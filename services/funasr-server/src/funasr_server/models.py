"""模型管理 —— 封装 5 个 AutoModel 实例的加载与推理。

修复原 funasr_wss_server.py 第 237-245 行硬编码 model="paraformer-zh" 的 bug：
改为从 Config.asr_model 读取，使 --asr_model 参数真正生效。

模型加载放在 FastAPI lifespan 中执行（绑定同一 event loop）。
"""

from __future__ import annotations

import asyncio
import functools
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np
import structlog

from .config import Config

logger = structlog.get_logger(__name__)

# 声纹模型硬编码（FunASR 官方原 wss_server 也硬编码此模型）
SPEAKER_MODEL_ID = "iic/speech_campplus_sv_zh-cn_16k-common"
SPEAKER_MATCH_THRESHOLD = 0.2


@dataclass
class SpeakerDB:
    """声纹库缓存，支持按间隔重新加载。"""

    path: str
    cache: dict[str, list[float]] = field(default_factory=dict)
    last_loaded_ts: float = 0.0
    reload_sec: int = 5

    def load_if_stale(self) -> None:
        """若距离上次加载超过 reload_sec，重新读盘。"""
        now = time.time()
        if now - self.last_loaded_ts < self.reload_sec:
            return
        try:
            if os.path.exists(self.path):
                with open(self.path, "r", encoding="utf-8") as f:
                    self.cache = json.load(f)
            else:
                self.cache = {}
            self.last_loaded_ts = now
        except Exception as err:
            logger.warning("speaker_db.load_failed", path=self.path, error=str(err))


