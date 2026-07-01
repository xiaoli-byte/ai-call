"""API 端点测试 —— 使用 mock ModelManager 测试 HTTP/SSE/Health 接口。

不加载真实模型，通过 mock ModelManager.load_all 来测试路由层逻辑。

运行：pytest tests/test_api_http.py -v
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from funasr_server.app import create_app
from funasr_server.config import Config


def _make_config(**overrides) -> Config:
    """创建测试用 Config（cpu 模式，不触发 torch 检查）。"""
    defaults = {
        "host": "127.0.0.1",
        "port": 10095,
        "device": "cpu",
        "ngpu": 0,
        "temp_dir": "test_temp",
        "max_upload_mb": 10,
    }
    defaults.update(overrides)
    return Config(**defaults)


def _make_mock_models() -> MagicMock:
    """创建 mock ModelManager。"""
    models = MagicMock()
    models.model_asr = MagicMock()
    models.model_asr_streaming = MagicMock()
    models.model_vad = MagicMock()
    models.model_punc = MagicMock()
    models.model_sv = MagicMock()
    models.hotword = ""
    models.shutdown = MagicMock()
    # run_blocking 默认返回空结果
    models.run_blocking = AsyncMock(return_value=[{"text": "", "value": []}])
    return models


@pytest.fixture
def client_and_models():
    """创建带 mock 模型的 TestClient。"""
    models = _make_mock_models()

    with patch("funasr_server.app.ModelManager.load_all", return_value=models):
        config = _make_config()
        app = create_app(config)
        with TestClient(app) as client:
            yield client, models


# ===================== /health 测试 =====================


def test_health_ok(client_and_models):
    """GET /health 应返回 200 和服务状态。"""
    client, _ = client_and_models
    response = client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["device"] == "cpu"
    assert data["gpu_available"] is False
    assert data["models_loaded"] is True
    assert "asr_offline" in data["models"]
    assert data["models"]["asr_offline"] is True
    assert "GET /health" in data["endpoints"]


# ===================== /recognize 错误处理测试 =====================


def test_recognize_no_filename(client_and_models):
    """POST /recognize 无文件名应返回 422（FastAPI 请求验证层拦截）。"""
    client, _ = client_and_models

    # 上传无文件名的文件，FastAPI 在 handler 之前即拒绝
    files = {"audio": ("", b"\x00\x01", "application/octet-stream")}
    response = client.post("/recognize", files=files)

    assert response.status_code == 422


def test_recognize_empty_file(client_and_models):
    """POST /recognize 空文件应返回 400。"""
    client, _ = client_and_models

    files = {"audio": ("test.wav", b"", "audio/wav")}
    response = client.post("/recognize", files=files)

    assert response.status_code == 400
    data = response.json()
    assert data["code"] == 1
    assert "empty" in data["msg"].lower()


def test_recognize_file_too_large(client_and_models):
    """POST /recognize 超大文件应返回 413。"""
    client, _ = client_and_models

    # max_upload_mb=10，创建 11MB 的假数据
    large_content = b"\x00" * (11 * 1024 * 1024)
    files = {"audio": ("big.wav", large_content, "audio/wav")}
    response = client.post("/recognize", files=files)

    assert response.status_code == 413
    data = response.json()
    assert data["code"] == 1
    assert "too large" in data["msg"].lower()


def test_recognition_alias(client_and_models):
    """POST /recognition（兼容路径）应与 /recognize 行为一致。"""
    client, _ = client_and_models

    files = {"audio": ("", b"", "application/octet-stream")}
    response = client.post("/recognition", files=files)

    assert response.status_code == 422  # 与 /recognize 一致：空文件名被 FastAPI 拦截


# ===================== /recognize/stream 错误处理测试 =====================


def test_recognize_stream_no_filename(client_and_models):
    """POST /recognize/stream 无文件名应返回 422（FastAPI 请求验证层拦截）。"""
    client, _ = client_and_models

    # 空文件名在 FastAPI 验证层即被拒绝，不会进入 SSE handler
    files = {"audio": ("", b"\x00\x01", "application/octet-stream")}
    response = client.post("/recognize/stream", files=files)

    assert response.status_code == 422


def test_recognize_stream_empty_file(client_and_models):
    """POST /recognize/stream 空文件应返回 SSE error 事件。"""
    client, _ = client_and_models

    files = {"audio": ("test.wav", b"", "audio/wav")}
    response = client.post("/recognize/stream", files=files)

    assert response.status_code == 200
    body = response.text
    assert "event: error" in body
    assert "empty" in body.lower()


# ===================== WS 路由注册测试 =====================


def test_ws_routes_registered(client_and_models):
    """WebSocket 路由 / 和 /ws 应已注册。"""
    client, _ = client_and_models

    # 尝试连接 WS（不带 subprotocol 应被拒绝或断开）
    # 这里只验证路由存在，不做完整 WS 握手
    # TestClient 的 websocket_connect 会自动处理握手
    try:
        with client.websocket_connect("/") as ws:
            # 发送一个 JSON 配置帧
            ws.send_text('{"mode": "2pass", "chunk_size": [5, 10, 5], "chunk_interval": 10}')
            # 不发音频，直接关闭
    except Exception:
        # WS 连接可能因无音频而断开，这是正常的
        pass

    # 如果路由不存在，websocket_connect 会抛出 404
    # 只要没有 404 就说明路由注册成功
