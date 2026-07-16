"""VoiceAgent integration tests for acoustic echo/double-talk gating."""

from __future__ import annotations

import numpy as np
import pytest
from scipy.signal import chirp

from voice_agent.agent import VoiceAgent
from voice_agent.audio import float_to_pcm16
from voice_agent.callbacks import NoopCallbacks
from voice_agent.types import TTSChunk


SAMPLE_RATE = 16000


def _reference_signal(seconds: float = 1.0) -> np.ndarray:
    samples = int(SAMPLE_RATE * seconds)
    t = np.arange(samples) / SAMPLE_RATE
    value = 0.19 * chirp(t, f0=180, f1=3000, t1=t[-1], method="quadratic")
    value += 0.05 * np.sin(2 * np.pi * 233 * t)
    return np.asarray(value, dtype=np.float32)


class _FakeSTT:
    def __init__(self) -> None:
        self.sent: list[bytes] = []

    async def send_audio(self, pcm: bytes) -> None:
        self.sent.append(pcm)

    async def end_speech(self) -> None:
        pass


class _FakeVAD:
    def __init__(self) -> None:
        self.state = "silence"
        self.feed_calls = 0
        self.reset_calls = 0

    def feed(self, frame: bytes):
        self.feed_calls += 1
        self.state = "speech"
        return "speech", [frame]

    def reset(self) -> None:
        self.reset_calls += 1
        self.state = "silence"


def _seed_agent(reference: np.ndarray) -> tuple[VoiceAgent, str, _FakeSTT, _FakeVAD]:
    agent = VoiceAgent(
        llm=None,
        tts=None,
        aec_reference_gate_enabled=True,
        aec_reference_window_ms=3000,
        aec_analysis_window_ms=200,
        aec_min_analysis_ms=180,
        asr_tts_gate_web_enabled=False,
    )
    call_id = "acoustic-web"
    stt = _FakeSTT()
    vad = _FakeVAD()
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True
    agent._stt_handles[call_id] = stt  # type: ignore[assignment]
    agent._vads[call_id] = vad  # type: ignore[assignment]
    generation = agent._begin_echo_reference(call_id)
    assert generation is not None
    agent._add_echo_reference(
        call_id, generation, float_to_pcm16(reference), SAMPLE_RATE
    )
    return agent, call_id, stt, vad


@pytest.mark.asyncio
async def test_confident_pure_echo_never_reaches_vad_or_stt() -> None:
    reference = _reference_signal()
    agent, call_id, stt, vad = _seed_agent(reference)
    echo = float_to_pcm16(reference[6400:9600] * 0.4)

    await agent.receive_audio(call_id, echo)

    assert vad.feed_calls == 0
    assert vad.reset_calls == 1
    assert stt.sent == []
    assert agent._echo_latest_analysis[call_id][1].classification == "echo"


@pytest.mark.asyncio
async def test_double_talk_is_forwarded_unchanged() -> None:
    reference = _reference_signal()
    agent, call_id, stt, vad = _seed_agent(reference)
    segment = reference[6400:9600]
    t = np.arange(segment.size) / SAMPLE_RATE
    caller = 0.16 * chirp(t, f0=550, f1=1900, t1=t[-1], method="linear")
    mixed = float_to_pcm16(np.asarray(segment * 0.35 + caller, dtype=np.float32))

    await agent.receive_audio(call_id, mixed)

    assert vad.feed_calls == 10
    assert b"".join(stt.sent) == mixed
    assert agent._echo_latest_analysis[call_id][1].classification != "echo"


@pytest.mark.asyncio
async def test_sixty_ms_chunks_are_held_until_safe_analysis_window() -> None:
    reference = _reference_signal()
    agent, call_id, stt, vad = _seed_agent(reference)
    first = float_to_pcm16(reference[6400:7360] * 0.42)
    second = float_to_pcm16(reference[7360:8320] * 0.42)
    third = float_to_pcm16(reference[8320:9280] * 0.42)

    await agent.receive_audio(call_id, first)
    assert vad.feed_calls == 0
    assert stt.sent == []

    await agent.receive_audio(call_id, second)
    assert vad.feed_calls == 0
    assert stt.sent == []

    await agent.receive_audio(call_id, third)
    assert vad.feed_calls == 0
    assert vad.reset_calls == 1
    assert stt.sent == []


@pytest.mark.asyncio
async def test_three_sixty_ms_double_talk_chunks_flush_complete_first_phoneme() -> None:
    reference = _reference_signal()
    agent, call_id, stt, vad = _seed_agent(reference)
    segment = reference[6400:9280]
    t = np.arange(segment.size) / SAMPLE_RATE
    caller = 0.16 * chirp(t, f0=530, f1=1750, t1=t[-1], method="linear")
    mixed = float_to_pcm16(np.asarray(segment * 0.33 + caller, dtype=np.float32))
    chunk_bytes = SAMPLE_RATE * 2 * 60 // 1000

    await agent.receive_audio(call_id, mixed[:chunk_bytes])
    assert stt.sent == []

    await agent.receive_audio(call_id, mixed[chunk_bytes : chunk_bytes * 2])
    assert stt.sent == []

    await agent.receive_audio(call_id, mixed[chunk_bytes * 2 :])

    assert vad.feed_calls == 9
    assert b"".join(stt.sent) == mixed


