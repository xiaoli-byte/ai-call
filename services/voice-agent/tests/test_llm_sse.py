"""LLM SSE 解析与 tool_calls 聚合单元测试。"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from voice_agent.llm import OpenAICompatibleLLM
from voice_agent.types import ChatMessage, LLMEvent, ToolCall


@pytest.fixture
def llm() -> OpenAICompatibleLLM:
    return OpenAICompatibleLLM(api_key="test-key", model="test-model", base_url="http://test")


def _make_sse_response(lines: list[str]) -> httpx.Response:
    """构造一个 mock httpx 流式响应。"""
    content = "\n".join(lines).encode("utf-8")
    request = httpx.Request("POST", "http://test/chat/completions")
    response = httpx.Response(
        status_code=200,
        headers={"content-type": "text/event-stream"},
        content=content,
        request=request,
    )
    response._request = request
    return response


@pytest.mark.asyncio
async def test_delta_accumulation(llm: OpenAICompatibleLLM) -> None:
    """delta content 应累加并通过 on_event 发出。"""
    sse_lines = [
        'data: {"choices":[{"delta":{"content":"你好"}}]}',
        'data: {"choices":[{"delta":{"content":"，世界"}}]}',
        "data: [DONE]",
    ]
    events: list[LLMEvent] = []

    async def on_event(ev: LLMEvent) -> None:
        events.append(ev)

    response = _make_sse_response(sse_lines)
    mock_stream_ctx = MagicMock()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=response)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch.object(llm._client, "stream", return_value=mock_stream_ctx):
        await llm.chat([ChatMessage(role="user", content="hi")], [], on_event)

    deltas = [ev for ev in events if ev.type == "delta"]
    assert [d.content for d in deltas] == ["你好", "，世界"]
    assert events[-1].type == "done"


@pytest.mark.asyncio
async def test_tool_calls_aggregation_across_chunks(llm: OpenAICompatibleLLM) -> None:
    """tool_calls arguments 跨 chunk 拼接。"""
    sse_lines = [
        # 第一个 chunk：带 id 和 name，arguments 部分片段
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"query_order","arguments":"{\\"orderNo\\":"}}]}}]}',
        # 第二个 chunk：只有 arguments 片段
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"DEMO123\\"}"}}]}}]}',
        "data: [DONE]",
    ]
    events: list[LLMEvent] = []

    async def on_event(ev: LLMEvent) -> None:
        events.append(ev)

    response = _make_sse_response(sse_lines)
    mock_stream_ctx = MagicMock()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=response)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch.object(llm._client, "stream", return_value=mock_stream_ctx):
        await llm.chat([ChatMessage(role="user", content="查订单")], [], on_event)

    tool_events = [ev for ev in events if ev.type == "tool_call"]
    assert len(tool_events) == 1
    call = tool_events[0].tool_call
    assert call is not None
    assert call.id == "call_abc"
    assert call.name == "query_order"
    assert call.arguments == {"orderNo": "DEMO123"}


@pytest.mark.asyncio
async def test_multiple_tool_calls_ordered_by_index(llm: OpenAICompatibleLLM) -> None:
    """多个 tool_calls 按 index 升序发出。"""
    sse_lines = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c1","function":{"name":"tool_b","arguments":"{}"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c0","function":{"name":"tool_a","arguments":"{}"}}]}}]}',
        "data: [DONE]",
    ]
    events: list[LLMEvent] = []

    async def on_event(ev: LLMEvent) -> None:
        events.append(ev)

    response = _make_sse_response(sse_lines)
    mock_stream_ctx = MagicMock()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=response)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch.object(llm._client, "stream", return_value=mock_stream_ctx):
        await llm.chat([ChatMessage(role="user", content="x")], [], on_event)

    tool_events = [ev for ev in events if ev.type == "tool_call"]
    assert len(tool_events) == 2
    assert tool_events[0].tool_call.id == "c0"
    assert tool_events[1].tool_call.id == "c1"


@pytest.mark.asyncio
async def test_done_signal_without_explicit_done(llm: OpenAICompatibleLLM) -> None:
    """流提前断开（无 [DONE]）仍应 flush 已聚合的 tool_calls 并发 done。"""
    sse_lines = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c0","function":{"name":"tool_a","arguments":"{\\"k\\":\\"v\\"}"}}]}}]}',
        # 没有 [DONE] 就结束
    ]
    events: list[LLMEvent] = []

    async def on_event(ev: LLMEvent) -> None:
        events.append(ev)

    response = _make_sse_response(sse_lines)
    mock_stream_ctx = MagicMock()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=response)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch.object(llm._client, "stream", return_value=mock_stream_ctx):
        await llm.chat([ChatMessage(role="user", content="x")], [], on_event)

    tool_events = [ev for ev in events if ev.type == "tool_call"]
    assert len(tool_events) == 1
    assert tool_events[0].tool_call.arguments == {"k": "v"}
    assert events[-1].type == "done"


@pytest.mark.asyncio
async def test_http_error_emits_done(llm: OpenAICompatibleLLM) -> None:
    """HTTP 非 200 应记录错误并发 done 事件，不抛异常。"""
    events: list[LLMEvent] = []

    async def on_event(ev: LLMEvent) -> None:
        events.append(ev)

    error_response = httpx.Response(
        status_code=500,
        content=b"internal error",
        request=httpx.Request("POST", "http://test/chat/completions"),
    )
    mock_stream_ctx = MagicMock()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=error_response)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch.object(llm._client, "stream", return_value=mock_stream_ctx):
        await llm.chat([ChatMessage(role="user", content="x")], [], on_event)

    assert events == [LLMEvent(type="done")]


def test_to_openai_messages_assistant_with_tool_calls(llm: OpenAICompatibleLLM) -> None:
    """assistant.tool_calls 应转换为 OpenAI tool_calls 格式。"""
    msg = ChatMessage(
        role="assistant",
        content="",
        tool_calls=[ToolCall(id="c1", name="query", arguments={"a": 1})],
    )
    result = llm._to_openai_messages([msg])
    assert result[0]["role"] == "assistant"
    assert result[0]["content"] is None
    assert result[0]["tool_calls"][0]["function"]["name"] == "query"
    assert '"a"' in result[0]["tool_calls"][0]["function"]["arguments"]


def test_to_openai_messages_tool_role(llm: OpenAICompatibleLLM) -> None:
    """tool 角色消息应转换为 OpenAI tool 格式。"""
    msg = ChatMessage(
        role="tool",
        content='{"status":"ok"}',
        tool_call_id="c1",
        name="query",
    )
    result = llm._to_openai_messages([msg])
    assert result[0]["role"] == "tool"
    assert result[0]["tool_call_id"] == "c1"
    assert result[0]["name"] == "query"
