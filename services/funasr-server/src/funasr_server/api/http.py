"""HTTP 同步识别端点 —— 上传音频文件，返回完整识别结果。

基于原 S:\\FunASR\\runtime\\python\\http\\server.py 重构：
- 直接 model 对象 → ModelManager（线程池 + 限流）
- 单一 /recognition → 同时注册 /recognize（规范）和 /recognition（兼容原 FunASR）
- 补充文件大小限制、错误处理、structlog 日志

用法：
    curl -X POST http://localhost:10095/recognize \\
         -F "audio=@test.wav"
响应：
    {"text": "...", "sentences": [{"text": "...", "start": 0, "end": 1000}], "code": 0}
"""

from __future__ import annotations

import os
import uuid
from typing import Any

import aiofiles
import structlog
from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse

from ..config import Config
from ..models import ModelManager

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["http"])


async def _recognize(audio: UploadFile, request: Request) -> JSONResponse:
    """HTTP 识别核心逻辑。

    流程：
    1. 校验文件大小
    2. 保存到临时文件
    3. ffmpeg 转码为 16kHz mono PCM s16le
    4. 调用 ModelManager.transcribe_offline
    5. 解析 sentence_info 返回
    """
    app = request.app
    config: Config = app.state.config
    models: ModelManager = app.state.models
    semaphores: dict[str, Any] = app.state.semaphores

    # 1) 校验文件名
    if not audio.filename:
        return JSONResponse(
            status_code=400,
            content={"msg": "filename is empty", "code": 1},
        )
    suffix = audio.filename.split(".")[-1].lower()
    if not suffix:
        suffix = "wav"

    # 2) 读取内容并校验大小
    content = await audio.read()
    if not content:
        return JSONResponse(
            status_code=400,
            content={"msg": "audio file is empty", "code": 1},
        )
    if len(content) > config.max_upload_mb * 1024 * 1024:
        return JSONResponse(
            status_code=413,
            content={
                "msg": f"file too large, max {config.max_upload_mb}MB",
                "code": 1,
            },
        )

    # 3) 保存到临时文件
    audio_path = os.path.join(config.temp_dir, f"{uuid.uuid1()}.{suffix}")
    try:
        async with aiofiles.open(audio_path, "wb") as out_file:
            await out_file.write(content)
    except Exception as err:
        logger.exception("http.save_temp_failed", error=str(err))
        return JSONResponse(
            status_code=500,
            content={"msg": "save temp file failed", "code": 1},
        )

    # 4) ffmpeg 转码为 16kHz mono PCM s16le
    try:
        import ffmpeg

        audio_bytes, _ = (
            ffmpeg.input(audio_path, threads=0)
            .output("-", format="s16le", acodec="pcm_s16le", ac=1, ar=16000)
            .run(cmd=["ffmpeg", "-nostdin"], capture_stdout=True, capture_stderr=True)
        )
    except Exception as err:
        logger.exception("http.ffmpeg_failed", error=str(err))
        return JSONResponse(
            status_code=400,
            content={"msg": "ffmpeg transcode failed", "code": 1, "detail": str(err)},
        )
    finally:
        # 清理临时文件
        try:
            os.remove(audio_path)
        except Exception:
            pass

    if not audio_bytes:
        return JSONResponse(
            status_code=400,
            content={"msg": "ffmpeg produced empty output", "code": 1},
        )

    # 5) ASR 推理（线程池 + 限流）
    hotword = models.hotword  # 从 hotword_path 加载的全局热词
    try:
        rec_results = await models.run_blocking(
            models.model_asr.generate,
            input=audio_bytes,
            is_final=True,
            sentence_timestamp=True,
            batch_size_s=300,
            hotword=hotword if hotword else None,
            sem=semaphores["asr_offline"],
        )
    except Exception as err:
        logger.exception("http.asr_failed", error=str(err))
        return JSONResponse(
            status_code=500,
            content={"msg": "ASR inference failed", "code": -1, "detail": str(err)},
        )

    rec_result = rec_results[0] if rec_results else {}
    text = rec_result.get("text", "")

    # 6) 标点恢复
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
            logger.warning("http.punc_failed", error=str(err))

    # 7) 解析 sentence_info
    sentences: list[dict[str, Any]] = []
    sentence_info = rec_result.get("sentence_info")
    if sentence_info:
        for sentence in sentence_info:
            sentences.append(
                {
                    "text": sentence.get("text", ""),
                    "start": sentence.get("start", 0),
                    "end": sentence.get("end", 0),
                }
            )

    logger.info(
        "http.recognized",
        text_len=len(text),
        sentence_count=len(sentences),
        audio_bytes=len(audio_bytes),
    )

    return JSONResponse(
        content={
            "text": text,
            "sentences": sentences,
            "code": 0,
        }
    )


@router.post("/recognize")
async def recognize(audio: UploadFile = File(..., description="audio file to recognize"), request: Request = None) -> JSONResponse:
    """HTTP 同步识别（规范路径）。"""
    return await _recognize(audio, request)


@router.post("/recognition")
async def recognition(audio: UploadFile = File(..., description="audio file to recognize"), request: Request = None) -> JSONResponse:
    """HTTP 同步识别（兼容原 FunASR HTTP server 路径）。"""
    return await _recognize(audio, request)
