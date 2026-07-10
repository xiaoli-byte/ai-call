"""Voice Agent HTTP readiness on the shared WebSocket port."""

from __future__ import annotations

import json
from types import SimpleNamespace

from voice_agent.server import VoiceAgentServer


class _TTS:
    def __init__(self, name: str) -> None:
        self.name = name


class _Agent:
    def __init__(self, tts_name: str) -> None:
        self._tts = _TTS(tts_name)


class _Tasks:
    pass


def _server(tts_name: str = "qwen") -> VoiceAgentServer:
    return VoiceAgentServer(
        host="127.0.0.1",
        port=8090,
        path="/audio-stream",
        agent=_Agent(tts_name),  # type: ignore[arg-type]
        tasks=_Tasks(),  # type: ignore[arg-type]
    )


def test_live_is_healthy_even_before_esl_subscription() -> None:
    server = _server()
    response = server._check_path(
        None,
        SimpleNamespace(path="/health/live"),
    )

    assert response is not None
    assert response.status_code == 200
    body = json.loads(response.body)
    assert body["live"] is True
    assert body["ready"] is False


def test_ready_requires_esl_and_real_tts(monkeypatch) -> None:
    monkeypatch.setenv("OUTBOUND_REAL_CALL_MODE", "true")
    server = _server("qwen")
    server._esl_ready = True

    response = server._check_path(
        None,
        SimpleNamespace(path="/health/ready"),
    )

    assert response is not None
    assert response.status_code == 200
    body = json.loads(response.body)
    assert body["ready"] is True
    assert body["tts_ready"] is True


def test_ready_rejects_mock_tts_in_real_call_mode(monkeypatch) -> None:
    monkeypatch.setenv("OUTBOUND_REAL_CALL_MODE", "true")
    server = _server("mock")
    server._esl_ready = True

    response = server._check_path(
        None,
        SimpleNamespace(path="/health/ready"),
    )

    assert response is not None
    assert response.status_code == 503
    body = json.loads(response.body)
    assert body["ready"] is False
    assert body["tts_ready"] is False
