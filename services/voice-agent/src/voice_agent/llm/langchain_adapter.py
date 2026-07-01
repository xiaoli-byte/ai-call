"""LangChain LLM 适配器 — 通过 ChatOpenAI 统一接入 DeepSeek/Qwen 等 OpenAI 兼容协议。

优势：
- 用 LangChain 的 ChatOpenAI 处理 SSE 解析、tool_calls 聚合等复杂逻辑
- 支持所有 LangChain 生态（prompt 模板、memory、chain 等）
- 通过 base_url/api_key 切换 provider，无需修改业务代码

桥接模式：
- LangChain astream() 是 pull 模式（async for chunk）
- agent.py 的 on_event 是 push 模式回调
- 本适配器在 async for 循环中 await on_event(...) 完成桥接
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Optional

from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_openai import ChatOpenAI

from ..types import ChatMessage, LLMEvent, ToolCall, ToolDefinition

logger = logging.getLogger(__name__)


class LangChainLLMAdapter:
    """LangChain ChatOpenAI 适配器。

    通过 LangChain 的 ChatOpenAI 接入任何 OpenAI 兼容协议的 LLM provider
    （DeepSeek、Qwen DashScope 兼容模式、OpenAI、Moonshot、Zhipu 等）。
    """

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str,
        timeout: float = 300.0,
        temperature: float = 0.7,
        **extra: Any,
    ) -> None:
        self._model = model
        self._base_url = base_url
        self._chat = ChatOpenAI(
            api_key=api_key,
            model=model,
            base_url=base_url,
            timeout=timeout,
            temperature=temperature,
            streaming=True,
            **extra,
        )
        self._current_task: Optional[asyncio.Task[None]] = None

    @property
    def name(self) -> str:
        return f"langchain:{self._model}"

    async def chat(
        self,
        messages: list[ChatMessage],
        tools: list[ToolDefinition],
        on_event: Callable[[LLMEvent], Awaitable[None]],
    ) -> None:
        """流式聊天，将 LangChain 的 astream() pull 模式桥接到 on_event push 模式。

        on_event 在以下场景被调用：
        - delta：text 增量
        - tool_call：完整的工具调用（arguments 已聚合为 dict）
        - done：流结束
        """
        lc_messages = self._to_langchain_messages(messages)
        lc_tools = self._to_langchain_tools(tools) if tools else None

        self._current_task = asyncio.current_task()

        try:
            # 聚合 tool_calls（按 index 拼接 arguments 字符串）
            tool_call_agg: dict[int, dict[str, Any]] = {}

            kwargs: dict[str, Any] = {}
            if lc_tools:
                kwargs["tools"] = lc_tools

            async for chunk in self._chat.astream(lc_messages, **kwargs):
                # 1) 文本增量
                if chunk.content:
                    await on_event(LLMEvent(type="delta", content=chunk.content))

                # 2) tool_calls 聚合（LangChain 把流式 tool_calls 拆到 tool_call_chunks）
                if isinstance(chunk, AIMessageChunk) and chunk.tool_call_chunks:
                    for tc_chunk in chunk.tool_call_chunks:
                        idx = tc_chunk.get("index", 0)
                        agg = tool_call_agg.setdefault(
                            idx, {"id": "", "name": "", "args": ""}
                        )
                        if tc_chunk.get("id"):
                            agg["id"] = tc_chunk["id"]
                        if tc_chunk.get("name"):
                            agg["name"] = tc_chunk["name"]
                        if tc_chunk.get("args"):
                            agg["args"] += tc_chunk["args"]

            # 流结束：flush 聚合的 tool_calls（按 index 升序）
            for idx in sorted(tool_call_agg.keys()):
                agg = tool_call_agg[idx]
                if not agg["name"]:
                    continue  # 没有名字的工具调用无法执行，跳过
                try:
                    args = json.loads(agg["args"]) if agg["args"] else {}
                except json.JSONDecodeError:
                    logger.warning(
                        "[%s] tool_call args 解析失败 idx=%s raw=%s",
                        self.name,
                        idx,
                        agg["args"][:100],
                    )
                    args = {"__raw__": agg["args"]}
                if not agg["id"]:
                    agg["id"] = f"call_{idx}"
                await on_event(
                    LLMEvent(
                        type="tool_call",
                        tool_call=ToolCall(
                            id=agg["id"], name=agg["name"], arguments=args
                        ),
                    )
                )

            await on_event(LLMEvent(type="done"))
        except asyncio.CancelledError:
            logger.info("[%s] chat cancelled (barge-in)", self.name)
            raise
        except Exception as err:
            logger.error("[%s] chat failed: %s", self.name, err)
            await on_event(LLMEvent(type="done"))
        finally:
            self._current_task = None

    def cancel(self) -> None:
        """中断当前 LLM 生成（barge-in）。"""
        if self._current_task and not self._current_task.done():
            self._current_task.cancel()

    def _to_langchain_messages(self, messages: list[ChatMessage]) -> list[BaseMessage]:
        """转换项目内部 ChatMessage → LangChain Message。"""
        result: list[BaseMessage] = []
        for m in messages:
            if m.role == "system":
                result.append(SystemMessage(content=m.content))
            elif m.role == "user":
                result.append(HumanMessage(content=m.content))
            elif m.role == "assistant":
                tool_calls: list[dict[str, Any]] = []
                if m.tool_calls:
                    for tc in m.tool_calls:
                        tool_calls.append({
                            "name": tc.name,
                            "args": tc.arguments,
                            "id": tc.id,
                            "type": "tool_call",
                        })
                result.append(AIMessage(content=m.content, tool_calls=tool_calls))
            elif m.role == "tool":
                result.append(
                    ToolMessage(
                        content=m.content,
                        tool_call_id=m.tool_call_id or "",
                    )
                )
        return result

    def _to_langchain_tools(self, tools: list[ToolDefinition]) -> list[dict[str, Any]]:
        """转换 ToolDefinition → OpenAI function tool 格式 dict。"""
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
            }
            for t in tools
        ]

    async def close(self) -> None:
        """关闭底层资源。

        ChatOpenAI 内部使用 httpx，但生命周期由 LangChain 管理。
        每次 astream() 请求都是独立的，无需显式关闭。
        """
        pass
