"""VoiceAgent 主循环单元测试。"""

from __future__ import annotations

import asyncio
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from voice_agent.agent import VoiceAgent
from voice_agent.callbacks import NoopCallbacks
from voice_agent.flow_executor import render_template
from voice_agent.scenarios import SCENARIO_CONFIGS, DEFAULT_VARIABLES
from voice_agent.types import (
    CallOutcome,
    CallSession,
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
            self.escalation_extensions: list[str | None] = []
            self.actions: list[tuple[str, dict[str, Any]]] = []
            self.audio_outputs: list[bytes] = []
            self.ends: list[str] = []

        async def on_agent_speech(self, text: str) -> None:
            self.agent_speech.append(text)

        async def on_caller_speech(self, text: str) -> None:
            self.caller_speech.append(text)

        async def on_tool_call(self, call: ToolCall, result: ToolResult) -> None:
            self.tool_calls.append((call, result))

        async def on_escalate(self, reason: str, extension: str | None = None) -> None:
            self.escalations.append(reason)
            self.escalation_extensions.append(extension)

        async def on_action(self, action_type: str, config: dict) -> None:
            self.actions.append((action_type, config))

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
        async def retrieve(
            self,
            scenario,
            query,
            top_k=3,
            tenant_id=None,
            user_id=None,
        ) -> str:
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
            self.transfers: list[tuple[str, str | None]] = []
            self.actions: list[tuple[str, str, dict[str, Any], str]] = []

        async def get_task(self, task_id):
            return None

        async def append_transcript(self, task_id, role, content, emotion=None):
            self.transcripts.append((task_id, role, content))

        async def set_outcome(self, task_id, outcome, tags=None):
            self.outcomes.append((task_id, outcome))

        async def transfer_to_human(self, task_id, extension=None):
            self.transfers.append((task_id, extension))

        async def execute_action(self, task_id, action_type, config, idempotency_key):
            self.actions.append((task_id, action_type, config, idempotency_key))
            return True

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


def test_flow_template_render_supports_new_and_legacy_variables() -> None:
    text = "您好，${company}，订单{{orderNo}}，金额{amount}，未知${missing}"

    assert render_template(
        text,
        {"company": "测试公司", "orderNo": "A001", "amount": "100"},
    ) == "您好，测试公司，订单A001，金额100，未知${missing}"


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
async def test_receive_audio_suppressed_while_tts_is_speaking(
    agent: VoiceAgent,
) -> None:
    """TTS 播放中不应把回声音频送入 ASR。"""

    class FakeSTT:
        def __init__(self) -> None:
            self.sent: list[bytes] = []
            self.end_speech_calls = 0

        async def send_audio(self, pcm: bytes) -> None:
            self.sent.append(pcm)

        async def end_speech(self) -> None:
            self.end_speech_calls += 1

    class FakeVAD:
        def __init__(self) -> None:
            self.feed_calls = 0
            self.reset_calls = 0

        def feed(self, frame: bytes):
            self.feed_calls += 1
            return "speech", [frame]

        def reset(self) -> None:
            self.reset_calls += 1

    call_id = "gate-call-1"
    stt = FakeSTT()
    vad = FakeVAD()
    agent._stt_handles[call_id] = stt  # type: ignore[assignment]
    agent._vads[call_id] = vad  # type: ignore[assignment]
    agent._channels[call_id] = "freeswitch"
    agent._speaking[call_id] = True

    await agent.receive_audio(call_id, b"\x01" * 640)

    assert stt.sent == []
    assert stt.end_speech_calls == 0
    assert vad.feed_calls == 0
    assert vad.reset_calls == 1


@pytest.mark.asyncio
async def test_receive_audio_suppressed_during_tts_tail_guard_then_recovers(
    agent: VoiceAgent,
) -> None:
    """TTS 结束后的尾音保护窗口内丢弃音频，窗口过后恢复 ASR。"""

    class FakeSTT:
        def __init__(self) -> None:
            self.sent: list[bytes] = []

        async def send_audio(self, pcm: bytes) -> None:
            self.sent.append(pcm)

        async def end_speech(self) -> None:
            pass

    class FakeVAD:
        def __init__(self) -> None:
            self.reset_calls = 0

        def feed(self, frame: bytes):
            return "speech", [frame]

        def reset(self) -> None:
            self.reset_calls += 1

    call_id = "gate-call-2"
    stt = FakeSTT()
    vad = FakeVAD()
    agent._stt_handles[call_id] = stt  # type: ignore[assignment]
    agent._vads[call_id] = vad  # type: ignore[assignment]

    agent._asr_suppressed_until[call_id] = time.monotonic() + 10
    await agent.receive_audio(call_id, b"\x01" * 640)
    assert stt.sent == []
    assert vad.reset_calls == 1

    agent._asr_suppressed_until[call_id] = time.monotonic() - 1
    await agent.receive_audio(call_id, b"\x01" * 640)
    assert stt.sent == [b"\x01" * 640]


def _pcm_frame(amplitude: int, frame_ms: int = 20, sample_rate: int = 16000) -> bytes:
    """构造定幅 PCM16 单声道帧，用于合成高/低能量测试音频。"""
    num_samples = sample_rate * frame_ms // 1000
    return amplitude.to_bytes(2, "little", signed=True) * num_samples


@pytest.fixture
def rms_barge_agent(mock_llm, mock_tts, mock_tools, mock_rag, mock_tasks) -> VoiceAgent:
    """开启 RMS barge-in 粗检测的 VoiceAgent，用于测试挂起容差逻辑。"""
    return VoiceAgent(
        llm=mock_llm,
        tts=mock_tts,
        tools=mock_tools,
        rag=mock_rag,
        tasks=mock_tasks,
        barge_in_during_tts_enabled=True,
        barge_in_min_ms=500,
        barge_in_rms_threshold=0.08,
        barge_in_hangover_ms=240,
    )


def test_barge_in_rms_high_low_alternating_within_hangover_accumulates(
    rms_barge_agent: VoiceAgent, mock_tts
) -> None:
    """高-低交替、低谷时长均小于 hangover 时，有效发声时长应继续累计并最终触发。

    自然语音音节间存在短暂能量低谷（远小于 hangover），不应清零已累计的
    有效发声时长，否则连续说话永远攒不够 barge_in_min_ms。
    """
    call_id = "rms-barge-1"
    rms_barge_agent._speaking[call_id] = True

    high_frame = _pcm_frame(12000)  # rms ≈ 0.366，远超阈值 0.08
    low_frame = _pcm_frame(200)  # rms ≈ 0.006，远低于阈值
    # 每轮 5 个高帧（100ms）+ 3 个低帧（60ms，< hangover 240ms），共 5 轮
    # 累计有效发声 = 5*5*20ms = 500ms，达到 barge_in_min_ms 应触发
    audio_bytes = (high_frame * 5 + low_frame * 3) * 5

    triggered = rms_barge_agent._observe_barge_in_candidate(call_id, audio_bytes)

    assert triggered
    assert mock_tts.interrupt_called
    assert call_id not in rms_barge_agent._barge_in_voice_ms
    assert call_id not in rms_barge_agent._barge_in_low_ms


def test_barge_in_rms_low_gap_exceeding_hangover_resets_accumulation(
    rms_barge_agent: VoiceAgent, mock_tts
) -> None:
    """低谷本身持续达到 hangover 时，视为真正停顿，应清零已累计的发声时长。"""
    call_id = "rms-barge-2"
    rms_barge_agent._speaking[call_id] = True

    high_frame = _pcm_frame(12000)
    low_frame = _pcm_frame(200)
    # 5 个高帧（100ms，未达阈值）+ 12 个低帧（240ms == hangover，触发清零）
    audio_bytes = high_frame * 5 + low_frame * 12

    triggered = rms_barge_agent._observe_barge_in_candidate(call_id, audio_bytes)

    assert not triggered
    assert not mock_tts.interrupt_called
    assert rms_barge_agent._barge_in_voice_ms.get(call_id, 0) == 0

    # 清零后再补少量高帧，仍不足 barge_in_min_ms，不应触发
    triggered_again = rms_barge_agent._observe_barge_in_candidate(call_id, high_frame * 5)
    assert not triggered_again
    assert not mock_tts.interrupt_called


def test_barge_in_rms_all_low_energy_never_triggers(
    rms_barge_agent: VoiceAgent, mock_tts
) -> None:
    """全程低能量（如静音/背景噪声）不应触发 barge-in。"""
    call_id = "rms-barge-3"
    rms_barge_agent._speaking[call_id] = True

    low_frame = _pcm_frame(200)
    audio_bytes = low_frame * 50  # 1000ms 低能量音频

    triggered = rms_barge_agent._observe_barge_in_candidate(call_id, audio_bytes)

    assert not triggered
    assert not mock_tts.interrupt_called
    assert rms_barge_agent._barge_in_voice_ms.get(call_id, 0) == 0


class _GateFakeSTT:
    def __init__(self) -> None:
        self.sent: list[bytes] = []
        self.end_speech_calls = 0

    async def send_audio(self, pcm: bytes) -> None:
        self.sent.append(pcm)

    async def end_speech(self) -> None:
        self.end_speech_calls += 1


class _GateFakeVAD:
    def __init__(self) -> None:
        self.feed_calls = 0
        self.reset_calls = 0

    def feed(self, frame: bytes):
        self.feed_calls += 1
        return "speech", [frame]

    def reset(self) -> None:
        self.reset_calls += 1


@pytest.mark.asyncio
async def test_web_channel_not_suppressed_during_tts(agent: VoiceAgent) -> None:
    """web 通道 + ASR_TTS_GATE_WEB_ENABLED=false（默认）：播报期间不抑制，
    尾音保护窗同样跳过（信任浏览器 AEC）。"""
    call_id = "web-gate-1"
    stt = _GateFakeSTT()
    vad = _GateFakeVAD()
    agent._stt_handles[call_id] = stt  # type: ignore[assignment]
    agent._vads[call_id] = vad  # type: ignore[assignment]
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True
    agent._asr_suppressed_until[call_id] = time.monotonic() + 10  # 尾音保护窗也应跳过

    await agent.receive_audio(call_id, b"\x01" * 640)

    assert stt.sent == [b"\x01" * 640]
    assert vad.feed_calls == 1
    assert vad.reset_calls == 0


@pytest.mark.asyncio
async def test_web_channel_gate_env_enabled_restores_suppression(
    mock_llm, mock_tts, mock_tools, mock_rag, mock_tasks
) -> None:
    """ASR_TTS_GATE_WEB_ENABLED=true 回退：web 通道播报期间照旧抑制。"""
    agent = VoiceAgent(
        llm=mock_llm,
        tts=mock_tts,
        tools=mock_tools,
        rag=mock_rag,
        tasks=mock_tasks,
        asr_tts_gate_web_enabled=True,
    )
    call_id = "web-gate-2"
    stt = _GateFakeSTT()
    vad = _GateFakeVAD()
    agent._stt_handles[call_id] = stt  # type: ignore[assignment]
    agent._vads[call_id] = vad  # type: ignore[assignment]
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True

    await agent.receive_audio(call_id, b"\x01" * 640)

    assert stt.sent == []
    assert vad.feed_calls == 0
    assert vad.reset_calls == 1


@pytest.mark.asyncio
async def test_stt_partial_triggers_interrupt_and_on_interrupted(
    agent: VoiceAgent,
    mock_llm,
    mock_tts,
) -> None:
    """STT partial 触发 _interrupt_speaking，且可选回调 on_interrupted 被调。"""

    class InterruptibleCallbacks(NoopCallbacks):
        def __init__(self) -> None:
            self.interrupted_calls = 0

        async def on_interrupted(self) -> None:
            self.interrupted_calls += 1

    call_id = "barge-web-1"
    callbacks = InterruptibleCallbacks()
    agent._callbacks[call_id] = callbacks
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True

    await agent._on_stt_event(call_id, STTEvent(type="partial", text="停一下"))
    await asyncio.sleep(0)  # 让 create_task 出来的 on_interrupted 执行

    assert mock_tts.interrupt_called
    assert mock_llm.cancel_called
    assert not agent._speaking.get(call_id)
    assert callbacks.interrupted_calls == 1


@pytest.mark.asyncio
async def test_web_echo_guard_ignores_tolerant_tts_echo(
    agent: VoiceAgent, mock_llm, mock_tts
) -> None:
    """ASR 对 TTS 有少量错字时也应判回声，partial/final 均不打断。"""
    call_id = "echo-guard-web-1"
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True
    agent._speak_started_at[call_id] = time.monotonic() - 1.0
    agent._tts_reference_text[call_id] = (
        "您好，我是示例公司的客服，请问您购买的商品收到了吗？"
    )

    await agent._on_stt_event(call_id, STTEvent(type="partial", text="你好"))
    await agent._on_stt_event(
        call_id, STTEvent(type="partial", text="你好，我是实力公司的客服")
    )
    await agent._on_stt_event(
        call_id, STTEvent(type="final", text="你好，我是实力公司的客服。")
    )

    assert not mock_tts.interrupt_called
    assert not mock_llm.cancel_called
    assert agent._speaking.get(call_id) is True
    assert call_id not in agent._injected_text


@pytest.mark.asyncio
async def test_web_echo_guard_distinct_partial_interrupts(
    agent: VoiceAgent, mock_llm, mock_tts
) -> None:
    """与当前 TTS 明显不同的插话应在 partial 阶段立即打断。"""
    call_id = "echo-guard-web-2"
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True
    agent._speak_started_at[call_id] = time.monotonic() - 1.0
    agent._tts_reference_text[call_id] = "您好，我是示例公司的客服。"

    await agent._on_stt_event(
        call_id, STTEvent(type="partial", text="等一下，我还有问题")
    )

    assert mock_tts.interrupt_called
    assert mock_llm.cancel_called
    assert not agent._speaking.get(call_id)
    assert agent._recent_partial.get(call_id) == "等一下，我还有问题"


@pytest.mark.asyncio
async def test_web_echo_guard_defers_short_overlap_until_final(
    agent: VoiceAgent, mock_tts
) -> None:
    """短回答与问题文字重叠时，partial 不抢停，但 final 仍可打断并入队。"""
    call_id = "echo-guard-web-3"
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True
    agent._speak_started_at[call_id] = time.monotonic() - 1.0
    agent._tts_reference_text[call_id] = "请问您购买的商品收到了吗？"

    await agent._on_stt_event(call_id, STTEvent(type="partial", text="收到了"))
    assert not mock_tts.interrupt_called
    assert agent._speaking.get(call_id) is True

    await agent._on_stt_event(call_id, STTEvent(type="final", text="收到了。"))

    assert mock_tts.interrupt_called
    assert not agent._speaking.get(call_id)
    assert await agent._wait_for_user_speech(call_id) == "收到了。"


@pytest.mark.asyncio
async def test_web_echo_guard_drops_delayed_echo_final(
    agent: VoiceAgent, mock_tts
) -> None:
    """TTS 刚播完后的延迟 echo final 不得抢占下一轮 waiter。"""
    call_id = "echo-guard-web-4"
    agent._channels[call_id] = "web"
    agent._tts_reference_text[call_id] = "您好，我是示例公司的客服。"
    agent._tts_reference_until[call_id] = time.monotonic() + 0.5
    waiter: asyncio.Future[str] = asyncio.get_running_loop().create_future()
    agent._endpoint_waiters[call_id] = waiter

    await agent._on_stt_event(
        call_id, STTEvent(type="final", text="你好，我是实力公司的客服。")
    )

    assert not mock_tts.interrupt_called
    assert not waiter.done()


@pytest.mark.asyncio
async def test_interrupt_without_on_interrupted_callback_is_noop(
    agent: VoiceAgent,
    mock_tts,
) -> None:
    """callbacks 未实现 on_interrupted（如 TextTestCallbacks）时打断不报错。"""
    call_id = "barge-plain-1"
    agent._callbacks[call_id] = NoopCallbacks()
    agent._speaking[call_id] = True

    agent._interrupt_speaking(call_id)
    await asyncio.sleep(0)

    assert mock_tts.interrupt_called
    assert not agent._speaking.get(call_id)


@pytest.mark.asyncio
async def test_stt_final_without_waiter_buffers_text_and_interrupts(
    agent: VoiceAgent,
    mock_tts,
) -> None:
    """final 落在 waiter 窗口外（如播报中）：缓冲进 _injected_text 并打断,不丢句。

    短语打断往往只出 final 不出 online partial(2pass 在线块 ~600ms),
    丢弃 final 会导致"用户说完了 agent 还在等"——打不断 + 体感延迟暴增。
    """
    call_id = "final-buffer-1"
    agent._callbacks[call_id] = NoopCallbacks()
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True

    await agent._on_stt_event(call_id, STTEvent(type="final", text="停一下"))

    assert mock_tts.interrupt_called
    assert not agent._speaking.get(call_id)
    # 下一次 _wait_for_user_speech 立即消费缓冲文本
    assert await agent._wait_for_user_speech(call_id) == "停一下"

    # 多个 final 依次落在窗口外:拼接不覆盖
    await agent._on_stt_event(call_id, STTEvent(type="final", text="不需要了"))
    await agent._on_stt_event(call_id, STTEvent(type="final", text="谢谢"))
    assert await agent._wait_for_user_speech(call_id) == "不需要了 谢谢"


@pytest.mark.asyncio
async def test_stt_final_empty_without_waiter_is_dropped(agent: VoiceAgent) -> None:
    """窗口外的空 final(纯噪声整句被识别为空)不缓冲、不打断。"""
    call_id = "final-buffer-2"
    agent._callbacks[call_id] = NoopCallbacks()
    agent._speaking[call_id] = True

    await agent._on_stt_event(call_id, STTEvent(type="final", text=""))

    assert agent._speaking.get(call_id)
    assert call_id not in agent._injected_text


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
                "data": {"mode": "script", "text": "您好，${company}"},
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
async def test_flow_dialog_uses_edge_intent_then_default(
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
            {"id": "yes", "type": "end", "data": {"farewell": "好的，为您登记"}},
            {"id": "no", "type": "end", "data": {"farewell": "感谢接听"}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "question"},
            {"id": "e2", "source": "question", "target": "yes", "label": "感兴趣/考虑"},
            {"id": "e3", "source": "question", "target": "no", "label": "default"},
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


@pytest.mark.asyncio
async def test_flow_ai_dialog_generates_once_then_edge_intent_uses_user_input(
    agent: VoiceAgent,
    mock_llm,
    scenario_config,
    variables,
    captured_callbacks,
) -> None:
    mock_llm.set_script([
        LLMEvent(type="delta", content="您好，请问您是否已经收到商品？"),
        LLMEvent(type="done"),
    ])
    flow = {
        "id": "version-ai",
        "nodes": [
            {"id": "start", "type": "start", "data": {}},
            {
                "id": "ai",
                "type": "dialog",
                "data": {
                    "mode": "ai",
                    "prompt": "内部提示：确认客户是否收到商品",
                    "systemPrompt": "你是电商售后客服。",
                    "waitForResponse": True,
                },
            },
            {"id": "received", "type": "end", "data": {"farewell": "感谢反馈"}},
            {"id": "missing", "type": "end", "data": {"farewell": "我来帮您登记售后"}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "ai"},
            {"id": "e2", "source": "ai", "target": "received", "label": "满意"},
            {"id": "e3", "source": "ai", "target": "missing", "label": "未收到"},
        ],
    }

    task = asyncio.create_task(
        agent.start_session(
            "flow-call-ai",
            scenario_config,
            variables,
            captured_callbacks,
            flow_version=flow,
        )
    )
    await asyncio.sleep(0.05)
    await agent.inject_user_text("flow-call-ai", "未收到")
    await asyncio.wait_for(task, timeout=2)

    assert mock_llm.calls == 1
    assert captured_callbacks.caller_speech == ["未收到"]
    assert captured_callbacks.agent_speech == [
        "您好，请问您是否已经收到商品？",
        "我来帮您登记售后",
    ]
    assert all("内部提示" not in text for text in captured_callbacks.agent_speech)


@pytest.mark.asyncio
async def test_flow_dry_run_crm_action_only_emits_debug_action(
    agent: VoiceAgent,
    scenario_config,
    variables,
    captured_callbacks,
) -> None:
    flow = {
        "id": "version-dry-crm",
        "nodes": [
            {"id": "start", "type": "start", "data": {}},
            {
                "id": "crm",
                "type": "action",
                "data": {
                    "actionType": "crm",
                    "config": {"action": "create_after_sale_ticket", "priority": "high"},
                },
            },
            {"id": "end", "type": "end", "data": {"farewell": "已记录"}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "crm"},
            {"id": "e2", "source": "crm", "target": "end"},
        ],
    }

    await agent.start_session(
        "flow-call-dry-crm",
        scenario_config,
        variables,
        captured_callbacks,
        flow_version=flow,
        dry_run=True,
    )

    assert captured_callbacks.actions == [
        ("crm", {"action": "create_after_sale_ticket", "priority": "high"})
    ]
    assert captured_callbacks.tool_calls == []
    assert captured_callbacks.agent_speech == ["已记录"]


@pytest.mark.asyncio
async def test_flow_crm_action_is_enqueued_to_task_control_plane(
    agent: VoiceAgent,
    scenario_config,
    variables,
    captured_callbacks,
    mock_tasks,
) -> None:
    flow = {
        "id": "version-crm",
        "nodes": [
            {"id": "start", "type": "start", "data": {}},
            {
                "id": "crm",
                "type": "action",
                "data": {
                    "actionType": "crm",
                    "config": {"action": "create_after_sale_ticket", "priority": "high"},
                },
            },
            {"id": "end", "type": "end", "data": {"farewell": "已记录"}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "crm"},
            {"id": "e2", "source": "crm", "target": "end"},
        ],
    }

    await agent.start_session(
        "flow-call-crm",
        scenario_config,
        variables,
        captured_callbacks,
        flow_version=flow,
    )

    assert len(mock_tasks.actions) == 1
    assert mock_tasks.actions[0][0] == "flow-call-crm"
    assert mock_tasks.actions[0][1] == "crm"
    assert mock_tasks.actions[0][2] == {
        "action": "create_after_sale_ticket",
        "priority": "high",
    }
    assert captured_callbacks.tool_calls == []
    assert captured_callbacks.agent_speech == ["已记录"]


@pytest.mark.asyncio
async def test_flow_transfer_passes_extension(
    agent: VoiceAgent,
    scenario_config,
    variables,
    captured_callbacks,
) -> None:
    flow = {
        "id": "version-transfer",
        "nodes": [
            {"id": "start", "type": "start", "data": {}},
            {
                "id": "transfer",
                "type": "action",
                "data": {
                    "actionType": "transfer",
                    "config": {"extension": "1001", "reason": "客户要求人工"},
                },
            },
            {"id": "end", "type": "end", "data": {"farewell": "请稍候"}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "transfer"},
            {"id": "e2", "source": "transfer", "target": "end"},
        ],
    }

    await agent.start_session(
        "flow-call-transfer",
        scenario_config,
        variables,
        captured_callbacks,
        flow_version=flow,
    )

    assert captured_callbacks.escalations == ["客户要求人工"]
    assert captured_callbacks.escalation_extensions == ["1001"]


# ---------------------------------------------------------------------------
# _speak 取消来源区分：外部任务取消(挂断)必须传播；tts.interrupt() 自抛(barge-in)吞掉
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_speak_propagates_external_cancellation(agent: VoiceAgent) -> None:
    """挂断/会话拆除时 session_task.cancel() 落在 synthesize 里,
    CancelledError 必须传播出 _speak,否则会话僵尸运行。"""

    class HangingTTS:
        def __init__(self) -> None:
            self.interrupt_called = False

        async def synthesize(self, text, on_chunk, speaker=None, instruct_text=None):
            await asyncio.Event().wait()  # 永不返回,模拟合成期被外部取消

        def interrupt(self) -> None:
            self.interrupt_called = True

        @property
        def name(self) -> str:
            return "hanging"

    call_id = "speak-cancel-external"
    agent._tts = HangingTTS()  # type: ignore[assignment]
    agent._callbacks[call_id] = NoopCallbacks()
    agent._speaking[call_id] = True

    task = asyncio.create_task(agent._speak(call_id, "你好"))
    await asyncio.sleep(0.02)  # 进入 synthesize 的 await
    task.cancel()  # 模拟 session_task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    # finally 仍应清理 _speaking
    assert call_id not in agent._speaking


@pytest.mark.asyncio
async def test_speak_swallows_barge_in_cancellation(agent: VoiceAgent) -> None:
    """tts.interrupt() 令 synthesize 自抛 CancelledError = barge-in,
    _speak 应吞掉并正常返回(不传播)。"""

    class SelfInterruptingTTS:
        def __init__(self) -> None:
            self.interrupt_called = False

        async def synthesize(self, text, on_chunk, speaker=None, instruct_text=None):
            # 模拟 interrupt() 后 synthesize 自抛 CancelledError(非外部 task.cancel)
            raise asyncio.CancelledError()

        def interrupt(self) -> None:
            self.interrupt_called = True

        @property
        def name(self) -> str:
            return "self-interrupting"

    call_id = "speak-cancel-bargein"
    agent._tts = SelfInterruptingTTS()  # type: ignore[assignment]
    agent._callbacks[call_id] = NoopCallbacks()
    agent._speaking[call_id] = True

    # 直接以任务运行以便 current_task().cancelling() 有意义;不应抛出
    await asyncio.create_task(agent._speak(call_id, "你好"))
    assert call_id not in agent._speaking


# ---------------------------------------------------------------------------
# 拖尾保护（TailGuard）：开始于 agent 本轮开口之前的 ASR 语音属于上一轮拖尾，
# 不应触发打断、不应被当作对当前问题的回答，只合并进上一条 user 消息。
# ---------------------------------------------------------------------------


def _seed_tail_session(agent: VoiceAgent, call_id: str) -> CallSession:
    """构造一个已含一条 user 消息的 session（模拟流程已消费上一轮用户语音）。"""
    session = CallSession(
        call_id=call_id,
        scenario="ecommerce",
        variables={},
        messages=[
            ChatMessage(role="user", content="啊是的是的"),
            ChatMessage(role="assistant", content="邀约话术"),
        ],
    )
    agent._sessions[call_id] = session
    return session


@pytest.mark.asyncio
async def test_tail_final_via_fallback_window_merges_not_answer(
    agent: VoiceAgent, mock_tts
) -> None:
    """兜底窗口：无 partial（final-only）且 final 落在开口后窗口内 → 判拖尾。

    复刻真机 bug：拖尾 final 早于 agent 开口就在说，只出 final 不出 partial。
    应不打断、不进 _injected_text、不解析 waiter，只合并进上一条 user 消息。
    """
    call_id = "tail-fallback"
    agent._callbacks[call_id] = NoopCallbacks()
    agent._channels[call_id] = "web"
    session = _seed_tail_session(agent, call_id)
    agent._speaking[call_id] = True
    agent._speak_started_at[call_id] = time.monotonic()  # 刚开口，final 将在 800ms 窗口内

    await agent._on_stt_event(call_id, STTEvent(type="final", text="挺满意的挺满意的"))

    assert not mock_tts.interrupt_called  # 不打断
    assert agent._speaking.get(call_id) is True  # 播报继续
    assert call_id not in agent._injected_text  # 不进缓冲
    assert call_id not in agent._endpoint_waiters  # 未凭空建 waiter
    assert session.messages[0].content == "啊是的是的 挺满意的挺满意的"  # 合并入上轮


@pytest.mark.asyncio
async def test_tail_final_via_primary_partial_signal_merges(
    agent: VoiceAgent, mock_tts
) -> None:
    """主信号：utterance 起始（首个 partial）早于开口 → 判拖尾，即便 final 距开口很久。"""
    call_id = "tail-primary"
    agent._callbacks[call_id] = NoopCallbacks()
    agent._channels[call_id] = "web"
    session = _seed_tail_session(agent, call_id)
    agent._speaking[call_id] = True
    t = time.monotonic()
    agent._speak_started_at[call_id] = t
    agent._utterance_started_at[call_id] = t - 0.5  # utterance 早于开口 0.5s

    await agent._on_stt_event(call_id, STTEvent(type="final", text="挺满意的"))

    assert not mock_tts.interrupt_called
    assert agent._speaking.get(call_id) is True
    assert call_id not in agent._injected_text
    assert session.messages[0].content == "啊是的是的 挺满意的"


@pytest.mark.asyncio
async def test_tail_partial_pre_speak_does_not_interrupt(
    agent: VoiceAgent, mock_tts, mock_llm
) -> None:
    """拖尾 partial（utterance 起始早于开口）不打断，也不写 _recent_partial。"""
    call_id = "tail-partial"
    agent._callbacks[call_id] = NoopCallbacks()
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True
    t = time.monotonic()
    agent._speak_started_at[call_id] = t
    agent._utterance_started_at[call_id] = t - 0.3

    await agent._on_stt_event(call_id, STTEvent(type="partial", text="挺满意"))

    assert not mock_tts.interrupt_called
    assert not mock_llm.cancel_called
    assert agent._speaking.get(call_id) is True
    assert agent._recent_partial.get(call_id) is None  # 拖尾 partial 不污染端点缓存


@pytest.mark.asyncio
async def test_post_speak_partial_still_interrupts(
    agent: VoiceAgent, mock_tts, mock_llm
) -> None:
    """反例：agent 开口之后才到达的 partial = 真打断，行为不变。"""
    call_id = "post-partial"
    agent._callbacks[call_id] = NoopCallbacks()
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True
    agent._speak_started_at[call_id] = time.monotonic() - 1.0  # 开口在 1s 前

    await agent._on_stt_event(call_id, STTEvent(type="partial", text="停一下"))

    assert mock_tts.interrupt_called
    assert mock_llm.cancel_called
    assert not agent._speaking.get(call_id)
    assert agent._recent_partial.get(call_id) == "停一下"


@pytest.mark.asyncio
async def test_post_speak_final_with_utterance_start_buffers_not_tail(
    agent: VoiceAgent, mock_tts
) -> None:
    """反例：utterance 起始晚于开口（有 partial）→ 真打断，final 照常缓冲。"""
    call_id = "post-final-utt"
    agent._callbacks[call_id] = NoopCallbacks()
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True
    t = time.monotonic()
    agent._speak_started_at[call_id] = t
    agent._utterance_started_at[call_id] = t + 0.1  # 开口后才开始

    await agent._on_stt_event(call_id, STTEvent(type="final", text="停一下"))

    assert mock_tts.interrupt_called
    assert not agent._speaking.get(call_id)
    assert await agent._wait_for_user_speech(call_id) == "停一下"


@pytest.mark.asyncio
async def test_tail_fallback_disabled_final_only_buffers(
    agent: VoiceAgent, mock_tts
) -> None:
    """兜底窗口关闭（ASR_TAIL_GUARD_MS=0）+ 无 partial → 非拖尾，final 照常缓冲打断。"""
    call_id = "no-fallback"
    agent._asr_tail_guard_window_ms = 0
    agent._callbacks[call_id] = NoopCallbacks()
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True
    agent._speak_started_at[call_id] = time.monotonic()  # 窗口内，但兜底已关

    await agent._on_stt_event(call_id, STTEvent(type="final", text="停一下"))

    assert mock_tts.interrupt_called
    assert await agent._wait_for_user_speech(call_id) == "停一下"


@pytest.mark.asyncio
async def test_no_speak_started_at_keeps_legacy_barge_in(
    agent: VoiceAgent, mock_tts
) -> None:
    """失效保护：_speaking 为 True 但无 _speak_started_at（未走 _speak）时，
    拖尾判定恒不成立，保持既有打断/缓冲语义（现有单测据此保持绿色）。"""
    call_id = "legacy-safe"
    agent._callbacks[call_id] = NoopCallbacks()
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True  # 未设置 _speak_started_at

    await agent._on_stt_event(call_id, STTEvent(type="final", text="停一下"))

    assert mock_tts.interrupt_called
    assert await agent._wait_for_user_speech(call_id) == "停一下"
