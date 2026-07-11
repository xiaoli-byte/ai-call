"""配置数据类 —— 从环境变量/argparse 读取所有参数，含 GPU 自动降级。

优先级：argparse > env > 默认值。
环境变量前缀：FUNASR_SERVER_（如 FUNASR_SERVER_PORT）。
"""

from __future__ import annotations

import argparse
import logging
import os
from dataclasses import dataclass, field
from typing import Optional

import structlog

logger = structlog.get_logger(__name__)


def _env(key: str, default: str = "") -> str:
    """读取 FUNASR_SERVER_ 前缀的环境变量。"""
    return os.environ.get(f"FUNASR_SERVER_{key}", default)


def _env_int(key: str, default: int) -> int:
    raw = _env(key, str(default))
    try:
        return int(raw)
    except ValueError:
        logger.warning("config.env_parse_failed", key=key, raw=raw, fallback=default)
        return default


def _env_bool(key: str, default: bool) -> bool:
    raw = _env(key, "true" if default else "false").strip().lower()
    return raw in ("1", "true", "yes", "on")


@dataclass
class Config:
    """FunASR Server 全部配置项。

    所有字段都可通过环境变量 FUNASR_SERVER_<UPPER_NAME> 覆盖，
    或通过 argparse 命令行参数覆盖。
    """

    # 服务监听
    host: str = "0.0.0.0"
    port: int = 10095
    cors_origins: str = "http://localhost:3000,http://localhost:8888,http://localhost:9999"

    # 设备（默认 GPU；无 GPU 时 resolve_device 会自动降级到 cpu）
    device: str = "cuda"
    ngpu: int = 1
    ncpu: int = 4

    # 模型（ModelScope ID）
    asr_model: str = "iic/speech_paraformer-large-contextual_asr_nat-zh-cn-16k-common-vocab8404"
    asr_model_revision: str = "v2.0.4"
    asr_model_online: str = "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online"
    asr_model_online_revision: str = "v2.0.4"
    vad_model: str = "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch"
    vad_model_revision: str = "v2.0.4"
    punc_model: str = "iic/punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727"
    punc_model_revision: str = "v2.0.4"
    # 句向量模型（意图 embedding 相似度层用，见 /embed 端点）。
    # 懒加载，不在 lifespan 里预加载，不影响启动时间。
    # 特殊值 "mock"：跳过真实模型，返回确定性伪向量（CI/无模型环境）。
    embed_model: str = "AI-ModelScope/bge-small-zh-v1.5"
    embed_model_revision: str = ""

    # SSL（空则禁用，使用明文 ws/http）
    certfile: str = ""
    keyfile: str = ""

    # 并发限流
    worker_threads: int = 4
    concurrent_vad: int = 4
    concurrent_asr_online: int = 4
    concurrent_asr_offline: int = 2
    concurrent_punc: int = 1
    concurrent_sv: int = 1

    # HTTP/SSE 接口
    temp_dir: str = "temp_dir"
    max_upload_mb: int = 100
    hotword_path: str = ""

    # 调试
    save_offline_segments: bool = False
    save_offline_segments_dir: str = "offline_segments"

    # 日志
    log_level: str = "INFO"

    # 运行时解析（不来自 env）
    gpu_available: bool = field(default=False, init=False)
    gpu_count: int = field(default=0, init=False)

    @classmethod
    def from_env(cls) -> "Config":
        """从环境变量读取配置。"""
        cfg = cls(
            host=_env("HOST", "0.0.0.0"),
            port=_env_int("PORT", 10095),
            cors_origins=_env("CORS_ORIGINS", "http://localhost:3000"),
            device=_env("DEVICE", "cuda"),
            ngpu=_env_int("NGPU", 1),
            ncpu=_env_int("NCPU", 4),
            asr_model=_env("ASR_MODEL", cls.asr_model),
            asr_model_revision=_env("ASR_MODEL_REVISION", cls.asr_model_revision),
            asr_model_online=_env("ASR_MODEL_ONLINE", cls.asr_model_online),
            asr_model_online_revision=_env("ASR_MODEL_ONLINE_REVISION", cls.asr_model_online_revision),
            vad_model=_env("VAD_MODEL", cls.vad_model),
            vad_model_revision=_env("VAD_MODEL_REVISION", cls.vad_model_revision),
            punc_model=_env("PUNC_MODEL", cls.punc_model),
            punc_model_revision=_env("PUNC_MODEL_REVISION", cls.punc_model_revision),
            embed_model=_env("EMBED_MODEL", cls.embed_model),
            embed_model_revision=_env("EMBED_MODEL_REVISION", cls.embed_model_revision),
            certfile=_env("CERTFILE", ""),
            keyfile=_env("KEYFILE", ""),
            worker_threads=_env_int("WORKER_THREADS", 4),
            concurrent_vad=_env_int("CONCURRENT_VAD", 4),
            concurrent_asr_online=_env_int("CONCURRENT_ASR_ONLINE", 4),
            concurrent_asr_offline=_env_int("CONCURRENT_ASR_OFFLINE", 2),
            concurrent_punc=_env_int("CONCURRENT_PUNC", 1),
            concurrent_sv=_env_int("CONCURRENT_SV", 1),
            temp_dir=_env("TEMP_DIR", "temp_dir"),
            max_upload_mb=_env_int("MAX_UPLOAD_MB", 100),
            hotword_path=_env("HOTWORD_PATH", ""),
            save_offline_segments=_env_bool("SAVE_OFFLINE_SEGMENTS", False),
            save_offline_segments_dir=_env("SAVE_OFFLINE_SEGMENTS_DIR", "offline_segments"),
            log_level=os.environ.get("LOG_LEVEL", "INFO"),
        )
        cfg.resolve_device()
        return cfg

    @classmethod
    def from_args(cls, argv: Optional[list[str]] = None) -> "Config":
        """从命令行参数读取配置（兼容 FunASR 官方 CLI 习惯）。

        优先级：argparse > 环境变量 > 默认值。
        """
        parser = argparse.ArgumentParser(description="FunASR Server (WS + HTTP + SSE)")
        parser.add_argument("--host", type=str, default=None, help="host ip")
        parser.add_argument("--port", type=int, default=None, help="server port")
        parser.add_argument("--device", type=str, default=None, help="cuda | cpu")
        parser.add_argument("--ngpu", type=int, default=None, help="1 for gpu, 0 for cpu")
        parser.add_argument("--ncpu", type=int, default=None, help="cpu cores")
        parser.add_argument("--asr_model", type=str, default=None)
        parser.add_argument("--asr_model_revision", type=str, default=None)
        parser.add_argument("--asr_model_online", type=str, default=None)
        parser.add_argument("--asr_model_online_revision", type=str, default=None)
        parser.add_argument("--vad_model", type=str, default=None)
        parser.add_argument("--vad_model_revision", type=str, default=None)
        parser.add_argument("--punc_model", type=str, default=None)
        parser.add_argument("--punc_model_revision", type=str, default=None)
        parser.add_argument("--embed_model", type=str, default=None, help="句向量模型 ID，或 mock（确定性伪向量）")
        parser.add_argument("--embed_model_revision", type=str, default=None)
        parser.add_argument("--certfile", type=str, default=None)
        parser.add_argument("--keyfile", type=str, default=None)
        parser.add_argument("--worker_threads", type=int, default=None)
        parser.add_argument("--concurrent_vad", type=int, default=None)
        parser.add_argument("--concurrent_asr_online", type=int, default=None)
        parser.add_argument("--concurrent_asr_offline", type=int, default=None)
        parser.add_argument("--concurrent_punc", type=int, default=None)
        parser.add_argument("--concurrent_sv", type=int, default=None)
        parser.add_argument("--temp_dir", type=str, default=None)
        parser.add_argument("--max_upload_mb", type=int, default=None)
        parser.add_argument("--hotword_path", type=str, default=None)
        parser.add_argument(
            "--save_offline_segments",
            action="store_true",
            default=None,
            help="save offline audio segments as wav for debugging",
        )
        parser.add_argument("--save_offline_segments_dir", type=str, default=None)
        parser.add_argument("--log_level", type=str, default=None)
        args = parser.parse_args(argv)

        # 先从 env 加载默认值
        cfg = cls.from_env()

        # argparse 覆盖（仅覆盖显式传入的参数）
        overrides = {
            "host": args.host,
            "port": args.port,
            "device": args.device,
            "ngpu": args.ngpu,
            "ncpu": args.ncpu,
            "asr_model": args.asr_model,
            "asr_model_revision": args.asr_model_revision,
            "asr_model_online": args.asr_model_online,
            "asr_model_online_revision": args.asr_model_online_revision,
            "vad_model": args.vad_model,
            "vad_model_revision": args.vad_model_revision,
            "punc_model": args.punc_model,
            "punc_model_revision": args.punc_model_revision,
            "embed_model": args.embed_model,
            "embed_model_revision": args.embed_model_revision,
            "certfile": args.certfile,
            "keyfile": args.keyfile,
            "worker_threads": args.worker_threads,
            "concurrent_vad": args.concurrent_vad,
            "concurrent_asr_online": args.concurrent_asr_online,
            "concurrent_asr_offline": args.concurrent_asr_offline,
            "concurrent_punc": args.concurrent_punc,
            "concurrent_sv": args.concurrent_sv,
            "temp_dir": args.temp_dir,
            "max_upload_mb": args.max_upload_mb,
            "hotword_path": args.hotword_path,
            "save_offline_segments": args.save_offline_segments,
            "save_offline_segments_dir": args.save_offline_segments_dir,
            "log_level": args.log_level,
        }
        for key, value in overrides.items():
            if value is not None:
                setattr(cfg, key, value)

        # 重新解析 device（argparse 可能改了 device）
        cfg.resolve_device()
        return cfg

    def resolve_device(self) -> tuple[str, int]:
        """GPU 降级核心逻辑。

        若 device=cuda 但 torch.cuda.is_available()=False，记 WARN 并降级到 cpu。
        返回 (final_device, final_ngpu)。
        """
        try:
            import torch
            self.gpu_available = torch.cuda.is_available()
            self.gpu_count = torch.cuda.device_count() if self.gpu_available else 0
        except ImportError:
            self.gpu_available = False
            self.gpu_count = 0
            logger.warning("config.torch_not_installed", fallback="cpu")

        if self.device == "cuda" and not self.gpu_available:
            logger.warning(
                "config.gpu_fallback",
                requested="cuda",
                reason="torch.cuda.is_available()=False",
                fallback="cpu",
            )
            self.device = "cpu"
            self.ngpu = 0
        elif self.device == "cpu":
            self.ngpu = 0

        logger.info(
            "config.resolved",
            device=self.device,
            ngpu=self.ngpu,
            ncpu=self.ncpu,
            gpu_available=self.gpu_available,
            gpu_count=self.gpu_count,
        )
        return self.device, self.ngpu


def setup_logging(level: str = "INFO") -> None:
    """配置 structlog + 标准 logging（uvicorn 依赖 logging）。"""
    numeric = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        level=numeric,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(numeric),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
