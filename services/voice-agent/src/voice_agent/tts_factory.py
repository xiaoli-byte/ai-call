"""TTS 工厂 — 根据 TTS_PROVIDER 环境变量创建适配器实例。

镜像 llm/factory.py 的模式。支持的 provider：
- qwen:      Qwen-TTS Realtime 云端（读 DASHSCOPE_API_KEY / QWEN_TTS_*）
- cosyvoice: CosyVoice v2 云端流式（阿里云百炼 DashScope，读 DASHSCOPE_API_KEY / COSYVOICE_*）
- mock:      MockTTS（默认，无配置降级）

降级策略：任何 provider 配置缺失关键凭证或依赖未安装 → 记 WARN + 返回 MockTTS，
确保本地开发零配置可跑。
"""

from __future__ import annotations

import logging
import os
from typing import Any

from .tts import CosyVoiceTTS, MockTTS

logger = logging.getLogger(__name__)


def create_tts(provider: str | None = None) -> Any:
    """创建 TTS 实例。provider 显式传入时优先（按场景 ttsConfig.provider 动态选择），
    否则回退 TTS_PROVIDER 环境变量。

    返回的实例满足 TTS 协议：
        name: str
        synthesize(text, on_chunk, speaker?, instruct_text?) -> None
        interrupt() -> None
        close() -> None
    """
    provider = (provider or os.getenv("TTS_PROVIDER", "mock")).lower()

    if provider == "mock":
        logger.info("TTS provider: mock")
        return MockTTS()

    if provider == "qwen":
        api_key = os.getenv("DASHSCOPE_API_KEY", "")
        if not api_key:
            logger.warning("DASHSCOPE_API_KEY 未配置，降级到 MockTTS")
            return MockTTS()
        try:
            from .tts_qwen import QwenTTS
        except ImportError as err:
            logger.warning("dashscope 依赖未安装（%s），降级到 MockTTS", err)
            return MockTTS()

        tts = QwenTTS(
            api_key=api_key,
            model=os.getenv("QWEN_TTS_MODEL", "qwen3-tts-flash-realtime"),
            clone_model=os.getenv("QWEN_TTS_CLONE_MODEL", "qwen3-tts-vc-realtime-2026-01-15"),
            voice=os.getenv("QWEN_TTS_VOICE", "Cherry"),
            url=os.getenv(
                "QWEN_TTS_URL",
                "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
            ),
            target_sample_rate=16000,
        )
        logger.info(
            "TTS provider: qwen (model=%s, voice=%s)",
            tts._model,
            tts._voice,
        )
        return tts

    if provider == "cosyvoice":
        api_key = os.getenv("DASHSCOPE_API_KEY", "")
        if not api_key:
            logger.warning("DASHSCOPE_API_KEY 未配置，降级到 MockTTS")
            return MockTTS()

        tts = CosyVoiceTTS(
            api_key=api_key,
            model=os.getenv("COSYVOICE_MODEL", "cosyvoice-v2"),
            default_speaker=os.getenv("COSYVOICE_VOICE", "longxiaochun_v2"),
            source_sample_rate=24000,
            target_sample_rate=16000,
        )
        logger.info(
            "TTS provider: cosyvoice (model=%s, voice=%s)",
            tts._model,
            tts._default_speaker,
        )
        return tts

    # 未知 provider：降级到 mock
    logger.warning("未知 TTS_PROVIDER=%s，降级到 MockTTS", provider)
    return MockTTS()
