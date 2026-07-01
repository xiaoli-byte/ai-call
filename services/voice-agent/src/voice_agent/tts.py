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
        self._current_task: Optional[asyncio.Task[None]] = None

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

        将合成任务包装为 asyncio.Task 以支持 interrupt()。
        on_chunk 在每个 PCM 块（已重采样到 16kHz）到达时被调用。
        """
        if self._current_task is not None and not self._current_task.done():
            raise RuntimeError("已有合成任务进行中，请先调用 interrupt()")

        self._current_task = asyncio.current_task()
        try:
            await self._do_synthesize(text, on_chunk, speaker, instruct_text)
        except asyncio.CancelledError:
            logger.info("[CosyVoice] synthesis cancelled (barge-in)")
            raise
        finally:
            self._current_task = None

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
        """中断当前合成任务（barge-in）。"""
        if self._current_task and not self._current_task.done():
            self._current_task.cancel()

    async def close(self) -> None:
        """关闭底层 HTTP 客户端。"""
        await self._client.aclose()


class MockTTS:
    """Mock TTS 实现 - 不合成音频，仅触发 on_chunk(is_final=True)。

    用于无 CosyVoice 服务时的本地开发与测试。
    """

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        self._current_task: Optional[asyncio.Task[None]] = None

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
        self._current_task = asyncio.current_task()
        try:
            logger.warning("[MockTTS] 真实 TTS 未启用，跳过音频合成: %s", text[:50])
            await on_chunk(TTSChunk(audio=b"", sample_rate=16000, is_final=True))
        finally:
            self._current_task = None

    def interrupt(self) -> None:
        if self._current_task and not self._current_task.done():
            self._current_task.cancel()

    async def close(self) -> None:
        pass
