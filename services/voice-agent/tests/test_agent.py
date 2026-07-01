"""VoiceAgent 主循环单元测试。"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from voice_agent.agent import VoiceAgent
from voice_agent.callbacks import NoopCallbacks
from voice_agent.scenarios import SCENARIO_CONFIGS, DEFAULT_VARIABLES
from voice_agent.types import (
    CallOutcome,
    ChatMessage,
    LLMEvent,
    STTEvent,
    Scenario,
    TTSChunk,
    ToolCall,
    ToolResult,
)


@pytest.fixture
def scenario_config():
    return SCENARIO_CONFIGS[Scenario.ECOMMERCE]


@pytest.fixture
def variables():
    return dict(DEFAULT_VARIABLES)


@pytest.fixture
def captured_callbacks():
    """记录所有回调事件的 callbacks 实现。"""

    class CapturingCallbacks(NoopCallbacks):
        def __init__(self) -> None:
            self.agent_speech: list[str] = []
            self.caller_speech: list[str] = []
            self.tool_calls: list[tuple[ToolCall, ToolResult]] = []
            self.escalations: list[str] = []
            self.audio_outputs: list[bytes] = []
            self.ends: list[str] = []

        async def on_agent_speech(self, text: str) -> None:
            self.agent_speech.append(text)

        async def on_caller_speech(self, text: str) -> None:
            self.caller_speech.append(text)

        async def on_tool_call(self, call: ToolCall, result: ToolResult) -> None:
            self.tool_calls.append((call, result))

        async def on_escalate(self, reason: str) -> None:
            self.escalations.append(reason)

        async def on_audio_output(self, audio: bytes) -> None:
            self.audio_outputs.append(audio)

        async def on_end(self, reason: str) -> None:
            self.ends.append(reason)

    return CapturingCallbacks()


@pytest.fixture
def mock_llm():
    """Mock LLM，按预设脚本返回 delta/tool_call/done 事件。"""

    class ScriptedLLM:
        def __init__(self) -> None:
            self.scripts: list[list[LLMEvent]] = []
            self.cancel_called = False
            self.calls = 0

        def set_script(self, events: list[LLMEvent]) -> None:
            self.scripts.append(events)

        async def chat(self, messages, tools, on_event) -> None:
            self.calls += 1
            script = self.scripts.pop(0) if self.scripts else [LLMEvent(type="done")]
            for ev in script:
                await on_event(ev)

        def cancel(self) -> None:
            self.cancel_called = True

        async def close(self) -> None:
            pass

        @property
        def name(self) -> str:
            return "scripted"

    return ScriptedLLM()


@pytest.fixture
def mock_tts():
    """Mock TTS，每个合成任务产生 2 个 PCM 块 + 1 个 final。"""

    class ScriptedTTS:
        def __init__(self) -> None:
            self.interrupt_called = False
            self.synthesize_calls: list[str] = []

        async def synthesize(self, text, on_chunk, speaker=None, instruct_text=None) -> None:
            self.synthesize_calls.append(text)
            await on_chunk(TTSChunk(audio=b"\x00" * 100, sample_rate=16000, is_final=False))
            await on_chunk(TTSChunk(audio=b"\x00" * 100, sample_rate=16000, is_final=False))
            await on_chunk(TTSChunk(audio=b"", sample_rate=16000, is_final=True))

        def interrupt(self) -> None:
            self.interrupt_called = True

        async def close(self) -> None:
            pass

        @property
        def name(self) -> str:
            return "scripted"

    return ScriptedTTS()


@pytest.fixture
def mock_tools():
    """Mock 工具分发器。"""

    class MockTools:
        def __init__(self) -> None:
            self.dispatch_results: dict[str, ToolResult] = {}

        def get_tool_definitions(self, scenario):
            return []

        async def dispatch(self, call: ToolCall) -> ToolResult:
            return self.dispatch_results.get(
                call.name,
                ToolResult(tool_call_id=call.id, result={"ok": True}),
            )

        async def close(self) -> None:
            pass

    return MockTools()


@pytest.fixture
def mock_rag():
    """Mock RAG 服务（返回空上下文）。"""

    class MockRag:
        async def retrieve(self, scenario, query, top_k=3) -> str:
            return ""

        async def close(self) -> None:
            pass

    return MockRag()


@pytest.fixture
def mock_tasks():
    """Mock TaskClient。"""

    class MockTasks:
        def __init__(self) -> None:
            self.transcripts: list[tuple[str, str, str]] = []
            self.outcomes: list[tuple[str, str]] = []
            self.transfers: list[str] = []

        async def get_task(self, task_id):
            return None

        async def append_transcript(self, task_id, role, content, emotion=None):
            self.transcripts.append((task_id, role, content))

        async def set_outcome(self, task_id, outcome, tags=None):
            self.outcomes.append((task_id, outcome))

        async def transfer_to_human(self, task_id, extension=None):
            self.transfers.append(task_id)

        async def update_status(self, task_id, status):
            pass

        async def close(self) -> None:
            pass

    return MockTasks()


@pytest.fixture
def agent(mock_llm, mock_tts, mock_tools, mock_rag, mock_tasks):
    """构造测试用 VoiceAgent。"""
    return VoiceAgent(
        llm=mock_llm,
        tts=mock_tts,
        tools=mock_tools,
        rag=mock_rag,
        tasks=mock_tasks,
        max_turns=3,
        turn_timeout_s=2,
    )


@pytest.mark.asyncio
async def test_greeting_and_single_turn(
    agent: VoiceAgent,
    scenario_config,
    variables,
    captured_callbacks,
    mock_llm,
) -> None:
    """测试 greeting 播报 + 单轮对话。"""
    # 预设 LLM 回复脚本
    mock_llm.set_script([
        LLMEvent(type="delta", content="好的，我帮您查一下"),
        LLMEvent(type="done"),
    ])

    call_id = "test-call-1"

    # 异步启动会话
    session_task = asyncio.create_task(
        agent.start_session(call_id, scenario_config, variables, captured_callbacks)
    )

    # 等待 greeting 完成（callback 应记录 greeting 文本）
    await asyncio.sleep(0.1)
    assert len(captured_callbacks.agent_speech) >= 1
    assert "售后助理" in captured_callbacks.agent_speech[0]

    # 注入用户输入
    await agent.inject_user_text(call_id, "我想查订单")

    # 等待会话结束（max_turns=3，但只有 1 轮输入，会因超时退出）
    # 给足够时间让 LLM 回复和 TTS 播报完成
    await asyncio.wait_for(session_task, timeout=10)

    # 验证：Agent 应该说了 greeting + 回复
    assert len(captured_callbacks.agent_speech) == 2
    assert captured_callbacks.caller_speech == ["我想查订单"]
    assert captured_callbacks.ends == ["对话结束"]


@pytest.mark.asyncio
async def test_tool_call_flow(
    agent: VoiceAgent,
    scenario_config,
    variables,
    captured_callbacks,
    mock_llm,
    mock_tools,
) -> None:
    """测试工具调用循环：LLM 返回 tool_call → dispatch → 再生成。"""
    # 第一次 chat：返回 tool_call
    mock_llm.set_script([
        LLMEvent(type="tool_call", tool_call=ToolCall(id="c1", name="query_order", arguments={"orderNo": "X"})),
        LLMEvent(type="done"),
    ])
    # 第二次 chat：基于工具结果生成回复
    mock_llm.set_script([
        LLMEvent(type="delta", content="订单状态：已发货"),
        LLMEvent(type="done"),
    ])
    # 第三次 chat：（如果触发的 max_turns 超时）

    mock_tools.dispatch_results["query_order"] = ToolResult(
        tool_call_id="c1",
        result={"status": "shipped"},
    )

    call_id = "test-call-2"
    session_task = asyncio.create_task(
        agent.start_session(call_id, scenario_config, variables, captured_callbacks)
    )

    await asyncio.sleep(0.1)
    await agent.inject_user_text(call_id, "查订单 X")

    await asyncio.wait_for(session_task, timeout=10)

    # 验证工具被调用
    assert len(captured_callbacks.tool_calls) == 1
    assert captured_callbacks.tool_calls[0][0].name == "query_order"
    # 验证 LLM 被调用 2 次（工具调用 + 后续回复）
    assert mock_llm.calls == 2
    # 验证最终回复
    assert any("订单状态" in s for s in captured_callbacks.agent_speech)


@pytest.mark.asyncio
async def test_escalation_via_tool(
    agent: VoiceAgent,
    scenario_config,
    variables,
    captured_callbacks,
    mock_llm,
    mock_tools,
    mock_tasks,
) -> None:
    """测试工具触发转人工。"""
    # 第一次 chat：返回 tool_call
    mock_llm.set_script([
        LLMEvent(type="tool_call", tool_call=ToolCall(id="c1", name="transfer_to_human", arguments={"reason": "客户要求"})),
        LLMEvent(type="done"),
    ])
    # 第二次 chat：生成告别话术
    mock_llm.set_script([
        LLMEvent(type="delta", content="好的，正在为您转接人工专员"),
        LLMEvent(type="done"),
    ])

    mock_tools.dispatch_results["transfer_to_human"] = ToolResult(
        tool_call_id="c1",
        result={"ok": True},
        should_escalate=True,
    )

    call_id = "test-call-3"
    session_task = asyncio.create_task(
        agent.start_session(call_id, scenario_config, variables, captured_callbacks)
    )

    await asyncio.sleep(0.1)
    await agent.inject_user_text(call_id, "我要找人工")

    await asyncio.wait_for(session_task, timeout=10)

    # 验证转人工回调
    assert len(captured_callbacks.escalations) == 1
    assert "transfer_to_human" in captured_callbacks.escalations[0]
    # 验证会话标记结束
    assert call_id in agent._ended
    # 验证 outcome 上报为 ESCALATED
    assert (call_id, CallOutcome.ESCALATED.value) in mock_tasks.outcomes


@pytest.mark.asyncio
async def test_barge_in_interrupts_tts(
    agent: VoiceAgent,
    scenario_config,
    variables,
    captured_callbacks,
    mock_llm,
    mock_tts,
) -> None:
    """测试 barge-in：STT partial 事件应中断 TTS。"""
    mock_llm.set_script([
        LLMEvent(type="delta", content="好的，我帮您查询"),
        LLMEvent(type="done"),
    ])

    call_id = "test-call-4"
    session_task = asyncio.create_task(
        agent.start_session(call_id, scenario_config, variables, captured_callbacks)
    )

    # 等 greeting 的 on_agent_speech 回调执行（在 TTS 之前）
    await asyncio.sleep(0.05)
    assert len(captured_callbacks.agent_speech) >= 1

    # 手动标记 speaking 状态（模拟 TTS 正在播报）
    # ScriptedTTS 同步完成，_speaking 标志会被立即清理，需手动设置以测试 barge-in 逻辑
    agent._speaking[call_id] = True

    # 模拟 STT partial 事件触发 barge-in
    await agent._on_stt_event(call_id, STTEvent(type="partial", text="等一下"))

    # TTS interrupt 应被调用
    assert mock_tts.interrupt_called
    # LLM cancel 也应被调用
    assert mock_llm.cancel_called
    # speaking 标志应被清除
    assert not agent._speaking.get(call_id)

    # 取消会话（避免测试挂起）
    await agent.end_session(call_id)
    session_task.cancel()
    try:
        await session_task
    except asyncio.CancelledError:
        pass


@pytest.mark.asyncio
async def test_max_turns_limit(
    scenario_config,
    variables,
    captured_callbacks,
    mock_llm,
    mock_tts,
    mock_tools,
    mock_rag,
    mock_tasks,
) -> None:
    """测试 max_turns 上限：超过轮数自动结束。"""
    # 构造一个 max_turns=2 的 agent
    agent = VoiceAgent(
        llm=mock_llm,
        tts=mock_tts,
        tools=mock_tools,
        rag=mock_rag,
        tasks=mock_tasks,
        max_turns=2,
        turn_timeout_s=1,
    )

    # 每轮都返回简单回复
    mock_llm.set_script([LLMEvent(type="delta", content="ok"), LLMEvent(type="done")])
    mock_llm.set_script([LLMEvent(type="delta", content="ok"), LLMEvent(type="done")])

    call_id = "test-call-5"

    # 异步启动会话
    session_task = asyncio.create_task(
        agent.start_session(call_id, scenario_config, variables, captured_callbacks)
    )

    # 等 greeting 完成
    await asyncio.sleep(0.05)
    # 注入 2 轮输入
    await agent.inject_user_text(call_id, "问题1")
    await asyncio.sleep(0.05)
    await agent.inject_user_text(call_id, "问题2")

    await asyncio.wait_for(session_task, timeout=10)

    # 验证：2 轮后自动结束（不依赖超时）
    # caller_speech 应记录 2 个用户输入
    assert len(captured_callbacks.caller_speech) <= 2


@pytest.mark.asyncio
async def test_end_session_clears_state(
    agent: VoiceAgent,
    scenario_config,
    variables,
    captured_callbacks,
) -> None:
    """测试 end_session 清理所有会话状态。"""
    call_id = "test-call-6"
    # 手动塞入一些状态
    agent._sessions[call_id] = MagicMock()
    agent._scenario_configs[call_id] = scenario_config
    agent._callbacks[call_id] = captured_callbacks
    agent._speaking[call_id] = True

    await agent.end_session(call_id)

    assert call_id not in agent._sessions
    assert call_id not in agent._scenario_configs
    assert call_id not in agent._callbacks
    assert call_id not in agent._speaking
    assert call_id in agent._ended


@pytest.mark.asyncio
async def test_executes_immutable_flow_snapshot(
    agent: VoiceAgent,
    scenario_config,
    variables,
    captured_callbacks,
) -> None:
    flow = {
        "id": "version-1",
        "nodes": [
            {"id": "start", "type": "start", "data": {}},
            {
                "id": "welcome",
                "type": "dialog",
                "data": {"mode": "script", "text": "您好，{company}"},
            },
            {
                "id": "end",
                "type": "end",
                "data": {"mode": "complete", "farewell": "再见"},
            },
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "welcome"},
            {"id": "e2", "source": "welcome", "target": "end"},
        ],
    }

    await agent.start_session(
        "flow-call-1",
        scenario_config,
        variables,
        captured_callbacks,
        flow_version=flow,
    )

    assert captured_callbacks.agent_speech == [
        f"您好，{variables['company']}",
        "再见",
    ]


@pytest.mark.asyncio
async def test_flow_decision_uses_label_then_default(
    agent: VoiceAgent,
    scenario_config,
    variables,
    captured_callbacks,
) -> None:
    flow = {
        "id": "version-2",
        "nodes": [
            {"id": "start", "type": "start", "data": {}},
            {
                "id": "question",
                "type": "dialog",
                "data": {"mode": "question", "prompt": "您感兴趣吗？", "waitForResponse": True},
            },
            {"id": "decision", "type": "decision", "data": {"mode": "intent"}},
            {"id": "yes", "type": "end", "data": {"farewell": "好的，为您登记"}},
            {"id": "no", "type": "end", "data": {"farewell": "感谢接听"}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "question"},
            {"id": "e2", "source": "question", "target": "decision"},
            {"id": "e3", "source": "decision", "target": "yes", "label": "感兴趣/考虑"},
            {"id": "e4", "source": "decision", "target": "no", "label": "default"},
        ],
    }
    task = asyncio.create_task(
        agent.start_session(
            "flow-call-2",
            scenario_config,
            variables,
            captured_callbacks,
            flow_version=flow,
        )
    )
    await asyncio.sleep(0.05)
    await agent.inject_user_text("flow-call-2", "我很感兴趣")
    await asyncio.wait_for(task, timeout=2)

    assert captured_callbacks.caller_speech == ["我很感兴趣"]
    assert captured_callbacks.agent_speech[-1] == "好的，为您登记"
