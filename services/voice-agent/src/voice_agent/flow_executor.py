"""Runtime executor for published task-flow snapshots.

The voice agent owns audio, LLM, and session state. This executor only walks the
flow graph and delegates side effects through callbacks so control-plane actions
(SMS/API/outbox, transfer, hangup) remain centralized in NestJS.
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Optional, Protocol
from uuid import uuid4

from .dialog_router import (
    DialogRouteRequest,
    DialogTurnCommand,
    DialogTurnResult,
    DialogTurnRouter,
    IntentDefinition,
    TurnRoute,
)
from .repair_phrases import ACTION_TRANSFER, BRIDGE_NATURAL, RepairPhrases
from .flow_types import (
    ActionType,
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
# 所有分支判断都配置在 edge 上，统一使用这一组默认分支标签。
_FALLBACK_LABELS = {"default", "else", "默认", "其他"}

_TRAILING_SPEECH_PARTICLES = "了啦呀啊哦哈"
_UNCERTAIN_SPEECH_PARTICLES = "吧呢嘛"


def _is_fallback_edge(edge: "FlowEdge") -> bool:
    """判断一条边是否为兜底/默认出口。"""
    if not edge.label:
        return True
    return edge.label.strip().casefold() in _FALLBACK_LABELS


def _normalize_utterance(text: str) -> str:
    """Normalize only semantically neutral surface variation for exact matching."""
    normalized = re.sub(r"[\s，。！？、,.!?；;：:'\"“”‘’]", "", text.casefold())
    while len(normalized) > 1 and normalized[-1] in _TRAILING_SPEECH_PARTICLES:
        normalized = normalized[:-1]
    return normalized


def _is_safe_exact_utterance(text: str) -> bool:
    """Keep questions and tentative speech on the semantic-router path."""
    if "?" in text or "？" in text:
        return False
    terminal = re.sub(r"[\s，。！、,.!；;：:'\"“”‘’]+$", "", text.casefold())
    return bool(terminal) and terminal[-1] not in _UNCERTAIN_SPEECH_PARTICLES


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return min(maximum, max(minimum, value))


@dataclass(slots=True)
class _DialogNodeState:
    """Ephemeral repair frame for one execution of one dialog node."""

    no_input_count: int = 0
    no_match_count: int = 0
    repair_turns: int = 0
    router_failure_count: int = 0
    pending_business: DialogTurnCommand | None = None
    pending_other: DialogTurnCommand | None = None
    awaiting_side_question: bool = False


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
    async def classify_dialog_turn(
        self,
        call_id: str,
        messages: list[ChatMessage],
        schema: dict[str, Any],
    ) -> dict[str, Any] | str: ...
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

    def __init__(
        self,
        flow: TaskFlow,
        callbacks: FlowExecutorCallbacks,
        embed_provider: Any = None,
        repair: RepairPhrases | None = None,
    ) -> None:
        self._flow = flow
        self._cb = callbacks
        # 场景级修复话术（无应答/没听懂/插问承接等），未配置时用内置默认。
        self._repair = repair or RepairPhrases()
        self._validate_routing_config()
        # Retained as a constructor argument for source compatibility.  Cloud
        # embeddings are intentionally no longer placed in the hot path: they
        # add latency and cannot represent compound dialogue acts reliably.
        self._legacy_embed_provider = embed_provider
        self._turn_router = DialogTurnRouter()
        self._resolved_turns: dict[tuple[str, str], DialogTurnResult] = {}
        self._router_enabled = (
            os.getenv("DIALOG_ROUTER_ENABLED", "true").strip().lower() != "false"
        )
        self._max_repair_turns = _env_int(
            "DIALOG_ROUTER_MAX_REPAIR_TURNS", 4, 1, 10
        )
        self._max_no_match = _env_int("DIALOG_ROUTER_MAX_NO_MATCH", 2, 1, 6)
        self._max_no_input = _env_int("DIALOG_ROUTER_MAX_NO_INPUT", 2, 1, 6)
        self._max_system_retries = _env_int(
            "DIALOG_ROUTER_MAX_SYSTEM_RETRIES", 1, 0, 3
        )

    def _validate_routing_config(self) -> None:
        """Reject graph ambiguity before a call can execute the wrong edge."""
        edge_ids: set[str] = set()
        duplicate_ids: set[str] = set()
        fallback_counts: dict[str, int] = {}
        for edge in self._flow.edges:
            if edge.id in edge_ids:
                duplicate_ids.add(edge.id)
            edge_ids.add(edge.id)
            if _is_fallback_edge(edge):
                fallback_counts[edge.source] = fallback_counts.get(edge.source, 0) + 1

        if duplicate_ids:
            duplicate_list = ", ".join(sorted(duplicate_ids))
            raise ValueError(f"flow {self._flow.id} has duplicate edge ids: {duplicate_list}")

        ambiguous_nodes = sorted(
            source for source, count in fallback_counts.items() if count > 1
        )
        if ambiguous_nodes:
            node_list = ", ".join(ambiguous_nodes)
            raise ValueError(
                f"flow {self._flow.id} has multiple fallback edges from: {node_list}"
            )

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
        if node.type == NodeType.ACTION:
            data = node.as_action()
            return f"动作({data.action_type.value})"
        if node.type == NodeType.END:
            data = node.as_end()
            return f"结束({data.mode.value})"
        return str(node.type)

    def _log_intent(
        self, call_id: str, node_id: str, tier: str, text: str, intent: str, detail: str = ""
    ) -> None:
        """结构化输出每次意图判定，供调参与后续训练数据采集。

        detail 为可选后缀（如 embed 层的 " (top=0.810 margin=0.120)"）。
        """
        logger.info(
            "[Intent] call_id=%s node=%s tier=%s text=%s -> intent=%s%s",
            call_id,
            node_id,
            tier,
            (text or "")[:50],
            intent,
            detail,
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

            if len(candidates) > 1:
                selected = await self._select_intent_edge(
                    call_id, node.id, candidates, last_response
                )
            else:
                selected = candidates[0]
            if not selected:
                if node.type == NodeType.DIALOG:
                    # Waiting dialogs consume no-match/no-input inside the
                    # current node. Reaching here means a provider/configuration
                    # failure; fail closed instead of re-entering or picking an
                    # arbitrary business edge.
                    await self._speak_and_record(
                        call_id, self._repair.render("no_match_give_up_prompt")
                    )
                    self._cb.mark_ended(call_id)
                    logger.warning(
                        "[FlowExecutor] ending after repeated unmatched intent: "
                        "call=%s node=%s",
                        call_id,
                        node.id,
                    )
                    return
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
        if node.type == NodeType.ACTION:
            await self._exec_action(call_id, node)
            return None
        if node.type == NodeType.END:
            await self._exec_end(call_id, node)
            return None
        logger.warning("[FlowExecutor] unknown node type %s, skipping", node.type)
        return None

    async def _speak_and_record(self, call_id: str, text: str) -> None:
        """Keep spoken assistant turns and the LLM conversation history aligned."""
        if not text:
            return
        self._cb.get_session_messages(call_id).append(
            ChatMessage(role="assistant", content=text)
        )
        await self._cb.speak(call_id, text)

    def _routing_spec(
        self, edges: list[FlowEdge]
    ) -> tuple[Optional[FlowEdge], tuple[IntentDefinition, ...]]:
        """Compile flow configuration into stable edge-id routing definitions."""

        fallback = next((edge for edge in edges if _is_fallback_edge(edge)), None)
        definitions = tuple(
            IntentDefinition(
                intent_id=edge.id,
                label=str(edge.label),
                examples=tuple(edge.intent_examples),
            )
            for edge in edges
            if not _is_fallback_edge(edge) and edge.label
        )
        return fallback, definitions

    @staticmethod
    def _configured_phrases(edge: FlowEdge) -> tuple[str, ...]:
        labels = (
            token.strip()
            for token in re.split(r"[/|,，、]+", str(edge.label or ""))
        )
        return tuple(
            phrase
            for phrase in (*labels, *edge.intent_examples)
            if phrase and phrase.strip()
        )

    def _match_exact_business_edge(
        self, edges: list[FlowEdge], response: str
    ) -> Optional[FlowEdge]:
        """Zero-LLM fast path restricted to exact flow-configured utterances.

        Substring and cloud-embedding matches are deliberately excluded.  They
        cannot safely preserve compound turns such as an answer followed by a
        side question.  Ambiguous duplicate examples also fall through to the
        semantic router.
        """

        if not _is_safe_exact_utterance(response):
            return None
        normalized = _normalize_utterance(response)
        if not normalized:
            return None
        matches = [
            edge
            for edge in edges
            if not _is_fallback_edge(edge)
            and any(
                _normalize_utterance(phrase) == normalized
                for phrase in self._configured_phrases(edge)
            )
        ]
        return matches[0] if len(matches) == 1 else None

    def _recent_dialog_history(
        self, call_id: str, latest_utterance: str
    ) -> tuple[tuple[str, str], ...]:
        messages = list(self._cb.get_session_messages(call_id))
        if (
            messages
            and messages[-1].role == "user"
            and messages[-1].content == latest_utterance
        ):
            messages.pop()
        return tuple(
            (message.role, message.content)
            for message in messages
            if message.role in {"assistant", "user"} and message.content
        )[-6:]

    async def _route_dialog_turn(
        self,
        call_id: str,
        node_id: str,
        current_question: str,
        response: str,
        definitions: tuple[IntentDefinition, ...],
        *,
        state: _DialogNodeState | None = None,
    ) -> DialogTurnResult:
        if not self._router_enabled or not definitions:
            return DialogTurnResult.unanswered()

        async def invoke(request: DialogRouteRequest) -> dict[str, Any] | str:
            messages = [
                ChatMessage(role="system", content=request.system_prompt),
                ChatMessage(role="user", content=request.user_text),
            ]
            classifier = getattr(self._cb, "classify_dialog_turn", None)
            if callable(classifier):
                return await classifier(call_id, messages, request.schema)
            # Compatibility for callback implementations predating structured
            # tool calls. Strict parsing still prevents prose from advancing.
            return await self._cb.generate_llm_text(
                call_id, messages, {"temperature": 0}
            )

        started = time.perf_counter()
        result = await self._turn_router.classify(
            current_question=current_question,
            caller_utterance=response,
            intents=definitions,
            invoke=invoke,
            recent_history=self._recent_dialog_history(call_id, response),
            dialog_state=(
                "AWAITING_SIDE_QUESTION"
                if state and state.awaiting_side_question
                else "AWAITING_BUSINESS_ANSWER"
            ),
            pending_business_intent=(
                state.pending_business.value
                if state and state.pending_business
                else None
            ),
        )
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "[TurnRouter] call_id=%s node=%s latency_ms=%.1f commands=%s",
            call_id,
            node_id,
            elapsed_ms,
            [
                {
                    "type": command.route.value,
                    "value": command.value,
                    "confidence": round(command.confidence, 3),
                }
                for command in result.commands
            ],
        )
        return result

    async def _answer_side_question(
        self,
        call_id: str,
        node_id: str,
        question: str,
        resume_prompt: str = "",
    ) -> None:
        history = list(self._cb.get_session_messages(call_id))
        if history and history[-1].role == "user":
            history.pop()
        natural_bridge = (
            bool(resume_prompt)
            and self._repair.side_question_bridge == BRIDGE_NATURAL
        )
        instruction = (
            "客户正在主流程中插问。请基于系统上下文和知识库准确、简短地回答，"
            "不推测未知事实。"
        )
        if natural_bridge:
            # 承接回主线由 LLM 在同一次生成中完成：提示词可按场景配置
            # （sideQuestionResumePrompt），默认要求语义等价、措辞自然，
            # 避免「答案 + 固定转折语 + 原话术复读」的拼接感。
            instruction += self._repair.render(
                "side_question_resume_prompt", resume_prompt
            )
        instruction += "只输出一段可以直接播报的完整话术。"
        messages = [
            *history,
            ChatMessage(role="system", content=instruction),
            ChatMessage(role="user", content=question),
        ]
        try:
            # Side questions have an isolated capability boundary. Business
            # tools must never execute before a flow transition is committed.
            reply = await self._cb.generate_reply(call_id, messages, [])
        except Exception as err:
            logger.warning(
                "[TurnRouter] side-question failed: call=%s node=%s err=%s",
                call_id,
                node_id,
                err,
            )
            reply = ""
        if self._cb.is_ended(call_id):
            return

        reply = reply.strip()
        if not reply:
            # LLM 失败时退回拼接模式：兜底话术 + 模板承接，保证未答的问题
            # 一定会被重新提出，不因生成失败丢失主线。
            reply = self._repair.render("side_question_fallback_prompt")
            natural_bridge = False
        if resume_prompt and not natural_bridge:
            bridge = self._repair.render(
                "side_question_bridge_template", resume_prompt
            )
            reply = f"{reply} {bridge}".strip()
        await self._speak_and_record(call_id, reply)

    async def _silence_reprompt(
        self, call_id: str, node_id: str, question: str
    ) -> str:
        """静默追问话术：由 LLM 按场景配置的静默提示词生成，失败回退固定模板。

        默认提示词要求「复述上一轮对话的内容 + 保证上下文自然衔接」，即未配置
        时依然执行这两项；生成失败或输出为空时回退 no_input_prompt 固定模板，
        保证追问一定会发生。
        """
        requirements = self._repair.silence_prompt
        instruction = (
            "客户在你说完上一句话后一直保持沉默。请生成一句简短口语化的追问，"
            "唤起客户注意并推进对话。要求：\n"
            f"{requirements}\n"
        )
        if question.strip():
            instruction += f"当前等待客户回答的问题：「{question.strip()}」\n"
        instruction += "只输出一段可以直接播报的话术。"
        messages = [
            *self._cb.get_session_messages(call_id),
            ChatMessage(role="system", content=instruction),
        ]
        try:
            reply = (await self._cb.generate_reply(call_id, messages, [])).strip()
        except Exception as err:
            logger.warning(
                "[FlowExecutor] silence reprompt failed: call=%s node=%s err=%s",
                call_id,
                node_id,
                err,
            )
            reply = ""
        return reply or self._repair.render("no_input_prompt", question)

    async def _handle_silence_exhausted(self, call_id: str) -> None:
        """连续静默超限：按场景配置执行挂机或转人工。"""
        if self._repair.silence_action == ACTION_TRANSFER:
            await self._speak_and_record(
                call_id, self._repair.render("silence_transfer_prompt")
            )
            try:
                await self._cb.on_escalate(call_id, "连续静默超限转人工")
            except Exception as err:
                logger.warning(
                    "[FlowExecutor] silence transfer failed: call=%s err=%s",
                    call_id,
                    err,
                )
        else:
            await self._speak_and_record(
                call_id, self._repair.render("no_input_give_up_prompt")
            )
        self._cb.mark_ended(call_id)

    @staticmethod
    def _pending_result(state: _DialogNodeState) -> DialogTurnResult | None:
        command = state.pending_business or state.pending_other
        return DialogTurnResult((command,)) if command else None

    def _cache_turn(
        self, call_id: str, node_id: str, result: DialogTurnResult
    ) -> None:
        self._resolved_turns[(call_id, node_id)] = result

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
            await self._speak_and_record(call_id, spoken_text)

        should_wait = data.wait_for_response or data.mode == DialogMode.QUESTION
        if not should_wait:
            return previous_response

        edges = self._flow.outgoing_edges(node.id)
        fallback, definitions = self._routing_spec(edges)
        # 静默轮数预算优先级：节点 retryCount > 场景 maxSilenceRounds > env 默认
        if data.retry_count is not None:
            no_input_budget = max(0, data.retry_count)
        elif self._repair.max_silence_rounds > 0:
            no_input_budget = self._repair.max_silence_rounds
        else:
            no_input_budget = self._max_no_input

        # A single/unconditional continuation needs no semantic decision, but
        # still shares the same no-input policy as branched dialogs.
        if len(edges) <= 1 or not definitions:
            for attempt in range(no_input_budget + 1):
                response = await self._cb.wait_for_user_speech(call_id)
                if response.strip():
                    await self._cb.on_caller_speech(call_id, response)
                    self._cb.get_session_messages(call_id).append(
                        ChatMessage(role="user", content=response)
                    )
                    return response
                if attempt < no_input_budget:
                    await self._speak_and_record(
                        call_id,
                        await self._silence_reprompt(call_id, node.id, spoken_text),
                    )
            return ""

        state = _DialogNodeState()
        response = previous_response

        while not self._cb.is_ended(call_id):
            response = await self._cb.wait_for_user_speech(call_id)
            if self._cb.is_ended(call_id):
                return response

            if not response.strip():
                state.no_input_count += 1
                if state.no_input_count <= no_input_budget:
                    if state.awaiting_side_question:
                        retry_prompt = self._repair.render(
                            "question_request_ack_prompt"
                        )
                    else:
                        retry_prompt = await self._silence_reprompt(
                            call_id, node.id, spoken_text
                        )
                    await self._speak_and_record(call_id, retry_prompt)
                    continue
                pending = self._pending_result(state)
                if pending:
                    self._cache_turn(call_id, node.id, pending)
                    return response
                await self._handle_silence_exhausted(call_id)
                return response

            state.no_input_count = 0
            await self._cb.on_caller_speech(call_id, response)
            self._cb.get_session_messages(call_id).append(
                ChatMessage(role="user", content=response)
            )

            exact_edge = (
                None
                if state.awaiting_side_question
                else self._match_exact_business_edge(edges, response)
            )
            if exact_edge:
                result = DialogTurnResult(
                    (
                        DialogTurnCommand(
                            TurnRoute.BUSINESS_INTENT, exact_edge.id, 1.0
                        ),
                    )
                )
                self._cache_turn(call_id, node.id, result)
                self._log_intent(
                    call_id, node.id, "exact", response, exact_edge.id
                )
                return response

            result = await self._route_dialog_turn(
                call_id,
                node.id,
                spoken_text,
                response,
                definitions,
                state=state,
            )
            if result.failure_kind:
                state.router_failure_count += 1
                logger.warning(
                    "[TurnRouter] call_id=%s node=%s failure_kind=%s attempt=%d",
                    call_id,
                    node.id,
                    result.failure_kind,
                    state.router_failure_count,
                )
                if state.router_failure_count <= self._max_system_retries:
                    await self._speak_and_record(
                        call_id, self._repair.render("stt_retry_prompt")
                    )
                    continue
                if self._pending_result(state):
                    logger.warning(
                        "[TurnRouter] discarded pending intent after provider failure: "
                        "call=%s node=%s",
                        call_id,
                        node.id,
                    )
                await self._speak_and_record(
                    call_id, self._repair.render("stt_give_up_prompt")
                )
                self._cb.mark_ended(call_id)
                return response
            state.router_failure_count = 0
            new_business = next(
                (
                    command
                    for command in result.commands
                    if command.route is TurnRoute.BUSINESS_INTENT
                ),
                None,
            )
            new_other = next(
                (
                    command
                    for command in result.commands
                    if command.route is TurnRoute.OTHER_ANSWER
                ),
                None,
            )
            accepted_pending = False
            if new_business:
                state.pending_business = new_business
                state.pending_other = None
                # In AWAITING_SIDE_QUESTION, the prompt only permits a business
                # result for an explicit correction, so it safely replaces the
                # previously pending answer.
                state.awaiting_side_question = False
                accepted_pending = True
            elif (
                new_other
                and not state.awaiting_side_question
                and fallback is not None
            ):
                # A newer valid answer supersedes a tentative business answer
                # retained across HOLD/REPEAT; never silently commit stale intent.
                state.pending_business = None
                state.pending_other = new_other
                accepted_pending = True

            repair_commands = [
                command
                for command in result.commands
                if command.route
                in {
                    TurnRoute.HOLD,
                    TurnRoute.REPEAT,
                    TurnRoute.BACKCHANNEL,
                    TurnRoute.QUESTION_REQUEST,
                    TurnRoute.SIDE_QUESTION,
                }
            ]
            if repair_commands:
                state.no_match_count = 0
                state.repair_turns += 1
                repair_routes = {command.route for command in repair_commands}
                if state.repair_turns > self._max_repair_turns:
                    pending = self._pending_result(state)
                    if pending:
                        if TurnRoute.SIDE_QUESTION in repair_routes:
                            await self._speak_and_record(
                                call_id,
                                self._repair.render("side_question_defer_prompt"),
                            )
                        self._cache_turn(call_id, node.id, pending)
                        return response
                    state.no_match_count = self._max_no_match + 1
                else:
                    if TurnRoute.SIDE_QUESTION in repair_routes:
                        side_question = next(
                            command
                            for command in repair_commands
                            if command.route is TurnRoute.SIDE_QUESTION
                        )
                        state.awaiting_side_question = False
                        await self._answer_side_question(
                            call_id,
                            node.id,
                            side_question.value or response,
                            "" if self._pending_result(state) else spoken_text,
                        )
                    elif TurnRoute.REPEAT in repair_routes:
                        state.awaiting_side_question = False
                        await self._speak_and_record(
                            call_id,
                            self._repair.render("repeat_ack_prompt", spoken_text),
                        )
                    elif TurnRoute.QUESTION_REQUEST in repair_routes:
                        state.awaiting_side_question = True
                        await self._speak_and_record(
                            call_id,
                            self._repair.render("question_request_ack_prompt"),
                        )
                    elif TurnRoute.HOLD in repair_routes:
                        await self._speak_and_record(
                            call_id, self._repair.render("hold_ack_prompt")
                        )
                    # BACKCHANNEL alone is intentionally silent: it keeps the
                    # node open without pretending the slot was answered.
                    if self._cb.is_ended(call_id):
                        return response
                    pending_after_backchannel = self._pending_result(state)
                    if (
                        pending_after_backchannel
                        and repair_routes <= {TurnRoute.BACKCHANNEL}
                        and not state.awaiting_side_question
                    ):
                        self._cache_turn(
                            call_id, node.id, pending_after_backchannel
                        )
                        return response
                    pending_after_side = self._pending_result(state)
                    if any(
                        command.route is TurnRoute.SIDE_QUESTION
                        for command in repair_commands
                    ) and pending_after_side:
                        self._cache_turn(call_id, node.id, pending_after_side)
                        return response
                    continue

            if accepted_pending:
                pending = self._pending_result(state)
                if pending:
                    self._cache_turn(call_id, node.id, pending)
                    return response

            # UNANSWERED and OTHER without a fallback are explicit no-match
            # states. They stay in this node and never select the first edge.
            state.no_match_count += 1
            if state.no_match_count <= self._max_no_match:
                await self._speak_and_record(
                    call_id, self._repair.render("no_match_prompt", spoken_text)
                )
                continue

            pending = self._pending_result(state)
            if pending:
                self._cache_turn(call_id, node.id, pending)
                return response
            await self._speak_and_record(
                call_id, self._repair.render("no_match_give_up_prompt")
            )
            self._cb.mark_ended(call_id)
            return response

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

    async def _select_intent_edge(
        self,
        call_id: str,
        node_id: str,
        edges: list[FlowEdge],
        response: str,
    ) -> Optional[FlowEdge]:
        """Commit a validated semantic decision to one stable edge id."""

        fallback, definitions = self._routing_spec(edges)
        result = self._resolved_turns.pop((call_id, node_id), None)

        if result is None:
            exact = self._match_exact_business_edge(edges, response)
            if exact:
                return exact
            if not definitions:
                return fallback
            if not response.strip():
                return None

            node = self._flow.node_by_id(node_id)
            current_question = ""
            if node and node.type is NodeType.DIALOG:
                data = node.as_dialog()
                template = data.prompt if data.mode is DialogMode.QUESTION else data.text
                current_question = render_template(
                    str(template or ""), self._cb.get_session_variables(call_id)
                )
            result = await self._route_dialog_turn(
                call_id, node_id, current_question, response, definitions
            )

        business_id = result.business_intent
        if business_id:
            selected = next((edge for edge in edges if edge.id == business_id), None)
            if selected and not _is_fallback_edge(selected):
                return selected
            logger.warning(
                "[FlowExecutor] rejected unknown/fallback business edge: call=%s node=%s edge=%s",
                call_id,
                node_id,
                business_id,
            )
            return None

        if any(
            command.route is TurnRoute.OTHER_ANSWER
            for command in result.commands
        ):
            return fallback

        logger.warning(
            "[FlowExecutor] no transition for dialog turn: call=%s node=%s commands=%s",
            call_id,
            node_id,
            [command.route.value for command in result.commands],
        )
        return None

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
