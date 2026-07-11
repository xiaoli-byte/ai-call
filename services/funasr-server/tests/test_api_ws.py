"""WS 2pass 流水线测试 —— 覆盖 vad_enabled 开关对服务端 VAD 推理的影响。

使用 mock ModelManager（不加载真实模型）+ 真实 FastAPI TestClient WebSocket 连接，
驱动 funasr_server.api.ws.ws_handler 的真代码路径。验证：

- vad_enabled=True（默认）：现有行为不变，服务端仍会调用 _async_vad 做端点检测。
- vad_enabled=False：ws_handler 完全跳过 _async_vad 调用（不产生服务端 VAD 推理），
  上游 {is_speaking:false} 信号仍能驱动 finalize_offline 的既有 fallback
  （frames_asr 为空时退回 frames 全部音频）产出 final。

运行：pytest tests/test_api_ws.py -v
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import funasr_server.api.ws as ws_module
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
    }
    defaults.update(overrides)
    return Config(**defaults)


def _make_mock_models(vad_loaded: bool) -> MagicMock:
    """创建 mock ModelManager，run_blocking 按被调用的 fn 分派不同返回值。

    - _sv_and_match_sync（同步声纹匹配辅助函数）需要返回 (spk_name, score) 二元组，
      不能走 ASR/VAD 通用的 [{"text": ..., "value": [...]}] 结构。
    - model_vad 是否存在与真实 models.py 的 vad_enabled 加载逻辑保持一致：
      关闭时不加载，模拟为 None。
    """
    models = MagicMock()
    models.model_asr = MagicMock()
    models.model_asr_streaming = MagicMock()
    models.model_vad = MagicMock() if vad_loaded else None
    models.model_punc = MagicMock()
    models.model_sv = MagicMock()
    models.hotword = ""
    models.shutdown = MagicMock()

    async def _run_blocking(fn, *args, sem=None, **kwargs):
        if getattr(fn, "__name__", "") == "_sv_and_match_sync":
            return "unknown", 0.0
        # VAD / ASR(online/offline) / Punc 通用返回结构，text/value 均为空
        return [{"text": "", "value": []}]

    models.run_blocking = AsyncMock(side_effect=_run_blocking)
    return models


def _send_utterance_and_get_final(client: TestClient) -> dict:
    """建立 WS 连接，发送配置帧 + 若干 PCM 帧 + is_speaking:false，返回收到的 final JSON。"""
    cfg = {
        "mode": "2pass",
        "chunk_size": [5, 10, 5],
        "chunk_interval": 10,
        "wav_name": "test",
        "is_speaking": True,
    }
    with client.websocket_connect("/") as ws:
        ws.send_text(json.dumps(cfg))
        # 16kHz mono PCM16 静音帧，mock 模型不解析音频内容，仅关心字节是否非空
        pcm_chunk = b"\x00\x00" * 1600
        for _ in range(3):
            ws.send_bytes(pcm_chunk)
        ws.send_text(json.dumps({"is_speaking": False}))

        message = ws.receive_text()
        return json.loads(message)


@pytest.fixture
def vad_on_client():
    models = _make_mock_models(vad_loaded=True)
    with patch("funasr_server.app.ModelManager.load_all", return_value=models):
        config = _make_config(vad_enabled=True)
        app = create_app(config)
        with TestClient(app) as client:
            yield client


@pytest.fixture
def vad_off_client():
    models = _make_mock_models(vad_loaded=False)
    with patch("funasr_server.app.ModelManager.load_all", return_value=models):
        config = _make_config(vad_enabled=False)
        app = create_app(config)
        with TestClient(app) as client:
            yield client


def test_vad_enabled_default_calls_server_vad(vad_on_client):
    """vad_enabled=True（默认）：现有行为不变，_async_vad 仍被调用。"""
    with patch.object(
        ws_module, "_async_vad", AsyncMock(return_value=(-1, -1))
    ) as mock_vad:
        result = _send_utterance_and_get_final(vad_on_client)

    assert mock_vad.await_count > 0, "vad_enabled=True 时应调用服务端 VAD 推理"
    assert result["mode"] == "2pass-offline"
    assert result["is_final"] is True


def test_vad_disabled_skips_server_vad_and_still_finalizes(vad_off_client):
    """vad_enabled=False：跳过服务端 VAD 推理，仍能通过 fallback 产出 final。"""
    with patch.object(
        ws_module, "_async_vad", AsyncMock(return_value=(-1, -1))
    ) as mock_vad:
        result = _send_utterance_and_get_final(vad_off_client)

    assert mock_vad.await_count == 0, "vad_enabled=False 时不应调用服务端 VAD 推理"
    assert result["mode"] == "2pass-offline"
    assert result["is_final"] is True
