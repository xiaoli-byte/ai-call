"""LLM 工厂函数测试 — create_llm() 环境变量解析与降级策略。"""

from __future__ import annotations

import pytest

from voice_agent.llm import LangChainLLMAdapter, MockLLM, create_llm


def _clear_llm_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """清除所有 LLM 相关环境变量。"""
    for key in [
        "LLM_PROVIDER",
        "LLM_DEEPSEEK_API_KEY",
        "LLM_DEEPSEEK_MODEL",
        "LLM_DEEPSEEK_BASE_URL",
        "LLM_QWEN_API_KEY",
        "LLM_QWEN_MODEL",
        "LLM_QWEN_BASE_URL",
        "LLM_API_KEY",
        "LLM_BASE_URL",
        "LLM_MODEL",
        "DEEPSEEK_API_KEY",
    ]:
        monkeypatch.delenv(key, raising=False)


# langchain 为可选依赖：未装时跳过需要它的测试
requires_langchain = pytest.mark.skipif(
    LangChainLLMAdapter is None,
    reason="langchain_openai not installed",
)


# ===================== mock / 降级测试（不需要 langchain）=====================


def test_provider_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM_PROVIDER=mock → MockLLM。"""
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    llm = create_llm()
    assert isinstance(llm, MockLLM)
    assert llm.name == "mock"


def test_provider_default_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    """未设置 LLM_PROVIDER → 默认 mock。"""
    _clear_llm_env(monkeypatch)
    llm = create_llm()
    assert isinstance(llm, MockLLM)


def test_provider_unknown_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """未知 LLM_PROVIDER → 降级 MockLLM。"""
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "unknown_provider")
    llm = create_llm()
    assert isinstance(llm, MockLLM)


def test_provider_deepseek_without_key_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """LLM_PROVIDER=deepseek + 无 key → 降级 MockLLM。"""
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    llm = create_llm()
    assert isinstance(llm, MockLLM)


def test_provider_qwen_without_key_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """LLM_PROVIDER=qwen + 无 key → 降级 MockLLM。"""
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "qwen")
    llm = create_llm()
    assert isinstance(llm, MockLLM)


def test_provider_legacy_without_key_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """LLM_PROVIDER=legacy + 无 key → 降级 MockLLM。"""
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "legacy")
    llm = create_llm()
    assert isinstance(llm, MockLLM)


# ===================== legacy 测试（不需要 langchain）=====================


def test_provider_legacy_with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM_PROVIDER=legacy + 有 key → OpenAICompatibleLLM。"""
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "legacy")
    monkeypatch.setenv("LLM_API_KEY", "sk-test")
    llm = create_llm()
    assert llm.name == "openai"


# ===================== deepseek / qwen 测试（需要 langchain）=====================


@requires_langchain
def test_provider_deepseek_with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM_PROVIDER=deepseek + 有 key → LangChainLLMAdapter。"""
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("LLM_DEEPSEEK_API_KEY", "sk-test")
    llm = create_llm()
    assert llm.name == "langchain:deepseek-chat"


@requires_langchain
def test_provider_deepseek_fallback_to_llm_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """LLM_DEEPSEEK_API_KEY 未设但 LLM_API_KEY 有值 → 应使用它。"""
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("LLM_API_KEY", "sk-fallback")
    llm = create_llm()
    assert llm.name == "langchain:deepseek-chat"


@requires_langchain
def test_provider_qwen_with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM_PROVIDER=qwen + 有 key → LangChainLLMAdapter with qwen-plus。"""
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "qwen")
    monkeypatch.setenv("LLM_QWEN_API_KEY", "sk-test")
    llm = create_llm()
    assert llm.name == "langchain:qwen-plus"


@requires_langchain
def test_provider_deepseek_custom_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM_DEEPSEEK_MODEL 自定义应反映在 name 中。"""
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("LLM_DEEPSEEK_API_KEY", "sk-test")
    monkeypatch.setenv("LLM_DEEPSEEK_MODEL", "deepseek-reasoner")
    llm = create_llm()
    assert llm.name == "langchain:deepseek-reasoner"
