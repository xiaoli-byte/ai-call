"""LLM 适配器包 — 适配器模式 + LangChain 实现。

主要导出：
- LLMAdapter: 适配器协议（typing.Protocol）
- create_llm: 工厂函数，根据 LLM_PROVIDER 环境变量创建实例
- MockLLM: Mock 实现（本地开发）
- LangChainLLMAdapter: LangChain ChatOpenAI 适配器（DeepSeek/Qwen 通用）
- OpenAICompatibleLLM: 旧版 httpx 实现（向后兼容）

使用示例：
    from voice_agent.llm import create_llm
    llm = create_llm()  # 根据 LLM_PROVIDER 自动选择
    await llm.chat(messages, tools, on_event)
"""

from .factory import create_llm
from .legacy_httpx import OpenAICompatibleLLM
from .mock import MockLLM
from .protocol import LLMAdapter

# langchain 为可选依赖：未安装时 LangChainLLMAdapter 不可用，但 mock/legacy 仍可正常工作
try:
    from .langchain_adapter import LangChainLLMAdapter
except ImportError:  # pragma: no cover
    LangChainLLMAdapter = None  # type: ignore[assignment, misc]

__all__ = [
    "LLMAdapter",
    "LangChainLLMAdapter",
    "MockLLM",
    "OpenAICompatibleLLM",
    "create_llm",
]
