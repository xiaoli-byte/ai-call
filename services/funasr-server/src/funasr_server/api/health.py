"""健康检查端点 —— 供监控 / 负载均衡器 / k8s 探针使用。"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..config import Config
from ..models import ModelManager

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(request: Request) -> JSONResponse:
    """返回服务健康状态。

    响应：
    ```json
    {
      "status": "ok",
      "version": "0.1.0",
      "device": "cuda",
      "gpu_available": true,
      "gpu_count": 1,
      "models_loaded": true,
      "endpoints": ["/health", "/recognize", "/recognition", "/recognize/stream", "/", "/ws"]
    }
    ```
    """
    app = request.app
    config: Config = app.state.config
    models_loaded = hasattr(app.state, "models") and app.state.models is not None

    # 检查各模型是否已加载
    model_status: dict[str, bool] = {}
    if models_loaded:
        models: ModelManager = app.state.models
        model_status = {
            "asr_offline": models.model_asr is not None,
            "asr_online": models.model_asr_streaming is not None,
            "vad": models.model_vad is not None,
            "punc": models.model_punc is not None,  # 可能为 None（禁用 punc）
            "sv": models.model_sv is not None,
            # 懒加载，未收到过 /embed 请求时为 False；不影响整体 status=ok
            "embed": models.model_embed is not None,
        }

    return JSONResponse(
        content={
            "status": "ok" if models_loaded else "loading",
            "version": "0.1.0",
            "device": config.device,
            "gpu_available": config.gpu_available,
            "gpu_count": config.gpu_count,
            "models_loaded": models_loaded,
            "models": model_status,
            "endpoints": [
                "GET /health",
                "POST /recognize",
                "POST /recognition",
                "POST /recognize/stream",
                "POST /embed",
                "WS /",
                "WS /ws",
            ],
        }
    )
