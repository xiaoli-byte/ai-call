"""帧级语音检测器（B-P2a Silero VAD provider）单元测试。

覆盖契约：
- WebRtcFrameDetector：与旧内联路径等价（异常按静音兜底）
- SileroFrameDetector：320 样本帧 → 512 样本窗的字节缓冲数学、阈值判定、
  运行中推理异常永久降级 webrtc、reset 清缓冲与模型状态
- make_frame_detector_factory：provider 解析、silero 不可用回退 webrtc、
  每次调用产出新实例（不跨通话复用）
- VoiceActivityDetector 注入 detector 后走 detector 判定，reset 级联
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock

import pytest

from voice_agent.vad import (
    SileroFrameDetector,
    VoiceActivityDetector,
    WebRtcFrameDetector,
    make_frame_detector_factory,
)

SAMPLE_RATE = 16000
FRAME_MS = 20
FRAME_BYTES = SAMPLE_RATE * 2 * FRAME_MS // 1000  # 640 = 320 样本
CHUNK_BYTES = 1024  # Silero 固定窗口 512 样本


def _frame(fill: int = 0) -> bytes:
    return bytes([fill]) * FRAME_BYTES


class _FakeModel:
    """可控概率的假模型：记录收到的窗口，按预设序列出概率。"""

    def __init__(self, probs: list[float]) -> None:
        self.probs = list(probs)
        self.chunks: list[bytes] = []
        self.reset_called = 0

    def __call__(self, chunk: bytes) -> float:
        self.chunks.append(chunk)
        return self.probs.pop(0) if self.probs else 0.0

    def reset(self) -> None:
        self.reset_called += 1


# ---------------------------------------------------------------------------
# WebRtcFrameDetector
# ---------------------------------------------------------------------------


def test_webrtc_detector_delegates_and_swallows_errors() -> None:
    det = WebRtcFrameDetector(aggressiveness=0, sample_rate=SAMPLE_RATE)
    det._vad = MagicMock()
    det._vad.is_speech.return_value = True
    assert det.is_speech(_frame()) is True

    det._vad.is_speech.side_effect = RuntimeError("boom")
    assert det.is_speech(_frame()) is False  # 异常按静音兜底

    det.reset()  # 空实现，不抛即可


def test_webrtc_detector_validates_params() -> None:
    with pytest.raises(ValueError, match="aggressiveness"):
        WebRtcFrameDetector(aggressiveness=5)
    with pytest.raises(ValueError, match="sample_rate"):
        WebRtcFrameDetector(sample_rate=44100)


# ---------------------------------------------------------------------------
# SileroFrameDetector：缓冲数学与阈值
# ---------------------------------------------------------------------------


def test_silero_buffers_until_full_window() -> None:
    """首帧 640 字节 < 1024 不出概率（返回 False）；第二帧凑满一窗才推理。"""
    model = _FakeModel([0.9])
    det = SileroFrameDetector(threshold=0.5, model=model)

    assert det.is_speech(_frame(1)) is False  # 640 字节，未满窗
    assert model.chunks == []

    assert det.is_speech(_frame(2)) is True  # 1280 字节 → 消费一窗，prob=0.9
    assert len(model.chunks) == 1
    assert len(model.chunks[0]) == CHUNK_BYTES
    assert len(det._buf) == 1280 - CHUNK_BYTES  # 余 256 字节留在缓冲


def test_silero_threshold_boundary() -> None:
    """prob == threshold 判为语音（>=）；低于则静音，且沿用最近概率。"""
    model = _FakeModel([0.5, 0.3])
    det = SileroFrameDetector(threshold=0.5, model=model)

    det.is_speech(_frame())
    assert det.is_speech(_frame()) is True  # 第一窗 prob=0.5 >= 0.5

    # 后续帧：第三帧未满新窗 → 沿用 0.5；第四帧出第二窗 prob=0.3 → False
    assert det.is_speech(_frame()) is True
    assert det.is_speech(_frame()) is False


def test_silero_consumes_multiple_windows_per_call() -> None:
    """单次喂入超大帧凑出多窗时全部消费，取最末窗概率。"""
    model = _FakeModel([0.1, 0.9])
    det = SileroFrameDetector(threshold=0.5, model=model)

    assert det.is_speech(b"\x01" * (CHUNK_BYTES * 2)) is True  # 两窗，末窗 0.9
    assert len(model.chunks) == 2
    assert len(det._buf) == 0


# ---------------------------------------------------------------------------
# SileroFrameDetector：运行中降级与 reset
# ---------------------------------------------------------------------------


def test_silero_degrades_permanently_on_inference_error() -> None:
    """推理抛异常 → 当帧起永久走 webrtc 兜底，假模型不再被调用。"""

    class _BoomModel:
        def __call__(self, chunk: bytes) -> float:
            raise RuntimeError("onnx boom")

    det = SileroFrameDetector(threshold=0.5, aggressiveness=0, model=_BoomModel())
    fake_fallback_result = det.is_speech(_frame()) or det.is_speech(_frame())
    assert det._degraded is True
    assert isinstance(det._fallback, WebRtcFrameDetector)
    assert isinstance(fake_fallback_result, bool)  # 降级后仍能正常出布尔判定

    # 降级后 is_speech 全权委托 fallback（mock 验证）
    det._fallback = MagicMock()
    det._fallback.is_speech.return_value = True
    assert det.is_speech(_frame()) is True
    det._fallback.is_speech.assert_called_once()


def test_silero_reset_clears_buffer_and_model_state() -> None:
    model = _FakeModel([0.9])
    det = SileroFrameDetector(threshold=0.5, model=model)
    det.is_speech(_frame())
    det.is_speech(_frame())  # 出过概率、缓冲余 256 字节
    assert det._have_prob is True

    det.reset()
    assert len(det._buf) == 0
    assert det._have_prob is False
    assert model.reset_called == 1
    assert det.is_speech(_frame()) is False  # reset 后未满窗，不沿用旧概率


# ---------------------------------------------------------------------------
# make_frame_detector_factory
# ---------------------------------------------------------------------------


def test_factory_default_webrtc_returns_none() -> None:
    """webrtc / 空 / 未知值 → 工厂产出 None（VAD 走内建路径）。"""
    for provider in ("webrtc", None, "", "  WEBRTC  ", "unknown"):
        factory = make_frame_detector_factory(provider)
        assert factory() is None


def test_factory_silero_unavailable_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    """pysilero_vad import 失败 → 启动即回退 webrtc（工厂产出 None），不炸。"""
    monkeypatch.setitem(sys.modules, "pysilero_vad", None)  # import → ImportError
    factory = make_frame_detector_factory("silero")
    assert factory() is None


def test_factory_silero_produces_fresh_instances() -> None:
    """silero 可用时每次调用产出新 SileroFrameDetector（不跨通话复用）。"""
    pytest.importorskip("pysilero_vad")
    factory = make_frame_detector_factory("silero", silero_threshold=0.6)
    a, b = factory(), factory()
    assert isinstance(a, SileroFrameDetector)
    assert isinstance(b, SileroFrameDetector)
    assert a is not b
    assert a._threshold == 0.6


# ---------------------------------------------------------------------------
# VoiceActivityDetector 注入 detector
# ---------------------------------------------------------------------------


def test_vad_uses_injected_detector_and_cascades_reset() -> None:
    detector = MagicMock()
    detector.is_speech.return_value = True
    vad = VoiceActivityDetector(
        frame_ms=FRAME_MS,
        sample_rate=SAMPLE_RATE,
        speech_confirm_frames=3,
        silence_confirm_frames=5,
        min_speech_ms=0,
        detector=detector,
    )
    # 内建 _vad 不应被调用（判定全走注入 detector）
    vad._vad = MagicMock()

    for _ in range(3):
        state, _ = vad.feed(_frame())
    assert state == "speech_start"
    vad._vad.is_speech.assert_not_called()
    assert detector.is_speech.call_count == 3

    vad.reset()
    detector.reset.assert_called_once()


def test_vad_without_detector_keeps_legacy_path() -> None:
    """不注入 detector（默认）：仍走内建 webrtcvad，可被既有测试 monkeypatch。"""
    vad = VoiceActivityDetector(frame_ms=FRAME_MS, sample_rate=SAMPLE_RATE)
    vad._vad = MagicMock()
    vad._vad.is_speech.return_value = False
    state, frames = vad.feed(_frame())
    assert state == "silence"
    vad._vad.is_speech.assert_called_once()
