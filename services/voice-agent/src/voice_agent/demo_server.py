"""Demo WebSocket 端点 — 供前端 voice-demo 页面使用的轻量 ASR/TTS 接口。

与 server.py 的 /audio-stream（FreeSWITCH 生产链路）解耦：
- /asr-stream：纯 VAD + FunASR 转写，不启动 Agent、不跑对话循环
- /tts-stream：TTS 合成代理，把文本经 create_tts() 合成后流式回推 PCM

设计目标：让前端 Demo 复用 Python 网关的 WebRTC VAD + FunASR + Qwen-TTS，
而非浏览器自带 VAD 和直连 FunASR/CosyVoice。生产链路不受影响。
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Optional

import websockets
from websockets.protocol import State

from . import audio
from .stt import FunASRClient
from .types import STTEvent, TTSChunk
from .vad import VoiceActivityDetector

logger = logging.getLogger(__name__)


def _ws_open(ws: Any) -> bool:
    """检查 WebSocket 连接是否打开（兼容 websockets < 11 和 >= 11）。"""
    if hasattr(ws, "open"):
        return bool(ws.open)  # websockets < 11
    return getattr(ws, "state", None) == State.OPEN  # websockets >= 11


class DemoServer:
    """前端 Demo 用的 WebSocket 端点集合。

    由 VoiceAgentServer 在同端口上路由分发，不需要独立监听。
    """

    def __init__(
        self,
        funasr_ws_url: str,
        funasr_mode: str,
        funasr_hotwords: str,
        vad_aggressiveness: int,
        vad_frame_ms: int,
        vad_pre_buffer_ms: int,
        vad_silence_confirm_frames: int,
        vad_speech_confirm_frames: int,
        tts: Any,
    ) -> None:
        self._funasr_ws_url = funasr_ws_url
        self._funasr_mode = funasr_mode
        self._funasr_hotwords = funasr_hotwords
        self._vad_aggressiveness = vad_aggressiveness
        self._vad_frame_ms = vad_frame_ms
        self._vad_pre_buffer_ms = vad_pre_buffer_ms
        self._vad_silence_confirm = vad_silence_confirm_frames
        self._vad_speech_confirm = vad_speech_confirm_frames
        self._tts = tts

    # ------------------------------------------------------------------
    # /asr-stream — 纯 VAD + FunASR 转写
    # ------------------------------------------------------------------

    async def handle_asr(self, ws: Any) -> None:
        """处理 /asr-stream 连接。

        协议：
        - 第一帧：可选 JSON { "hotwords": "...", "mode": "2pass" }
        - 后续帧：二进制 PCM 16-bit 16kHz mono
        - 回推：JSON { "type": "partial"|"final"|"vad_state", ... }
        """
        call_id = f"demo-{int(time.time() * 1000)}"
        logger.info("[DemoServer/asr] connection call_id=%s", call_id)

        metadata: Optional[dict[str, Any]] = None
        stt: Optional[FunASRClient] = None
        vad: Optional[VoiceActivityDetector] = None
        pending_pcm = b""
        prev_speaking = False

        async def on_stt_event(event: STTEvent) -> None:
            """FunASR 事件 → 推 JSON 给浏览器。"""
            try:
                if _ws_open(ws):
                    await ws.send(
                        json.dumps(
                            {"type": event.type, "text": event.text},
                            ensure_ascii=False,
                        )
                    )
            except Exception as err:
                logger.warning("[DemoServer/asr] send result failed: %s", err)

        try:
            async for msg in ws:
                if metadata is None:
                    # 第一帧：可选 JSON 配置
                    if isinstance(msg, str):
                        try:
                            metadata = json.loads(msg)
                        except json.JSONDecodeError:
                            metadata = {}
                    else:
                        # 第一帧就是二进制（无配置），直接当音频处理
                        metadata = {}

                    hotwords = metadata.get("hotwords", self._funasr_hotwords)
                    mode = metadata.get("mode", self._funasr_mode)

                    # 创建 STT + VAD
                    stt = FunASRClient(
                        self._funasr_ws_url,
                        call_id,
                        mode=mode,  # type: ignore[arg-type]
                        hotwords=hotwords,
                        on_event=on_stt_event,
                    )
                    try:
                        await stt.connect()
                    except Exception as err:
                        logger.error(
                            "[DemoServer/asr] call_id=%s STT connect failed: %s",
                            call_id,
                            err,
                        )
                        if _ws_open(ws):
                            await ws.send(
                                json.dumps(
                                    {"type": "error", "message": f"FunASR 连接失败: {err}"}
                                )
                            )
                        return

                    vad = VoiceActivityDetector(
                        aggressiveness=self._vad_aggressiveness,
                        frame_ms=self._vad_frame_ms,
                        sample_rate=16000,
                        speech_confirm_frames=self._vad_speech_confirm,
                        silence_confirm_frames=self._vad_silence_confirm,
                        pre_buffer_ms=self._vad_pre_buffer_ms,
                    )
                    logger.info(
                        "[DemoServer/asr] call_id=%s ready (mode=%s)", call_id, mode
                    )
                    if isinstance(msg, str):
                        continue

                if isinstance(msg, str):
                    try:
                        control = json.loads(msg)
                    except json.JSONDecodeError:
                        continue
                    if control.get("is_speaking") is False and stt is not None:
                        pending_pcm = b""
                        await stt.end_speech()
                        if prev_speaking:
                            prev_speaking = False
                            try:
                                if _ws_open(ws):
                                    await ws.send(
                                        json.dumps(
                                            {
                                                "type": "vad_state",
                                                "is_speaking": False,
                                            }
                                        )
                                    )
                            except Exception:
                                pass
                    continue

                # 后续二进制 PCM 帧
                if not isinstance(msg, bytes) or stt is None or vad is None:
                    continue

                # WebSocket 可能按任意大小分包，先攒够 VAD 固定帧再处理。
                pending_pcm += msg
                frame_bytes = vad.frame_bytes
                aligned_bytes = (len(pending_pcm) // frame_bytes) * frame_bytes
                if aligned_bytes == 0:
                    continue

                pcm_chunk = pending_pcm[:aligned_bytes]
                pending_pcm = pending_pcm[aligned_bytes:]

                # VAD 切片 + feed（复用 agent.py:receive_audio 的逻辑）
                for frame in audio.split_into_frames(
                    pcm_chunk, self._vad_frame_ms, 16000
                ):
                    state, frames_to_send = vad.feed(frame)
                    for f in frames_to_send:
                        await stt.send_audio(f)
                    if state == "speech_end":
                        await stt.end_speech()

                    # VAD 状态变化 → 推 vad_state 事件
                    now_speaking = state in ("speech_start", "speech", "speech_end")
                    if now_speaking != prev_speaking:
                        prev_speaking = now_speaking
                        try:
                            if _ws_open(ws):
                                await ws.send(
                                    json.dumps(
                                        {
                                            "type": "vad_state",
                                            "is_speaking": now_speaking,
                                        }
                                    )
                                )
                        except Exception:
                            pass

        except websockets.exceptions.ConnectionClosed:
            logger.info("[DemoServer/asr] call_id=%s disconnected", call_id)
        except Exception as err:
            logger.exception("[DemoServer/asr] call_id=%s error: %s", call_id, err)
        finally:
            if stt is not None:
                try:
                    await stt.close()
                except Exception:
                    pass

    # ------------------------------------------------------------------
    # /tts-stream — TTS 合成代理
    # ------------------------------------------------------------------

    async def handle_tts(self, ws: Any) -> None:
        """处理 /tts-stream 连接。

        协议：
        - 客户端发 JSON { "text": "...", "speaker": "...", "instruct_text": "..." }
        - 客户端可发 { "type": "cancel" } 中断当前合成
        - 服务端回推：二进制 PCM 16-bit 帧 + 结束 JSON { "type": "final" }
        """
        logger.info("[DemoServer/tts] connection")

        synth_task: Optional[asyncio.Task[None]] = None

        async def on_chunk(chunk: TTSChunk) -> None:
            """TTS 音频块 → 推给浏览器。"""
            try:
                if not _ws_open(ws):
                    return
                if chunk.audio:
                    await ws.send(chunk.audio)
                if chunk.is_final:
                    await ws.send(json.dumps({"type": "final"}))
            except Exception as err:
                logger.warning("[DemoServer/tts] send chunk failed: %s", err)

        try:
            async for msg in ws:
                # 解析 JSON 请求
                try:
                    req = json.loads(msg)
                except (json.JSONDecodeError, TypeError):
                    continue

                if req.get("type") == "cancel":
                    # 中断当前合成
                    if synth_task and not synth_task.done():
                        self._tts.interrupt()
                    continue

                text = req.get("text", "").strip()
                if not text:
                    continue

                # 中断前一个合成任务（若有）
                if synth_task and not synth_task.done():
                    self._tts.interrupt()
                    try:
                        await synth_task
                    except (asyncio.CancelledError, Exception):
                        pass

                speaker = req.get("speaker")
                instruct_text = req.get("instruct_text")

                synth_task = asyncio.create_task(
                    self._run_synth(text, speaker, instruct_text, on_chunk)
                )

        except websockets.exceptions.ConnectionClosed:
            logger.info("[DemoServer/tts] disconnected")
        except Exception as err:
            logger.exception("[DemoServer/tts] error: %s", err)
        finally:
            if synth_task and not synth_task.done():
                self._tts.interrupt()
                try:
                    await synth_task
                except (asyncio.CancelledError, Exception):
                    pass

    async def _run_synth(
        self,
        text: str,
        speaker: Optional[str],
        instruct_text: Optional[str],
        on_chunk: Any,
    ) -> None:
        """执行一次 TTS 合成（包装异常）。"""
        try:
            await self._tts.synthesize(text, on_chunk, speaker, instruct_text)
        except asyncio.CancelledError:
            logger.info("[DemoServer/tts] synthesis cancelled")
            raise
        except Exception as err:
            logger.exception("[DemoServer/tts] synthesis failed: %s", err)
            try:
                on_chunk_sync = on_chunk
                # 错误时也发 final，避免前端卡在 synthesizing 状态
                await on_chunk_sync(TTSChunk(audio=b"", sample_rate=16000, is_final=True))
            except Exception:
                pass
