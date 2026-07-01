"""SSE 流式识别端点 —— 上传音频文件，以 Server-Sent Events 逐句推送识别结果。

与 HTTP /recognize 的区别：
- HTTP：等全部识别完成才返回（适合短音频、需要完整结果）
- SSE：VAD 切分后逐句推送（适合长音频、需要实时反馈）

注意：本端点使用 POST + StreamingResponse，适用于 curl / fetch / Python httpx，
不兼容浏览器 EventSource API（EventSource 仅支持 GET）。

用法：
    curl -X POST http://localhost:10095/recognize/stream \\
         -F "audio=@test.wav" --no-buffer

事件流：
    event: status
    data: {"stage": "transcoding"}

    event: vad
    data: {"segments": [[0, 1500], [2000, 3500]], "total": 2}

    event: sentence
    data: {"index": 0, "text": "...", "start": 0, "end": 1500}

    event: sentence
    data: {"index": 1, "text": "...", "start": 2000, "end": 3500}

    event: done
    data: {"total_sentences": 2}

    event: error
    data: {"msg": "error message"}
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any, AsyncIterator

import aiofiles
import structlog
from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import StreamingResponse

from ..config import Config
from ..models import ModelManager

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["sse"])

# 16kHz mono PCM s16le: 1ms = 32 bytes
_BYTES_PER_MS = 32


def _sse(event: str, data: dict[str, Any]) -> bytes:
    """构造 SSE 事件帧。"""
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


async def _transcode_to_pcm(audio_path: str) -> bytes | None:
    """ffmpeg 转码为 16kHz mono PCM s16le。"""
    try:
        import ffmpeg

        audio_bytes, _ = (
            ffmpeg.input(audio_path, threads=0)
            .output("-", format="s16le", acodec="pcm_s16le", ac=1, ar=16000)
            .run(cmd=["ffmpeg", "-nostdin"], capture_stdout=True, capture_stderr=True)
        )
        return audio_bytes
    except Exception as err:
        logger.exception("sse.ffmpeg_failed", error=str(err))
        return None


def _extract_segment_pcm(pcm: bytes, start_ms: int, end_ms: int) -> bytes:
    """从完整 PCM 中提取 [start_ms, end_ms) 时间段的字节。"""
    start_byte = start_ms * _BYTES_PER_MS
    end_byte = end_ms * _BYTES_PER_MS
    # 边界对齐到 int16（2 字节）
    start_byte = start_byte - (start_byte % 2)
    end_byte = end_byte - (end_byte % 2)
    if start_byte >= len(pcm):
        return b""
    end_byte = min(end_byte, len(pcm))
    return pcm[start_byte:end_byte]


async def _event_generator(audio: UploadFile, request: Request) -> AsyncIterator[bytes]:
    """SSE 事件生成器。"""
    app = request.app
    config: Config = app.state.config
    models: ModelManager = app.state.models
    semaphores: dict[str, Any] = app.state.semaphores

    # 1) 校验文件名
    if not audio.filename:
        yield _sse("error", {"msg": "filename is empty"})
        return

    suffix = audio.filename.split(".")[-1].lower() if audio.filename else "wav"
    if not suffix:
        suffix = "wav"

    # 2) 读取内容并校验大小
    content = await audio.read()
    if not content:
        yield _sse("error", {"msg": "audio file is empty"})
        return
    if len(content) > config.max_upload_mb * 1024 * 1024:
        yield _sse("error", {"msg": f"file too large, max {config.max_upload_mb}MB"})
        return

    # 3) 保存到临时文件
    audio_path = os.path.join(config.temp_dir, f"{uuid.uuid1()}.{suffix}")
    try:
        async with aiofiles.open(audio_path, "wb") as out_file:
            await out_file.write(content)
    except Exception as err:
        logger.exception("sse.save_temp_failed", error=str(err))
        yield _sse("error", {"msg": "save temp file failed", "detail": str(err)})
        return

    try:
        # 4) ffmpeg 转码
        yield _sse("status", {"stage": "transcoding"})
        pcm = await _transcode_to_pcm(audio_path)
        if not pcm:
            yield _sse("error", {"msg": "ffmpeg transcode failed"})
            return

        # 5) VAD 切分
        yield _sse("status", {"stage": "vad"})
        try:
            vad_out = await models.run_blocking(
                models.model_vad.generate,
                input=pcm,
                cache={},
                chunk_size=60,  # 默认 60ms（与 WS 默认一致）
                is_final=True,
                sem=semaphores["vad"],
            )
        except Exception as err:
            logger.exception("sse.vad_failed", error=str(err))
            yield _sse("error", {"msg": "VAD failed", "detail": str(err)})
            return

        segments: list[list[int]] = []
        if vad_out:
            segments = vad_out[0].get("value", [])

        # 过滤掉 [-1, -1]（无活动标记）
        segments = [s for s in segments if s[0] != -1 and s[1] != -1]

        yield _sse("vad", {"segments": segments, "total": len(segments)})

        if not segments:
            yield _sse("done", {"total_sentences": 0})
            return

        # 6) 逐句 ASR
        hotword = models.hotword
        total_sentences = 0

        for idx, (start_ms, end_ms) in enumerate(segments):
            seg_pcm = _extract_segment_pcm(pcm, start_ms, end_ms)
            if not seg_pcm:
                continue

            # 6a) 离线 ASR
            try:
                asr_kwargs: dict[str, Any] = {
                    "input": seg_pcm,
                    "is_final": True,
                    "sentence_timestamp": True,
                    "batch_size_s": 300,
                }
                if hotword:
                    asr_kwargs["hotword"] = hotword

                rec_results = await models.run_blocking(
                    models.model_asr.generate,
                    sem=semaphores["asr_offline"],
                    **asr_kwargs,
                )
            except Exception as err:
                logger.exception("sse.asr_failed", segment=idx, error=str(err))
                yield _sse(
                    "error",
                    {"msg": f"ASR failed at segment {idx}", "detail": str(err)},
                )
                continue

            rec_result = rec_results[0] if rec_results else {}
            text = rec_result.get("text", "")

            # 6b) 标点恢复
            if models.model_punc is not None and text:
                try:
                    punc_out = await models.run_blocking(
                        models.model_punc.generate,
                        input=text,
                        sem=semaphores["punc"],
                    )
                    punc_result = punc_out[0] if punc_out else {}
                    if punc_result.get("text"):
                        text = punc_result["text"]
                except Exception as err:
                    logger.warning("sse.punc_failed", segment=idx, error=str(err))

            if text:
                yield _sse(
                    "sentence",
                    {
                        "index": idx,
                        "text": text,
                        "start": start_ms,
                        "end": end_ms,
                    },
                )
                total_sentences += 1

        # 7) 结束
        yield _sse("done", {"total_sentences": total_sentences})

    except Exception as err:
        logger.exception("sse.unhandled", error=str(err))
        yield _sse("error", {"msg": "unhandled error", "detail": str(err)})
    finally:
        # 清理临时文件
        try:
            os.remove(audio_path)
        except Exception:
            pass


@router.post("/recognize/stream")
async def recognize_stream(
    audio: UploadFile = File(..., description="audio file to stream recognize"),
    request: Request = None,
) -> StreamingResponse:
    """SSE 流式识别（VAD 切分 + 逐句推送）。

    返回 `text/event-stream`，事件类型：status / vad / sentence / done / error。
    """
    return StreamingResponse(
        _event_generator(audio, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 禁用 nginx 缓冲
        },
    )
