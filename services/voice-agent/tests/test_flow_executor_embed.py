"""FlowExecutor embedding 意图相似度层的单元测试。

注入 fake provider（返回手工构造的归一化向量），验证 spec 第 3 节 6 个用例：
命中、margin 不足、threshold 不足、provider 异常 fail-open、off/空例句跳过、例句缓存。

约束：不依赖 mock provider 的语义质量，向量全部手工构造；阈值用默认
（THRESHOLD=0.72 / MARGIN=0.05），故 autouse fixture 清掉 INTENT_EMBED_* 环境与例句缓存，
保证与全局 CI 环境隔离、用例间互不串味。
"""

from __future__ import annotations

import math
from typing import Any, Optional

import pytest

from voice_agent import intent_embed
from voice_agent.flow_executor import FlowExecutor
from voice_agent.flow_types import (
    DecisionMode,
    DecisionNodeData,
    FlowNode,
    NodeType,
    TaskFlow,
)


@pytest.fixture(autouse=True)
def _isolate_embed_env(monkeypatch):
    """每个用例前清空 embedding 相关环境变量与模块级例句缓存。"""
    for name in (
        "INTENT_EMBED_PROVIDER",
        "INTENT_EMBED_URL",
        "INTENT_EMBED_THRESHOLD",
        "INTENT_EMBED_MARGIN",
        "INTENT_EMBED_TIMEOUT_MS",
    ):
        monkeypatch.delenv(name, raising=False)
    intent_embed._EXAMPLE_CACHE.clear()
    yield
    intent_embed._EXAMPLE_CACHE.clear()


def _norm(vec: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in vec))
    return [x / n for x in vec] if n else vec


class FakeEmbedProvider:
    """按精确文本返回预置向量的 fake provider，并记录每次 embed 的入参。"""

    def __init__(self, vectors: dict[str, list[float]]) -> None:
        self.vectors = {k: _norm(v) for k, v in vectors.items()}
        self.calls: list[list[str]] = []

    async def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        return [self.vectors[t] for t in texts]

    def embedded_count(self, text: str) -> int:
        return sum(batch.count(text) for batch in self.calls)


