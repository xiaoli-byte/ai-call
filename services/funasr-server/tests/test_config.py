"""Config 模块单元测试 —— 测试环境变量解析、CLI 参数覆盖、GPU 自动降级。

运行：pytest tests/test_config.py -v
"""

from __future__ import annotations

import sys
from unittest.mock import patch, MagicMock

import pytest

from funasr_server.config import Config, _env, _env_int, _env_bool


# ===================== 默认值测试 =====================


def test_config_defaults():
    """Config 默认值应符合预期。"""
    cfg = Config()
    assert cfg.host == "0.0.0.0"
    assert cfg.port == 10095
    assert cfg.device == "cuda"  # 默认 GPU
    assert cfg.ngpu == 1
    assert cfg.asr_model.startswith("iic/")
    assert cfg.vad_model.startswith("iic/")
    assert cfg.concurrent_vad == 4
    assert cfg.concurrent_asr_offline == 2
    assert cfg.max_upload_mb == 100
    assert cfg.save_offline_segments is False
    assert cfg.vad_enabled is True  # 默认开启，保持现状零行为变化


# ===================== 环境变量测试 =====================


def test_config_from_env(monkeypatch):
    """Config.from_env 应正确读取 FUNASR_SERVER_ 前缀的环境变量。"""
    monkeypatch.setenv("FUNASR_SERVER_HOST", "127.0.0.1")
    monkeypatch.setenv("FUNASR_SERVER_PORT", "8080")
    monkeypatch.setenv("FUNASR_SERVER_DEVICE", "cpu")
    monkeypatch.setenv("FUNASR_SERVER_NGPU", "0")
    monkeypatch.setenv("FUNASR_SERVER_MAX_UPLOAD_MB", "50")
    monkeypatch.setenv("FUNASR_SERVER_SAVE_OFFLINE_SEGMENTS", "true")

    cfg = Config.from_env()

    assert cfg.host == "127.0.0.1"
    assert cfg.port == 8080
    assert cfg.device == "cpu"
    assert cfg.ngpu == 0
    assert cfg.max_upload_mb == 50
    assert cfg.save_offline_segments is True


def test_config_from_env_vad_enabled_false(monkeypatch):
    """FUNASR_SERVER_VAD_ENABLED=false 应关闭服务端 VAD。"""
    monkeypatch.setenv("FUNASR_SERVER_VAD_ENABLED", "false")
    cfg = Config.from_env()
    assert cfg.vad_enabled is False


def test_config_from_env_vad_enabled_default_true(monkeypatch):
    """未设置 FUNASR_SERVER_VAD_ENABLED 时默认开启。"""
    cfg = Config.from_env()
    assert cfg.vad_enabled is True


def test_config_from_env_bad_int(monkeypatch):
    """非法整数环境变量应回退到默认值并记 WARN。"""
    monkeypatch.setenv("FUNASR_SERVER_PORT", "not-a-number")
    cfg = Config.from_env()
    assert cfg.port == 10095  # 默认值


def test_config_from_env_bad_bool(monkeypatch):
    """非法布尔环境变量应回退到 False。"""
    monkeypatch.setenv("FUNASR_SERVER_SAVE_OFFLINE_SEGMENTS", "maybe")
    cfg = Config.from_env()
    assert cfg.save_offline_segments is False


def test_env_helpers(monkeypatch):
    """_env / _env_int / _env_bool 辅助函数。"""
    monkeypatch.setenv("FUNASR_SERVER_TEST_STR", "hello")
    monkeypatch.setenv("FUNASR_SERVER_TEST_INT", "42")
    monkeypatch.setenv("FUNASR_SERVER_TEST_BOOL", "yes")

    assert _env("TEST_STR", "default") == "hello"
    assert _env("MISSING", "fallback") == "fallback"
    assert _env_int("TEST_INT", 0) == 42
    assert _env_int("MISSING", 99) == 99
    assert _env_bool("TEST_BOOL", False) is True


# ===================== CLI 参数测试 =====================


def test_config_from_args_override_env(monkeypatch):
    """CLI 参数应覆盖环境变量。"""
    monkeypatch.setenv("FUNASR_SERVER_PORT", "9000")
    monkeypatch.setenv("FUNASR_SERVER_DEVICE", "cpu")

    cfg = Config.from_args(["--port", "10095", "--device", "cuda"])

    assert cfg.port == 10095  # CLI 覆盖 env
    assert cfg.device == "cuda"  # CLI 覆盖 env


