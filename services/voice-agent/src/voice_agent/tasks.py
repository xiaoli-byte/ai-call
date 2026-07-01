"""NestJS 任务端点集成 - 通话任务全生命周期上报。

新增集成（TS 版未做）：
- 会话开始：GET /api/tasks/:id 拉取任务上下文（scenario + variables）
- 每轮对话：PATCH /api/tasks/:id/transcript 上报转写条目
- 转人工时：POST /api/tasks/:id/transfer 触发 ESL uuid_transfer
- 会话结束：PATCH /api/tasks/:id/outcome 上报通话结果

所有上报均为 fire-and-forget：失败仅 warn 不阻塞对话主循环。
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Optional
from uuid import uuid4

import httpx
from pydantic import ValidationError

from .contracts import TaskContextContract

logger = logging.getLogger(__name__)


class TaskClient:
    """NestJS 任务端点客户端。"""

    def __init__(
        self,
        api_base_url: str = "http://localhost:3001/api",
        timeout: float = 10.0,
        service_token: Optional[str] = None,
    ) -> None:
        self._api_base_url = api_base_url.rstrip("/")
        token = service_token if service_token is not None else os.getenv("SERVICE_API_TOKEN", "")
        headers = {"X-Service-Token": token} if token else {}
        self._client = httpx.AsyncClient(timeout=timeout, headers=headers)

    async def _request(
        self,
        method: str,
        url: str,
        *,
        json: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
        retry: bool = True,
    ) -> httpx.Response:
        attempts = 3 if retry else 1
        for attempt in range(attempts):
            try:
                response = await self._client.request(method, url, json=json, headers=headers)
                if response.status_code < 500 and response.status_code != 429:
                    return response
                if attempt == attempts - 1:
                    return response
            except httpx.HTTPError:
                if attempt == attempts - 1:
                    raise
            await asyncio.sleep(0.2 * (2**attempt))
        raise RuntimeError("unreachable retry state")

    async def get_task(self, task_id: str) -> Optional[dict[str, Any]]:
        """会话开始时拉取任务上下文。

        返回 None 表示任务不存在或后端不可达，调用方应 fallback 到 metadata。
        """
        url = f"{self._api_base_url}/tasks/{task_id}/context"
        try:
            response = await self._request("GET", url)
            if response.status_code == 404:
                logger.info("[TaskClient] task %s not found, fallback to metadata", task_id)
                return None
            if response.status_code != 200:
                logger.warning(
                    "[TaskClient] get_task HTTP %s: %s",
                    response.status_code,
                    response.text[:200],
                )
                return None
            contract = TaskContextContract.model_validate(response.json())
            return contract.model_dump(by_alias=True)
        except ValidationError as err:
            logger.error("[TaskClient] invalid task contract for %s: %s", task_id, err)
            return None
        except Exception as err:
            logger.warning("[TaskClient] get_task %s error: %s", task_id, err)
            return None

    async def append_transcript(
        self,
        task_id: str,
        role: str,
        content: str,
        emotion: Optional[str] = None,
    ) -> None:
        """上报对话转写条目（失败仅 warn 不阻塞）。"""
        url = f"{self._api_base_url}/tasks/{task_id}/transcript"
        body: dict[str, Any] = {"role": role, "content": content}
        if emotion:
            body["emotion"] = emotion
        try:
            response = await self._request(
                "PATCH",
                url,
                json=body,
                headers={"Idempotency-Key": str(uuid4())},
            )
            if response.status_code != 200:
                logger.warning(
                    "[TaskClient] append_transcript HTTP %s for task %s",
                    response.status_code,
                    task_id,
                )
        except Exception as err:
            logger.warning("[TaskClient] append_transcript %s error: %s", task_id, err)

    async def set_outcome(
        self,
        task_id: str,
        outcome: str,
        tags: Optional[list[str]] = None,
    ) -> None:
        """上报通话结果（会话结束时调用）。"""
        url = f"{self._api_base_url}/tasks/{task_id}/outcome"
        body: dict[str, Any] = {"outcome": outcome}
        if tags:
            body["tags"] = tags
        try:
            response = await self._request("PATCH", url, json=body)
            if response.status_code != 200:
                logger.warning(
                    "[TaskClient] set_outcome HTTP %s for task %s",
                    response.status_code,
                    task_id,
                )
        except Exception as err:
            logger.warning("[TaskClient] set_outcome %s error: %s", task_id, err)

    async def transfer_to_human(
        self,
        task_id: str,
        extension: Optional[str] = None,
    ) -> None:
        """触发转人工（调用 NestJS 那边的 ESL uuid_transfer）。"""
        url = f"{self._api_base_url}/tasks/{task_id}/transfer"
        body: dict[str, Any] = {}
        if extension:
            body["extension"] = extension
        try:
            response = await self._request("POST", url, json=body, retry=False)
            if response.status_code != 202:
                logger.warning(
                    "[TaskClient] transfer_to_human HTTP %s for task %s",
                    response.status_code,
                    task_id,
                )
        except Exception as err:
            logger.warning("[TaskClient] transfer_to_human %s error: %s", task_id, err)

    async def update_status(self, task_id: str, status: str) -> None:
        """更新任务状态（如 IN_CALL / COMPLETED）。"""
        url = f"{self._api_base_url}/tasks/{task_id}/status"
        try:
            response = await self._request("PATCH", url, json={"status": status})
            if response.status_code != 200:
                logger.warning(
                    "[TaskClient] update_status HTTP %s for task %s",
                    response.status_code,
                    task_id,
                )
        except Exception as err:
            logger.warning("[TaskClient] update_status %s error: %s", task_id, err)

    async def get_task_flow(self, flow_id: str) -> Optional[dict[str, Any]]:
        """拉取流程配置（GET /api/task-flows/{flow_id}）。

        返回 flow dict（含 nodes/edges），失败返回 None。
        """
        url = f"{self._api_base_url}/task-flows/{flow_id}"
        try:
            response = await self._request("GET", url)
            if response.status_code == 404:
                logger.warning("[TaskClient] flow %s not found", flow_id)
                return None
            if response.status_code >= 400:
                logger.warning(
                    "[TaskClient] get_task_flow HTTP %s for flow %s",
                    response.status_code,
                    flow_id,
                )
                return None
            return response.json()
        except Exception as err:
            logger.warning("[TaskClient] get_task_flow %s error: %s", flow_id, err)
            return None

    async def hangup(self, task_id: str) -> None:
        """挂机（POST /api/tasks/{task_id}/hangup，202 Accepted）。"""
        url = f"{self._api_base_url}/tasks/{task_id}/hangup"
        try:
            response = await self._request("POST", url, retry=False)
            if response.status_code != 202:
                logger.warning(
                    "[TaskClient] hangup HTTP %s for task %s",
                    response.status_code,
                    task_id,
                )
        except Exception as err:
            logger.warning("[TaskClient] hangup %s error: %s", task_id, err)

    async def execute_action(
        self,
        task_id: str,
        action_type: str,
        config: dict[str, Any],
        idempotency_key: str,
    ) -> bool:
        """将流程动作交给 Nest outbox 执行，返回是否已接收。"""
        url = f"{self._api_base_url}/tasks/{task_id}/actions"
        try:
            response = await self._request(
                "POST",
                url,
                json={"actionType": action_type, "config": config},
                headers={"Idempotency-Key": idempotency_key},
                retry=False,
            )
            if response.status_code == 202:
                return True
            logger.warning(
                "[TaskClient] execute_action HTTP %s for task %s action %s",
                response.status_code,
                task_id,
                action_type,
            )
            return False
        except Exception as err:
            logger.warning("[TaskClient] execute_action %s/%s error: %s", task_id, action_type, err)
            return False

    async def close(self) -> None:
        await self._client.aclose()
