"""句向量端点 —— 供 voice-agent 意图 embedding 相似度层调用。

见 docs/superpowers/specs/2026-07-11-intent-embedding-tier.md 第 2 节。

用法：
    curl -X POST http://localhost:10095/embed \\
         -H "Content-Type: application/json" \\
         -d '{"texts": ["同意", "拒绝"]}'
响应：
    {"embeddings": [[0.01, ...], [0.02, ...]], "dim": 512, "model": "iic/..."}

要点：
- 批量上限 64 条文本，超限返回 400。
- 输出向量已 L2 归一化，客户端直接用点积算 cosine 相似度。
- 模型懒加载：首个请求触发加载，加载失败缓存错误，后续请求快速 503（不反复重试）。
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..models import ModelManager

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["embed"])

MAX_BATCH_SIZE = 64


class EmbedRequest(BaseModel):
    texts: list[str]


@router.post("/embed")
async def embed(payload: EmbedRequest, request: Request) -> JSONResponse:
    models: ModelManager = request.app.state.models

    if not payload.texts:
        return JSONResponse(
            content={"embeddings": [], "dim": 0, "model": models.config.embed_model}
        )

    if len(payload.texts) > MAX_BATCH_SIZE:
        return JSONResponse(
            status_code=400,
            content={
                "msg": f"单批最多 {MAX_BATCH_SIZE} 条文本，实收 {len(payload.texts)} 条",
                "code": 1,
            },
        )

    await models.ensure_embed_model()

    if models.embed_load_error is not None:
        return JSONResponse(
            status_code=503,
            content={
                "msg": "句向量模型加载失败，暂不可用",
                "code": -1,
                "detail": models.embed_load_error,
            },
        )

    try:
        vectors = await models.run_blocking(models.embed_texts, payload.texts)
    except Exception as err:
        logger.exception("embed.inference_failed", error=str(err))
        return JSONResponse(
            status_code=500,
            content={"msg": "句向量推理失败", "code": -1, "detail": str(err)},
        )

    dim = len(vectors[0]) if vectors else 0
    return JSONResponse(
        content={"embeddings": vectors, "dim": dim, "model": models.config.embed_model}
    )
