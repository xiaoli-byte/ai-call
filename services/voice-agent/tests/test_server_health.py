"""Voice Agent HTTP readiness on the shared WebSocket port."""

from __future__ import annotations

import json
from types import SimpleNamespace

import voice_agent.server as server_module
from voice_agent.server import VoiceAgentServer


class _TTS:
    def __init__(self, name: str) -> None:
        self.name = name


class _Agent:
    def __init__(self, tts_name: str) -> None:
        self._tts = _TTS(tts_name)


class _Tasks:
    pass


class _FakeEslClient:
    """轻量 ESL 客户端替身，仅暴露 is_open 供实时判定读取。"""

    def __init__(self, is_open: bool) -> None:
        self.is_open = is_open


def _server(tts_name: str = "qwen") -> VoiceAgentServer:
    return VoiceAgentServer(
        host="127.0.0.1",
        port=8090,
        path="/audio-stream",
        agent=_Agent(tts_name),  # type: ignore[arg-type]
        tasks=_Tasks(),  # type: ignore[arg-type]
    )


def test_live_is_healthy_even_before_esl_subscription(monkeypatch) -> None:
    # 已配置 ESL（真实部署形态），但尚未创建共享客户端 —— /health/live 不受影响，
    # /health/ready 反映“尚未连接”。
    monkeypatch.setenv("FREESWITCH_ESL_HOST", "127.0.0.1")
    monkeypatch.setattr(server_module, "_shared_esl_client", None)
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
    monkeypatch.setattr(server_module, "_shared_esl_client", _FakeEslClient(True))
    server = _server("qwen")

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
    monkeypatch.setattr(server_module, "_shared_esl_client", _FakeEslClient(True))
    server = _server("mock")

    response = server._check_path(
        None,
        SimpleNamespace(path="/health/ready"),
    )

    assert response is not None
    assert response.status_code == 503
    body = json.loads(response.body)
    assert body["ready"] is False
    assert body["tts_ready"] is False


def test_ready_becomes_unhealthy_after_esl_disconnect(monkeypatch) -> None:
    """启动成功后断线 → 503：实时读取 is_open，不依赖 start() 时写入的静态标志。"""
    fake_client = _FakeEslClient(True)
    monkeypatch.setattr(server_module, "_shared_esl_client", fake_client)
    server = _server("qwen")

    healthy = server._check_path(None, SimpleNamespace(path="/health/ready"))
    assert healthy is not None
    assert healthy.status_code == 200
    assert json.loads(healthy.body)["ready"] is True

    fake_client.is_open = False
    degraded = server._check_path(None, SimpleNamespace(path="/health/ready"))
    assert degraded is not None
    assert degraded.status_code == 503
    body = json.loads(degraded.body)
    assert body["ready"] is False
    assert body["esl_ready"] is False


def test_ready_recovers_after_reconnect(monkeypatch) -> None:
    """启动失败后重连成功 → 200：懒连接补上共享客户端后 ready 立即恢复。"""
    monkeypatch.setenv("FREESWITCH_ESL_HOST", "127.0.0.1")
    monkeypatch.setattr(server_module, "_shared_esl_client", None)
    server = _server("qwen")

    degraded = server._check_path(None, SimpleNamespace(path="/health/ready"))
    assert degraded is not None
    assert degraded.status_code == 503
    assert json.loads(degraded.body)["ready"] is False

    monkeypatch.setattr(server_module, "_shared_esl_client", _FakeEslClient(True))
    healthy = server._check_path(None, SimpleNamespace(path="/health/ready"))
    assert healthy is not None
    assert healthy.status_code == 200
    assert json.loads(healthy.body)["ready"] is True
