"""WebSocket 实时流式端点 —— 与 voice-agent stt.py 协议完全兼容。

从原 funasr_wss_server.py 迁移到 FastAPI WebSocket API：
- `websockets.serve(ws_serve, ...)` → `@app.websocket("/")`
- `async for message in websocket` → `async for message in websocket.iter_data()`
- `websocket.send(text)` → `websocket.send_text(text)`
- `websocket.xxx` 属性存储 → `ClientState` 数据类

协议（与 stt.py 对齐）：
1. 客户端连接时 subprotocols=["binary"]
2. 第一帧 JSON 配置：{mode, chunk_size, chunk_interval, wav_name, is_speaking, hotwords, itn}
3. 持续推送二进制 PCM 16-bit 16kHz mono
4. 推送 {is_speaking: false} 触发 offline 整句识别
5. 响应：
   - {mode:"2pass-online", text:"..."} 为 partial（在线流式）
   - {mode:"2pass-offline", text:"...", is_final:true, ...} 为 final（离线整句）

2pass 去重：online is_final=True 时不发送，由 offline 兜底（原 L699-700）。

服务端 VAD 开关（config.vad_enabled / FUNASR_SERVER_VAD_ENABLED）：
关闭时跳过 fsmn-vad 推理，整段上游音频按语音处理，走 finalize_offline 既有的
fallback 路径（frames_asr 为空时退回 frames 全部音频），由上游 {is_speaking:false}
信号驱动整句触发。
"""

from __future__ import annotations

import json
import os
import time
import wave
from dataclasses import dataclass, field
from typing import Any

import structlog
from fastapi import FastAPI, WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from ..config import Config
from ..models import ModelManager, to_python

logger = structlog.get_logger(__name__)


# ===================== 辅助函数 =====================


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _pcm_duration_ms(pcm_bytes: bytes, fs: int, ch: int = 1, sampwidth: int = 2) -> int:
    """根据 fs/ch/sampwidth 计算 PCM 时长（毫秒）。"""
    if not pcm_bytes:
        return 0
    bytes_per_ms = (fs * ch * sampwidth) / 1000.0
    if bytes_per_ms <= 0:
        return 0
    return int(len(pcm_bytes) / bytes_per_ms)


def _save_wav_sync(out_path: str, audio_bytes: bytes, fs: int, ch: int = 1, sampwidth: int = 2) -> None:
    """同步保存 PCM 为 WAV 文件。"""
    with wave.open(out_path, "wb") as wf:
        wf.setnchannels(ch)
        wf.setsampwidth(sampwidth)
        wf.setframerate(fs)
        wf.writeframes(audio_bytes)


def _save_offline_wav_sync(state: "ClientState", audio_bytes: bytes, reason: str) -> None:
    """保存离线阶段送入 ASR 的音频片段，方便人工试听排查 VAD 切分是否正确。

    约定：audio_bytes 为单声道 PCM16 little-endian（默认 16k）。
    """
    if not audio_bytes:
        return
    if "2pass" not in (state.mode or ""):
        return

    fs = int(state.audio_fs or 16000)
    ch = 1
    sampwidth = 2

    # int16 对齐
    if len(audio_bytes) % 2 == 1:
        audio_bytes = audio_bytes[:-1]
        if not audio_bytes:
            return

    seg_idx = int(state.offline_seg_idx)
    state.offline_seg_idx = seg_idx + 1

    duration_ms = _pcm_duration_ms(audio_bytes, fs=fs, ch=ch, sampwidth=sampwidth)

    base_dir = state.offline_save_dir
    try:
        os.makedirs(base_dir, exist_ok=True)
    except Exception:
        pass

    wav_name = (state.wav_name or "microphone").replace("/", "_")
    ts = int(time.time() * 1000)
    fname = f"{wav_name}_{ts}_seg{seg_idx:04d}_{reason}_{duration_ms}ms.wav"
    out_path = os.path.join(base_dir, fname)

    try:
        _save_wav_sync(out_path, audio_bytes, fs=fs, ch=ch, sampwidth=sampwidth)
        logger.info("ws.save_offline_seg", path=out_path, duration_ms=duration_ms, bytes=len(audio_bytes))
    except Exception as err:
        logger.warning("ws.save_offline_seg_failed", error=str(err))


