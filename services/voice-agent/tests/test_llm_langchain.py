"""LangChainLLMAdapter 单元测试 — 消息转换、工具转换、流式 delta、tool_calls 聚合。

用 FakeChat 替换 ChatOpenAI 实例，模拟 astream() 返回预设 AIMessageChunk 序列，
不发起真实 HTTP 请求。
"""

from __future__ import annotations

from typing import Any, AsyncIterator

import pytest

# langchain_openai 为可选依赖：未安装时跳过整个测试文件
pytest.importorskip("langchain_openai")
pytest.importorskip("langchain_core")

from langchain_core.messages import (  # noqa: E402
    AIMessage,
    AIMessageChunk,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from voice_agent.llm import LangChainLLMAdapter  # noqa: E402
from voice_agent.types import ChatMessage, LLMEvent, ToolCall, ToolDefinition  # noqa: E402


async def _aiter_chunks(chunks: list[AIMessageChunk]) -> AsyncIterator[AIMessageChunk]:
    """把 list 包装成 async iterator，模拟 astream() 返回值。"""
    for c in chunks:
        yield c


class FakeChat:
    """替代 ChatOpenAI 的假对象，astream() 返回预设 chunks。"""

    def __init__(self, chunks: list[AIMessageChunk]) -> None:
        self._chunks = chunks

    def astream(self, messages: Any, **kwargs: Any) -> AsyncIterator[AIMessageChunk]:
        return _aiter_chunks(self._chunks)


class FailingChat:
    """astream() 抛异常的假对象。"""

    def astream(self, messages: Any, **kwargs: Any) -> AsyncIterator[AIMessageChunk]:
        async def _failing() -> AsyncIterator[AIMessageChunk]:
            raise RuntimeError("network error")
            yield  # pragma: no cover  # 让 Python 识别为 async generator

        return _failing()


@pytest.fixture
def adapter() -> LangChainLLMAdapter:
    """构造测试用适配器（fake api_key，不发起真实请求）。"""
    return LangChainLLMAdapter(
        api_key="test-key",
        model="test-model",
        base_url="http://test",
    )


# ===================== 消息转换测试 =====================


def test_to_langchain_messages_system(adapter: LangChainLLMAdapter) -> None:
    """system 角色 → SystemMessage。"""
    msgs = [ChatMessage(role="system", content="你是助手")]
    result = adapter._to_langchain_messages(msgs)
    assert len(result) == 1
    assert isinstance(result[0], SystemMessage)
    assert result[0].content == "你是助手"


def test_to_langchain_messages_user(adapter: LangChainLLMAdapter) -> None:
    """user 角色 → HumanMessage。"""
    msgs = [ChatMessage(role="user", content="你好")]
    result = adapter._to_langchain_messages(msgs)
    assert isinstance(result[0], HumanMessage)
    assert result[0].content == "你好"


def test_to_langchain_messages_assistant_with_tool_calls(
    adapter: LangChainLLMAdapter,
) -> None:
    """assistant + tool_calls → AIMessage with LangChain 格式 tool_calls。"""
    msg = ChatMessage(
        role="assistant",
        content="",
        tool_calls=[ToolCall(id="c1", name="query", arguments={"a": 1})],
    )
    result = adapter._to_langchain_messages([msg])
    assert isinstance(result[0], AIMessage)
    assert len(result[0].tool_calls) == 1
    tc = result[0].tool_calls[0]
    assert tc["id"] == "c1"
    assert tc["name"] == "query"
    assert tc["args"] == {"a": 1}
    assert tc["type"] == "tool_call"


def test_to_langchain_messages_tool_role(adapter: LangChainLLMAdapter) -> None:
    """tool 角色 → ToolMessage。"""
    msg = ChatMessage(
        role="tool",
        content='{"status":"ok"}',
        tool_call_id="c1",
        name="query",
    )
    result = adapter._to_langchain_messages([msg])
    assert isinstance(result[0], ToolMessage)
    assert result[0].content == '{"status":"ok"}'
    assert result[0].tool_call_id == "c1"


# ===================== 工具转换测试 =====================


def test_to_langchain_tools(adapter: LangChainLLMAdapter) -> None:
    """ToolDefinition → OpenAI function tool 格式。"""
    tools = [
        ToolDefinition(
            name="query_order",
            description="查询订单状态",
            parameters={
                "type": "object",
                "properties": {"orderNo": {"type": "string"}},
            },
        )
    ]
    result = adapter._to_langchain_tools(tools)
    assert len(result) == 1
    assert result[0]["type"] == "function"
    func = result[0]["function"]
    assert func["name"] == "query_order"
    assert func["description"] == "查询订单状态"
    assert func["parameters"]["properties"]["orderNo"]["type"] == "string"


# ===================== 流式 delta 测试 =====================


@pytest.mark.asyncio
async def test_stream_delta_accumulation(adapter: LangChainLLMAdapter) -> None:
    """流式 delta 应通过 on_event 发出，结束时发 done。"""
    adapter._chat = FakeChat([
        AIMessageChunk(content="你好"),
        AIMessageChunk(content="，世界"),
    ])
    events: list[LLMEvent] = []

    async def on_event(ev: LLMEvent) -> None:
        events.append(ev)

    await adapter.chat([ChatMessage(role="user", content="hi")], [], on_event)

    deltas = [ev for ev in events if ev.type == "delta"]
    assert [d.content for d in deltas] == ["你好", "，世界"]
    assert events[-1].type == "done"


# ===================== tool_calls 聚合测试 =====================


@pytest.mark.asyncio
async def test_tool_calls_aggregation_across_chunks(
    adapter: LangChainLLMAdapter,
) -> None:
    """tool_call_chunks 跨 chunk 拼接 arguments。"""
    adapter._chat = FakeChat([
        AIMessageChunk(
            content="",
            tool_call_chunks=[
                {"index": 0, "id": "call_abc", "name": "query_order", "args": '{"orderNo":"'}
            ],
        ),
        AIMessageChunk(
            content="",
            tool_call_chunks=[{"index": 0, "name": "", "args": "DEMO123"}],
        ),
        AIMessageChunk(
            content="",
            tool_call_chunks=[{"index": 0, "name": "", "args": '"}'}],
        ),
    ])
    events: list[LLMEvent] = []

    async def on_event(ev: LLMEvent) -> None:
        events.append(ev)

    await adapter.chat([ChatMessage(role="user", content="查订单")], [], on_event)

    tool_events = [ev for ev in events if ev.type == "tool_call"]
    assert len(tool_events) == 1
    call = tool_events[0].tool_call
    assert call is not None
    assert call.id == "call_abc"
    assert call.name == "query_order"
    assert call.arguments == {"orderNo": "DEMO123"}


@pytest.mark.asyncio
async def test_multiple_tool_calls_ordered_by_index(
    adapter: LangChainLLMAdapter,
) -> None:
    """多个 tool_calls 按 index 升序发出。"""
    adapter._chat = FakeChat([
        AIMessageChunk(
            content="",
            tool_call_chunks=[
                {"index": 1, "id": "c1", "name": "tool_b", "args": "{}"}
            ],
        ),
        AIMessageChunk(
            content="",
            tool_call_chunks=[
                {"index": 0, "id": "c0", "name": "tool_a", "args": "{}"}
            ],
        ),
    ])
    events: list[LLMEvent] = []

    async def on_event(ev: LLMEvent) -> None:
        events.append(ev)

    await adapter.chat([ChatMessage(role="user", content="x")], [], on_event)

    tool_events = [ev for ev in events if ev.type == "tool_call"]
    assert len(tool_events) == 2
    assert tool_events[0].tool_call.id == "c0"
    assert tool_events[1].tool_call.id == "c1"


# ===================== 边界测试 =====================


@pytest.mark.asyncio
async def test_empty_stream_emits_done(adapter: LangChainLLMAdapter) -> None:
    """空流也应发 done 事件。"""
    adapter._chat = FakeChat([])
    events: list[LLMEvent] = []

    async def on_event(ev: LLMEvent) -> None:
        events.append(ev)

    await adapter.chat([ChatMessage(role="user", content="x")], [], on_event)

    assert events == [LLMEvent(type="done")]


@pytest.mark.asyncio
async def test_chat_error_emits_done(adapter: LangChainLLMAdapter) -> None:
    """astream 抛异常应捕获并发 done，不向外抛。"""
    adapter._chat = FailingChat()
    events: list[LLMEvent] = []

    async def on_event(ev: LLMEvent) -> None:
        events.append(ev)

    await adapter.chat([ChatMessage(role="user", content="x")], [], on_event)

    assert events == [LLMEvent(type="done")]


def test_name_format(adapter: LangChainLLMAdapter) -> None:
    """name 应为 langchain:<model> 格式。"""
    assert adapter.name == "langchain:test-model"
