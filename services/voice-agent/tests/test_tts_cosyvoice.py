"""CosyVoiceTTS（阿里云百炼 DashScope 云端）非连网单测。

只覆盖构造 / name / 发音人选择等纯逻辑，不触发合成、不连网、不 import dashscope。
真机流式合成的验证见离线脚本，不进 CI。
"""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest

from voice_agent.tts import CosyVoiceTTS
from voice_agent.types import TTSChunk


def test_default_construction_no_network() -> None:
    """构造函数不连网、不需要凭证即可实例化。"""
    tts = CosyVoiceTTS()
    assert tts.name == "cosyvoice"
    assert tts._model == "cosyvoice-v2"
    assert tts._default_speaker == "longxiaochun_v2"
    # 云端 CosyVoice v2 固定输出 24kHz，重采样到 16kHz
    assert tts._source_sr == 24000
    assert tts._target_sr == 16000
    assert tts._synthesis_task is None
    assert tts._synth is None


def test_custom_construction_params() -> None:
    tts = CosyVoiceTTS(
        model="cosyvoice-v2-custom",
        default_speaker="longcheng_v2",
        source_sample_rate=24000,
        target_sample_rate=8000,
        timeout=60.0,
        api_key="sk-explicit",
    )
    assert tts._model == "cosyvoice-v2-custom"
    assert tts._default_speaker == "longcheng_v2"
    assert tts._target_sr == 8000
    assert tts._timeout == 60.0
    assert tts._api_key == "sk-explicit"


def test_resolve_voice_prefers_speaker() -> None:
    """显式 speaker（如复刻音色）优先于默认预设音色。"""
    tts = CosyVoiceTTS(default_speaker="longxiaochun_v2")
    assert tts._resolve_voice("cosyvoice-v2-cvtest-abc") == "cosyvoice-v2-cvtest-abc"


def test_resolve_voice_falls_back_to_default() -> None:
    """speaker 为 None 或空串时回落默认音色。"""
    tts = CosyVoiceTTS(default_speaker="longxiaochun_v2")
    assert tts._resolve_voice(None) == "longxiaochun_v2"
    assert tts._resolve_voice("") == "longxiaochun_v2"


def test_api_key_defaults_to_none_without_env() -> None:
    """缺省 api_key 时构造期不读环境（延迟到合成路径解析），保持 None。"""
    tts = CosyVoiceTTS()
    assert tts._api_key is None


async def test_synthesize_raises_when_closed() -> None:
    """关闭后再 synthesize 抛 RuntimeError。"""
    tts = CosyVoiceTTS()
    await tts.close()

    async def _noop(_chunk: object) -> None:  # pragma: no cover - 不应被调用
        pass

    with pytest.raises(RuntimeError):
        await tts.synthesize("你好", _noop)  # type: ignore[arg-type]


def test_enable_instruct_defaults_false() -> None:
    """默认不启用 instruct（cosyvoice-v2 不支持 instruction，带上会 428 无声）。"""
    assert CosyVoiceTTS()._enable_instruct is False
    assert CosyVoiceTTS(enable_instruct=True)._enable_instruct is True


class _FakeSynth:
    """伪 SpeechSynthesizer：记录构造 kwargs，streaming 时回吐一个音频块 + 完成。"""

    last_kwargs: dict[str, Any] = {}

    def __init__(self, **kwargs: Any) -> None:
        _FakeSynth.last_kwargs = kwargs
        self._cb = kwargs.get("callback")

    def streaming_call(self, text: str) -> None:
        if self._cb:
            self._cb.on_data(b"\x00\x01" * 120)

    def streaming_complete(self, complete_timeout_millis: int = 0) -> None:
        if self._cb:
            self._cb.on_complete()

    def streaming_cancel(self) -> None:  # pragma: no cover - 本用例不触发
        pass


def _install_fake_dashscope(monkeypatch: pytest.MonkeyPatch) -> None:
    """把伪 dashscope 注入 sys.modules，避免连网并捕获合成 kwargs。"""
    dashscope = types.ModuleType("dashscope")
    dashscope.api_key = None  # type: ignore[attr-defined]
    audio_mod = types.ModuleType("dashscope.audio")
    tts_v2 = types.ModuleType("dashscope.audio.tts_v2")

    class AudioFormat:
        PCM_24000HZ_MONO_16BIT = "pcm_24000"

    class ResultCallback:  # run_sync 里的 Callback 继承它
        pass

    tts_v2.AudioFormat = AudioFormat  # type: ignore[attr-defined]
    tts_v2.ResultCallback = ResultCallback  # type: ignore[attr-defined]
    tts_v2.SpeechSynthesizer = _FakeSynth  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "dashscope", dashscope)
    monkeypatch.setitem(sys.modules, "dashscope.audio", audio_mod)
    monkeypatch.setitem(sys.modules, "dashscope.audio.tts_v2", tts_v2)


async def _collect(tts: CosyVoiceTTS, instruct: str | None) -> None:
    async def on_chunk(_chunk: TTSChunk) -> None:
        return None

    await tts.synthesize("你好", on_chunk, speaker="cosyvoice-v2-x", instruct_text=instruct)


async def test_synthesize_drops_instruction_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """enable_instruct=False（默认）时不把 instruct_text 传给 SpeechSynthesizer。"""
    _install_fake_dashscope(monkeypatch)
    _FakeSynth.last_kwargs = {}
    await _collect(CosyVoiceTTS(api_key="k"), instruct="用热情亲切的语气")
    assert "instruction" not in _FakeSynth.last_kwargs
    assert _FakeSynth.last_kwargs.get("voice") == "cosyvoice-v2-x"


async def test_synthesize_passes_instruction_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """显式开启 enable_instruct 时才透传 instruction（供未来支持 instruct 的模型）。"""
    _install_fake_dashscope(monkeypatch)
    _FakeSynth.last_kwargs = {}
    await _collect(CosyVoiceTTS(api_key="k", enable_instruct=True), instruct="用热情亲切的语气")
    assert _FakeSynth.last_kwargs.get("instruction") == "用热情亲切的语气"
