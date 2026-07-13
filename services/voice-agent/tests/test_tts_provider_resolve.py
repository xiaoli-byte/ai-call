"""按场景 ttsConfig.provider 动态解析 TTS 实例的测试。"""

from __future__ import annotations

from dataclasses import replace

import pytest

from voice_agent.agent import VoiceAgent
from voice_agent.scenarios import SCENARIO_CONFIGS
from voice_agent.tts import CosyVoiceTTS, MockTTS
from voice_agent.tts_factory import create_tts
from voice_agent.types import Scenario


def _scenario(**tts_config):
    return replace(SCENARIO_CONFIGS[Scenario.ECOMMERCE], tts_config=tts_config)


def test_create_tts_explicit_provider_overrides_env(monkeypatch) -> None:
    monkeypatch.setenv("TTS_PROVIDER", "qwen")
    monkeypatch.setenv("COSYVOICE_BASE_URL", "http://localhost:50000")
    assert isinstance(create_tts("mock"), MockTTS)
    assert isinstance(create_tts("cosyvoice"), CosyVoiceTTS)


def test_resolve_tts_defaults_when_no_provider() -> None:
    default = MockTTS()
    agent = VoiceAgent(tts=default)
    assert agent._resolve_tts("c1", _scenario()) is default
    assert agent._resolve_tts("c1", None) is default


def test_resolve_tts_same_provider_reuses_default() -> None:
    default = MockTTS()
    agent = VoiceAgent(tts=default)
    assert agent._resolve_tts("c1", _scenario(provider="mock")) is default
    assert agent._tts_overrides == {}


def test_resolve_tts_qwen_name_alias_matches_default() -> None:
    class FakeQwen(MockTTS):
        @property
        def name(self) -> str:
            return "qwen-tts"

    default = FakeQwen()
    agent = VoiceAgent(tts=default)
    assert agent._resolve_tts("c1", _scenario(provider="qwen")) is default
    assert agent._tts_overrides == {}


def test_resolve_tts_creates_and_caches_override(monkeypatch) -> None:
    monkeypatch.setenv("COSYVOICE_BASE_URL", "http://localhost:50000")
    default = MockTTS()
    agent = VoiceAgent(tts=default)
    scenario = _scenario(provider="cosyvoice", voice="clone-voice-1")

    resolved = agent._resolve_tts("c1", scenario)
    assert isinstance(resolved, CosyVoiceTTS)
    # 二次解析命中缓存，返回同一实例
    assert agent._resolve_tts("c1", scenario) is resolved


def test_resolve_tts_missing_credentials_falls_back_to_default(monkeypatch) -> None:
    monkeypatch.delenv("COSYVOICE_BASE_URL", raising=False)
    default = MockTTS()
    agent = VoiceAgent(tts=default)

    resolved = agent._resolve_tts("c1", _scenario(provider="cosyvoice"))
    assert resolved is default