class ModelManager:
    """5 个 AutoModel 实例的容器与推理入口。

    所有 generate() 调用都是阻塞的，应在 ThreadPoolExecutor 中执行。
    """

    def __init__(self, config: Config) -> None:
        self.config = config
        self.executor = ThreadPoolExecutor(
            max_workers=config.worker_threads,
            thread_name_prefix="funasr-worker",
        )

        # 模型对象（延迟加载，load_all() 完成后才可用）
        self.model_asr: Any = None
        self.model_asr_streaming: Any = None
        self.model_vad: Any = None
        self.model_punc: Any = None  # 可能为 None（punc_model 为空时禁用）
        self.model_sv: Any = None

        # 声纹库
        speaker_db_path = os.path.join(
            os.path.dirname(__file__), "speaker_db.json"
        )
        self.speaker_db = SpeakerDB(path=speaker_db_path)

        # 热词（从 hotword_path 加载）
        self.hotword: str = self._load_hotword(config.hotword_path)

    @classmethod
    def load_all(cls, config: Config) -> "ModelManager":
        """同步加载所有模型（在 FastAPI lifespan 中调用）。

        首次加载会从 ModelScope 下载模型（约 2-3 GB，10-30 分钟）。
        """
        from funasr import AutoModel

        manager = cls(config)
        common_kwargs = {
            "ngpu": config.ngpu,
            "ncpu": config.ncpu,
            "device": config.device,
            "disable_pbar": True,
            "disable_log": True,
        }

        logger.info("models.loading_start", device=config.device, ngpu=config.ngpu)

        # 1. ASR（离线整句）—— 修复原代码硬编码 bug：用 config.asr_model 而非 "paraformer-zh"
        logger.info("models.loading_asr", model=config.asr_model, revision=config.asr_model_revision)
        manager.model_asr = AutoModel(
            model=config.asr_model,
            model_revision=config.asr_model_revision,
            **common_kwargs,
        )

        # 2. ASR（在线流式）
        logger.info(
            "models.loading_asr_streaming",
            model=config.asr_model_online,
            revision=config.asr_model_online_revision,
        )
        manager.model_asr_streaming = AutoModel(
            model=config.asr_model_online,
            model_revision=config.asr_model_online_revision,
            **common_kwargs,
        )

        # 3. VAD
        logger.info("models.loading_vad", model=config.vad_model, revision=config.vad_model_revision)
        manager.model_vad = AutoModel(
            model=config.vad_model,
            model_revision=config.vad_model_revision,
            **common_kwargs,
        )

        # 4. Punc（可选，punc_model 为空则跳过）
        if config.punc_model and config.punc_model.strip():
            logger.info(
                "models.loading_punc",
                model=config.punc_model,
                revision=config.punc_model_revision,
            )
            manager.model_punc = AutoModel(
                model=config.punc_model,
                model_revision=config.punc_model_revision,
                **common_kwargs,
            )
        else:
            logger.info("models.punc_disabled", reason="punc_model empty")

        # 5. Speaker Verification（声纹，硬编码模型 ID，与原 wss_server 一致）
        logger.info("models.loading_sv", model=SPEAKER_MODEL_ID)
        manager.model_sv = AutoModel(
            model=SPEAKER_MODEL_ID,
            ngpu=config.ngpu,
            device=config.device,
            disable_pbar=True,
            disable_log=True,
        )

        logger.info("models.loading_done")
        return manager

    def shutdown(self) -> None:
        """关闭线程池。"""
        try:
            self.executor.shutdown(wait=False, cancel_futures=True)
        except Exception:
            pass

    async def run_blocking(
        self,
        fn: Any,
        *args: Any,
        sem: Optional[asyncio.Semaphore] = None,
        **kwargs: Any,
    ) -> Any:
        """把阻塞函数丢线程池执行，可选 sem 限流。

        WS handler 用此方法调用 model.generate(input=..., **status_dict)，
        因为流式 ASR 需要传 chunk_size/encoder_chunk_look_back 等参数，
        比 transcribe_online 签名更灵活。
        """
        loop = asyncio.get_running_loop()
        call = functools.partial(fn, *args, **kwargs)
        if sem is None:
            return await loop.run_in_executor(self.executor, call)
        async with sem:
            return await loop.run_in_executor(self.executor, call)

    # ---------- 推理接口 ----------

    def transcribe_offline(
        self,
        audio: bytes | np.ndarray,
        hotword: str = "",
        is_final: bool = True,
    ) -> dict:
        """离线整句 ASR 推理（paraformer-large-contextual）。

        返回 funasr generate 结果的第一项 dict。
        """
        kwargs: dict[str, Any] = {
            "input": audio,
            "is_final": is_final,
            "sentence_timestamp": True,
            "batch_size_s": 300,
        }
        if hotword:
            kwargs["hotword"] = hotword
        result = self.model_asr.generate(**kwargs)
        return result[0] if result else {}

    def transcribe_online(
        self,
        audio: bytes | np.ndarray,
        cache: dict[str, Any],
        is_final: bool,
        hotword: str = "",
    ) -> dict:
        """在线流式 ASR 推理（paraformer-large-online）。

        cache 会被模型内部更新（chunk 缓存），调用方需保留返回结果中的 cache。
        """
        kwargs: dict[str, Any] = {
            "input": audio,
            "cache": cache,
            "is_final": is_final,
            "hotword": hotword,
        }
        result = self.model_asr_streaming.generate(**kwargs)
        return result[0] if result else {}

    def vad_detect(
        self,
        audio: bytes | np.ndarray,
        cache: dict[str, Any],
        chunk_size: int,
        is_final: bool = False,
    ) -> list[list[int]]:
        """VAD 语音端点检测。

        返回 [[start_ms, end_ms], ...]，[-1, -1] 表示无活动。
        """
        result = self.model_vad.generate(
            input=audio,
            cache=cache,
            chunk_size=chunk_size,
            is_final=is_final,
        )
        if not result:
            return []
        return result[0].get("value", [])

    def punctuate(self, text: str) -> str:
        """标点恢复。返回加标点后的文本。"""
        if not self.model_punc or not text:
            return text
        result = self.model_punc.generate(input=text)
        if not result:
            return text
        return result[0].get("text", text)

    def speaker_embedding(self, audio: bytes | np.ndarray) -> np.ndarray:
        """提取声纹 embedding。"""
        result = self.model_sv.generate(input=audio, embedding=True)
        return result[0]["spk_embedding"][0].cpu().numpy()

    def speaker_match(self, embedding: np.ndarray) -> tuple[str, float]:
        """与声纹库匹配，返回 (name, score)。无匹配返回 ("unknown", 0.0)。"""
        from scipy.spatial.distance import cosine

        self.speaker_db.load_if_stale()
        if not self.speaker_db.cache:
            return "unknown", 0.0

        best_name = "unknown"
        best_score = 0.0
        for name, ref_emb_list in self.speaker_db.cache.items():
            ref = np.array(ref_emb_list)
            score = 1.0 - cosine(embedding, ref)
            if score > best_score:
                best_score = score
                best_name = name

        if best_score > SPEAKER_MATCH_THRESHOLD:
            return best_name, best_score
        return "unknown", best_score

    # ---------- 内部工具 ----------

    @staticmethod
    def _load_hotword(path: str) -> str:
        """从 txt 文件加载热词（每行一个词，空格分隔权重）。"""
        if not path or not os.path.exists(path):
            return ""
        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = [line.strip() for line in f.readlines() if line.strip()]
            return " ".join(lines)
        except Exception as err:
            logger.warning("hotword.load_failed", path=path, error=str(err))
            return ""


def to_python(obj: Any) -> Any:
    """递归把 numpy / torch 类型转成纯 Python，可 JSON 序列化。

    沿用原 funasr_wss_server.py 第 17-38 行的实现。
    """
    try:
        import torch
    except ImportError:
        torch = None

    if isinstance(obj, np.generic):
        return obj.item()
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if torch is not None and isinstance(obj, torch.Tensor):
        return obj.cpu().tolist()

    if isinstance(obj, dict):
        return {k: to_python(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_python(v) for v in obj]

    return obj