def test_config_from_args_partial_override(monkeypatch):
    """只传部分 CLI 参数时，其余项应从 env / 默认值填充。"""
    monkeypatch.setenv("FUNASR_SERVER_HOST", "0.0.0.0")
    cfg = Config.from_args(["--port", "3000"])
    assert cfg.port == 3000
    assert cfg.host == "0.0.0.0"  # 来自 env


def test_config_from_args_no_vad_enabled_overrides_env(monkeypatch):
    """--no-vad_enabled 应覆盖 env（BooleanOptionalAction 支持显式关闭）。"""
    monkeypatch.setenv("FUNASR_SERVER_VAD_ENABLED", "true")
    cfg = Config.from_args(["--no-vad_enabled"])
    assert cfg.vad_enabled is False


def test_config_from_args_vad_enabled_unset_falls_back_to_env(monkeypatch):
    """未传 --vad_enabled / --no-vad_enabled 时应沿用 env 值。"""
    monkeypatch.setenv("FUNASR_SERVER_VAD_ENABLED", "false")
    cfg = Config.from_args([])
    assert cfg.vad_enabled is False


# ===================== GPU 降级测试 =====================


def test_resolve_device_gpu_available(monkeypatch):
    """有 GPU 时应保持 cuda。"""
    mock_torch = MagicMock()
    mock_torch.cuda.is_available.return_value = True
    mock_torch.cuda.device_count.return_value = 2
    monkeypatch.setitem(sys.modules, "torch", mock_torch)

    cfg = Config(device="cuda", ngpu=1)
    cfg.resolve_device()

    assert cfg.device == "cuda"
    assert cfg.ngpu == 1
    assert cfg.gpu_available is True
    assert cfg.gpu_count == 2


def test_resolve_device_gpu_fallback(monkeypatch):
    """device=cuda 但无 GPU 时应降级到 cpu。"""
    mock_torch = MagicMock()
    mock_torch.cuda.is_available.return_value = False
    mock_torch.cuda.device_count.return_value = 0
    monkeypatch.setitem(sys.modules, "torch", mock_torch)

    cfg = Config(device="cuda", ngpu=1)
    cfg.resolve_device()

    assert cfg.device == "cpu"  # 降级
    assert cfg.ngpu == 0  # 降级
    assert cfg.gpu_available is False
    assert cfg.gpu_count == 0


def test_resolve_device_cpu_explicit(monkeypatch):
    """device=cpu 时应保持 cpu，ngpu=0。"""
    mock_torch = MagicMock()
    mock_torch.cuda.is_available.return_value = True  # 有 GPU 但显式选 cpu
    mock_torch.cuda.device_count.return_value = 1
    monkeypatch.setitem(sys.modules, "torch", mock_torch)

    cfg = Config(device="cpu", ngpu=1)
    cfg.resolve_device()

    assert cfg.device == "cpu"
    assert cfg.ngpu == 0  # cpu 模式下 ngpu=0


def test_resolve_device_torch_not_installed(monkeypatch):
    """torch 未安装时应降级到 cpu。"""
    # 模拟 torch 不可导入
    monkeypatch.setitem(sys.modules, "torch", None)

    cfg = Config(device="cuda", ngpu=1)
    cfg.resolve_device()

    assert cfg.device == "cpu"
    assert cfg.ngpu == 0
    assert cfg.gpu_available is False


# ===================== from_env + resolve_device 集成 =====================


def test_from_env_with_gpu_fallback(monkeypatch):
    """from_env 应自动调用 resolve_device。"""
    mock_torch = MagicMock()
    mock_torch.cuda.is_available.return_value = False
    mock_torch.cuda.device_count.return_value = 0
    monkeypatch.setitem(sys.modules, "torch", mock_torch)

    monkeypatch.setenv("FUNASR_SERVER_DEVICE", "cuda")
    monkeypatch.setenv("FUNASR_SERVER_NGPU", "1")

    cfg = Config.from_env()

    # 应自动降级
    assert cfg.device == "cpu"
    assert cfg.ngpu == 0
    assert cfg.gpu_available is False
