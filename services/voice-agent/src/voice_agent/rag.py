"""RAG 检索增强生成服务。

复刻自 apps/voice-agent/src/rag.ts。

职责：
1. 调用 NestJS 后端知识库 API 检索相关文档片段
2. 将片段格式化为 system prompt 的补充上下文
3. 用于抑制幻觉：让 LLM 基于检索到的真实信息回答

接入路径：POST /api/knowledge-base/:id/retrieve
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from .types import ScenarioConfig

logger = logging.getLogger(__name__)


class RagService:
    """RAG 检索服务。"""

    def __init__(
        self,
        api_base_url: str = "http://localhost:3001/api",
        timeout: float = 3.0,
        service_token: str | None = None,
    ) -> None:
        self._api_base_url = api_base_url.rstrip("/")
        self._timeout = timeout
        token = service_token if service_token is not None else os.getenv("SERVICE_API_TOKEN", "")
        headers = {"X-Service-Token": token} if token else {}
        self._client = httpx.AsyncClient(timeout=timeout, headers=headers)

    async def retrieve(
        self,
        scenario: ScenarioConfig,
        query: str,
        top_k: int = 3,
        tenant_id: str | None = None,
        user_id: str | None = None,
    ) -> str:
        """检索知识库 - 取回与用户问题相关的文档片段。

        返回的片段会拼接到 LLM 的 system prompt 中。
        超时或失败不阻塞对话，仅返回空字符串。
        """
        url = f"{self._api_base_url}/knowledge-base/{scenario.knowledge_base_id}/retrieve"
        try:
            headers: dict[str, str] = {}
            if tenant_id:
                headers["X-Tenant-Id"] = tenant_id
            if user_id:
                headers["X-User-Id"] = user_id
            response = await self._client.post(
                url,
                json={"query": query, "topK": top_k},
                headers=headers or None,
            )
            if response.status_code != 200:
                raise RuntimeError(f"RAG retrieve failed: HTTP {response.status_code}")

            data = response.json()
            results = data.get("results", [])
            return self._format_context(results)
        except Exception as err:
            logger.warning("[RagService] retrieve error: %s", err)
            return ""

    def _format_context(self, docs: list[dict[str, Any]]) -> str:
        """将检索结果格式化为 system prompt 补充段落。

        防幻觉规则嵌入这段话：
        - 涉及数字/政策时必须基于【知识库】回答
        - 知识库未涵盖的问题回复"帮您确认后回复"
        - 不引用未在【知识库】中出现的信息
        """
        if not docs:
            return ""

        docs_text = "\n\n".join(
            f"[{i + 1}] (来源: {d.get('source', 'unknown')})\n{d.get('content', '')}"
            for i, d in enumerate(docs)
        )

        return (
            "\n\n【知识库参考资料】\n"
            f"{docs_text}\n\n"
            "【使用规则】\n"
            "- 涉及金额/日期/政策等具体信息时，必须基于上述【知识库参考资料】回答\n"
            '- 若上述参考资料未覆盖客户问题，统一回复："这部分我需要帮您确认后回复"\n'
            "- 不得编造未在参考资料中出现的信息"
        )

    async def close(self) -> None:
        await self._client.aclose()