def _sv_and_match_sync(models: ModelManager, audio_in: bytes) -> tuple[str, float]:
    """同步执行 SV embedding + speaker_db 匹配，返回 (spk_name, best_score)。

    放在一个线程池任务内执行，避免两次 run_blocking 切换开销。
    """
    if not audio_in:
        return "unknown", 0.0
    try:
        embedding = models.speaker_embedding(audio_in)
        return models.speaker_match(embedding)
    except Exception as err:
        logger.warning("ws.sv_failed", error=str(err))
        return "unknown", 0.0


# ===================== 每连接状态 =====================


@dataclass
class ClientState:
    """Per-connection WebSocket state（替代原 websocket.xxx 属性存储）。

    所有 status_xxx dict 会被 model.generate 内部 mutate（如 cache 字段），
    调用方需保留引用以便下次传入。
    """

    # 客户端配置（从初始 JSON 帧解析）
    chunk_interval: int = 10
    wav_name: str = "microphone"
    mode: str = "2pass"
    is_speaking: bool = True
    audio_fs: int = 16000

    # ASR online 流式状态（作为 **kwargs 传给 model.generate）
    status_asr_online: dict[str, Any] = field(
        default_factory=lambda: {
            "cache": {},
            "is_final": False,
            "chunk_size": [5, 10, 5],
            "encoder_chunk_look_back": 5,
            "decoder_chunk_look_back": 5,
        }
    )

    # ASR offline 状态（hotword 等）
    status_asr: dict[str, Any] = field(default_factory=dict)

    # VAD 状态
    status_vad: dict[str, Any] = field(
        default_factory=lambda: {"cache": {}, "is_final": False}
    )

    # Punc 状态
    status_punc: dict[str, Any] = field(default_factory=lambda: {"cache": {}})

    # VAD 时间累计（用于 speech_start 偏移计算）
    vad_pre_idx: int = 0

    # 调试：离线片段保存
    offline_seg_idx: int = 0
    offline_save_dir: str = "offline_segments"


# ===================== 推理子任务 =====================


async def _async_vad(
    state: ClientState,
    models: ModelManager,
    semaphores: dict[str, Any],
    audio_in: bytes,
) -> tuple[int, int]:
    """VAD 语音端点检测，返回 (speech_start_ms, speech_end_ms)，-1 表示无事件。"""
    out = await models.run_blocking(
        models.model_vad.generate,
        input=audio_in,
        cache=state.status_vad["cache"],
        chunk_size=state.status_vad.get("chunk_size", 10),
        is_final=state.status_vad.get("is_final", False),
        sem=semaphores["vad"],
    )
    if not out:
        return -1, -1
    segments = out[0].get("value", [])

    # 原逻辑：仅当恰好 1 段时才解析 start/end（>1 段视为异常）
    if len(segments) == 0 or len(segments) > 1:
        return -1, -1

    speech_start = -1
    speech_end = -1
    if segments[0][0] != -1:
        speech_start = segments[0][0]
    if segments[0][1] != -1:
        speech_end = segments[0][1]
    return speech_start, speech_end


