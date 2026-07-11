"""POST /embed 端点测试 —— embed_model=mock，不加载真实模型。

与 test_api_http.py 不同：这里不把 ModelManager 整体 mock 成 MagicMock，
而是让 ModelManager.load_all 直接返回一个真实 ModelManager 实例（跳过 5 个
AutoModel 的重加载），这样 /embed 的懒加载 + mock 伪向量逻辑走的是真代码路径。

运行：pytest tests/test_api_embed.py -v
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from funasr_server.app import create_app
from funasr_server.config import Config
from funasr_server.models import ModelManager


def _make_config(**overrides) -> Config:
    """创建测试用 Config（cpu 模式 + embed_model=mock，避免真实模型下载）。"""
    defaults = {
        "host": "127.0.0.1",
        "port": 10095,
        "device": "cpu",
        "ngpu": 0,
        "temp_dir": "test_temp",
        "embed_model": "mock",
    }
    defaults.update(overrides)
    return Config(**defaults)


@pytest.fixture
def client():
    """真实 ModelManager 实例（跳过 load_all 里对 5 个 AutoModel 的加载）。"""
    config = _make_config()
    with patch.object(ModelManager, "load_all", side_effect=lambda cfg: ModelManager(cfg)):
        app = create_app(config)
        with TestClient(app) as c:
            yield c


# ===================== 正常批量 + mock 向量确定性 =====================


def test_embed_batch_returns_normalized_deterministic_vectors(client):
    """批量请求应返回等长、L2 归一化、按文本确定性的向量。"""
    response = client.post("/embed", json={"texts": ["同意", "拒绝", "同意"]})

    assert response.status_code == 200
    data = response.json()
    assert len(data["embeddings"]) == 3
    assert data["dim"] > 0
    assert data["model"] == "mock"

    # 相同文本 → 相同向量（确定性，供缓存/单测断言用）
    assert data["embeddings"][0] == data["embeddings"][2]
    # 不同文本 → 不同向量
    assert data["embeddings"][0] != data["embeddings"][1]

    # L2 归一化：模长 ≈ 1
    for vec in data["embeddings"]:
        norm = sum(v * v for v in vec) ** 0.5
        assert abs(norm - 1.0) < 1e-6


# ===================== 空数组 =====================


def test_embed_empty_texts_returns_empty_list(client):
    """空数组应直接返回空 embeddings，不触发模型加载。"""
    response = client.post("/embed", json={"texts": []})

    assert response.status_code == 200
    data = response.json()
    assert data["embeddings"] == []
    assert data["dim"] == 0


# ===================== 超限 400 =====================


def test_embed_batch_too_large_returns_400(client):
    """单批超过 64 条应返回 400，不触发推理。"""
    response = client.post("/embed", json={"texts": ["x"] * 65})

    assert response.status_code == 400
    data = response.json()
    assert data["code"] == 1
    assert "64" in data["msg"]


def test_embed_batch_at_limit_ok(client):
    """单批恰好 64 条应正常处理（边界值）。"""
    response = client.post("/embed", json={"texts": ["x"] * 64})

    assert response.status_code == 200
    assert len(response.json()["embeddings"]) == 64


# ===================== health 的 embed 字段 =====================


def test_health_embed_field_false_before_first_request(client):
    """未收到过 /embed 请求时，health.models.embed 应为 False，不影响整体 status=ok。"""
    response = client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["models"]["embed"] is False


def test_health_embed_field_true_after_lazy_load(client):
    """首次 /embed 请求触发懒加载后，health.models.embed 应变为 True。"""
    client.post("/embed", json={"texts": ["hi"]})

    response = client.get("/health")
    assert response.json()["models"]["embed"] is True


# ===================== 加载失败缓存 + 快速 503 =====================


def test_embed_load_failure_returns_503_and_caches_error():
    """模型加载失败时应返回 503，且第二次请求不应再次触发加载（缓存错误快速失败）。

    直接 patch ModelManager._load_embed_model_sync 模拟加载失败，不依赖真实
    modelscope.pipelines 是否可导入（该子模块的重依赖如 datasets 未必装在 CI 里）。
    """
    config = _make_config(embed_model="iic/does-not-exist")
    load_calls: list[int] = []

    def fake_load_failure(self: ModelManager) -> None:
        load_calls.append(1)
        self.embed_load_error = "模拟加载失败：boom"

    with patch.object(ModelManager, "load_all", side_effect=lambda cfg: ModelManager(cfg)):
        app = create_app(config)
        with TestClient(app) as c:
            with patch.object(ModelManager, "_load_embed_model_sync", fake_load_failure):
                response1 = c.post("/embed", json={"texts": ["hi"]})
                assert response1.status_code == 503
                assert response1.json()["code"] == -1

                # 第二次请求：embed_load_error 已缓存，不应再次调用加载函数
                response2 = c.post("/embed", json={"texts": ["hi"]})
                assert response2.status_code == 503

    assert len(load_calls) == 1
