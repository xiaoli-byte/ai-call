from __future__ import annotations

import base64
import json

import pytest

from voice_agent.server import VoiceAgentServer, WebSocketCallbacks


class FakeWebSocket:
    open = True

    def __init__(self) -> None:
        self.messages: list[bytes | str] = []

    async def send(self, message: bytes | str) -> None:
        self.messages.append(message)


class FakeTasks:
    async def append_transcript(self, *_args: object) -> None:
        return None

    async def transfer_to_human(self, *_args: object) -> None:
        return None


@pytest.mark.asyncio
async def test_audio_fork_receives_raw_pcm() -> None:
    ws = FakeWebSocket()
    callbacks = WebSocketCallbacks(ws, "call-1", FakeTasks())

    await callbacks.on_audio_output(b"\x01\x02")

    assert ws.messages == [b"\x01\x02"]


@pytest.mark.asyncio
async def test_audio_stream_receives_base64_json() -> None:
    ws = FakeWebSocket()
    callbacks = WebSocketCallbacks(
        ws,
        "call-1",
        FakeTasks(),
        audio_response_format="base64-json",
    )

    await callbacks.on_audio_output(b"\x01\x02")

    payload = json.loads(str(ws.messages[0]))
    assert payload["type"] == "streamAudio"
    assert payload["data"]["audioDataType"] == "raw"
    assert payload["data"]["sampleRate"] == 16000
    assert base64.b64decode(payload["data"]["audioData"]) == b"\x01\x02"


def test_rejects_unknown_audio_response_format() -> None:
    with pytest.raises(ValueError, match="Unsupported audio response format"):
        WebSocketCallbacks(
            FakeWebSocket(),
            "call-1",
            FakeTasks(),
            audio_response_format="mp3",
        )


@pytest.mark.asyncio
async def test_audio_stream_counts_and_forwards_pcm() -> None:
    class StreamingWebSocket:
        def __init__(self) -> None:
            metadata = base64.b64encode(
                json.dumps({"dialog_id": "call-1"}).encode()
            ).decode()
            self.messages = [f"base64:{metadata}", b"\x01\x02", b"\x03\x04"]

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self.messages:
                raise StopAsyncIteration
            return self.messages.pop(0)

    class FakeAgent:
        def __init__(self) -> None:
            self.audio: list[bytes] = []
            self.ended: list[str] = []

        async def receive_audio(self, _call_id: str, audio: bytes) -> None:
            self.audio.append(audio)

        async def end_session(self, call_id: str) -> None:
            self.ended.append(call_id)

    agent = FakeAgent()
    server = VoiceAgentServer.__new__(VoiceAgentServer)
    server._agent = agent

    async def fake_start(*_args: object) -> None:
        return None

    server._start_agent_session = fake_start
    await server._handle_audio_stream(StreamingWebSocket())

    assert agent.audio == [b"\x01\x02", b"\x03\x04"]
    assert agent.ended == ["call-1"]
