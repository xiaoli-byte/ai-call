"""ModelManager.load_all 测试 —— 覆盖 vad_enabled 对 VAD 模型加载的影响。

用一个假的 funasr 模块（stub AutoModel，不下载/加载真实权重）替换
sys.modules["funasr"]，让 load_all 走真代码路径但不产生真实开销。

运行：pytest tests/test_models.py -v
"""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest

from funasr_server.config import Config
from funasr_server.models import ModelManager


class _FakeAutoModel:
    """记录每次构造使用的 kwargs，便于断言哪些模型被创建（不做任何真实加载）。"""

    calls: list[dict[str, Any]] = []

    def __init__(self, **kwargs: Any) -> None:
        _FakeAutoModel.calls.append(kwargs)
        self.kwargs = kwargs

    def generate(self, **kwargs: Any) -> list[dict]:
        return [{"text": "", "value": []}]


@pytest.fixture
def fake_funasr(monkeypatch):
    """把 sys.modules["funasr"] 替换为只含 stub AutoModel 的假模块。"""
    _FakeAutoModel.calls = []
    fake_module = types.ModuleType("funasr")
    fake_module.AutoModel = _FakeAutoModel  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "funasr", fake_module)
    return _FakeAutoModel


def _make_config(**overrides) -> Config:
    defaults = {
        "device": "cpu",
        "ngpu": 0,
        "embed_model": "mock",
    }
    defaults.update(overrides)
    return Config(**defaults)


def test_load_all_loads_vad_by_default(fake_funasr):
    """vad_enabled=True（默认）：VAD 模型正常加载，行为与改动前一致。"""
    config = _make_config(vad_enabled=True)
    manager = ModelManager.load_all(config)

    assert manager.model_vad is not None
    vad_calls = [c for c in fake_funasr.calls if c.get("model") == config.vad_model]
    assert len(vad_calls) == 1

    # 其余模型不受影响
    assert manager.model_asr is not None
    assert manager.model_asr_streaming is not None
    assert manager.model_sv is not None


def test_load_all_skips_vad_when_disabled(fake_funasr):
    """vad_enabled=False：不构造 vad AutoModel（省显存），model_vad 保持 None。"""
    config = _make_config(vad_enabled=False)
    manager = ModelManager.load_all(config)

    assert manager.model_vad is None
    vad_calls = [c for c in fake_funasr.calls if c.get("model") == config.vad_model]
    assert len(vad_calls) == 0

    # 其余模型仍正常加载，不受 vad_enabled 影响
    assert manager.model_asr is not None
    assert manager.model_asr_streaming is not None
    assert manager.model_sv is not None
