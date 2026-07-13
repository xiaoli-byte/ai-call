"""CosyVoice TTS 客户端 - 阿里云百炼 DashScope 云端流式合成 + 重采样。

模型：cosyvoice-v2（SpeechSynthesizer / tts_v2），输出 PCM 24kHz mono 16-bit，
按需重采样到目标采样率（默认 16kHz 供 FreeSWITCH）。旧的本地 HTTP 部署
（/inference_sft）已弃用，改走云端 WebSocket 流式合成。

协议要点（dashscope SDK tts_v2 封装，参见
https://help.aliyun.com/zh/model-studio/cosyvoice-streaming-synthesis）：
- SpeechSynthesizer(model, voice, format=PCM_24000HZ_MONO_16BIT, callback)
- 流式：streaming_call(text) 送文本（首次调用内部阻塞建连、置 _is_started）
  → streaming_complete() 阻塞等合成结束；callback.on_data(bytes) 逐块收 PCM。
- 中断：streaming_cancel()（须在 _is_started 之后调用，否则抛 InvalidTask）。

SDK 基于线程回调，本模块用 asyncio.Queue + loop.call_soon_threadsafe 桥接到
事件循环，保持与 QwenTTS 一致的 async 接口（synthesize / interrupt / close）。
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from typing import Awaitable, Callable, Optional

from . import audio
from .types import TTSChunk

logger = logging.getLogger(__name__)


class CosyVoiceTTS:
    """CosyVoice v2 云端流式 TTS 客户端。

    dashscope SDK 为可选依赖：未安装时 synthesize() 抛 RuntimeError，
    由 tts_factory.create_tts() 捕获并降级到 MockTTS。
    构造函数不连网、不 import dashscope，可被单测直接实例化。
    """

    def __init__(
        self,
        model: str = "cosyvoice-v2",
        default_speaker: str = "longxiaochun_v2",
        source_sample_rate: int = 24000,
        target_sample_rate: int = 16000,
        timeout: float = 30.0,
        api_key: Optional[str] = None,
    ) -> None:
        self._model = model
        self._default_speaker = default_speaker
        self._source_sr = source_sample_rate
        self._target_sr = target_sample_rate
        self._timeout = timeout
        # 缺省时延迟到合成路径读环境变量，构造期不触碰凭证 / 不连网。
        self._api_key = api_key
        # 当前合成「子任务」。interrupt() 只取消它，绝不取消调用方任务——
        # 否则 barge-in 会污染会话任务的取消计数，上层用 task.cancelling()
        # 区分「打断/挂断」的判别器会把打断误判成挂断，拆掉整个会话协程
        # （真机僵尸通话根因，2026-07-12，与 QwenTTS 同款修复）。
        self._synthesis_task: Optional[asyncio.Task[None]] = None
        self._cancel_event: Optional[threading.Event] = None
        # 当前 SpeechSynthesizer 句柄（在 executor 线程内建立）。interrupt() 从
        # 事件循环线程读它并跨线程调 streaming_cancel() 打断阻塞的 streaming_complete()。
        self._synth: Optional[object] = None
        self._closed = False

    @property
    def name(self) -> str:
        return "cosyvoice"

    def _resolve_voice(self, speaker: Optional[str]) -> str:
        """按调用参数选发音人：显式 speaker（如复刻音色）优先，否则用默认预设音色。"""
        return speaker or self._default_speaker

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
            raise RuntimeError("CosyVoiceTTS 已关闭")
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

        active_voice = self._resolve_voice(speaker)

        def run_sync() -> None:
            """在 executor 线程中跑 dashscope SDK 同步调用。"""
            try:
                import dashscope
                from dashscope.audio.tts_v2 import (
                    AudioFormat,
                    ResultCallback,
                    SpeechSynthesizer,
                )
            except ImportError as err:
                push(("error", err.args[0].encode() if err.args else b"import error"))
                return

            dashscope.api_key = self._api_key or os.getenv("DASHSCOPE_API_KEY", "")
            started_at = time.monotonic()
            audio_chunks = 0
            audio_bytes = 0
            response_completed = False
            error_pushed = False

            class Callback(ResultCallback):
                def on_open(self) -> None:
                    logger.info(
                        "[CosyVoice] connection opened model=%s voice=%s",
                        self_outer._model,
                        active_voice,
                    )

                def on_data(self, data: bytes) -> None:
                    nonlocal audio_chunks, audio_bytes
                    if not data:
                        return
                    audio_chunks += 1
                    audio_bytes += len(data)
                    if audio_chunks == 1:
                        logger.info(
                            "[CosyVoice] first audio chunk bytes=%d latency_ms=%d",
                            len(data),
                            int((time.monotonic() - started_at) * 1000),
                        )
                    push(("audio", data))

                def on_complete(self) -> None:
                    nonlocal response_completed
                    response_completed = True
                    logger.info(
                        "[CosyVoice] synthesis complete chunks=%d bytes=%d",
                        audio_chunks,
                        audio_bytes,
                    )
                    push(("finished", None))

                def on_error(self, message: object) -> None:
                    nonlocal error_pushed
                    error_pushed = True
                    logger.error("[CosyVoice] server error: %s", message)
                    push(("error", str(message).encode()))

                def on_close(self) -> None:
                    logger.info("[CosyVoice] connection closed")

            self_outer = self
            synth_kwargs: dict = {
                "model": self._model,
                "voice": active_voice,
                "format": AudioFormat.PCM_24000HZ_MONO_16BIT,
                "callback": Callback(),
            }
            if instruct_text:
                # CosyVoice v2 指令模式：自然语言控制语气/情感（可选，缺省不传）。
                synth_kwargs["instruction"] = instruct_text
            synth = SpeechSynthesizer(**synth_kwargs)
            self._synth = synth
            try:
                if cancel_event.is_set():
                    return
                # streaming_call 首帧内部阻塞建连并置 _is_started（cancel 打不断，
                # 最多 ~10s）；期间若已被打断，返回后立即收场，不白合成一遍。
                synth.streaming_call(text)
                if cancel_event.is_set():
                    logger.info("[CosyVoice] synthesis cancelled (barge-in)")
                    try:
                        synth.streaming_cancel()
                    except Exception:
                        pass
                    return
                # 阻塞等 on_complete；barge-in 时 interrupt() 会跨线程调
                # streaming_cancel() 打断这里的等待。timeout 兜底防永久阻塞。
                synth.streaming_complete(
                    complete_timeout_millis=int(self._timeout * 1000)
                )
            except Exception as err:
                if not cancel_event.is_set():
                    logger.exception("[CosyVoice] sync synthesis failed: %s", err)
                    push(("error", str(err).encode()))
                    error_pushed = True
                else:
                    logger.info("[CosyVoice] synthesis cancelled (barge-in)")
            finally:
                # 终止哨兵守卫：正常返回但未收到 on_complete/on_error（异常路径），
                # 补一个 finished，避免消费端 queue.get() 永久阻塞。
                if (
                    not cancel_event.is_set()
                    and not response_completed
                    and not error_pushed
                ):
                    push(("finished", None))
                if self._synth is synth:
                    self._synth = None

        sync_future = loop.run_in_executor(None, run_sync)

        try:
            # 消费队列，把 PCM 块回调给调用方
            output_chunks = 0
            output_bytes = 0
            while True:
                kind, data = await queue.get()
                if kind == "audio" and data:
                    resampled = audio.resample(
                        data, self._source_sr, self._target_sr
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
                        "[CosyVoice] output complete chunks=%d bytes=%d sample_rate=%d",
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
                        f"CosyVoice 合成失败: {data.decode() if data else 'unknown'}"
                    )
        except asyncio.CancelledError:
            logger.info("[CosyVoice] synthesis cancelled (barge-in)")
            cancel_event.set()
            # 跨线程 cancel 以 unblock run_sync 里阻塞的 streaming_complete()，
            # 否则 finally 的 wrap_future 会一直等到 timeout 才返回。
            synth = self._synth
            if synth is not None:
                try:
                    synth.streaming_cancel()  # type: ignore[attr-defined]
                except Exception:
                    pass
            raise
        finally:
            # 确保 executor 线程退出（cancel 已设置或已完成）
            try:
                await asyncio.wrap_future(sync_future)
            except Exception:
                pass

    def interrupt(self) -> None:
        """中断当前合成（barge-in）：只取消合成子任务 + 跨线程 streaming_cancel()，
        不动调用方任务。"""
        if self._cancel_event is not None:
            self._cancel_event.set()
        synth = self._synth
        if synth is not None:
            try:
                synth.streaming_cancel()  # type: ignore[attr-defined]
            except Exception:
                # 尚未 _is_started 时抛 InvalidTask：cancel_event 已置，
                # run_sync 会在 streaming_call 返回后自行收场。
                pass
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


class MockTTS:
    """Mock TTS 实现 - 不合成音频，仅触发 on_chunk(is_final=True)。

    用于无 CosyVoice 服务时的本地开发与测试。
    """

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        self._synthesis_task: Optional[asyncio.Task[None]] = None

    @property
    def name(self) -> str:
        return "mock"

    async def synthesize(
        self,
        text: str,
        on_chunk: Callable[[TTSChunk], Awaitable[None]],
        speaker: Optional[str] = None,
        instruct_text: Optional[str] = None,
    ) -> None:
        # 与真实 provider 同款子任务契约：Mock 虽快，但 on_chunk 是异步回调
        # （下游 ws/节拍泵可能挂起），interrupt() 同样不能误取消调用方任务。
        child = asyncio.create_task(self._do_synthesize(text, on_chunk))
        self._synthesis_task = child
        try:
            await child
        except asyncio.CancelledError:
            if not child.done():
                child.cancel()
            raise
        finally:
            if not child.done():
                try:
                    await child
                except BaseException:
                    pass
            if self._synthesis_task is child:
                self._synthesis_task = None

    async def _do_synthesize(
        self,
        text: str,
        on_chunk: Callable[[TTSChunk], Awaitable[None]],
    ) -> None:
        logger.warning("[MockTTS] 真实 TTS 未启用，跳过音频合成: %s", text[:50])
        await on_chunk(TTSChunk(audio=b"", sample_rate=16000, is_final=True))

    def interrupt(self) -> None:
        task = self._synthesis_task
        if task is not None and not task.done():
            task.cancel()

    async def close(self) -> None:
        pass