async def _async_asr_online(
    websocket: WebSocket,
    state: ClientState,
    models: ModelManager,
    semaphores: dict[str, Any],
    audio_in: bytes,
) -> None:
    """在线流式 ASR 推理，推送 partial JSON。

    2pass 模式下 is_final=True 时不发送（由 offline 兜底），原 L699-700。
    """
    if not audio_in:
        return

    rec_out = await models.run_blocking(
        models.model_asr_streaming.generate,
        input=audio_in,
        cache=state.status_asr_online["cache"],
        is_final=state.status_asr_online.get("is_final", False),
        chunk_size=state.status_asr_online.get("chunk_size", [5, 10, 5]),
        encoder_chunk_look_back=state.status_asr_online.get("encoder_chunk_look_back", 5),
        decoder_chunk_look_back=state.status_asr_online.get("decoder_chunk_look_back", 5),
        hotword=state.status_asr_online.get("hotword", ""),
        sem=semaphores["asr_online"],
    )
    rec_result = rec_out[0] if rec_out else {}

    # 2pass 去重：online is_final=True 时不发，由 offline 兜底
    if state.mode == "2pass" and state.status_asr_online.get("is_final", False):
        return

    text = rec_result.get("text", "")
    if not text:
        return

    mode = "2pass-online" if "2pass" in (state.mode or "") else state.mode
    message = {
        "mode": mode,
        "text": text,
        "wav_name": state.wav_name,
        "is_final": bool(
            state.status_asr_online.get("is_final", False) or (not state.is_speaking)
        ),
    }
    await websocket.send_text(json.dumps(message, ensure_ascii=False))


async def _async_asr_offline(
    websocket: WebSocket,
    state: ClientState,
    models: ModelManager,
    semaphores: dict[str, Any],
    audio_in: bytes,
) -> None:
    """离线整句 ASR 推理（含 SV + Punc），推送 final JSON。"""
    mode = "2pass-offline" if "2pass" in (state.mode or "") else state.mode

    if not audio_in:
        message = {
            "mode": mode,
            "text": "",
            "wav_name": state.wav_name,
            "is_final": True,
        }
        await websocket.send_text(json.dumps(message, ensure_ascii=False))
        return

    # 1) ASR 离线整句
    asr_kwargs: dict[str, Any] = {
        "input": audio_in,
        "is_final": True,
        "sentence_timestamp": True,
        "batch_size_s": 300,
    }
    hotword = state.status_asr.get("hotword", "")
    if hotword:
        asr_kwargs["hotword"] = hotword

    rec_result_list = await models.run_blocking(
        models.model_asr.generate,
        sem=semaphores["asr_offline"],
        **asr_kwargs,
    )
    rec_result = rec_result_list[0] if rec_result_list else {}

    text = rec_result.get("text", "")
    timestamp = rec_result.get("timestamp")
    sentence_info = rec_result.get("sentence_info")

    # 2) 声纹识别（SV + 匹配合并为一个线程池任务）
    spk_name, best_score = await models.run_blocking(
        _sv_and_match_sync, models, audio_in, sem=semaphores["sv"]
    )

    # 3) 标点恢复
    punc_array = None
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
            if "punc_array" in punc_result:
                punc_array = punc_result["punc_array"]
        except Exception as err:
            logger.warning("ws.punc_failed", error=str(err))

    # 4) 构造并推送 final 消息
    message: dict[str, Any] = {
        "mode": mode,
        "spk_name": spk_name,
        "spk_score": float(best_score),
        "text": text,
        "wav_name": state.wav_name,
        "is_final": True,
    }
    if timestamp is not None:
        message["timestamp"] = to_python(timestamp)
    if sentence_info is not None:
        message["sentence_info"] = to_python(sentence_info)
    if punc_array is not None:
        message["punc_array"] = to_python(punc_array)

    await websocket.send_text(json.dumps(message, ensure_ascii=False))


# ===================== 主 handler =====================


