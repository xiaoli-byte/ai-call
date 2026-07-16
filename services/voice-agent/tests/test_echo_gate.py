"""Deterministic tests for the reference-aware residual echo gate."""

from __future__ import annotations

import numpy as np
import pytest
from scipy.signal import chirp, lfilter

from voice_agent.audio import float_to_pcm16
from voice_agent.echo_gate import ReferenceEchoGate


SAMPLE_RATE = 16000


def _reference_signal(seconds: float = 2.0) -> np.ndarray:
    samples = int(SAMPLE_RATE * seconds)
    t = np.arange(samples, dtype=np.float64) / SAMPLE_RATE
    # Speech-like, non-periodic content gives correlation a unique time anchor.
    signal = 0.20 * chirp(t, f0=160, f1=3200, t1=t[-1], method="quadratic")
    signal += 0.055 * np.sin(2 * np.pi * 227 * t)
    envelope = 0.65 + 0.35 * np.sin(2 * np.pi * 2.7 * t) ** 2
    return np.asarray(signal * envelope, dtype=np.float32)


def _new_gate(**kwargs) -> ReferenceEchoGate:
    return ReferenceEchoGate(
        sample_rate=SAMPLE_RATE,
        reference_window_ms=3000,
        analysis_window_ms=200,
        min_analysis_ms=180,
        **kwargs,
    )


def test_scaled_delayed_reference_is_confident_echo() -> None:
    reference = _reference_signal()
    gate = _new_gate()
    gate.add_reference(float_to_pcm16(reference))

    # The search must recover an arbitrary playback/capture offset and volume.
    microphone = reference[13200:16400] * 0.37
    analysis = gate.analyze(float_to_pcm16(microphone))

    assert analysis.classification == "echo"
    assert analysis.correlation > 0.99
    assert analysis.residual_ratio < 0.02
    assert analysis.echo_gain == pytest.approx(0.37, abs=0.01)


def test_mild_acoustic_path_and_noise_still_match_reference() -> None:
    reference = _reference_signal()
    gate = _new_gate()
    gate.add_reference(float_to_pcm16(reference))
    segment = reference[8000:11200]
    rng = np.random.default_rng(7)
    microphone = lfilter([0.32, 0.09, -0.025], [1.0], segment)
    microphone += rng.normal(0.0, 0.003, segment.size)

    analysis = gate.analyze(float_to_pcm16(microphone.astype(np.float32)))

    assert analysis.classification == "echo"
    assert analysis.correlation >= gate.echo_correlation_threshold
    assert analysis.residual_ratio <= gate.echo_max_residual_ratio


def test_echo_plus_independent_near_end_is_never_dropped() -> None:
    reference = _reference_signal()
    gate = _new_gate()
    gate.add_reference(float_to_pcm16(reference))
    segment = reference[10000:13200]
    t = np.arange(segment.size) / SAMPLE_RATE
    near_end = 0.15 * chirp(t, f0=510, f1=1850, t1=t[-1], method="linear")

    analysis = gate.analyze(
        float_to_pcm16(np.asarray(segment * 0.34 + near_end, dtype=np.float32))
    )

    assert analysis.classification in {"double_talk", "near_end", "unknown"}
    assert not analysis.is_confident_echo
    assert analysis.residual_ratio > gate.echo_max_residual_ratio


def test_quiet_near_end_at_minus_eight_db_is_fail_open() -> None:
    """Even a quiet caller under louder echo must not be erased by the gate."""
    reference = _reference_signal()
    gate = _new_gate()
    gate.add_reference(float_to_pcm16(reference))
    segment = reference[10000:13200] * 0.35
    t = np.arange(segment.size) / SAMPLE_RATE
    near_end = chirp(t, f0=510, f1=1850, t1=t[-1], method="linear")
    near_end *= np.sqrt(np.mean(segment * segment)) / np.sqrt(
        np.mean(near_end * near_end)
    )
    # 0.4 amplitude ratio is about -8 dB relative to the echo component.
    mixed = np.asarray(segment + near_end * 0.4, dtype=np.float32)

    analysis = gate.analyze(float_to_pcm16(mixed))

    assert analysis.classification != "echo"
    assert not analysis.is_confident_echo


def test_very_quiet_near_end_at_minus_twelve_db_is_fail_open() -> None:
    reference = _reference_signal()
    gate = _new_gate()
    gate.add_reference(float_to_pcm16(reference))
    segment = reference[10000:13200] * 0.35
    t = np.arange(segment.size) / SAMPLE_RATE
    near_end = chirp(t, f0=430, f1=1700, t1=t[-1], method="quadratic")
    near_end *= np.sqrt(np.mean(segment * segment)) / np.sqrt(
        np.mean(near_end * near_end)
    )
    mixed = np.asarray(segment + near_end * 0.25, dtype=np.float32)

    analysis = gate.analyze(float_to_pcm16(mixed))

    assert analysis.classification != "echo"


def test_independent_near_end_is_classified_fail_open() -> None:
    reference = _reference_signal()
    gate = _new_gate()
    gate.add_reference(float_to_pcm16(reference))
    t = np.arange(3200) / SAMPLE_RATE
    near_end = 0.16 * chirp(t, f0=420, f1=2300, t1=t[-1], method="logarithmic")

    analysis = gate.analyze(float_to_pcm16(near_end.astype(np.float32)))

    assert analysis.classification == "near_end"
    assert not analysis.is_confident_echo
    assert analysis.correlation < 0.35


def test_silence_and_short_blocks_cannot_make_destructive_decision() -> None:
    reference = _reference_signal()
    gate = _new_gate()
    gate.add_reference(float_to_pcm16(reference))

    silence = gate.analyze(b"\x00\x00" * 3200)
    short_echo = gate.analyze(float_to_pcm16(reference[:960] * 0.4))  # 60 ms

    assert silence.classification == "silence"
    assert short_echo.classification == "unknown"
    assert not short_echo.is_confident_echo


def test_noise_floor_tracks_background_but_rejects_loud_outlier() -> None:
    gate = _new_gate()
    rng = np.random.default_rng(11)
    low_noise = rng.normal(0.0, 0.004, SAMPLE_RATE // 5).astype(np.float32)

    for _ in range(30):
        gate.observe_background(float_to_pcm16(low_noise))
    learned = gate.noise_floor_rms

    loud = rng.normal(0.0, 0.20, SAMPLE_RATE // 5).astype(np.float32)
    gate.observe_background(float_to_pcm16(loud))

    assert 0.0025 < learned < 0.006
    assert gate.noise_floor_rms < learned * 1.15


def test_reference_ring_is_bounded_resamples_and_resets() -> None:
    gate = ReferenceEchoGate(
        sample_rate=SAMPLE_RATE,
        reference_window_ms=1000,
        analysis_window_ms=200,
    )
    source_8k = _reference_signal(3.0)[::2]
    gate.add_reference(float_to_pcm16(source_8k), sample_rate=8000)

    assert gate.reference_samples == SAMPLE_RATE

    gate.add_reference(b"\x01")  # malformed trailing byte is ignored
    assert gate.reference_samples == SAMPLE_RATE
    gate.reset_reference()
    assert gate.reference_samples == 0
