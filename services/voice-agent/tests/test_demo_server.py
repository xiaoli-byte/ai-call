from __future__ import annotations

import json
from typing import Any

import pytest

from voice_agent import demo_server
from voice_agent.demo_server import DemoServer


class FakeWebSocket:
    open = True

    def __init__(self, messages: list[bytes | str]) -> None:
        self.messages = list(messages)
        self.sent: list[bytes | str] = []

    def __aiter__(self):
        return self

    async def __anext__(self) -> bytes | str:
        if not self.messages:
            raise StopAsyncIteration
        return self.messages.pop(0)

    async def send(self, message: bytes | str) -> None:
        self.sent.append(message)


class FakeSTT:
    instances: list["FakeSTT"] = []

    def __init__(self, *_args: Any, **_kwargs: Any) -> None:
        self.sent_audio: list[bytes] = []
        self.end_speech_calls = 0
        self.closed = False
        FakeSTT.instances.append(self)

    async def connect(self) -> None:
        return None

    async def send_audio(self, pcm: bytes) -> None:
        self.sent_audio.append(pcm)

    async def end_speech(self) -> None:
        self.end_speech_calls += 1

    async def close(self) -> None:
        self.closed = True


class FakeVAD:
    frame_bytes = 640

    def feed(self, frame: bytes) -> tuple[str, list[bytes]]:
        assert len(frame) == self.frame_bytes
        return "speech", [frame]


def make_server() -> DemoServer:
    return DemoServer(
        funasr_ws_url="ws://funasr.test",
        funasr_mode="2pass",
        funasr_hotwords="",
        vad_aggressiveness=3,
        vad_frame_ms=20,
        vad_pre_buffer_ms=300,
        vad_silence_confirm_frames=10,
        vad_speech_confirm_frames=3,
        tts=None,
    )


@pytest.fixture(autouse=True)
def fake_asr_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSTT.instances.clear()
    monkeypatch.setattr(demo_server, "FunASRClient", FakeSTT)
    monkeypatch.setattr(demo_server, "VoiceActivityDetector", lambda **_kwargs: FakeVAD())


@pytest.mark.asyncio
async def test_asr_stream_buffers_small_binary_chunks_before_vad() -> None:
    ws = FakeWebSocket(
        [
            json.dumps({"mode": "2pass"}),
            *[b"\x01" * 86 for _ in range(8)],
        ]
    )

    await make_server().handle_asr(ws)

    stt = FakeSTT.instances[0]
    assert [len(frame) for frame in stt.sent_audio] == [640]
    assert stt.closed is True


@pytest.mark.asyncio
async def test_asr_stream_manual_end_speech_clears_pending_pcm() -> None:
    ws = FakeWebSocket(
        [
            json.dumps({"mode": "2pass"}),
            b"\x01" * 86,
            json.dumps({"is_speaking": False}),
            b"\x02" * 554,
        ]
    )

    await make_server().handle_asr(ws)

    stt = FakeSTT.instances[0]
    assert stt.sent_audio == []
    assert stt.end_speech_calls == 1
