"""音色人设注入 LLM system prompt 的测试。"""

from __future__ import annotations

import asyncio
from dataclasses import replace

import pytest

from voice_agent.scenarios import DEFAULT_VARIABLES, SCENARIO_CONFIGS
from voice_agent.types import Scenario
from voice_agent.voice_personas import (
    BUILTIN_VOICE_PERSONAS,
    build_voice_style_prompt,
    resolve_voice_persona,
)


def _scenario(**overrides):
    return replace(SCENARIO_CONFIGS[Scenario.ECOMMERCE], **overrides)


def test_resolve_voice_persona_prefers_explicit_config() -> None:
    scenario = _scenario(
        tts_config={"voice": "Cherry", "voicePersona": "定制人设：低沉磁性男声。"}
    )
    assert resolve_voice_persona(scenario) == "定制人设：低沉磁性男声。"


def test_resolve_voice_persona_falls_back_to_builtin_by_voice() -> None:
    scenario = _scenario(tts_config={"voice": "Serena"})
    assert resolve_voice_persona(scenario) == BUILTIN_VOICE_PERSONAS["Serena"]


def test_resolve_voice_persona_unknown_voice_returns_empty() -> None:
    scenario = _scenario(tts_config={"voice": "some-clone-voice-id"})
    assert resolve_voice_persona(scenario) == ""


def test_build_voice_style_prompt_combines_persona_identity_style() -> None:
    scenario = _scenario(
        tts_config={"voice": "Ethan"},
        agent_identity="保险专员",
        communication_style="亲切、口语化",
        communication_style_prompt="",
    )
    prompt = build_voice_style_prompt(scenario)
    assert "【语气与人设】" in prompt
    assert BUILTIN_VOICE_PERSONAS["Ethan"] in prompt
    assert "保险专员" in prompt
    assert "亲切、口语化" in prompt


def test_build_voice_style_prompt_empty_when_nothing_configured() -> None:
    scenario = _scenario(
        tts_config={},
        agent_identity="",
        communication_style="",
        communication_style_prompt="",
    )
    assert build_voice_style_prompt(scenario) == ""


class _StubTools:
    def get_tool_definitions(self, scenario):
        return []


@pytest.mark.asyncio
async def test_session_system_prompt_includes_voice_persona() -> None:
    """start_session 组装的 system 消息应包含音色人设，主循环与流程 AI 节点共用。"""
    from voice_agent.agent import VoiceAgent
    from voice_agent.callbacks import NoopCallbacks

    agent = VoiceAgent(
        llm=None,
        tts=None,
        tools=_StubTools(),
        rag=None,
        tasks=None,
        max_turns=1,
        turn_timeout_s=1,
    )
    scenario = _scenario(tts_config={"voice": "Chelsie"})
    call_id = "persona-call-1"

    session_task = asyncio.create_task(
        agent.start_session(
            call_id, scenario, dict(DEFAULT_VARIABLES), NoopCallbacks(), dry_run=True
        )
    )
    await asyncio.sleep(0.05)

    session = agent._sessions.get(call_id)
    assert session is not None
    system_msg = session.messages[0]
    assert system_msg.role == "system"
    assert BUILTIN_VOICE_PERSONAS["Chelsie"] in system_msg.content

    await agent.end_session(call_id)
    await asyncio.wait_for(session_task, timeout=5)
