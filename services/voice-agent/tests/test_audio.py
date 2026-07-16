from __future__ import annotations

import numpy as np

from voice_agent.audio import float_to_pcm16


def test_float_to_pcm16_saturates_both_endpoints_without_wraparound() -> None:
    pcm = float_to_pcm16(np.asarray([-2.0, -1.0, 0.0, 1.0, 2.0], dtype=np.float32))
    values = np.frombuffer(pcm, dtype="<i2").tolist()

    assert values == [-32768, -32768, 0, 32767, 32767]