class RaisingEmbedProvider:
    async def embed(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError("embed 服务不可用")


class RecordingCallbacks:
    """_exec_decision 只触及 generate_llm_text，最小实现并计数 LLM 调用。"""

    def __init__(self, llm_reply: str = "") -> None:
        self.llm_reply = llm_reply
        self.llm_calls = 0

    async def generate_llm_text(
        self, call_id: str, messages: list, options: Optional[dict] = None
    ) -> str:
        self.llm_calls += 1
        return self.llm_reply


def _decision_node(
    intents: list[str], intent_examples: dict[str, list[str]]
) -> FlowNode:
    return FlowNode(
        id="dec",
        type=NodeType.DECISION,
        position={"x": 0, "y": 0},
        data=DecisionNodeData(
            mode=DecisionMode.INTENT,
            intents=list(intents),
            intent_examples=dict(intent_examples),
        ),
    )


def _flow_with(node: FlowNode) -> TaskFlow:
    # 单节点、无出边：embed 未命中时 has_fallback=False，会落到 _classify_intent_llm。
    return TaskFlow(id="f", name="f", nodes=[node], edges=[])


_INTENTS = ["同意", "拒绝"]
_EXAMPLES = {"同意": ["我愿意"], "拒绝": ["我不要"]}
_USER = "拿到了"  # 不含任一意图关键字 → keyword 必然未命中，进入 embed 层


# --- 1. 命中：分数满足阈值 → 返回意图，不落 LLM ---
async def test_embed_hit_returns_intent_without_llm():
    provider = FakeEmbedProvider(
        {
            _USER: [1.0, 0.0],
            "我愿意": [1.0, 0.0],  # cos(user)=1.0 → top
            "我不要": [0.0, 1.0],  # cos(user)=0.0 → second
        }
    )
    cb = RecordingCallbacks(llm_reply="不该被调用")
    ex = FlowExecutor(_flow_with(_decision_node(_INTENTS, _EXAMPLES)), cb, embed_provider=provider)
    result = await ex._exec_decision("c1", _decision_node(_INTENTS, _EXAMPLES), _USER)
    assert result == "同意"
    assert cb.llm_calls == 0


# --- 2. margin 不足：两意图都很接近 → 落 LLM ---
async def test_embed_margin_insufficient_falls_to_llm():
    provider = FakeEmbedProvider(
        {
            _USER: [1.0, 0.0],
            "我愿意": [1.0, 0.0],      # cos=1.0
            "我不要": [0.98, 0.199],   # cos≈0.98 → margin≈0.02 < 0.05
        }
    )
    cb = RecordingCallbacks(llm_reply="同意")
    ex = FlowExecutor(_flow_with(_decision_node(_INTENTS, _EXAMPLES)), cb, embed_provider=provider)
    await ex._exec_decision("c1", _decision_node(_INTENTS, _EXAMPLES), _USER)
    assert cb.llm_calls == 1


# --- 3. threshold 不足：top 相似度太低 → 落 LLM ---
async def test_embed_below_threshold_falls_to_llm():
    provider = FakeEmbedProvider(
        {
            _USER: [1.0, 0.0],
            "我愿意": [0.5, 0.866],   # cos=0.5 < 0.72 → top 不足
            "我不要": [0.1, 0.995],   # cos=0.1
        }
    )
    cb = RecordingCallbacks(llm_reply="同意")
    ex = FlowExecutor(_flow_with(_decision_node(_INTENTS, _EXAMPLES)), cb, embed_provider=provider)
    await ex._exec_decision("c1", _decision_node(_INTENTS, _EXAMPLES), _USER)
    assert cb.llm_calls == 1


# --- 4. provider 抛异常 → fail-open 落 LLM，通话不断 ---
async def test_embed_provider_exception_fails_open():
    cb = RecordingCallbacks(llm_reply="同意")
    ex = FlowExecutor(
        _flow_with(_decision_node(_INTENTS, _EXAMPLES)), cb, embed_provider=RaisingEmbedProvider()
    )
    # 不应抛异常
    await ex._exec_decision("c1", _decision_node(_INTENTS, _EXAMPLES), _USER)
    assert cb.llm_calls == 1


# --- 5. provider=off 或例句为空 → 完全跳过 embed，行为同现状 ---
async def test_embed_skipped_when_off_or_no_examples():
    # 5a: 不传 provider + 环境 off（fixture 已清）→ self._embed=None → 跳过
    cb_off = RecordingCallbacks(llm_reply="同意")
    ex_off = FlowExecutor(_flow_with(_decision_node(_INTENTS, _EXAMPLES)), cb_off)
    assert ex_off._embed is None
    await ex_off._exec_decision("c1", _decision_node(_INTENTS, _EXAMPLES), _USER)
    assert cb_off.llm_calls == 1

    # 5b: 有 provider 但节点无例句 → 跳过（provider 不被调用）
    provider = FakeEmbedProvider({_USER: [1.0, 0.0]})
    cb_empty = RecordingCallbacks(llm_reply="同意")
    ex_empty = FlowExecutor(
        _flow_with(_decision_node(_INTENTS, {})), cb_empty, embed_provider=provider
    )
    await ex_empty._exec_decision("c1", _decision_node(_INTENTS, {}), _USER)
    assert cb_empty.llm_calls == 1
    assert provider.calls == []  # 无例句直接短路，从未调 embed


# --- 6. 例句缓存：同一例句集第二次调用不再 embed 例句 ---
async def test_embed_example_cache_avoids_reembedding():
    provider = FakeEmbedProvider(
        {
            _USER: [1.0, 0.0],
            "我愿意": [1.0, 0.0],
            "我不要": [0.0, 1.0],
        }
    )
    cb = RecordingCallbacks()
    node = _decision_node(_INTENTS, _EXAMPLES)
    ex = FlowExecutor(_flow_with(node), cb, embed_provider=provider)

    await ex._exec_decision("c1", node, _USER)  # 首次：例句 cache miss，各 embed 一次
    await ex._exec_decision("c2", node, _USER)  # 二次：例句 cache hit，不再 embed

    # 用户话术每次都要 embed（各占一次），例句总计只 embed 过一次。
    assert provider.embedded_count("我愿意") == 1
    assert provider.embedded_count("我不要") == 1
    assert provider.embedded_count(_USER) == 2
