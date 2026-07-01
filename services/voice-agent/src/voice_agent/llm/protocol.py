"""LLM 适配器协议 — 结构化协议（typing.Protocol），所有 provider 实现的统一接口。

设计决策：用 Protocol 而非 abc.ABC
- 现有 MockLLM 和 test_agent.py 中的 ScriptedLLM 无需继承即可满足协议（结构化子类型）
- @runtime_checkable 支持 isinstance 检查但无运行时开销
- 不引入 metaclass 冲突
"""

from __future__ import annotations

from typing import Awaitable, Callable, Protocol, runtime_checkable

from ..types import ChatMessage, LLMEvent, ToolDefinition


@runtime_checkable
class LLMAdapter(Protocol):
    """LLM 适配器协议 — 所有 provider 实现的统一接口。

    与 agent.py 现有调用方式完全兼容：chat() / cancel() / close() / name。
    """

    @property
    def name(self) -> str: ...

    async def chat(
        self,
        messages: list[ChatMessage],
        tools: list[ToolDefinition],
        on_event: Callable[[LLMEvent], Awaitable[None]],
    ) -> None: ...

    def cancel(self) -> None: ...

    async def close(self) -> None: ...
