"""FastAPI app 工厂 —— 聚合 HTTP/SSE/WS 路由 + lifespan 模型加载。

模型加载放在 lifespan 内（绑定 uvicorn event loop），
Semaphore/Executor 也在 lifespan 内创建，避免模块顶层创建导致 loop 不匹配。
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Config, setup_logging
from .models import ModelManager

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """FastAPI lifespan：启动时加载模型，关闭时清理。"""
    config: Config = app.state.config

    setup_logging(config.log_level)
    logger.info(
        "lifespan.startup",
        host=config.host,
        port=config.port,
        device=config.device,
        ngpu=config.ngpu,
        gpu_available=config.gpu_available,
        gpu_count=config.gpu_count,
    )

    # 加载模型（首次会下载 2-3 GB，10-30 分钟）
    logger.info("lifespan.loading_models")
    app.state.models = ModelManager.load_all(config)

    # 创建 Semaphore（必须在 event loop 内创建，避免 loop 不匹配）
    app.state.semaphores = {
        "vad": asyncio.Semaphore(config.concurrent_vad),
        "asr_online": asyncio.Semaphore(config.concurrent_asr_online),
        "asr_offline": asyncio.Semaphore(config.concurrent_asr_offline),
        "punc": asyncio.Semaphore(config.concurrent_punc),
        "sv": asyncio.Semaphore(config.concurrent_sv),
        "wav": asyncio.Semaphore(4),
    }

    # 确保临时目录存在
    os.makedirs(config.temp_dir, exist_ok=True)
    if config.save_offline_segments:
        os.makedirs(config.save_offline_segments_dir, exist_ok=True)

    logger.info("lifespan.startup_done")

    try:
        yield
    finally:
        logger.info("lifespan.shutdown")
        if hasattr(app.state, "models") and app.state.models is not None:
            app.state.models.shutdown()
        logger.info("lifespan.shutdown_done")


def create_app(config: Config) -> FastAPI:
    """创建 FastAPI app，注册全部路由。"""
    app = FastAPI(
        title="FunASR Server",
        description=(
            "FunASR WebSocket + HTTP + SSE 三合一服务端。"
            "WS 服务实时流式（voice-agent 主链路）；"
            "HTTP 同步识别（外部 curl/文件转写）；"
            "SSE 流式识别（外部长音频/调试）。"
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    # 存入 config 供 lifespan 与路由访问
    app.state.config = config

    # CORS（允许外部调用）
    cors_origins = [
        origin.strip()
        for origin in config.cors_origins.split(",")
        if origin.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials="*" not in cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 全局异常处理
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_exception", path=request.url.path, error=str(exc))
        return JSONResponse(
            status_code=500,
            content={"msg": "internal server error", "code": -1, "detail": str(exc)},
        )

    # 注册路由（延迟 import 避免循环依赖）
    from .api.embed import router as embed_router
    from .api.health import router as health_router
    from .api.http import router as http_router
    from .api.sse import router as sse_router
    from .api.ws import register_ws_routes

    app.include_router(health_router)
    app.include_router(http_router)
    app.include_router(sse_router)
    app.include_router(embed_router)
    register_ws_routes(app)  # WebSocket 路由单独注册（需要 app 实例）

    logger.info(
        "app.created",
        routes=["/health", "/recognize", "/recognize/stream", "/embed", "/", "/ws"],
    )
    return app