@pytest.mark.asyncio
async def test_interrupt_discards_held_echo_prefix_before_next_user_audio() -> None:
    reference = _reference_signal()
    agent, call_id, stt, vad = _seed_agent(reference)
    held_echo = float_to_pcm16(reference[6400:7360] * 0.4)
    await agent.receive_audio(call_id, held_echo)
    assert call_id in agent._echo_pending_audio

    agent._interrupt_speaking(call_id)
    assert call_id not in agent._echo_pending_audio

    t = np.arange(960) / SAMPLE_RATE
    caller = float_to_pcm16(
        np.asarray(0.16 * chirp(t, f0=520, f1=1700, t1=t[-1]), dtype=np.float32)
    )
    await agent.receive_audio(call_id, caller)

    assert b"".join(stt.sent) == caller
    assert held_echo not in b"".join(stt.sent)


@pytest.mark.asyncio
async def test_large_packet_only_drops_analyzed_echo_suffix() -> None:
    reference = _reference_signal()
    agent, call_id, stt, _vad = _seed_agent(reference)
    t = np.arange(3200) / SAMPLE_RATE
    caller_prefix = float_to_pcm16(
        np.asarray(0.16 * chirp(t, f0=470, f1=2200, t1=t[-1]), dtype=np.float32)
    )
    echo_suffix = float_to_pcm16(reference[6400:9600] * 0.4)

    await agent.receive_audio(call_id, caller_prefix + echo_suffix)

    assert b"".join(stt.sent) == caller_prefix


@pytest.mark.asyncio
async def test_reference_can_arrive_in_three_small_transport_chunks() -> None:
    reference = _reference_signal()
    agent = VoiceAgent(llm=None, tts=None, aec_reference_gate_enabled=True)
    call_id = "small-reference"
    stt = _FakeSTT()
    vad = _FakeVAD()
    agent._channels[call_id] = "web"
    agent._speaking[call_id] = True
    agent._stt_handles[call_id] = stt  # type: ignore[assignment]
    agent._vads[call_id] = vad  # type: ignore[assignment]
    generation = agent._begin_echo_reference(call_id)
    assert generation is not None

    for index in range(3):
        start = 6400 + index * 960
        reference_chunk = float_to_pcm16(reference[start : start + 960])
        agent._add_echo_reference(call_id, generation, reference_chunk)
        await agent.receive_audio(
            call_id,
            float_to_pcm16(reference[start : start + 960] * 0.4),
        )

    assert stt.sent == []
    assert vad.reset_calls == 1


@pytest.mark.asyncio
async def test_odd_pcm_byte_is_trimmed_and_fails_open() -> None:
    agent = VoiceAgent(llm=None, tts=None, aec_reference_gate_enabled=True)
    call_id = "odd-pcm"
    stt = _FakeSTT()
    vad = _FakeVAD()
    agent._channels[call_id] = "web"
    agent._stt_handles[call_id] = stt  # type: ignore[assignment]
    agent._vads[call_id] = vad  # type: ignore[assignment]

    await agent.receive_audio(call_id, b"\x01" * 641)

    assert b"".join(stt.sent) == b"\x01" * 640


@pytest.mark.asyncio
async def test_double_talk_hangover_prevents_mid_utterance_echo_cutoff() -> None:
    reference = _reference_signal()
    agent, call_id, stt, vad = _seed_agent(reference)
    segment = reference[6400:9600]
    t = np.arange(segment.size) / SAMPLE_RATE
    caller = 0.17 * chirp(t, f0=480, f1=2100, t1=t[-1], method="linear")
    mixed = float_to_pcm16(np.asarray(segment * 0.32 + caller, dtype=np.float32))

    await agent.receive_audio(call_id, mixed)
    first_sent = len(stt.sent)
    # Isolate the hangover from the separate VAD-state fail-open rule.
    vad.state = "silence"
    echo = float_to_pcm16(reference[8000:11200] * 0.38)
    await agent.receive_audio(call_id, echo)

    assert len(stt.sent) > first_sent
    assert vad.reset_calls == 0


@pytest.mark.asyncio
async def test_transport_send_boundary_supplies_reference_and_end_cleans_state() -> None:
    reference_pcm = float_to_pcm16(_reference_signal(0.2))

    class _TTS:
        async def synthesize(self, text, on_chunk, speaker=None, instruct_text=None):
            await on_chunk(TTSChunk(audio=reference_pcm, sample_rate=16000, is_final=False))
            await on_chunk(TTSChunk(audio=b"", sample_rate=16000, is_final=True))

        def interrupt(self) -> None:
            pass

        async def close(self) -> None:
            pass

        @property
        def name(self) -> str:
            return "transport-test"

    class _Callbacks(NoopCallbacks):
        def __init__(self) -> None:
            self.observer = None

        def set_far_end_observer(self, observer) -> None:
            self.observer = observer

        def clear_far_end_observer(self, observer) -> None:
            if self.observer is observer:
                self.observer = None

        async def on_audio_output(self, audio: bytes) -> None:
            # Model WebSocketCallbacks._paced_send's exact send-boundary tap.
            assert self.observer is not None
            self.observer(audio)

    agent = VoiceAgent(llm=None, tts=_TTS(), aec_reference_gate_enabled=True)
    call_id = "transport-reference"
    callbacks = _Callbacks()
    agent._channels[call_id] = "web"
    agent._callbacks[call_id] = callbacks

    await agent._speak(call_id, "测试")

    assert callbacks.observer is None
    assert agent._echo_gates[call_id].reference_samples == len(reference_pcm) // 2
    assert call_id in agent._echo_reference_until

    await agent.end_session(call_id)
    assert call_id not in agent._echo_gates
    assert call_id not in agent._echo_reference_generation
    assert call_id not in agent._echo_pending_audio
