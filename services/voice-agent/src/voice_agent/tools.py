"""Function Calling 工具定义与 HTTP 分发。

复刻自 apps/voice-agent/src/tools.ts。

设计：工具即 HTTP 接口 - LLM 触发 tool_call 时通过 HTTP 调用 NestJS 后端
POST /api/tools/{name}，业务逻辑独立于 Voice Agent，便于复用与测试。
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from .types import ScenarioConfig, ToolCall, ToolDefinition, ToolResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 工具签名定义（与 NestJS ToolsController 路由一一对应）
# ---------------------------------------------------------------------------

TOOL_DEFS: dict[str, ToolDefinition] = {
    # ===== 催收场景 =====
    "query_repayment_info": ToolDefinition(
        name="query_repayment_info",
        description="查询客户还款信息：应还金额、还款日、逾期天数、罚息等",
        parameters={
            "type": "object",
            "properties": {
                "customerId": {"type": "string", "description": "客户ID（可选）"},
            },
        },
    ),
    "calculate_penalty": ToolDefinition(
        name="calculate_penalty",
        description="计算逾期罚息",
        parameters={
            "type": "object",
            "properties": {
                "overdueDays": {"type": "number", "description": "逾期天数"},
                "principal": {"type": "number", "description": "本金"},
            },
            "required": ["overdueDays", "principal"],
        },
    ),
    "create_extension_request": ToolDefinition(
        name="create_extension_request",
        description="创建延期还款申请（需要转人工审核）",
        parameters={
            "type": "object",
            "properties": {
                "reason": {"type": "string", "description": "延期原因"},
                "customerId": {"type": "string", "description": "客户ID（可选）"},
            },
            "required": ["reason"],
        },
    ),
    # ===== 电商场景 =====
    "query_order": ToolDefinition(
        name="query_order",
        description="查询订单详情：状态、物流、商品、金额",
        parameters={
            "type": "object",
            "properties": {
                "orderNo": {"type": "string", "description": "订单号"},
            },
            "required": ["orderNo"],
        },
    ),
    "query_refund_status": ToolDefinition(
        name="query_refund_status",
        description="查询退款进度",
        parameters={
            "type": "object",
            "properties": {
                "orderNo": {"type": "string", "description": "订单号"},
            },
            "required": ["orderNo"],
        },
    ),
    "create_pickup_appointment": ToolDefinition(
        name="create_pickup_appointment",
        description="创建上门取件预约",
        parameters={
            "type": "object",
            "properties": {
                "orderNo": {"type": "string", "description": "订单号"},
                "date": {"type": "string", "description": "取件日期 YYYY-MM-DD"},
                "timeSlot": {"type": "string", "description": "时间段 如 09:00-12:00"},
                "address": {"type": "string", "description": "取件地址（可选）"},
            },
            "required": ["orderNo", "date", "timeSlot"],
        },
    ),
    "create_after_sale_ticket": ToolDefinition(
        name="create_after_sale_ticket",
        description="创建售后工单（质量问题、投诉等，会转专员跟进）",
        parameters={
            "type": "object",
            "properties": {
                "orderNo": {"type": "string", "description": "订单号"},
                "issueType": {
                    "type": "string",
                    "description": "问题类型 quality/damage/wrong/other",
                },
                "description": {"type": "string", "description": "问题描述"},
            },
            "required": ["orderNo", "issueType", "description"],
        },
    ),
    # ===== 售前场景 =====
    "query_car_model": ToolDefinition(
        name="query_car_model",
        description="查询车型参数：续航、加速、配置亮点",
        parameters={
            "type": "object",
            "properties": {
                "model": {"type": "string", "description": "车型名称（可选）"},
            },
        },
    ),
    "query_activity": ToolDefinition(
        name="query_activity",
        description="查询当前进行中的活动详情",
        parameters={
            "type": "object",
            "properties": {
                "activityId": {"type": "string", "description": "活动ID（可选）"},
            },
        },
    ),
    "create_test_drive_appointment": ToolDefinition(
        name="create_test_drive_appointment",
        description="创建试驾预约",
        parameters={
            "type": "object",
            "properties": {
                "customerName": {"type": "string", "description": "客户姓名"},
                "phone": {"type": "string", "description": "客户手机号"},
                "date": {"type": "string", "description": "试驾日期 YYYY-MM-DD"},
                "timeSlot": {"type": "string", "description": "时间段 如 14:00-15:00"},
                "model": {"type": "string", "description": "试驾车型（可选）"},
            },
            "required": ["customerName", "phone", "date", "timeSlot"],
        },
    ),
    # ===== 通用 =====
    "transfer_to_human": ToolDefinition(
        name="transfer_to_human",
        description="转接人工专员（客户要求、超出能力范围、情绪激动等场景）",
        parameters={
            "type": "object",
            "properties": {
                "reason": {"type": "string", "description": "转人工原因"},
            },
            "required": ["reason"],
        },
    ),
}


class ToolDispatcher:
    """工具调用分发器。"""

    def __init__(
        self,
        api_base_url: str = "http://localhost:3001/api",
        timeout: float = 5.0,
    ) -> None:
        self._api_base_url = api_base_url.rstrip("/")
        self._timeout = timeout
        self._client = httpx.AsyncClient(timeout=timeout)

    def get_tool_definitions(self, scenario: ScenarioConfig) -> list[ToolDefinition]:
        """根据场景的 allowed_tools 过滤出可用工具。"""
        return [TOOL_DEFS[name] for name in scenario.allowed_tools if name in TOOL_DEFS]

    async def dispatch(self, call: ToolCall) -> ToolResult:
        """执行工具调用 - 通过 HTTP POST 调用后端 API。

        失败时返回 should_escalate=True，让 Agent 触发转人工。
        """
        url = f"{self._api_base_url}/tools/{call.name}"
        try:
            response = await self._client.post(url, json=call.arguments)
            if response.status_code != 200:
                raise RuntimeError(f"Tool {call.name} failed: HTTP {response.status_code}")

            data = response.json()
            return ToolResult(
                tool_call_id=call.id,
                result=data.get("result"),
                should_escalate=bool(data.get("shouldEscalate", False)),
            )
        except Exception as err:
            logger.error("[ToolDispatcher] %s error: %s", call.name, err)
            return ToolResult(
                tool_call_id=call.id,
                result={"error": "工具调用失败，建议转人工"},
                should_escalate=True,
            )

    async def close(self) -> None:
        await self._client.aclose()
