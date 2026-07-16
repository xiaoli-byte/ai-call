"""旧版 httpx 裸调 LLM 客户端 — 从原 llm.py 迁移，向后兼容。

LLM_PROVIDER=legacy 时使用此实现。保留以兼容现有 tests/test_llm_sse.py。
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Optional

import httpx

from ..types import ChatMessage, LLMEvent, ToolCall, ToolDefinition
from .provider_profile import ProviderProfile

logger = logging.getLogger(__name__)


class OpenAICompatibleLLM:
    """OpenAI 兼容协议 LLM 客户端（支持 DeepSeek、qwen 等兼容厂商）。

    通过环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 配置。
    """

    def __init__(
        self,
        api_key: str,
        model: str = "deepseek-v4-flash",
        base_url: str = "https://api.deepseek.com/v1",
        timeout: Optional[float] = 300.0,
        provider: str | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._profile = ProviderProfile.from_base_url(base_url, provider=provider)
        self._timeout = timeout
        self._client = httpx.AsyncClient(timeout=timeout)
        self._current_task: Optional[asyncio.Task[None]] = None

    @property
    def name(self) -> str:
        return "openai"

    def _control_options(self, tool_name: str) -> dict[str, Any]:
        options = self._profile.control_options(tool_name)
        extra_body = options.pop("extra_body", {})
        options.update(extra_body)
        return options

    async def chat(
        self,
        messages: list[ChatMessage],
        tools: list[ToolDefinition],
        on_event: Callable[[LLMEvent], Awaitable[None]],
    ) -> None:
        """流式聊天。

        on_event 在以下场景被调用：
        - delta：text 增量
        - tool_call：完整的工具调用（arguments 已聚合为 dict）
        - done：流结束
        """
        body: dict[str, Any] = {
            "model": self._model,
            "messages": self._to_openai_messages(messages),
            "stream": True,
            **self._profile.raw_chat_body(),
        }
        if tools:
            serialized_tools: list[dict[str, Any]] = []
            for tool in tools:
                function: dict[str, Any] = {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": self._profile.compile_schema(tool.parameters),
                }
                if tool.strict and self._profile.supports_strict_tools:
                    function["strict"] = True
                serialized_tools.append({"type": "function", "function": function})
            body["tools"] = serialized_tools
            required_tools = [tool for tool in tools if tool.required]
            if required_tools:
                if len(required_tools) != 1:
                    raise ValueError("control requests require exactly one tool")
                body.update(self._control_options(required_tools[0].name))

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        self._current_task = asyncio.current_task()

        try:
            async with self._client.stream(
                "POST",
                f"{self._base_url}/chat/completions",
                json=body,
                headers=headers,
            ) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    logger.error(
                        "[%s] HTTP %s: %s",
                        self.name,
                        response.status_code,
                        error_body[:200],
                    )
                    await on_event(
                        LLMEvent(
                            type="error",
                            content=f"HTTP {response.status_code}",
                        )
                    )
                    await on_event(LLMEvent(type="done"))
                    return

                await self._parse_sse(response, on_event)
        except asyncio.CancelledError:
            logger.info("[%s] chat cancelled (barge-in)", self.name)
            raise
        except httpx.HTTPError as err:
            logger.error("[%s] request failed: %s", self.name, err)
            await on_event(LLMEvent(type="error", content=str(err)))
            await on_event(LLMEvent(type="done"))
        finally:
            self._current_task = None

    def cancel(self) -> None:
        """中断当前 LLM 生成（barge-in）。"""
        if self._current_task and not self._current_task.done():
            self._current_task.cancel()

    async def complete_structured(
        self,
        messages: list[ChatMessage],
        tool: ToolDefinition,
    ) -> dict[str, Any]:
        function: dict[str, Any] = {
            "name": tool.name,
            "description": tool.description,
            "parameters": self._profile.compile_schema(tool.parameters),
        }
        if tool.strict and self._profile.supports_strict_tools:
            function["strict"] = True
        body: dict[str, Any] = {
            "model": self._model,
            "messages": self._to_openai_messages(messages),
            "tools": [{"type": "function", "function": function}],
            "stream": False,
            **self._control_options(tool.name),
        }
        response = await self._client.post(
            f"{self._base_url}/chat/completions",
            json=body,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
        choices = response.json().get("choices") or []
        message = choices[0].get("message") if choices else None
        tool_calls = message.get("tool_calls") if isinstance(message, dict) else None
        if not isinstance(tool_calls, list) or len(tool_calls) != 1:
            count = len(tool_calls) if isinstance(tool_calls, list) else 0
            raise RuntimeError(f"expected exactly one tool call, received {count}")
        function_call = tool_calls[0].get("function") or {}
        if function_call.get("name") != tool.name:
            raise RuntimeError(f"unexpected tool call: {function_call.get('name')}")
        try:
            arguments = json.loads(function_call.get("arguments") or "{}")
        except json.JSONDecodeError as err:
            raise RuntimeError("provider returned malformed tool arguments") from err
        if not isinstance(arguments, dict):
            raise RuntimeError("tool arguments are not an object")
        return arguments

    async def _parse_sse(
        self,
        response: httpx.Response,
        on_event: Callable[[LLMEvent], Awaitable[None]],
    ) -> None:
        """解析 SSE 流。

        OpenAI SSE 格式：
            data: {"choices":[{"delta":{"content":"..."}}]}
            data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_x","function":{"name":"f","arguments":"{\\"a\\":"}}]}}]}
            data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"1\\"}"}}]}}]}
            data: [DONE]
        """
        tool_call_agg: dict[int, ToolCall] = {}
        raw_args: dict[int, str] = {}

        async for line in response.aiter_lines():
            line = line.strip()
            if not line or not line.startswith("data:"):
                continue

            data = line[5:].strip()
            if not data:
                continue

            if data == "[DONE]":
                await self._flush_tool_calls(tool_call_agg, raw_args, on_event)
                await on_event(LLMEvent(type="done"))
                return

            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                continue

            choices = payload.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            if not delta:
                continue

            content = delta.get("content")
            if content:
                await on_event(LLMEvent(type="delta", content=content))

            tool_calls = delta.get("tool_calls")
            if isinstance(tool_calls, list):
                for tc in tool_calls:
                    self._aggregate_tool_call(tool_call_agg, raw_args, tc)

        # 流正常结束但未收到 [DONE]：仍补发聚合的工具调用
        await self._flush_tool_calls(tool_call_agg, raw_args, on_event)
        await on_event(LLMEvent(type="done"))

    def _aggregate_tool_call(
        self,
        agg: dict[int, ToolCall],
        raw_args: dict[int, str],
        tc: dict[str, Any],
    ) -> None:
        """聚合 tool_calls 流式片段。

        OpenAI 把一次工具调用的 arguments 拆成多块发送，按 index 累加字符串。
        """
        raw_index = tc.get("index", 0)
        idx = raw_index if isinstance(raw_index, int) else 0
        existing = agg.get(idx, ToolCall(id="", name="", arguments={}))

        if tc.get("id"):
            existing.id = tc["id"]
        function = tc.get("function") or {}
        if function.get("name"):
            existing.name = function["name"]

        args_chunk = function.get("arguments", "")
        raw = raw_args.get(idx, "") + args_chunk
        raw_args[idx] = raw

        # 尝试解析当前累积的 arguments；失败则等下一 chunk
        try:
            existing.arguments = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            # arguments 尚未完整，保留之前的 arguments（可能为空 dict）
            pass

        agg[idx] = existing

    async def _flush_tool_calls(
        self,
        agg: dict[int, ToolCall],
        raw_args: dict[int, str],
        on_event: Callable[[LLMEvent], Awaitable[None]],
    ) -> None:
        """流结束时按 index 升序发出所有已聚合的 tool_call 事件。"""
        if not agg:
            return
        for idx in sorted(agg.keys()):
            call = agg[idx]
            # 用原始字符串兜底重新解析一次（确保 arguments 是 dict）
            raw = raw_args.get(idx, "")
            if raw:
                try:
                    call.arguments = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning(
                        "[%s] tool_call arguments 解析失败，保留原始字符串: idx=%s raw=%s",
                        self.name,
                        idx,
                        raw[:100],
                    )
                    call.arguments = {"__raw__": raw}

            if not call.id:
                call.id = f"call_{idx}"
            if not call.name:
                continue  # 没有名字的工具调用无法执行，跳过

            await on_event(LLMEvent(type="tool_call", tool_call=call))
        agg.clear()
        raw_args.clear()

    def _to_openai_messages(self, messages: list[ChatMessage]) -> list[dict[str, Any]]:
        """转换项目内部 ChatMessage → OpenAI API 格式。"""
        result: list[dict[str, Any]] = []
        for m in messages:
            if m.role == "assistant" and m.tool_calls:
                result.append({
                    "role": "assistant",
                    "content": m.content or None,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": json.dumps(tc.arguments, ensure_ascii=False),
                            },
                        }
                        for tc in m.tool_calls
                    ],
                })
            elif m.role == "tool":
                result.append({
                    "role": "tool",
                    "content": m.content,
                    "tool_call_id": m.tool_call_id,
                    "name": m.name,
                })
            else:
                result.append({"role": m.role, "content": m.content})
        return result

    async def close(self) -> None:
        await self._client.aclose()
