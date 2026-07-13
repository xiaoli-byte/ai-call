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
import time
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
        clone_model: Optional[str] = None,
        voice: str = "Cherry",
        url: str = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
        target_sample_rate: int = 16000,
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key
        self._model = model
        # 复刻音色（qwen-tts-vc- 前缀）需用 vc-realtime 模型走 WebSocket 流式合成；
        # 预设系统音色（Cherry 等）用 _model。缺省 clone_model 时不区分（保持旧行为）。
        self._clone_model = clone_model
        self._voice = voice
        self._url = url
        self._target_sr = target_sample_rate
        self._timeout = timeout
        # 当前合成「子任务」。interrupt() 只取消它，绝不取消调用方任务——
        # 否则 barge-in 会给会话任务的取消计数 +1，上层 _speak 用
        # task.cancelling() 区分「打断/挂断」的判别器会把打断误判成挂断，
        # 把整个会话协程拆掉（真机僵尸通话根因，2026-07-12）。
        self._synthesis_task: Optional[asyncio.Task[None]] = None
        self._cancel_event: Optional[threading.Event] = None
        self._closed = False

    @property
    def name(self) -> str:
        return "qwen-tts"

    def _resolve_model(self, voice: Optional[str]) -> str:
        """按音色选合成模型：复刻音色（qwen-tts-vc- 前缀）用 vc-realtime 模型，
        其余（系统预设音色）用默认 _model。两者都走 realtime WebSocket 流式。

        依据阿里云约定：复刻音色绑定到 target_model=qwen3-tts-vc-realtime-*，
        不能跨模型使用；用非 vc 的 flash-realtime 合成复刻音色会被服务端拒绝
        （Invalid voice specified），导致通话无声。
        """
        if self._clone_model and voice and voice.startswith("qwen-tts-vc-"):
            return self._clone_model
        return self._model

    async def synthesize(
        self,
        text: str,
        on_chunk: Callable[[TTSChunk], Awaitable[None]],
        speaker: Optional[str] = None,
        instruct_text: Optional[str] = None,
    ) -> None:
        """流式合成语音。

        实际工作跑在独立子任务里：interrupt()（barge-in）只取消子任务，
        调用方任务的取消计数保持不变，上层得以用 task.cancelling() 区分
        「打断（吞掉继续）」与「挂断（上抛拆会话）」。
        on_chunk 在每个 PCM 块（已重采样到 target_sample_rate）到达时被调用。
        """
        if self._closed:
            raise RuntimeError("QwenTTS 已关闭")
        if self._synthesis_task is not None and not self._synthesis_task.done():
            raise RuntimeError("已有合成任务进行中，请先调用 interrupt()")

        cancel_event = threading.Event()
        child = asyncio.create_task(
            self._run_synthesis(text, on_chunk, speaker, instruct_text, cancel_event)
        )
        self._synthesis_task = child
        self._cancel_event = cancel_event
        try:
            await child
        except asyncio.CancelledError:
            # 两种来源：interrupt() 取消了 child（调用方计数为 0，上层按
            # barge-in 吞掉）；或调用方被外部取消（挂断）→ 级联停掉 child。
            cancel_event.set()
            if not child.done():
                child.cancel()
            raise
        finally:
            if not child.done():
                # 等 child 完全收尾（含 executor 线程 join），不留泄漏
                try:
                    await child
                except BaseException:
                    pass
            # 身份守卫：只清理本轮登记，防止旧任务的 finally 清掉新一轮状态
            if self._synthesis_task is child:
                self._synthesis_task = None
            if self._cancel_event is cancel_event:
                self._cancel_event = None

    async def _run_synthesis(
        self,
        text: str,
        on_chunk: Callable[[TTSChunk], Awaitable[None]],
        speaker: Optional[str],
        instruct_text: Optional[str],
        cancel_event: threading.Event,
    ) -> None:
        """合成子任务主体：dashscope 线程桥 + 队列消费。"""
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[tuple[str, Optional[bytes]]] = asyncio.Queue()

        def push(item: tuple[str, Optional[bytes]]) -> None:
            """SDK 回调线程 → asyncio 队列（线程安全）。"""
            try:
                loop.call_soon_threadsafe(queue.put_nowait, item)
            except RuntimeError:
                # 事件循环已关闭，忽略
                pass

        active_voice = speaker or self._voice
        active_model = self._resolve_model(active_voice)

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
            audio_chunks = 0
            audio_bytes = 0
            response_completed = False
            started_at = time.monotonic()

            class Callback(QwenTtsRealtimeCallback):
                def on_open(self) -> None:
                    logger.info("[QwenTTS] connection opened model=%s voice=%s", active_model, active_voice)

                def on_close(self, code: int, msg: str) -> None:
                    nonlocal response_completed
                    logger.info("[QwenTTS] connection closed code=%s message=%s", code, msg)
                    if not response_completed and not cancel_event.is_set():
                        push(
                            (
                                "error",
                                f"connection closed before response.done: {code} {msg}".encode(),
                            )
                        )
                    finished_event.set()

                def on_event(self, response: dict) -> None:
                    nonlocal audio_chunks, audio_bytes, response_completed
                    event_type = response.get("type", "")
                    if event_type == "response.audio.delta":
                        delta = response.get("delta", "")
                        if delta:
                            try:
                                pcm = base64.b64decode(delta)
                                audio_chunks += 1
                                audio_bytes += len(pcm)
                                if audio_chunks == 1:
                                    logger.info(
                                        "[QwenTTS] first audio chunk bytes=%d latency_ms=%d",
                                        len(pcm),
                                        int((time.monotonic() - started_at) * 1000),
                                    )
                                push(("audio", pcm))
                            except Exception as err:
                                logger.warning("[QwenTTS] base64 decode failed: %s", err)
                    elif event_type == "response.done":
                        response_completed = True
                        logger.info(
                            "[QwenTTS] response done chunks=%d bytes=%d",
                            audio_chunks,
                            audio_bytes,
                        )
                        push(("finished", None))
                        finished_event.set()
                    elif event_type == "session.finished":
                        finished_event.set()
                    elif event_type == "error":
                        err_msg = response.get("error", {}).get("message", "unknown")
                        logger.error("[QwenTTS] server error: %s", err_msg)
                        push(("error", err_msg.encode()))
                        finished_event.set()

            self_outer = self
            synth = QwenTtsRealtime(
                model=active_model,
                callback=Callback(),
                url=self._url,
            )
            try:
                if cancel_event.is_set():
                    return
                synth.connect()
                # connect() 是阻塞调用、cancel 打不断；期间若已被打断，
                # 立即收场，不再 update_session/append_text 白合成一遍
                if cancel_event.is_set():
                    logger.info("[QwenTTS] synthesis cancelled (barge-in)")
                    return
                session_kwargs: dict = {
                    "voice": active_voice,
                    "response_format": AudioFormat.PCM_24000HZ_MONO_16BIT,
                    "mode": "commit",
                }
                if instruct_text:
                    # 指令模式需 qwen3-tts-instruct-flash-realtime 模型
                    session_kwargs["instructions"] = instruct_text
                    session_kwargs["optimize_instructions"] = True
                synth.update_session(**session_kwargs)
                synth.append_text(text)
                synth.commit()

                # 等 response.done 后再 finish；提前 finish 会终止尚未提交完成的合成。
                while not finished_event.wait(timeout=0.5):
                    if cancel_event.is_set():
                        logger.info("[QwenTTS] synthesis cancelled (barge-in)")
                        break
                if not cancel_event.is_set():
                    synth.finish()
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
            output_chunks = 0
            output_bytes = 0
            while True:
                kind, data = await queue.get()
                if kind == "audio" and data:
                    resampled = audio.resample(
                        data, _QWEN_SOURCE_SAMPLE_RATE, self._target_sr
                    )
                    if resampled:
                        output_chunks += 1
                        output_bytes += len(resampled)
                        await on_chunk(
                            TTSChunk(
                                audio=resampled,
                                sample_rate=self._target_sr,
                                is_final=False,
                            )
                        )
                elif kind == "finished":
                    logger.info(
                        "[QwenTTS] output complete chunks=%d bytes=%d sample_rate=%d",
                        output_chunks,
                        output_bytes,
                        self._target_sr,
                    )
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

    def interrupt(self) -> None:
        """中断当前合成（barge-in）：只取消合成子任务，不动调用方任务。"""
        if self._cancel_event is not None:
            self._cancel_event.set()
        task = self._synthesis_task
        if task is not None and not task.done():
            task.cancel()

    async def close(self) -> None:
        """关闭客户端（应用退出时调用）：中断并等在途合成完全收尾。"""
        self._closed = True
        self.interrupt()
        task = self._synthesis_task
        if task is not None:
            try:
                await task
            except BaseException:
                pass
