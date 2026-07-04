"""Runtime executor for published task-flow snapshots.

The voice agent owns audio, LLM, and session state. This executor only walks the
flow graph and delegates side effects through callbacks so control-plane actions
(SMS/API/outbox, transfer, hangup) remain centralized in NestJS.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional, Protocol
from uuid import uuid4

from .flow_types import (
    ActionType,
    DecisionMode,
    DialogMode,
    EndMode,
    FlowEdge,
    FlowNode,
    NodeType,
    TaskFlow,
)
from .types import ChatMessage, ToolCall

logger = logging.getLogger(__name__)


class FlowExecutorCallbacks(Protocol):
    """Callbacks implemented by VoiceAgent."""

    async def speak(self, call_id: str, text: str) -> None: ...
    async def wait_for_user_speech(self, call_id: str) -> str: ...
    async def generate_reply(
        self, call_id: str, messages: list[ChatMessage], tools: list = None
    ) -> str: ...
    async def generate_llm_text(
        self, call_id: str, messages: list[ChatMessage], options: dict = None
    ) -> str: ...
    async def on_caller_speech(self, call_id: str, text: str) -> None: ...
    async def on_escalate(
        self, call_id: str, reason: str, extension: Optional[str] = None
    ) -> bool: ...
    async def on_tool_call(self, call_id: str, call: ToolCall, result: Any) -> None: ...
    async def on_node_enter(self, call_id: str, node_id: str, node_name: str) -> None: ...
    async def on_action(self, call_id: str, action_type: str, config: dict[str, Any]) -> None: ...
    def get_session_messages(self, call_id: str) -> list[ChatMessage]: ...
    def get_session_variables(self, call_id: str) -> dict[str, str]: ...
    def get_session_tools(self, call_id: str) -> list: ...
    def is_ended(self, call_id: str) -> bool: ...
    def mark_ended(self, call_id: str) -> None: ...
    def mark_escalated(self, call_id: str) -> None: ...
    async def dispatch_tool(self, call_id: str, call: ToolCall) -> Any: ...
    async def dispatch_action(
        self, call_id: str, action_type: str, config: dict[str, Any], idempotency_key: str
    ) -> bool: ...
    async def hangup_call(self, call_id: str) -> None: ...


def render_template(text: str, variables: dict[str, str]) -> str:
    """Replace {var} placeholders and leave unknown placeholders unchanged."""
    for key, value in variables.items():
        text = text.replace(f"{{{key}}}", value)
    return text


class FlowExecutor:
    """Walk a task-flow graph and execute nodes by type."""

    def __init__(self, flow: TaskFlow, callbacks: FlowExecutorCallbacks) -> None:
        self._flow = flow
        self._cb = callbacks

    def _node_label(self, node: FlowNode) -> str:
        """计算节点的中文显示名称（用于调试信息展示）。"""
        if node.type == NodeType.START:
            return "开始"
        if node.type == NodeType.DIALOG:
            data = node.as_dialog()
            content = ""
            if data.mode == DialogMode.SCRIPT:
                content = (data.text or "")[:20]
            else:
                content = (data.prompt or "")[:20]
            suffix = f": {content}" if content else ""
            return f"对话({data.mode.value}){suffix}"
        if node.type == NodeType.DECISION:
            data = node.as_decision()
            return f"判断({data.mode.value})"
        if node.type == NodeType.ACTION:
            data = node.as_action()
            return f"动作({data.action_type.value})"
        if node.type == NodeType.END:
            data = node.as_end()
            return f"结束({data.mode.value})"
        return str(node.type)

    async def run(self, call_id: str) -> None:
        entry = self._flow.find_entry()
        if not entry:
            raise ValueError(f"flow {self._flow.id} has no start node")

        current_id = entry.id
        last_response = ""
        step_limit = max(100, len(self._flow.nodes) * 4)

        for _step in range(step_limit):
            if self._cb.is_ended(call_id):
                return

            node = self._flow.node_by_id(current_id)
            if not node:
                raise ValueError(f"flow node not found: {current_id}")

            await self._cb.on_node_enter(call_id, node.id, self._node_label(node))
            node_response = await self._execute_node(call_id, node, last_response)
            if node_response is not None:
                last_response = node_response

            if self._cb.is_ended(call_id):
                return

            candidates = self._flow.outgoing_edges(current_id)
            if not candidates:
                raise ValueError(f"flow node {current_id} has no outgoing edge")

            selected = (
                await self._select_decision_edge(call_id, candidates, last_response)
                if node.type == NodeType.DECISION
                else candidates[0]
            )
            if not selected:
                raise ValueError(f"flow node {current_id} has no matching outgoing edge")
            current_id = selected.target

        raise RuntimeError(f"flow {self._flow.id} exceeded execution step limit")

    async def _execute_node(
        self, call_id: str, node: FlowNode, last_response: str
    ) -> Optional[str]:
        if node.type == NodeType.START:
            return None
        if node.type == NodeType.DIALOG:
            return await self._exec_dialog(call_id, node, last_response)
        if node.type == NodeType.DECISION:
            return await self._exec_decision(call_id, node, last_response)
        if node.type == NodeType.ACTION:
            await self._exec_action(call_id, node)
            return None
        if node.type == NodeType.END:
            await self._exec_end(call_id, node)
            return None
        logger.warning("[FlowExecutor] unknown node type %s, skipping", node.type)
        return None

    async def _exec_dialog(
        self, call_id: str, node: FlowNode, previous_response: str
    ) -> str:
        data = node.as_dialog()
        variables = self._cb.get_session_variables(call_id)

        spoken_text = ""
        if data.mode == DialogMode.SCRIPT:
            spoken_text = render_template(str(data.text or ""), variables)
        elif data.mode == DialogMode.QUESTION:
            spoken_text = render_template(str(data.prompt or ""), variables)
        elif data.mode == DialogMode.AI:
            spoken_text = await self._generate_ai_dialog_text(call_id, data, variables)

        if spoken_text:
            self._cb.get_session_messages(call_id).append(
                ChatMessage(role="assistant", content=spoken_text)
            )
            await self._cb.speak(call_id, spoken_text)

        response = previous_response
        should_wait = data.wait_for_response or data.mode == DialogMode.QUESTION
        if should_wait:
            retry = max(1, data.retry_count or (1 if data.mode == DialogMode.QUESTION else 0))
            for attempt in range(retry):
                response = await self._cb.wait_for_user_speech(call_id)
                if response.strip():
                    await self._cb.on_caller_speech(call_id, response)
                    self._cb.get_session_messages(call_id).append(
                        ChatMessage(role="user", content=response)
                    )
                    break
                if attempt < retry - 1 and spoken_text:
                    await self._cb.speak(call_id, "请问您还在吗？")

        return response

    async def _generate_ai_dialog_text(
        self, call_id: str, data: Any, variables: dict[str, str]
    ) -> str:
        messages = list(self._cb.get_session_messages(call_id))
        if data.system_prompt:
            messages.append(
                ChatMessage(
                    role="system",
                    content=render_template(str(data.system_prompt), variables),
                )
            )
        if data.prompt:
            messages.append(
                ChatMessage(
                    role="user",
                    content=(
                        "请根据以下流程节点提示，生成一句适合直接对客户说的话。"
                        "只输出话术正文，不要解释。\n"
                        f"节点提示：{render_template(str(data.prompt), variables)}"
                    ),
                )
            )
        if not data.prompt and not data.system_prompt:
            messages.append(
                ChatMessage(
                    role="user",
                    content="请生成一句适合当前流程节点直接对客户说的话。",
                )
            )
        return await self._cb.generate_llm_text(
            call_id, messages, {"temperature": data.temperature}
        )

    async def _exec_decision(
        self, call_id: str, node: FlowNode, last_response: str
    ) -> str:
        data = node.as_decision()

        if data.mode == DecisionMode.CONDITION:
            return self._eval_condition(data.expression or "", last_response)

        matched = self._match_intent_by_keyword(data.intents, last_response)
        if matched:
            return matched

        if data.intents and last_response.strip():
            classified = await self._classify_intent_llm(call_id, data.intents, last_response)
            return classified or last_response

        return last_response

    def _eval_condition(self, expression: str, response: str) -> str:
        expr = expression.strip()
        if not expr:
            return ""
        try:
            if "includes(" in expr:
                match = re.search(r"includes\(['\"](.+?)['\"]\)", expr)
                if match:
                    return "true" if match.group(1) in response else "false"
            if "==" in expr:
                match = re.search(r"==\s*['\"](.+?)['\"]", expr)
                if match:
                    return "true" if response.strip() == match.group(1) else "false"
        except Exception as err:
            logger.warning("[FlowExecutor] condition eval failed: %s (expr=%s)", err, expr)
        return "false"

    def _match_intent_by_keyword(self, intents: list[str], response: str) -> str:
        normalized = response.casefold()
        for intent in intents:
            if intent.casefold() in normalized:
                return intent
        return ""

    async def _classify_intent_llm(
        self, call_id: str, intents: list[str], response: str
    ) -> str:
        intent_list = "/".join(intents)
        prompt_msg = ChatMessage(
            role="system",
            content=(
                "你是意图分类器。请从下列意图中选择最匹配的一项，"
                "只输出意图名，不要输出其它内容。\n"
                f"意图列表：{intent_list}\n用户说：{response}"
            ),
        )
        try:
            result = await self._cb.generate_llm_text(
                call_id, [prompt_msg], {"temperature": 0}
            )
            result = result.strip()
            for intent in intents:
                if intent in result:
                    return intent
        except Exception as err:
            logger.warning("[FlowExecutor] LLM intent classify failed: %s", err)
        return ""

    async def _select_decision_edge(
        self, call_id: str, edges: list[FlowEdge], response: str
    ) -> Optional[FlowEdge]:
        normalized = response.casefold()
        fallback: Optional[FlowEdge] = None
        for edge in edges:
            if not edge.label:
                fallback = edge
                continue
            label = edge.label.strip()
            if label.casefold() in {"default", "else", "默认", "其他"}:
                fallback = edge
                continue
            tokens = [t.strip().casefold() for t in re.split(r"[/|,，、\s]+", label)]
            if any(token and token in normalized for token in tokens):
                return edge
        return fallback

    async def _exec_action(self, call_id: str, node: FlowNode) -> None:
        data = node.as_action()

        if data.action_type == ActionType.TRANSFER:
            reason = str(data.config.get("reason", "flow requested transfer"))
            extension = data.config.get("extension") or data.config.get("queueId")
            escalated = await self._cb.on_escalate(
                call_id,
                reason,
                str(extension) if extension else None,
            )
            if escalated:
                self._cb.mark_escalated(call_id)
            logger.info(
                "[FlowExecutor] transfer: call=%s reason=%s ext=%s",
                call_id,
                reason,
                extension,
            )
            return

        if data.action_type == ActionType.SMS:
            accepted = await self._cb.dispatch_action(
                call_id, "sms", dict(data.config), str(uuid4())
            )
            if not accepted:
                raise RuntimeError("sms action was not accepted by task control plane")
            logger.info("[FlowExecutor] sms action enqueued: call=%s", call_id)
            return

        if data.action_type == ActionType.CRM:
            accepted = await self._cb.dispatch_action(
                call_id, "crm", dict(data.config), str(uuid4())
            )
            if accepted:
                logger.info("[FlowExecutor] crm action handled by callback: call=%s", call_id)
                return

            tool_name = str(data.config.get("action") or data.config.get("toolName") or "crm")
            call = ToolCall(
                id=str(uuid4()),
                name=tool_name,
                arguments=dict(data.config.get("arguments", data.config)),
            )
            result = await self._cb.dispatch_tool(call_id, call)
            await self._cb.on_tool_call(call_id, call, result)
            if getattr(result, "should_escalate", False):
                await self._cb.on_escalate(
                    call_id,
                    f"CRM action {tool_name} requested transfer",
                )
                self._cb.mark_escalated(call_id)
            return

        if data.action_type == ActionType.API:
            accepted = await self._cb.dispatch_action(
                call_id, "api", dict(data.config), str(uuid4())
            )
            if not accepted:
                raise RuntimeError("api action was not accepted by task control plane")
            logger.info("[FlowExecutor] api action enqueued: call=%s", call_id)
            return

    async def _exec_end(self, call_id: str, node: FlowNode) -> None:
        data = node.as_end()
        variables = self._cb.get_session_variables(call_id)

        if data.farewell:
            await self._cb.speak(call_id, render_template(str(data.farewell), variables))

        if data.mode == EndMode.HANGUP:
            await self._cb.hangup_call(call_id)

        self._cb.mark_ended(call_id)
        logger.info(
            "[FlowExecutor] end: call=%s mode=%s reason=%s",
            call_id,
            data.mode.value,
            data.reason,
        )