async def ws_handler(websocket: WebSocket) -> None:
    """WebSocket 主处理函数。

    流程：
    1. accept（subprotocol=binary，兼容 stt.py）
    2. 循环接收消息：JSON 配置帧 / 二进制 PCM 帧
    3. 累积 PCM → chunk_interval 边界触发 online ASR
    4. 每帧跑 VAD → speech_end 或 is_speaking=false 触发 offline ASR
    5. 推送 partial / final JSON
    """
    await websocket.accept(subprotocol="binary")

    app = websocket.app
    config: Config = app.state.config
    models: ModelManager = app.state.models
    semaphores: dict[str, Any] = app.state.semaphores

    state = ClientState(offline_save_dir=config.save_offline_segments_dir)

    # 帧缓冲（局部变量，避免跨连接泄漏）
    frames: list[bytes] = []  # 全部 PCM（用于 speech_start 前瞻）
    frames_asr: list[bytes] = []  # offline ASR 输入（speech_start 后累积）
    frames_asr_online: list[bytes] = []  # online ASR 输入（chunk_interval 累积）
    speech_start = False
    speech_end_i = -1

    logger.info(
        "ws.connected",
        client=f"{websocket.client.host}:{websocket.client.port}" if websocket.client else "unknown",
        save_offline=config.save_offline_segments,
    )

    async def finalize_offline(reason: str) -> None:
        """Run offline ASR for the current utterance and reset per-utterance buffers.

        The client can end an utterance by sending a JSON control frame
        {"is_speaking": false}. In that case no further binary frame may arrive, so
        finalization must happen immediately instead of waiting for the next PCM
        packet to pass through the binary-frame branch.
        """
        nonlocal frames, frames_asr, frames_asr_online, speech_start, speech_end_i

        if state.mode in ("2pass", "offline"):
            # Prefer the server-side VAD utterance buffer. If the upstream client
            # already gates audio with its own VAD, the local server VAD may not
            # have opened speech_start yet; fall back to all frames received for
            # this utterance so {is_speaking:false} can still produce a final.
            audio_in = b"".join(frames_asr or frames)

            if config.save_offline_segments and audio_in:
                try:
                    await models.run_blocking(
                        _save_offline_wav_sync,
                        state,
                        audio_in,
                        reason,
                        sem=semaphores["wav"],
                    )
                except Exception:
                    logger.exception("ws.save_offline_failed")

            try:
                await _async_asr_offline(websocket, state, models, semaphores, audio_in)
            except Exception:
                logger.exception("ws.asr_offline_error")

        frames_asr = []
        speech_start = False
        frames_asr_online = []
        state.status_asr_online["cache"] = {}

        if reason == "not_speaking":
            state.vad_pre_idx = 0
            frames = []
            state.status_vad["cache"] = {}
            speech_end_i = -1
        else:
            frames = frames[-20:]

    try:
        while True:
            try:
                raw = await websocket.receive()
            except WebSocketDisconnect:
                break

            if raw["type"] == "websocket.disconnect":
                break

            if raw["type"] != "websocket.receive":
                continue

            if "text" in raw:
                message: str | bytes = raw["text"]
            elif "bytes" in raw:
                message = raw["bytes"]
            else:
                continue

            # ========== 1) JSON 配置帧 ==========
            if isinstance(message, str):
                try:
                    msg = json.loads(message)
                except json.JSONDecodeError:
                    logger.warning("ws.bad_json", raw=message[:200])
                    continue

                if "is_speaking" in msg:
                    state.is_speaking = bool(msg["is_speaking"])
                    state.status_asr_online["is_final"] = (not state.is_speaking)

                if "chunk_interval" in msg:
                    state.chunk_interval = _safe_int(msg["chunk_interval"], state.chunk_interval)

                if "wav_name" in msg:
                    state.wav_name = msg.get("wav_name") or state.wav_name

                if "chunk_size" in msg:
                    cs = msg["chunk_size"]
                    if isinstance(cs, str):
                        cs = [x.strip() for x in cs.split(",") if x.strip()]
                    state.status_asr_online["chunk_size"] = [int(x) for x in cs]

                if "encoder_chunk_look_back" in msg:
                    state.status_asr_online["encoder_chunk_look_back"] = msg["encoder_chunk_look_back"]

                if "decoder_chunk_look_back" in msg:
                    state.status_asr_online["decoder_chunk_look_back"] = msg["decoder_chunk_look_back"]

                if "hotwords" in msg:
                    hw = msg["hotwords"]
                    state.status_asr["hotword"] = hw
                    state.status_asr_online["hotword"] = hw

                if "mode" in msg:
                    state.mode = msg["mode"] or state.mode

                if "audio_fs" in msg:
                    state.audio_fs = _safe_int(msg["audio_fs"], 16000)

                if "is_speaking" in msg and not state.is_speaking:
                    await finalize_offline("not_speaking")

                # itn 字段被 stt.py 发送但服务端不处理（与原 wss_server 一致）
                continue

            # ========== 2) 二进制 PCM 帧 ==========
            if "chunk_size" not in state.status_asr_online:
                logger.warning("ws.audio_before_config")
                continue

            # 计算 VAD chunk_size（原 L437-439）
            try:
                state.status_vad["chunk_size"] = int(
                    state.status_asr_online["chunk_size"][1] * 60 / state.chunk_interval
                )
            except Exception:
                logger.warning("ws.vad_chunk_size_failed")
                continue

            pcm: bytes = message
            frames.append(pcm)
            duration_ms = _pcm_duration_ms(pcm, fs=state.audio_fs)
            state.vad_pre_idx += duration_ms

            # ---- online ASR（chunk_interval 边界触发）----
            frames_asr_online.append(pcm)
            state.status_asr_online["is_final"] = (speech_end_i != -1)

            if (len(frames_asr_online) % state.chunk_interval == 0) or state.status_asr_online["is_final"]:
                if state.mode in ("2pass", "online"):
                    audio_in = b"".join(frames_asr_online)
                    try:
                        await _async_asr_online(websocket, state, models, semaphores, audio_in)
                    except Exception:
                        logger.exception("ws.asr_online_error")
                frames_asr_online = []

            if speech_start:
                frames_asr.append(pcm)

            # ---- VAD 在线检测 ----
            if config.vad_enabled:
                try:
                    speech_start_i, speech_end_i = await _async_vad(state, models, semaphores, pcm)
                except Exception:
                    logger.exception("ws.vad_error")
                    speech_start_i, speech_end_i = -1, -1
            else:
                # 服务端 VAD 关闭（FUNASR_SERVER_VAD_ENABLED=false）：跳过 fsmn-vad
                # 推理，不产生 speech_start/speech_end 事件。上游 voice-agent 已用
                # WebRTC VAD 门控，靠 {is_speaking:false} 信号驱动 finalize_offline；
                # speech_start 始终为 False → frames_asr 始终为空 → finalize_offline
                # 走既有 fallback（audio_in = frames_asr or frames），整段接收到的
                # 音频当一句话送 ASR，不新增分支路径。
                speech_start_i, speech_end_i = -1, -1

            if speech_start_i != -1:
                speech_start = True
                if duration_ms > 0:
                    beg_bias = (state.vad_pre_idx - speech_start_i) // duration_ms
                else:
                    beg_bias = 0
                frames_pre = frames[-beg_bias:] if beg_bias > 0 else []
                frames_asr = []
                frames_asr.extend(frames_pre)

            # ========== 3) 2pass offline 触发（VAD end 或 is_speaking=false）==========
            if (speech_end_i != -1) or (not state.is_speaking):
                reason = "vad_end" if speech_end_i != -1 else "not_speaking"
                await finalize_offline(reason)

    except WebSocketDisconnect:
        logger.info("ws.disconnected")
    except Exception:
        logger.exception("ws.handler_error")
    finally:
        # 确保连接关闭
        try:
            if websocket.application_state != WebSocketState.DISCONNECTED:
                await websocket.close()
        except Exception:
            pass


# ===================== 路由注册 =====================


def register_ws_routes(app: FastAPI) -> None:
    """注册 WebSocket 路由。

    同时注册 `/` 和 `/ws` 两个路径：
    - `/`：兼容 stt.py 的 `ws://localhost:10095` 无路径连接
    - `/ws`：规范路径，供其他客户端使用
    """

    @app.websocket("/")
    async def ws_root(websocket: WebSocket) -> None:
        await ws_handler(websocket)

    @app.websocket("/ws")
    async def ws_path(websocket: WebSocket) -> None:
        await ws_handler(websocket)

    logger.info("ws.routes_registered", paths=["/", "/ws"])
