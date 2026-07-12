"""意图 embedding 相似度层的 provider 抽象、环境配置与例句向量缓存。

级联位置：keyword（精确/最长优先）→ **embedding（例句相似度）** → LLM → fallback。

设计要点：
- 默认关闭（INTENT_EMBED_PROVIDER=off）：不配置时返回 None，运行时完全跳过本层，
  行为与现状逐行为等价，CI/mock 环境不需要任何模型。
- fail-open：本模块只负责取向量，任何异常上抛给调用方（flow_executor）统一 fail-open
  落到 LLM 层，绝不影响通话。
- 模型宿主可选本地 funasr-server（/embed）或阿里云百炼 DashScope 云端 embeddings 接口
  （方案 A：embedding 全云化）：voice-agent 不新增 torch 依赖，均仅通过 httpx 调用。
- 向量在服务端已 L2 归一化，客户端 cosine 相似度 == 点积，纯 Python 实现不依赖 numpy。
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
from collections import OrderedDict
from typing import Optional, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

# 环境变量默认值（与 spec 一致）。
_DEFAULT_URL = "http://localhost:10095/embed"
_DEFAULT_THRESHOLD = 0.72
_DEFAULT_MARGIN = 0.05
_DEFAULT_TIMEOUT_MS = 500
_VALID_PROVIDERS = {"off", "mock", "funasr", "dashscope"}

# 阿里云百炼 DashScope OpenAI 兼容 embeddings 接口默认值（方案 A：embedding 全云化）。
_DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_DASHSCOPE_MODEL = "text-embedding-v4"
_DEFAULT_DASHSCOPE_TIMEOUT_MS = 3000  # 云端接口延迟更高，默认比本地 funasr 放宽

# mock 伪向量维度（仅供无模型环境；语义质量无意义，只保证确定性）。
_MOCK_DIM = 32

# 例句向量缓存：键 = tuple(例句文本)，值 = list[向量]。
# 流程快照不可变 → 同一版本例句永不变，缓存天然安全。FIFO 上限 256。
_EXAMPLE_CACHE: "OrderedDict[tuple[str, ...], list[list[float]]]" = OrderedDict()
_EXAMPLE_CACHE_MAX = 256


@runtime_checkable
class IntentEmbedProvider(Protocol):
    """句向量 provider 协议：输入文本列表，返回等长的向量列表（已 L2 归一化）。"""

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


def _l2_normalize(vec: list[float]) -> list[float]:
    """L2 归一化，零向量原样返回（避免除零）。"""
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0.0:
        return vec
    return [v / norm for v in vec]


def _hash_vector(text: str, dim: int) -> list[float]:
    """由文本派生确定性伪向量：sha256 字节流映射到 [-1,1] 再 L2 归一化。"""
    raw = bytearray()
    counter = 0
    while len(raw) < dim:
        raw += hashlib.sha256(f"{counter}:{text}".encode("utf-8")).digest()
        counter += 1
    vals = [(raw[i] / 255.0) * 2.0 - 1.0 for i in range(dim)]
    return _l2_normalize(vals)


def cosine(a: list[float], b: list[float]) -> float:
    """归一化向量的余弦相似度 == 点积。维度不符视为数据错误，上抛给 fail-open。"""
    if len(a) != len(b):
        raise ValueError(f"向量维度不符: {len(a)} != {len(b)}")
    return sum(x * y for x, y in zip(a, b))


class MockEmbedProvider:
    """确定性伪向量 provider，仅供 CLI 开发与无模型环境；不保证语义质量。"""

    def __init__(self, dim: int = _MOCK_DIM) -> None:
        self._dim = dim

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [_hash_vector(t, self._dim) for t in texts]


class FunasrEmbedProvider:
    """通过 HTTP 调 funasr-server /embed 端点获取句向量。

    任何异常（超时、HTTP 非 2xx、响应维度不符）直接上抛，由调用方 fail-open。
    """

    def __init__(self, url: str, timeout_ms: int) -> None:
        self._url = url
        self._timeout_s = max(0.001, timeout_ms / 1000.0)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        import httpx  # 延迟导入：off/mock 场景不触发 httpx 加载

        async with httpx.AsyncClient(timeout=self._timeout_s) as client:
            resp = await client.post(self._url, json={"texts": list(texts)})
            resp.raise_for_status()
            data = resp.json()
        embeddings = data.get("embeddings")
        if not isinstance(embeddings, list) or len(embeddings) != len(texts):
            raise ValueError(
                f"/embed 响应条数不符: 期望 {len(texts)}，实得 {len(embeddings) if isinstance(embeddings, list) else type(embeddings).__name__}"
            )
        return embeddings


class DashScopeEmbedProvider:
    """通过阿里云百炼 DashScope OpenAI 兼容 embeddings 接口获取句向量（方案 A：embedding 全云化）。

    不依赖本地 funasr-server，直接调云端模型。与 FunasrEmbedProvider 保持同一失败契约：
    任何异常（超时、HTTP 非 2xx、响应条数不符）直接上抛，由调用方 fail-open。
    """

    def __init__(self, api_key: str, base_url: str, model: str, timeout_ms: int) -> None:
        if not api_key:
            raise ValueError("DASHSCOPE_API_KEY 未配置")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout_s = max(0.001, timeout_ms / 1000.0)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        import httpx  # 延迟导入：off/mock 场景不触发 httpx 加载

        async with httpx.AsyncClient(timeout=self._timeout_s) as client:
            resp = await client.post(
                f"{self._base_url}/embeddings",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={
                    "model": self._model,
                    "input": list(texts),
                    "encoding_format": "float",
                },
            )
            resp.raise_for_status()
            data = resp.json()
        items = data.get("data")
        if not isinstance(items, list) or len(items) != len(texts):
            raise ValueError(
                f"/embeddings 响应条数不符: 期望 {len(texts)}，实得 {len(items) if isinstance(items, list) else type(items).__name__}"
            )
        # OpenAI 兼容接口不保证返回顺序与输入一致，必须按 index 排序后再取向量。
        items = sorted(items, key=lambda item: item["index"])
        return [_l2_normalize(item["embedding"]) for item in items]


# --- 环境变量安全解析 ---


def _read_provider_name() -> str:
    raw = os.getenv("INTENT_EMBED_PROVIDER", "off").strip().lower()
    if raw not in _VALID_PROVIDERS:
        logger.warning("[Intent/Embed] 未知 INTENT_EMBED_PROVIDER=%r，按 off 处理", raw)
        return "off"
    return raw


def _read_float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("[Intent/Embed] %s=%r 非法（非浮点），用默认 %s", name, raw, default)
        return default


def _read_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("[Intent/Embed] %s=%r 非法（非整数），用默认 %s", name, raw, default)
        return default


def read_threshold() -> float:
    """命中阈值：top 相似度需 >= 此值。"""
    return _read_float_env("INTENT_EMBED_THRESHOLD", _DEFAULT_THRESHOLD)


def read_margin() -> float:
    """区分度：top 与 second 之差需 >= 此值，防止两意图接近时误判。"""
    return _read_float_env("INTENT_EMBED_MARGIN", _DEFAULT_MARGIN)


def create_embed_provider_from_env() -> Optional[IntentEmbedProvider]:
    """按环境变量创建 provider；off/坏值 → None（运行时跳过 embedding 层）。"""
    name = _read_provider_name()
    if name == "off":
        return None
    if name == "mock":
        return MockEmbedProvider()
    if name == "dashscope":
        api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
        base_url = (
            os.getenv("DASHSCOPE_COMPATIBLE_BASE_URL", "").strip() or _DEFAULT_DASHSCOPE_BASE_URL
        )
        model = os.getenv("INTENT_EMBED_MODEL", "").strip() or _DEFAULT_DASHSCOPE_MODEL
        timeout_ms = _read_int_env("INTENT_EMBED_TIMEOUT_MS", _DEFAULT_DASHSCOPE_TIMEOUT_MS)
        return DashScopeEmbedProvider(api_key, base_url, model, timeout_ms)
    url = os.getenv("INTENT_EMBED_URL", _DEFAULT_URL).strip() or _DEFAULT_URL
    timeout_ms = _read_int_env("INTENT_EMBED_TIMEOUT_MS", _DEFAULT_TIMEOUT_MS)
    return FunasrEmbedProvider(url, timeout_ms)


async def get_example_vectors(
    provider: IntentEmbedProvider, examples: list[str]
) -> list[list[float]]:
    """取一组例句的向量，带模块级 FIFO 缓存。

    键 = tuple(例句)。缓存命中直接返回，不重复调用 provider；未命中则 embed 后写缓存，
    超过上限按插入顺序淘汰最早条目（FIFO）。
    """
    key = tuple(examples)
    cached = _EXAMPLE_CACHE.get(key)
    if cached is not None:
        return cached
    vecs = await provider.embed(list(examples))
    _EXAMPLE_CACHE[key] = vecs
    while len(_EXAMPLE_CACHE) > _EXAMPLE_CACHE_MAX:
        _EXAMPLE_CACHE.popitem(last=False)  # FIFO：淘汰最早插入
    return vecs
