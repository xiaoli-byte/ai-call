"""CosyVoice TTS 客户端 - HTTP 流式合成 + 重采样。

参考实现：apps/dashboard/lib/cosyvoice-client.ts。

关键协议：
- 端点：POST /inference_sft（SFT 模式）或 /inference_instruct（指令模式）
- 请求体：FormData（tts_text, spk_id, 可选 instruct_text）
- 响应：StreamingResponse，原始 PCM 16-bit 二进制（无 WAV 头）
- 采样率：CosyVoice 1.0 = 22050Hz，2.0 = 24000Hz → 必须重采样到 16kHz

支持 barge-in：通过 asyncio.CancelledError 中断流式读取。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Optional

import httpx

from . import audio
from .types import TTSChunk

logger = logging.getLogger(__name__)


class CosyVoiceTTS:
    """CosyVoice 流式 TTS 客户端。"""

    def __init__(
        self,
        base_url: str,
        default_speaker: str = "中文女",
        source_sample_rate: int = 22050,
        target_sample_rate: int = 16000,
        timeout: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._default_speaker = default_speaker
        self._source_sr = source_sample_rate
        self._target_sr = target_sample_rate
        self._client = httpx.AsyncClient(timeout=timeout)
        # 当前合成「子任务」。interrupt() 只取消它，绝不取消调用方任务——
        # 否则 barge-in 会污染会话任务的取消计数，上层无法区分打断/挂断
        # （真机僵尸通话根因，2026-07-12，与 QwenTTS 同款修复）。
        self._synthesis_task: Optional[asyncio.Task[None]] = None

    @property
    def name(self) -> str:
        return "cosyvoice"

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
        on_chunk 在每个 PCM 块（已重采样到 16kHz）到达时被调用。
        """
        if self._synthesis_task is not None and not self._synthesis_task.done():
            raise RuntimeError("已有合成任务进行中，请先调用 interrupt()")

        child = asyncio.create_task(
            self._do_synthesize(text, on_chunk, speaker, instruct_text)
        )
        self._synthesis_task = child
        try:
            await child
        except asyncio.CancelledError:
            logger.info("[CosyVoice] synthesis cancelled (barge-in)")
            if not child.done():
                child.cancel()  # 外部（挂断）取消 → 级联停掉子任务
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
        speaker: Optional[str],
        instruct_text: Optional[str],
    ) -> None:
        use_instruct = bool(instruct_text)
        endpoint = "/inference_instruct" if use_instruct else "/inference_sft"
        url = f"{self._base_url}{endpoint}"

        form_data = {
            "tts_text": text,
            "spk_id": speaker or self._default_speaker,
        }
        if use_instruct:
            form_data["instruct_text"] = instruct_text  # type: ignore[assignment]

        async with self._client.stream("POST", url, data=form_data) as response:
            if response.status_code != 200:
                body = await response.aread()
                raise RuntimeError(
                    f"CosyVoice 服务返回 {response.status_code}: {body[:200]!r}"
                )

            async for chunk in response.aiter_bytes():
                if not chunk:
                    continue
                # 重采样到目标采样率（默认 16kHz，与 FreeSWITCH 一致）
                resampled = audio.resample(chunk, self._source_sr, self._target_sr)
                if resampled:
                    await on_chunk(
                        TTSChunk(
                            audio=resampled,
                            sample_rate=self._target_sr,
                            is_final=False,
                        )
                    )

        # 发送 final 标记
        await on_chunk(TTSChunk(audio=b"", sample_rate=self._target_sr, is_final=True))

    def interrupt(self) -> None:
        """中断当前合成（barge-in）：只取消合成子任务，不动调用方任务。"""
        task = self._synthesis_task
        if task is not None and not task.done():
            task.cancel()

    async def close(self) -> None:
        """关闭底层 HTTP 客户端（先停掉在途合成再关连接池）。"""
        self.interrupt()
        task = self._synthesis_task
        if task is not None:
            try:
                await task
            except BaseException:
                pass
        await self._client.aclose()


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
