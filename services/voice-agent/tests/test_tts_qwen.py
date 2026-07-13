"""QwenTTS 按音色选模型的单测。

复刻音色（qwen-tts-vc- 前缀）必须用 vc-realtime 模型合成，否则服务端拒绝
（Invalid voice specified）导致通话无声；预设系统音色仍用默认 flash 模型。
QwenTTS 构造不连网（dashscope SDK 在 _run_synthesis 内延迟导入），可直接实例化。
"""
from __future__ import annotations

from voice_agent.tts_qwen import QwenTTS

CLONE_MODEL = "qwen3-tts-vc-realtime-2026-01-15"
DEFAULT_MODEL = "qwen3-tts-flash-realtime"
CLONE_VOICE = "qwen-tts-vc-vca1a36c58148c4f-voice-20260711054907655-2e49"


def _tts(clone_model=None):
    return QwenTTS(api_key="test-key", model=DEFAULT_MODEL, clone_model=clone_model)


def test_clone_voice_resolves_to_clone_model():
    tts = _tts(clone_model=CLONE_MODEL)
    assert tts._resolve_model(CLONE_VOICE) == CLONE_MODEL


def test_preset_voice_resolves_to_default_model():
    tts = _tts(clone_model=CLONE_MODEL)
    assert tts._resolve_model("Cherry") == DEFAULT_MODEL
    assert tts._resolve_model("Ethan") == DEFAULT_MODEL


def test_empty_voice_resolves_to_default_model():
    tts = _tts(clone_model=CLONE_MODEL)
    assert tts._resolve_model(None) == DEFAULT_MODEL
    assert tts._resolve_model("") == DEFAULT_MODEL


def test_without_clone_model_never_switches():
    """未配置 clone_model（缺省）时保持旧行为：所有音色都用默认模型。"""
    tts = _tts(clone_model=None)
    assert tts._resolve_model(CLONE_VOICE) == DEFAULT_MODEL
    assert tts._resolve_model("Cherry") == DEFAULT_MODEL
