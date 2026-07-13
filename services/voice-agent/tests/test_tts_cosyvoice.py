"""CosyVoiceTTS（阿里云百炼 DashScope 云端）非连网单测。

只覆盖构造 / name / 发音人选择等纯逻辑，不触发合成、不连网、不 import dashscope。
真机流式合成的验证见离线脚本，不进 CI。
"""

from __future__ import annotations

import pytest

from voice_agent.tts import CosyVoiceTTS


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
