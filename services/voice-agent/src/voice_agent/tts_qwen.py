"""Qwen-TTS Realtime 云端 TTS 客户端 - dashscope SDK + asyncio 桥。

通过阿里云百炼 DashScope 的 Qwen3-TTS-Flash-Realtime 模型合成语音，
输出 PCM 24kHz mono 16-bit，按需重采样到目标采样率（默认 16kHz 供 FreeSWITCH）。

协议要点（SDK 封装，参见
https://help.aliyun.com/zh/model-studio/realtime-tts-user-guide）：
- WebSocket 双向流式，url=wss://dashscope.aliyuncs.com/api-ws/v1/realtime
- session.update 设置 voice / response_format / mode
- input_text_buffer.append + finish（server_commit 模式由服务端自动提交）
- 事件：session.created / response.audio.delta(base64 PCM) / response.done / session.finished

SDK 基于线程回调，本模块用 asyncio.Queue + loop.call_soon_threadsafe 桥接到
事件循环，保持与 CosyVoiceTTS 一致的 async 接口（synthesize / interrupt / close）。
"""

from __future__ import annotations

import asyncio
import base64
import logging
import threading
from typing import Awaitable, Callable, Optional

from . import audio
from .types import TTSChunk

logger = logging.getLogger(__name__)

# Qwen-TTS 固定输出 24kHz（PCM_24000HZ_MONO_16BIT）
_QWEN_SOURCE_SAMPLE_RATE = 24000


class QwenTTS:
    """Qwen-TTS Realtime 流式 TTS 客户端。

    dashscope SDK 为可选依赖：未安装时 synthesize() 抛 RuntimeError，
    由 tts_factory.create_tts() 捕获并降级到 MockTTS。
    """

    def __init__(
        self,
        api_key: str,
        model: str = "qwen3-tts-flash-realtime",
        voice: str = "Cherry",
        url: str = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
        target_sample_rate: int = 16000,
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._voice = voice
        self._url = url
        self._target_sr = target_sample_rate
        self._timeout = timeout
        self._current_task: Optional[asyncio.Task[None]] = None
        self._cancel_event: Optional[threading.Event] = None
        self._closed = False

    @property
    def name(self) -> str:
        return "qwen-tts"

    async def synthesize(
        self,
        text: str,
        on_chunk: Callable[[TTSChunk], Awaitable[None]],
        speaker: Optional[str] = None,
        instruct_text: Optional[str] = None,
    ) -> None:
        """流式合成语音。

        将合成任务包装为 asyncio.Task 以支持 interrupt()。
        on_chunk 在每个 PCM 块（已重采样到 target_sample_rate）到达时被调用。
        """
        if self._closed:
            raise RuntimeError("QwenTTS 已关闭")
        if self._current_task is not None and not self._current_task.done():
            raise RuntimeError("已有合成任务进行中，请先调用 interrupt()")

        self._current_task = asyncio.current_task()
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[tuple[str, Optional[bytes]]] = asyncio.Queue()
        cancel_event = threading.Event()
        self._cancel_event = cancel_event

        def push(item: tuple[str, Optional[bytes]]) -> None:
            """SDK 回调线程 → asyncio 队列（线程安全）。"""
            try:
                loop.call_soon_threadsafe(queue.put_nowait, item)
            except RuntimeError:
                # 事件循环已关闭，忽略
                pass

        def run_sync() -> None:
            """在 executor 线程中跑 dashscope SDK 同步调用。"""
            try:
                import dashscope
                from dashscope.audio.qwen_tts_realtime import (
                    AudioFormat,
                    QwenTtsRealtime,
                    QwenTtsRealtimeCallback,
                )
            except ImportError as err:
                push(("error", err.args[0].encode() if err.args else b"import error"))
                return

            dashscope.api_key = self._api_key
            finished_event = threading.Event()

            class Callback(QwenTtsRealtimeCallback):
                def on_open(self) -> None:
                    logger.debug("[QwenTTS] connection opened")

                def on_close(self, code: int, msg: str) -> None:
                    logger.debug("[QwenTTS] connection closed: %s %s", code, msg)
                    finished_event.set()

                def on_event(self, response: dict) -> None:
                    event_type = response.get("type", "")
                    if event_type == "response.audio.delta":
                        delta = response.get("delta", "")
                        if delta:
                            try:
                                pcm = base64.b64decode(delta)
                                push(("audio", pcm))
                            except Exception as err:
                                logger.warning("[QwenTTS] base64 decode failed: %s", err)
                    elif event_type == "session.finished":
                        push(("finished", None))
                        finished_event.set()
                    elif event_type == "error":
                        err_msg = response.get("error", {}).get("message", "unknown")
                        logger.error("[QwenTTS] server error: %s", err_msg)
                        push(("error", err_msg.encode()))
                        finished_event.set()

            synth = QwenTtsRealtime(
                model=self._model,
                callback=Callback(),
                url=self._url,
            )
            try:
                synth.connect()
                session_kwargs: dict = {
                    "voice": speaker or self._voice,
                    "response_format": AudioFormat.PCM_24000HZ_MONO_16BIT,
                    "mode": "server_commit",
                }
                if instruct_text:
                    # 指令模式需 qwen3-tts-instruct-flash-realtime 模型
                    session_kwargs["instructions"] = instruct_text
                    session_kwargs["optimize_instructions"] = True
                synth.update_session(**session_kwargs)
                synth.append_text(text)
                synth.finish()

                # 阻塞等待合成完成或取消信号（每 0.5s 检查一次 cancel）
                while not finished_event.wait(timeout=0.5):
                    if cancel_event.is_set():
                        logger.info("[QwenTTS] synthesis cancelled (barge-in)")
                        break
            except Exception as err:
                logger.exception("[QwenTTS] sync synthesis failed: %s", err)
                push(("error", str(err).encode()))
            finally:
                try:
                    synth.get_duplex_api().close(1000, "bye")
                except Exception:
                    pass

        sync_future = loop.run_in_executor(None, run_sync)

        try:
            # 消费队列，把 PCM 块回调给调用方
            while True:
                kind, data = await queue.get()
                if kind == "audio" and data:
                    resampled = audio.resample(
                        data, _QWEN_SOURCE_SAMPLE_RATE, self._target_sr
                    )
                    if resampled:
                        await on_chunk(
                            TTSChunk(
                                audio=resampled,
                                sample_rate=self._target_sr,
                                is_final=False,
                            )
                        )
                elif kind == "finished":
                    await on_chunk(
                        TTSChunk(audio=b"", sample_rate=self._target_sr, is_final=True)
                    )
                    break
                elif kind == "error":
                    raise RuntimeError(
                        f"Qwen-TTS 合成失败: {data.decode() if data else 'unknown'}"
                    )
        except asyncio.CancelledError:
            logger.info("[QwenTTS] synthesis cancelled (barge-in)")
            cancel_event.set()
            raise
        finally:
            # 确保 executor 线程退出（cancel 已设置，最多 0.5s 后返回）
            try:
                await asyncio.wrap_future(sync_future)
            except Exception:
                pass
            self._current_task = None
            self._cancel_event = None

    def interrupt(self) -> None:
        """中断当前合成任务（barge-in）。"""
        if self._cancel_event is not None:
            self._cancel_event.set()
        if self._current_task and not self._current_task.done():
            self._current_task.cancel()

    async def close(self) -> None:
        """关闭客户端（应用退出时调用）。"""
        self._closed = True
        self.interrupt()
