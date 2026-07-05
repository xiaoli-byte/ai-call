from __future__ import annotations

import json
from typing import Any

import pytest

from voice_agent import stt
from voice_agent.stt import FunASRClient


class FakeFunASRWebSocket:
    def __init__(self) -> None:
        self.sent: list[str | bytes] = []
        self.closed = False

    async def send(self, message: str | bytes) -> None:
        self.sent.append(message)

    async def close(self) -> None:
        self.closed = True

    def __aiter__(self):
        return self

    async def __anext__(self) -> str:
        raise StopAsyncIteration


@pytest.mark.asyncio
async def test_send_audio_reopens_speech_after_end(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ws = FakeFunASRWebSocket()

    async def fake_connect(*_args: Any, **_kwargs: Any) -> FakeFunASRWebSocket:
        return ws

    monkeypatch.setattr(stt.websockets, "connect", fake_connect)

    client = FunASRClient("ws://funasr.test", "call-1")
    await client.connect()
    await client.end_speech()
    await client.end_speech()
    await client.send_audio(b"\x01\x02")
    await client.close()

    initial_config = json.loads(str(ws.sent[0]))
    first_end = json.loads(str(ws.sent[1]))
    reopened = json.loads(str(ws.sent[2]))

    assert initial_config["is_speaking"] is True
    assert first_end == {"is_speaking": False}
    assert reopened == {"is_speaking": True}
    assert ws.sent[3] == b"\x01\x02"
    assert len(ws.sent) == 4
