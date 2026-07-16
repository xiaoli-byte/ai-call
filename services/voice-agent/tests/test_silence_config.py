"""场景级静默超时（dialogRepair.silenceTimeoutMs）在 agent 侧的生效测试。"""

import time

from voice_agent.agent import VoiceAgent


def _agent(turn_timeout_s: int = 30) -> VoiceAgent:
    return VoiceAgent(
        llm=None,
        tts=None,
        tools=None,
        rag=None,
        tasks=None,
        turn_timeout_s=turn_timeout_s,
    )


async def test_wait_for_user_speech_uses_per_call_override() -> None:
    """配置了场景级静默超时的通话应按覆盖值超时，而非全局默认。"""
    agent = _agent(turn_timeout_s=30)
    agent._turn_timeout_overrides["call-1"] = 0.05
    started = time.monotonic()
    result = await agent._wait_for_user_speech("call-1")
    elapsed = time.monotonic() - started
    assert result == ""
    assert elapsed < 5  # 覆盖值 50ms 生效；若走全局 30s 会远超

async def test_wait_for_user_speech_falls_back_to_global_timeout() -> None:
    agent = _agent(turn_timeout_s=0)  # 全局 0 秒 → 立即超时
    result = await agent._wait_for_user_speech("call-2")
    assert result == ""


async def test_end_session_clears_timeout_override() -> None:
    agent = _agent()
    agent._turn_timeout_overrides["call-3"] = 8.0
    await agent.end_session("call-3")
    assert "call-3" not in agent._turn_timeout_overrides
