"""Reference-aware residual echo and double-talk gate.

The browser remains responsible for the actual acoustic echo cancellation (AEC).
This module is a conservative server-side second line of defence: it compares a
microphone block with the PCM that was sent to the loudspeaker and only labels a
block as echo when a linear projection explains nearly all of its energy.

The gate deliberately does not subtract audio.  Anything that cannot be
confidently explained by the far-end reference (including double-talk) is passed
to VAD/ASR unchanged, so an imperfect echo model cannot erase caller speech.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Literal

import numpy as np
from scipy.signal import correlate

from . import audio


EchoClassification = Literal["silence", "echo", "double_talk", "near_end", "unknown"]


@dataclass(frozen=True, slots=True)
class EchoAnalysis:
    """Metrics for one microphone block.

    ``correlation`` is the best absolute normalized correlation against the
    retained far-end PCM. ``residual_ratio`` is the RMS left after fitting a
    scalar echo gain (0 means fully explained, 1 means unexplained).  The two
    metrics are intentionally exposed in logs so real-device thresholds can be
    calibrated without recording or retaining caller audio.
    """

    classification: EchoClassification
    input_rms: float
    noise_floor_rms: float
    snr_db: float
    correlation: float = 0.0
    residual_ratio: float = 1.0
    residual_rms: float = 0.0
    reference_rms: float = 0.0
    echo_gain: float = 0.0
    reference_offset_ms: float | None = None
    analyzed_ms: float = 0.0

    @property
    def is_confident_echo(self) -> bool:
        return self.classification == "echo"


class ReferenceEchoGate:
    """Bounded PCM reference buffer plus conservative echo classifier.

    A 16 kHz mono PCM block is searched within a bounded TTS reference using
    FFT cross-correlation.  Per-window mean and energy normalization make the
    score robust to DC offset and loudspeaker volume.  A best-fit scalar gain is
    then removed only for measurement; the original microphone PCM is never
    modified.
    """

    def __init__(
        self,
        *,
        sample_rate: int = 16000,
        reference_window_ms: int = 3000,
        analysis_window_ms: int = 200,
        min_analysis_ms: int = 180,
        echo_correlation_threshold: float = 0.98,
        echo_max_residual_ratio: float = 0.20,
        near_end_min_snr_db: float = 8.0,
        min_rms: float = 0.006,
        initial_noise_floor_rms: float = 0.0015,
    ) -> None:
        if sample_rate <= 0:
            raise ValueError("sample_rate must be positive")
        if reference_window_ms <= 0:
            raise ValueError("reference_window_ms must be positive")
        if analysis_window_ms <= 0:
            raise ValueError("analysis_window_ms must be positive")

        self.sample_rate = sample_rate
        self.reference_window_ms = reference_window_ms
        self.analysis_window_ms = analysis_window_ms
        self.echo_correlation_threshold = float(
            np.clip(echo_correlation_threshold, 0.0, 1.0)
        )
        self.echo_max_residual_ratio = max(0.0, echo_max_residual_ratio)
        self.near_end_min_snr_db = max(0.0, near_end_min_snr_db)
        self.min_rms = max(0.0, min_rms)

        self._max_reference_bytes = sample_rate * 2 * reference_window_ms // 1000
        self._analysis_samples = sample_rate * analysis_window_ms // 1000
        # Short voiced sounds can correlate highly merely because they share a
        # pitch. Require enough phonetic context before a destructive decision.
        min_analysis_ms = min(analysis_window_ms, max(40, min_analysis_ms))
        self._min_analysis_samples = max(1, sample_rate * min_analysis_ms // 1000)
        self._reference = bytearray()

        self._noise_floor_rms = max(1e-5, initial_noise_floor_rms)
        # 20 ms frame levels over roughly five seconds. A low percentile is
        # resilient to caller speech contaminating background observations.
        self._noise_levels: deque[float] = deque(maxlen=250)

    @property
    def reference_samples(self) -> int:
        return len(self._reference) // 2

    @property
    def noise_floor_rms(self) -> float:
        return self._noise_floor_rms

    def reset_reference(self) -> None:
        self._reference.clear()

    def add_reference(self, pcm: bytes, *, sample_rate: int | None = None) -> None:
        """Append loudspeaker PCM and retain only the configured rolling window."""
        if not pcm:
            return
        # Align before resampling because np.frombuffer rejects odd-sized PCM.
        pcm = pcm[: len(pcm) - len(pcm) % 2]
        if not pcm:
            return
        source_rate = sample_rate or self.sample_rate
        if source_rate != self.sample_rate:
            pcm = audio.resample(pcm, source_rate, self.sample_rate)
        # PCM16 samples are two bytes. Ignore a malformed trailing byte rather
        # than shifting every subsequent sample in the reference ring.
        pcm = pcm[: len(pcm) - len(pcm) % 2]
        if not pcm:
            return
        self._reference.extend(pcm)
        overflow = len(self._reference) - self._max_reference_bytes
        if overflow > 0:
            # Keep sample alignment even if a caller supplied an odd config.
            overflow += overflow % 2
            del self._reference[:overflow]

    def observe_background(self, pcm: bytes) -> float:
        """Update the dynamic noise floor from audio outside the TTS window.

        Upward adaptation is intentionally slow so a caller utterance cannot
        immediately become the new "silence" baseline. Downward adaptation is
        faster when the environment becomes quiet again.
        """
        samples = audio.pcm16_to_float(pcm)
        frame_samples = max(1, self.sample_rate * 20 // 1000)
        for start in range(0, samples.size - frame_samples + 1, frame_samples):
            frame = samples[start : start + frame_samples]
            centered = frame - float(np.mean(frame))
            rms = float(np.sqrt(np.mean(centered * centered)))
            self._noise_levels.append(rms)

        if not self._noise_levels:
            return self._noise_floor_rms

        observed = float(np.percentile(np.asarray(self._noise_levels), 20))
        observed = max(1e-5, observed)
        if observed < self._noise_floor_rms:
            self._noise_floor_rms += 0.20 * (observed - self._noise_floor_rms)
        else:
            # Limit upward learning to roughly 1 dB/s. A loud first utterance
            # therefore cannot become the new silence baseline during startup.
            duration_s = samples.size / self.sample_rate
            max_rise = 10.0 ** (max(0.0, duration_s) / 20.0)
            self._noise_floor_rms = min(
                observed, self._noise_floor_rms * max_rise
            )
        return self._noise_floor_rms

    def analyze(self, pcm: bytes) -> EchoAnalysis:
        """Classify one microphone PCM block without modifying it."""
        incoming = audio.pcm16_to_float(pcm)
        if incoming.size == 0:
            return self._base_analysis("silence", 0.0, 0.0)

        query_len = min(incoming.size, self._analysis_samples, self.reference_samples)
        if query_len <= 0:
            query_len = min(incoming.size, self._analysis_samples)
        query = incoming[-query_len:].astype(np.float64, copy=False)
        query -= float(np.mean(query))
        input_rms = float(np.sqrt(np.mean(query * query))) if query.size else 0.0
        snr_db = self._snr_db(input_rms)
        analyzed_ms = query.size * 1000.0 / self.sample_rate

        audible_rms = max(
            self.min_rms,
            self._noise_floor_rms * (10.0 ** (self.near_end_min_snr_db / 20.0)),
        )
        if input_rms < audible_rms:
            return self._base_analysis("silence", input_rms, snr_db, analyzed_ms)

        if query.size < self._min_analysis_samples:
            return self._base_analysis("unknown", input_rms, snr_db, analyzed_ms)

        reference = audio.pcm16_to_float(bytes(self._reference)).astype(
            np.float64, copy=False
        )
        if reference.size < query.size:
            return self._base_analysis("near_end", input_rms, snr_db, analyzed_ms)

        match = self._best_reference_match(reference, query)
        if match is None:
            return self._base_analysis("near_end", input_rms, snr_db, analyzed_ms)

        (
            correlation,
            residual_ratio,
            residual_rms,
            reference_rms,
            echo_gain,
            best_index,
        ) = match

        if (
            correlation >= self.echo_correlation_threshold
            and residual_ratio <= self.echo_max_residual_ratio
        ):
            classification: EchoClassification = "echo"
        else:
            residual_snr_db = self._snr_db(residual_rms)
            # Moderate reference evidence plus an audible unexplained residual
            # is the classic double-talk shape. It must pass to ASR unchanged.
            if correlation >= 0.35 and residual_snr_db >= self.near_end_min_snr_db:
                classification = "double_talk"
            elif correlation < 0.35:
                classification = "near_end"
            else:
                classification = "unknown"

        matched_end = best_index + query.size
        offset_ms = (reference.size - matched_end) * 1000.0 / self.sample_rate
        return EchoAnalysis(
            classification=classification,
            input_rms=input_rms,
            noise_floor_rms=self._noise_floor_rms,
            snr_db=snr_db,
            correlation=correlation,
            residual_ratio=residual_ratio,
            residual_rms=residual_rms,
            reference_rms=reference_rms,
            echo_gain=echo_gain,
            reference_offset_ms=offset_ms,
            analyzed_ms=analyzed_ms,
        )

    def _best_reference_match(
        self, reference: np.ndarray, query: np.ndarray
    ) -> tuple[float, float, float, float, float, int] | None:
        """Find the best mean-normalized reference window and its residual."""
        window = query.size
        query_energy = float(np.dot(query, query))
        if query_energy <= 1e-12:
            return None

        # query is zero-mean, therefore dot(reference, query) is already
        # invariant to each reference window's mean.
        dots = correlate(reference, query, mode="valid", method="fft")
        prefix = np.concatenate(([0.0], np.cumsum(reference)))
        prefix_sq = np.concatenate(([0.0], np.cumsum(reference * reference)))
        window_sum = prefix[window:] - prefix[:-window]
        window_sq_sum = prefix_sq[window:] - prefix_sq[:-window]
        reference_energy = window_sq_sum - (window_sum * window_sum) / window
        reference_energy = np.maximum(reference_energy, 0.0)

        denominator = np.sqrt(reference_energy * query_energy)
        valid = denominator > 1e-9
        if not np.any(valid):
            return None

        scores = np.zeros_like(dots, dtype=np.float64)
        scores[valid] = np.abs(dots[valid]) / denominator[valid]
        np.clip(scores, 0.0, 1.0, out=scores)
        best_index = int(np.argmax(scores))
        correlation = float(scores[best_index])

        segment = reference[best_index : best_index + window]
        centered_reference = segment - float(np.mean(segment))
        ref_energy = float(np.dot(centered_reference, centered_reference))
        if ref_energy <= 1e-12:
            return None
        gain = float(np.dot(centered_reference, query) / ref_energy)
        residual = query - gain * centered_reference
        residual_rms = float(np.sqrt(np.mean(residual * residual)))
        input_rms = float(np.sqrt(query_energy / window))
        residual_ratio = residual_rms / max(input_rms, 1e-9)
        reference_rms = float(np.sqrt(ref_energy / window))
        return (
            correlation,
            residual_ratio,
            residual_rms,
            reference_rms,
            gain,
            best_index,
        )

    def _snr_db(self, rms: float) -> float:
        return float(20.0 * np.log10(max(rms, 1e-9) / max(self._noise_floor_rms, 1e-9)))

    def _base_analysis(
        self,
        classification: EchoClassification,
        input_rms: float,
        snr_db: float,
        analyzed_ms: float = 0.0,
    ) -> EchoAnalysis:
        return EchoAnalysis(
            classification=classification,
            input_rms=input_rms,
            noise_floor_rms=self._noise_floor_rms,
            snr_db=snr_db,
            residual_rms=input_rms,
            analyzed_ms=analyzed_ms,
        )
