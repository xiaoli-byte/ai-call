"""FunASR Server 入口 —— 解析配置、创建 app、启动 uvicorn。

支持两种启动方式：
1. 命令行：`python -m funasr_server --host 0.0.0.0 --port 10095 --device cuda`
2. 脚本入口：`funasr-server`（pyproject.toml 中注册的 console_script）

环境变量优先级低于命令行参数（见 Config.from_args）。
"""

from __future__ import annotations

import structlog

from .app import create_app
from .config import Config, setup_logging

logger = structlog.get_logger(__name__)


def main() -> None:
    """主入口：加载 .env → 解析配置 → 创建 app → 启动 uvicorn。"""
    # 加载服务目录下的 .env（FUNASR_SERVER_* 变量）。python-dotenv 一直在依赖里
    # 但此前从未被调用，导致 services/funasr-server/.env 形同虚设。
    # override=False：已存在的进程环境变量优先（部署编排注入的值不被文件覆盖）。
    from pathlib import Path

    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

    config = Config.from_args()
    setup_logging(config.log_level)

    logger.info(
        "main.starting",
        host=config.host,
        port=config.port,
        device=config.device,
        ngpu=config.ngpu,
        gpu_available=config.gpu_available,
        gpu_count=config.gpu_count,
        certfile=config.certfile or "(none)",
    )

    app = create_app(config)

    # 延迟 import uvicorn，避免在仅做配置解析时加载
    import uvicorn

    ssl_kwargs: dict[str, str] = {}
    if config.certfile and config.keyfile:
        ssl_kwargs["ssl_certfile"] = config.certfile
        ssl_kwargs["ssl_keyfile"] = config.keyfile
        logger.info("main.ssl_enabled", certfile=config.certfile)

    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
        log_level=config.log_level.lower(),
        **ssl_kwargs,
    )


if __name__ == "__main__":
    main()
