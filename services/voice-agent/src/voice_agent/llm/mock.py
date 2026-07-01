"""Mock LLM — 无 API key 时的本地开发实现。

从原 llm.py 迁移，代码完全不变。返回固定话术，不调用工具，便于跑通对话主循环。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Optional

from ..types import ChatMessage, LLMEvent, ToolDefinition

logger = logging.getLogger(__name__)


class MockLLM:
    """Mock LLM 实现 - 用于无 API key 时的本地开发。

    返回固定话术，不调用工具，便于跑通对话主循环。
    """

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        self._current_task: Optional[asyncio.Task[None]] = None

    @property
    def name(self) -> str:
        return "mock"

    async def chat(
        self,
        messages: list[ChatMessage],
        tools: list[ToolDefinition],
        on_event: Callable[[LLMEvent], Awaitable[None]],
    ) -> None:
        self._current_task = asyncio.current_task()
        try:
            # 取最后一条 user 消息简单回声
            user_text = ""
            for m in reversed(messages):
                if m.role == "user":
                    user_text = m.content
                    break
            reply = f"我听到了您说：{user_text}。这是 Mock LLM 的回复，请配置 LLM_API_KEY 启用真实模型。"
            await on_event(LLMEvent(type="delta", content=reply))
            await on_event(LLMEvent(type="done"))
        finally:
            self._current_task = None

    def cancel(self) -> None:
        if self._current_task and not self._current_task.done():
            self._current_task.cancel()

    async def close(self) -> None:
        pass
