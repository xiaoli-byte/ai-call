"""DashScopeEmbedProvider（阿里云百炼云端 embedding，方案 A：embedding 全云化）单测。

均通过 monkeypatch 伪造 httpx.AsyncClient，不发真实网络请求。
"""

from __future__ import annotations

import math

import httpx
import pytest

from voice_agent.intent_embed import DashScopeEmbedProvider, create_embed_provider_from_env


def _vector_norm(vec: list[float]) -> float:
    return math.sqrt(sum(v * v for v in vec))


class _FakeResponse:
    def __init__(self, json_data: dict) -> None:
        self._json_data = json_data

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._json_data


def _make_fake_async_client(json_data: dict, captured: list[dict]):
    """构造一个假的 httpx.AsyncClient 类：不连网，记录请求，回放固定响应。"""

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self) -> "_FakeAsyncClient":
            return self

        async def __aexit__(self, *exc_info) -> bool:
            return False

        async def post(self, url, headers=None, json=None):
            captured.append({"url": url, "headers": headers, "json": json})
            return _FakeResponse(json_data)

    return _FakeAsyncClient


def _make_provider(timeout_ms: int = 1000) -> DashScopeEmbedProvider:
    return DashScopeEmbedProvider(
        api_key="test-key",
        base_url="https://dashscope.example.com/compatible-mode/v1",
        model="text-embedding-v4",
        timeout_ms=timeout_ms,
    )


async def test_embed_normalizes_and_reorders_by_index(monkeypatch: pytest.MonkeyPatch) -> None:
    # 故意乱序返回（index=1 排在前面），验证必须按 index 重排，不能假设顺序与输入一致。
    fake_json = {
        "data": [
            {"embedding": [3.0, 4.0], "index": 1},
            {"embedding": [1.0, 0.0], "index": 0},
        ]
    }
    captured: list[dict] = []
    monkeypatch.setattr(httpx, "AsyncClient", _make_fake_async_client(fake_json, captured))

    provider = _make_provider()
    vectors = await provider.embed(["你好", "再见"])

    assert len(vectors) == 2
    for vec in vectors:
        assert abs(_vector_norm(vec) - 1.0) < 1e-9
    # index=0 对应输入第一句“你好” -> 原始向量 [1.0, 0.0]，本身已是单位向量
    assert vectors[0] == pytest.approx([1.0, 0.0])
    # index=1 对应“再见” -> 原始向量 [3.0, 4.0] 归一化后为 [0.6, 0.8]
    assert vectors[1] == pytest.approx([0.6, 0.8])

    assert captured[0]["url"] == "https://dashscope.example.com/compatible-mode/v1/embeddings"
    assert captured[0]["headers"]["Authorization"] == "Bearer test-key"
    assert captured[0]["json"] == {
        "model": "text-embedding-v4",
        "input": ["你好", "再见"],
        "encoding_format": "float",
    }


async def test_embed_raises_on_count_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_json = {"data": [{"embedding": [1.0, 0.0], "index": 0}]}
    monkeypatch.setattr(httpx, "AsyncClient", _make_fake_async_client(fake_json, []))

    provider = _make_provider()

    with pytest.raises(ValueError):
        await provider.embed(["你好", "再见"])


async def test_embed_empty_texts_returns_empty_list_without_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[dict] = []
    monkeypatch.setattr(httpx, "AsyncClient", _make_fake_async_client({"data": []}, captured))

    provider = _make_provider()

    assert await provider.embed([]) == []
    assert captured == []  # 空输入不应发起 HTTP 请求


def test_missing_api_key_raises_on_construction() -> None:
    with pytest.raises(ValueError):
        DashScopeEmbedProvider(
            api_key="",
            base_url="https://dashscope.example.com/compatible-mode/v1",
            model="text-embedding-v4",
            timeout_ms=1000,
        )


def test_create_embed_provider_from_env_returns_dashscope_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INTENT_EMBED_PROVIDER", "dashscope")
    monkeypatch.setenv("DASHSCOPE_API_KEY", "env-key")
    monkeypatch.delenv("DASHSCOPE_COMPATIBLE_BASE_URL", raising=False)
    monkeypatch.delenv("INTENT_EMBED_MODEL", raising=False)
    monkeypatch.delenv("INTENT_EMBED_TIMEOUT_MS", raising=False)

    provider = create_embed_provider_from_env()

    assert isinstance(provider, DashScopeEmbedProvider)


def test_create_embed_provider_from_env_dashscope_missing_key_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INTENT_EMBED_PROVIDER", "dashscope")
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)

    with pytest.raises(ValueError):
        create_embed_provider_from_env()
