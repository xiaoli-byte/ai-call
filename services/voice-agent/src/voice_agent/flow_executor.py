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

# fallback（兜底/默认）边的 label 判定：无 label 或 label 属于下列关键字。
# 抽成模块级常量+helper，让 _exec_decision 的 has_fallback 判定与
# _select_decision_edge 的 fallback 边选择共用同一份逻辑，防止两处漂移。
_FALLBACK_LABELS = {"default", "else", "默认", "其他"}

# 否定词：意图关键字紧邻其后时，keyword 层不足以判定语义（如"不满意"含"满意"），
# 交由 LLM 层裁决。
_NEGATION_CHARS = "不没别未非"


def _is_fallback_edge(edge: "FlowEdge") -> bool:
    """判断一条边是否为兜底/默认出口。"""
    if not edge.label:
        return True
    return edge.label.strip().casefold() in _FALLBACK_LABELS


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
    """Replace ${var} placeholders and leave unknown placeholders unchanged."""

    def replace(match: re.Match[str]) -> str:
        key = match.group(1) or match.group(2) or match.group(3)
        return variables.get(key, match.group(0))

    return re.sub(r"\$\{(\w+)\}|\{\{(\w+)\}\}|\{(\w+)\}", replace, text)


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

    def _log_intent(
        self, call_id: str, node_id: str, tier: str, text: str, intent: str
    ) -> None:
        """结构化输出每次意图判定，供调参与后续训练数据采集。"""
        logger.info(
            "[Intent] call_id=%s node=%s tier=%s text=%s -> intent=%s",
            call_id,
            node_id,
            tier,
            (text or "")[:50],
            intent,
        )

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
            self._log_intent(call_id, node.id, "keyword", last_response, matched)
            return matched

        # intents 为空或用户无有效输入：保持原早退语义，交给边匹配/兜底。
        if not data.intents or not last_response.strip():
            return last_response

        # 有无兜底边决定 LLM 是否提供"其他"逃生口，以及最终兜底策略。
        has_fallback = any(
            _is_fallback_edge(e) for e in self._flow.outgoing_edges(node.id)
        )

        classified = await self._classify_intent_llm(
            call_id, data.intents, last_response, has_fallback
        )
        if classified:
            self._log_intent(call_id, node.id, "llm", last_response, classified)
            return classified

        # keyword 与 LLM 均无结果：电话进行中，错分支比抛异常炸掉整通电话轻。
        if has_fallback:
            self._log_intent(call_id, node.id, "fallback", last_response, "其他")
            return "其他"
        forced = data.intents[0]
        logger.warning(
            "[FlowExecutor] intent 无法分类，强制走首个意图分支: call=%s node=%s text=%s",
            call_id,
            node.id,
            (last_response or "")[:50],
        )
        self._log_intent(call_id, node.id, "forced", last_response, forced)
        return forced

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
        # 最长优先：先匹配更长的意图，避免"满意"抢先命中"不满意"。
        intents_cf = {i.casefold() for i in intents}
        for intent in sorted(intents, key=len, reverse=True):
            needle = intent.casefold()
            if not needle:
                continue
            start = 0
            while True:
                idx = normalized.find(needle, start)
                if idx < 0:
                    break
                if idx == 0:
                    return intent
                prev = normalized[idx - 1]
                # 否定守卫：命中处紧邻否定字，且"否定字+意图"不是列表里的另一个意图
                # （若是另一个意图，最长优先已让它先命中），本层无法定性 → 让 LLM 层裁决。
                if prev in _NEGATION_CHARS and (prev + needle) not in intents_cf:
                    start = idx + 1
                    continue
                return intent
        return ""

    async def _classify_intent_llm(
        self, call_id: str, intents: list[str], response: str, has_fallback: bool
    ) -> str:
        # 有兜底边时额外给"其他"逃生口，避免用户说无关内容被强行 N 选一。
        options = list(intents) + (["其他"] if has_fallback else [])
        escape_hint = (
            "若用户所说与所有意图都不相关，请选择“其他”。\n" if has_fallback else ""
        )
        prompt_msg = ChatMessage(
            role="system",
            content=(
                "你是意图分类器。请从下列选项中选择最匹配的一项，"
                "只输出选项名，不要输出其它内容。\n"
                f"选项：{'/'.join(options)}\n"
                f"{escape_hint}"
                f"用户说：{response}"
            ),
        )
        try:
            result = await self._cb.generate_llm_text(
                call_id, [prompt_msg], {"temperature": 0}
            )
            result = result.strip()
            # 精确匹配优先，彻底绕开子串误命中。
            for intent in intents:
                if result == intent:
                    return intent
            # 再按意图长度降序做子串匹配（LLM 输出带额外解释时的兜底）。
            for intent in sorted(intents, key=len, reverse=True):
                if intent and intent in result:
                    return intent
            if has_fallback and (
                "其他" in result or "无法判断" in result or "都不" in result
            ):
                return "其他"
        except Exception as err:
            logger.warning("[FlowExecutor] LLM intent classify failed: %s", err)
        return ""

    async def _select_decision_edge(
        self, call_id: str, edges: list[FlowEdge], response: str
    ) -> Optional[FlowEdge]:
        fallback: Optional[FlowEdge] = None
        resp_norm = response.strip().casefold()

        # 第一遍：label 与 response 精确相等的边直接返回。
        # 分类后的意图名走这条，彻底绕开子串问题（"不满意" 不会误命中 "满意" 边）。
        for edge in edges:
            if _is_fallback_edge(edge):
                fallback = edge
                continue
            if edge.label.strip().casefold() == resp_norm:
                return edge

        # 第二遍：兼容原始文本路径。收集所有 (token, edge)，token 按长度降序，
        # 第一个被 response 包含的 token 胜出，避免短 token 抢先。
        normalized = response.casefold()
        token_edges: list[tuple[str, FlowEdge]] = []
        for edge in edges:
            if _is_fallback_edge(edge):
                continue
            for raw in re.split(r"[/|,，、\s]+", edge.label):
                token = raw.strip().casefold()
                if token:
                    token_edges.append((token, edge))
        token_edges.sort(key=lambda te: len(te[0]), reverse=True)
        for token, edge in token_edges:
            if token in normalized:
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
