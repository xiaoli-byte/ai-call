"""LLM 工厂 — 根据 LLM_PROVIDER 环境变量创建适配器实例。

支持的 provider：
- deepseek: LangChain + DeepSeek API（读 LLM_DEEPSEEK_API_KEY / DEEPSEEK_API_KEY / LLM_API_KEY）
- qwen:     LangChain + Qwen DashScope 兼容模式（读 LLM_QWEN_API_KEY / LLM_API_KEY）
- legacy:   旧版 httpx 裸调（读 LLM_API_KEY，向后兼容）
- mock:     MockLLM（默认，无 API key 降级）

降级策略：任何 provider 配置缺失 API key → 记 WARN + 返回 MockLLM，确保本地开发零配置可跑。
"""

from __future__ import annotations

import logging
import os

from .mock import MockLLM
from .protocol import LLMAdapter

logger = logging.getLogger(__name__)


def create_llm() -> LLMAdapter:
    """根据环境变量创建 LLM 适配器。"""
    provider = os.getenv("LLM_PROVIDER", "mock").lower()

    if provider == "mock":
        logger.info("LLM provider: mock")
        return MockLLM()

    if provider == "deepseek":
        api_key = (
            os.getenv("LLM_DEEPSEEK_API_KEY")
            or os.getenv("DEEPSEEK_API_KEY")
            or os.getenv("LLM_API_KEY", "")
        )
        if not api_key:
            logger.warning("DeepSeek API key 未配置，降级到 MockLLM")
            return MockLLM()
        from .langchain_adapter import LangChainLLMAdapter

        llm = LangChainLLMAdapter(
            api_key=api_key,
            model=os.getenv("LLM_DEEPSEEK_MODEL", "deepseek-v4-flash"),
            base_url=os.getenv(
                "LLM_DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"
            ),
            provider="deepseek",
        )
        logger.info("LLM provider: deepseek (langchain, model=%s)", llm.name)
        return llm

    if provider == "qwen":
        api_key = os.getenv("LLM_QWEN_API_KEY") or os.getenv("LLM_API_KEY", "")
        if not api_key:
            logger.warning("Qwen API key 未配置，降级到 MockLLM")
            return MockLLM()
        from .langchain_adapter import LangChainLLMAdapter

        llm = LangChainLLMAdapter(
            api_key=api_key,
            model=os.getenv("LLM_QWEN_MODEL", "qwen-plus"),
            base_url=os.getenv(
                "LLM_QWEN_BASE_URL",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
            provider="qwen",
        )
        logger.info("LLM provider: qwen (langchain, model=%s)", llm.name)
        return llm

    if provider == "legacy":
        # 旧版 httpx 裸调，向后兼容
        api_key = os.getenv("LLM_API_KEY", "")
        if not api_key:
            logger.warning("LLM_API_KEY 未配置，降级到 MockLLM")
            return MockLLM()
        from .legacy_httpx import OpenAICompatibleLLM

        llm = OpenAICompatibleLLM(
            api_key=api_key,
            model=os.getenv("LLM_MODEL", "deepseek-v4-flash"),
            base_url=os.getenv("LLM_BASE_URL", "https://api.deepseek.com/v1"),
        )
        logger.info("LLM provider: legacy httpx")
        return llm

    # 未知 provider：降级到 mock
    logger.warning("未知 LLM_PROVIDER=%s，降级到 MockLLM", provider)
    return MockLLM()
