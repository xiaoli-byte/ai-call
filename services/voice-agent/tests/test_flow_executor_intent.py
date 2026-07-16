"""Regression tests for structured dialog routing and node-local repair."""

from __future__ import annotations

from typing import Any

import pytest

from voice_agent.dialog_router import ROUTER_PROTOCOL_VERSION
from voice_agent.flow_executor import FlowExecutor
from voice_agent.flow_types import (
    DialogMode,
    DialogNodeData,
    EndNodeData,
    FlowEdge,
    FlowNode,
    NodeType,
    StartNodeData,
    TaskFlow,
)
from voice_agent.types import ChatMessage


def _command(kind: str, value: str | None, confidence: float = 0.95) -> dict[str, Any]:
    return {"type": kind, "value": value, "confidence": confidence}


def _route(
    *commands: dict[str, Any],
    alternatives: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "protocol_version": ROUTER_PROTOCOL_VERSION,
        "commands": list(commands),
        "alternatives": alternatives or [],
    }


class FakeFlowCallbacks:
    def __init__(
        self,
        user_replies: str | list[str] = "",
        router_results: dict[str, Any] | str | list[dict[str, Any] | str] | None = None,
        generated_reply: str = "",
    ) -> None:
        self.user_replies = (
            list(user_replies) if isinstance(user_replies, list) else [user_replies]
        )
        if router_results is None:
            self.router_results: list[dict[str, Any] | str] = []
        elif isinstance(router_results, list):
            self.router_results = list(router_results)
        else:
            self.router_results = [router_results]
        self.generated_reply = generated_reply
        self._ended = False
        self._messages: list[ChatMessage] = []
        self.entered_nodes: list[str] = []
        self.hung_up = False
        self.router_calls = 0
        self.generate_reply_calls = 0
        self.spoken: list[str] = []
        self.caller_speech: list[str] = []
        self.router_messages: list[list[ChatMessage]] = []
        self.router_schemas: list[dict[str, Any]] = []
        self.reply_tools: list[list] = []
        self.reply_messages: list[list[ChatMessage]] = []
        self.escalations: list[str] = []

    async def speak(self, call_id: str, text: str) -> None:
        self.spoken.append(text)

    async def wait_for_user_speech(self, call_id: str) -> str:
        return self.user_replies.pop(0) if self.user_replies else ""

    async def generate_reply(self, call_id, messages, tools=None) -> str:
        self.generate_reply_calls += 1
        self.reply_tools.append(list(tools or []))
        self.reply_messages.append(list(messages))
        return self.generated_reply

    async def generate_llm_text(self, call_id, messages, options=None) -> str:
        return ""

    async def classify_dialog_turn(self, call_id, messages, schema):
        self.router_calls += 1
        self.router_messages.append(list(messages))
        self.router_schemas.append(schema)
        if self.router_results:
            return self.router_results.pop(0)
        return _route(_command("UNANSWERED", None, 0.99))

    async def on_caller_speech(self, call_id: str, text: str) -> None:
        self.caller_speech.append(text)

    async def on_escalate(self, call_id, reason, extension=None) -> bool:
        self.escalations.append(reason)
        return True

    async def on_tool_call(self, call_id, call, result) -> None:
        pass

    async def on_node_enter(self, call_id, node_id, node_name) -> None:
        self.entered_nodes.append(node_id)

    async def on_action(self, call_id, action_type, config) -> None:
        pass

    def get_session_messages(self, call_id: str) -> list[ChatMessage]:
        return self._messages

    def get_session_variables(self, call_id: str) -> dict[str, str]:
        return {}

    def get_session_tools(self, call_id: str) -> list:
        return ["must-not-be-used-for-side-questions"]

    def is_ended(self, call_id: str) -> bool:
        return self._ended

    def mark_ended(self, call_id: str) -> None:
        self._ended = True

    def mark_escalated(self, call_id: str) -> None:
        pass

    async def dispatch_tool(self, call_id, call) -> Any:
        return None

    async def dispatch_action(self, call_id, action_type, config, idempotency_key) -> bool:
        return True

    async def hangup_call(self, call_id: str) -> None:
        self.hung_up = True


def _build_availability_flow(*, retry_count: int | None = None) -> TaskFlow:
    nodes = [
        FlowNode("start", NodeType.START, {"x": 0, "y": 0}, StartNodeData()),
        FlowNode(
            "availability",
            NodeType.DIALOG,
            {"x": 0, "y": 0},
            DialogNodeData(
                mode=DialogMode.SCRIPT,
                text="请问您现在方便沟通吗？",
                wait_for_response=True,
                retry_count=retry_count,
            ),
        ),
        FlowNode("end_no", NodeType.END, {"x": 0, "y": 0}, EndNodeData()),
        FlowNode("end_yes", NodeType.END, {"x": 0, "y": 0}, EndNodeData()),
    ]
    edges = [
        FlowEdge("start_edge", "start", "availability"),
        # Negative is intentionally first: an unresolved turn must never pick it.
        FlowEdge(
            "not_available",
            "availability",
            "end_no",
            "不方便",
            ["现在没空", "晚点再打"],
        ),
        FlowEdge(
            "available",
            "availability",
            "end_yes",
            "方便",
            ["可以", "明天下午可以", "没问题"],
        ),
    ]
    return TaskFlow("availability-flow", "availability-flow", nodes, edges)


def _build_delivery_flow() -> TaskFlow:
    nodes = [
        FlowNode("start", NodeType.START, {"x": 0, "y": 0}, StartNodeData()),
        FlowNode(
            "delivery",
            NodeType.DIALOG,
            {"x": 0, "y": 0},
            DialogNodeData(
                mode=DialogMode.SCRIPT,
                text="请问商品收到了吗？",
                wait_for_response=True,
            ),
        ),
        FlowNode("end_missing", NodeType.END, {"x": 0, "y": 0}, EndNodeData()),
        FlowNode("end_received", NodeType.END, {"x": 0, "y": 0}, EndNodeData()),
        FlowNode("end_other", NodeType.END, {"x": 0, "y": 0}, EndNodeData()),
    ]
    edges = [
        FlowEdge("start_edge", "start", "delivery"),
        FlowEdge(
            "missing",
            "delivery",
            "end_missing",
            "未收到",
            ["还没到", "一直没送来"],
        ),
        FlowEdge(
            "received",
            "delivery",
            "end_received",
            "收到了",
            ["货到了", "我拿到了"],
        ),
        FlowEdge("other", "delivery", "end_other"),
    ]
    return TaskFlow("delivery-flow", "delivery-flow", nodes, edges)


async def test_exact_label_normalization_uses_zero_llm_fast_path() -> None:
    cb = FakeFlowCallbacks("收到")
    await FlowExecutor(_build_delivery_flow(), cb).run("call-exact-label")
    assert cb.entered_nodes[-1] == "end_received"
    assert cb.router_calls == 0


async def test_exact_configured_example_uses_zero_llm_fast_path() -> None:
    cb = FakeFlowCallbacks("一直没送来")
    await FlowExecutor(_build_delivery_flow(), cb).run("call-exact-example")
    assert cb.entered_nodes[-1] == "end_missing"
    assert cb.router_calls == 0


@pytest.mark.parametrize("ambiguous_reply", ["可以？", "可以呢", "可以吧", "可以嘛"])
async def test_question_like_or_particle_suffixed_answer_skips_exact_fast_path(
    ambiguous_reply: str,
) -> None:
    """Only an unmodified configured phrase is safe enough for zero-LLM routing."""

    cb = FakeFlowCallbacks(
        [ambiguous_reply, "没问题"],
        _route(_command("UNANSWERED", None, 0.96)),
    )

    await FlowExecutor(_build_availability_flow(), cb).run(
        f"call-exact-guard-{ambiguous_reply}"
    )

    assert cb.router_calls == 1
    assert cb.caller_speech == [ambiguous_reply, "没问题"]
    assert cb.entered_nodes[-1] == "end_yes"
    assert cb.spoken[1].startswith("抱歉，我还没理解您的回答。")


async def test_substring_is_not_treated_as_deterministic_business_answer() -> None:
    cb = FakeFlowCallbacks(
        "快递一直没送来，应该怎么办",
        _route(_command("BUSINESS_INTENT", "missing", 0.94)),
    )
    await FlowExecutor(_build_delivery_flow(), cb).run("call-semantic")
    assert cb.entered_nodes[-1] == "end_missing"
    assert cb.router_calls == 1


async def test_question_request_stays_in_same_node_until_exact_answer() -> None:
    cb = FakeFlowCallbacks(
        ["等一下，我有问题", "明天下午可以"],
        [
            _route(_command("QUESTION_REQUEST", None, 0.96)),
            _route(
                _command("BUSINESS_INTENT", "available", 0.96),
                alternatives=[{"intent_id": "not_available", "confidence": 0.03}],
            ),
        ],
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-question-request")
    assert cb.entered_nodes[-1] == "end_yes"
    assert cb.entered_nodes.count("availability") == 1
    assert "end_no" not in cb.entered_nodes
    assert cb.caller_speech == ["等一下，我有问题", "明天下午可以"]
    assert "好的，您请说。" in cb.spoken
    assert cb.router_calls == 2


async def test_repeat_replays_without_reentering_node() -> None:
    cb = FakeFlowCallbacks(
        ["没听清", "可以"],
        _route(_command("REPEAT", None, 0.95)),
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-repeat")
    assert cb.entered_nodes[-1] == "end_yes"
    assert cb.entered_nodes.count("availability") == 1
    assert cb.spoken[:2] == [
        "请问您现在方便沟通吗？",
        "好的，我再说一遍。请问您现在方便沟通吗？",
    ]


async def test_backchannel_is_silent_and_does_not_fill_business_slot() -> None:
    cb = FakeFlowCallbacks(
        ["嗯", "可以"],
        _route(_command("BACKCHANNEL", None, 0.92)),
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-backchannel")
    assert cb.entered_nodes[-1] == "end_yes"
    assert cb.spoken == ["请问您现在方便沟通吗？"]


async def test_side_question_is_rag_reply_with_no_business_tools_then_resumes() -> None:
    cb = FakeFlowCallbacks(
        ["安装收费吗？", "可以"],
        _route(_command("SIDE_QUESTION", "安装收费吗？", 0.97)),
        generated_reply="安装服务不收费。",
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-side")
    assert cb.entered_nodes[-1] == "end_yes"
    assert cb.generate_reply_calls == 1
    assert cb.reply_tools == [[]]
    # 插话应答：先播过渡语（与答案生成并行），再播答案。
    # 默认 natural 承接：不再硬拼「回到刚才的问题 + 原话术复读」，由 LLM 在
    # 同一次生成中融合承接；给 LLM 的指令必须携带未答的问题原文。
    assert cb.spoken[1] == "好的，稍等哈，我帮您看一下。"
    assert cb.spoken[2] == "安装服务不收费。"
    instruction = next(
        m.content for m in cb.reply_messages[0] if m.role == "system"
    )
    assert "请问您现在方便沟通吗？" in instruction
    assert "回到刚才的问题" not in cb.spoken[2]


async def test_side_question_template_bridge_uses_configured_wording() -> None:
    """template 模式：按场景配置的承接模板拼接，复读原问题。"""
    from voice_agent.repair_phrases import RepairPhrases

    cb = FakeFlowCallbacks(
        ["安装收费吗？", "可以"],
        _route(_command("SIDE_QUESTION", "安装收费吗？", 0.97)),
        generated_reply="安装服务不收费。",
    )
    repair = RepairPhrases.from_config(
        {
            "sideQuestionBridge": "template",
            "sideQuestionBridgeTemplate": "咱们接着刚才的：{question}",
        }
    )
    await FlowExecutor(_build_availability_flow(), cb, repair=repair).run(
        "call-side-template"
    )
    assert cb.entered_nodes[-1] == "end_yes"
    # template 模式同样先播过渡语，再播「答案 + 模板承接」
    assert cb.spoken[1] == "好的，稍等哈，我帮您看一下。"
    assert cb.spoken[2] == "安装服务不收费。 咱们接着刚才的：请问您现在方便沟通吗？"
    # template 模式不得在 LLM 指令里要求承接（避免双重承接）
    instruction = next(
        m.content for m in cb.reply_messages[0] if m.role == "system"
    )
    assert "请问您现在方便沟通吗？" not in instruction


async def test_side_question_llm_failure_falls_back_to_template_bridge() -> None:
    """natural 模式下 LLM 失败：兜底话术 + 模板承接，未答问题不丢失。"""
    cb = FakeFlowCallbacks(
        ["安装收费吗？", "可以"],
        _route(_command("SIDE_QUESTION", "安装收费吗？", 0.97)),
        generated_reply="",
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-side-fallback")
    assert cb.entered_nodes[-1] == "end_yes"
    # 生成失败不影响过渡语照播，随后走兜底 + 模板承接
    assert cb.spoken[1] == "好的，稍等哈，我帮您看一下。"
    assert cb.spoken[2] == (
        "这部分我需要帮您确认后回复。 回到刚才的问题，请问您现在方便沟通吗？"
    )


async def test_compound_business_answer_and_side_question_preserves_both() -> None:
    cb = FakeFlowCallbacks(
        "不方便，不过安装收费吗？",
        _route(
            _command("BUSINESS_INTENT", "not_available", 0.95),
            _command("SIDE_QUESTION", "安装收费吗？", 0.96),
            alternatives=[{"intent_id": "available", "confidence": 0.08}],
        ),
        generated_reply="安装服务不收费。",
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-compound")
    assert cb.entered_nodes[-1] == "end_no"
    assert cb.generate_reply_calls == 1
    assert cb.reply_tools == [[]]
    assert cb.spoken[1] == "好的，稍等哈，我帮您看一下。"
    assert cb.spoken[2] == "安装服务不收费。"
    assert "回到刚才的问题" not in cb.spoken[2]


async def test_business_plus_question_request_keeps_pending_answer_through_side_question() -> None:
    cb = FakeFlowCallbacks(
        ["不方便，不过我有一个问题", "安装收费吗？"],
        [
            _route(
                _command("BUSINESS_INTENT", "not_available", 0.95),
                _command("QUESTION_REQUEST", None, 0.93),
                alternatives=[{"intent_id": "available", "confidence": 0.05}],
            ),
            _route(_command("SIDE_QUESTION", "安装收费吗？", 0.97)),
        ],
        generated_reply="安装服务不收费。",
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-pending")
    assert cb.entered_nodes[-1] == "end_no"
    assert cb.router_calls == 2
    assert cb.spoken[1:] == [
        "好的，您请说。",
        "好的，稍等哈，我帮您看一下。",
        "安装服务不收费。",
    ]


async def test_question_request_phase_disables_business_exact_fast_path() -> None:
    cb = FakeFlowCallbacks(
        ["不方便，不过我有问题", "可以？"],
        [
            _route(
                _command("BUSINESS_INTENT", "not_available", 0.95),
                _command("QUESTION_REQUEST", None, 0.94),
                alternatives=[{"intent_id": "available", "confidence": 0.03}],
            ),
            _route(_command("SIDE_QUESTION", "可以？", 0.9)),
        ],
        generated_reply="可以，请您继续说。",
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-side-exact-guard")
    assert cb.entered_nodes[-1] == "end_no"
    assert cb.router_calls == 2
    assert cb.spoken[-1] == "可以，请您继续说。"


async def test_backchannel_while_awaiting_side_question_does_not_commit_pending_business() -> None:
    cb = FakeFlowCallbacks(
        ["不方便，不过我有问题", "嗯", "安装收费吗？"],
        [
            _route(
                _command("BUSINESS_INTENT", "not_available", 0.95),
                _command("QUESTION_REQUEST", None, 0.94),
                alternatives=[{"intent_id": "available", "confidence": 0.03}],
            ),
            _route(_command("BACKCHANNEL", None, 0.92)),
            _route(_command("SIDE_QUESTION", "安装收费吗？", 0.97)),
        ],
        generated_reply="安装服务不收费。",
    )

    await FlowExecutor(_build_availability_flow(), cb).run(
        "call-side-question-backchannel"
    )

    assert cb.router_calls == 3
    assert cb.caller_speech == ["不方便，不过我有问题", "嗯", "安装收费吗？"]
    assert cb.generate_reply_calls == 1
    assert cb.entered_nodes[-1] == "end_no"
    assert cb.spoken[-1] == "安装服务不收费。"


async def test_question_request_no_input_uses_phase_specific_prompt() -> None:
    cb = FakeFlowCallbacks(
        ["不方便，不过我有问题", "", "", ""],
        _route(
            _command("BUSINESS_INTENT", "not_available", 0.95),
            _command("QUESTION_REQUEST", None, 0.94),
            alternatives=[{"intent_id": "available", "confidence": 0.03}],
        ),
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-side-no-input")
    assert cb.entered_nodes[-1] == "end_no"
    # QUESTION_REQUEST 应答与等待插问期间的无应答重问统一走
    # question_request_ack_prompt：1 次确认 + 2 次重问。
    assert cb.spoken.count("好的，您请说。") == 3


async def test_explicit_correction_can_replace_pending_business_answer() -> None:
    cb = FakeFlowCallbacks(
        ["不方便，不过我有问题", "我改口，现在方便"],
        [
            _route(
                _command("BUSINESS_INTENT", "not_available", 0.95),
                _command("QUESTION_REQUEST", None, 0.94),
                alternatives=[{"intent_id": "available", "confidence": 0.03}],
            ),
            _route(
                _command("BUSINESS_INTENT", "available", 0.96),
                alternatives=[{"intent_id": "not_available", "confidence": 0.04}],
            ),
        ],
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-correction")
    assert cb.entered_nodes[-1] == "end_yes"


async def test_pending_business_survives_failed_followup_repairs() -> None:
    cb = FakeFlowCallbacks(
        ["不方便，不过我有一个问题", "杂音一", "杂音二", "杂音三"],
        [
            _route(
                _command("BUSINESS_INTENT", "not_available", 0.95),
                _command("QUESTION_REQUEST", None, 0.93),
                alternatives=[{"intent_id": "available", "confidence": 0.05}],
            ),
            _route(_command("UNANSWERED", None, 0.95)),
            _route(_command("UNANSWERED", None, 0.95)),
            _route(_command("UNANSWERED", None, 0.95)),
        ],
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-pending-repair")
    assert cb.entered_nodes[-1] == "end_no"
    assert cb._ended


@pytest.mark.parametrize(
    ("repair_route", "first_utterance"),
    [
        ("HOLD", "不方便，等一下"),
        ("REPEAT", "不方便，请再说一遍"),
    ],
)
async def test_other_answer_after_pending_repair_does_not_commit_stale_business(
    repair_route: str,
    first_utterance: str,
) -> None:
    cb = FakeFlowCallbacks(
        [first_utterance, "朋友代收了", "没问题"],
        [
            _route(
                _command("BUSINESS_INTENT", "not_available", 0.95),
                _command(repair_route, None, 0.93),
                alternatives=[{"intent_id": "available", "confidence": 0.03}],
            ),
            _route(_command("OTHER_ANSWER", "朋友代收了", 0.96)),
        ],
    )

    await FlowExecutor(_build_availability_flow(), cb).run(
        f"call-stale-business-{repair_route.lower()}"
    )

    assert cb.router_calls == 2
    assert cb.caller_speech == [first_utterance, "朋友代收了", "没问题"]
    assert cb.entered_nodes[-1] == "end_yes"
    assert "end_no" not in cb.entered_nodes
    assert cb.spoken[-1].startswith("抱歉，我还没理解您的回答。")


async def test_business_plus_backchannel_commits_business_without_silent_wait() -> None:
    cb = FakeFlowCallbacks(
        "嗯，可以",
        _route(
            _command("BACKCHANNEL", None, 0.9),
            _command("BUSINESS_INTENT", "available", 0.95),
            alternatives=[{"intent_id": "not_available", "confidence": 0.03}],
        ),
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-business-backchannel")
    assert cb.entered_nodes[-1] == "end_yes"
    assert cb.spoken == ["请问您现在方便沟通吗？"]


async def test_unanswered_with_fallback_repairs_in_node_instead_of_taking_fallback() -> None:
    cb = FakeFlowCallbacks(
        ["先聊点别的", "收到"],
        _route(_command("UNANSWERED", None, 0.96)),
    )
    await FlowExecutor(_build_delivery_flow(), cb).run("call-unanswered")
    assert cb.entered_nodes[-1] == "end_received"
    assert "end_other" not in cb.entered_nodes
    assert cb.entered_nodes.count("delivery") == 1
    assert cb.router_calls == 1
    assert cb.spoken[1].startswith("抱歉，我还没理解您的回答。")


async def test_other_answer_takes_fallback_only_at_high_confidence() -> None:
    cb = FakeFlowCallbacks(
        "朋友代收了",
        _route(_command("OTHER_ANSWER", "朋友代收了", 0.91)),
    )
    await FlowExecutor(_build_delivery_flow(), cb).run("call-other")
    assert cb.entered_nodes[-1] == "end_other"


async def test_low_confidence_other_does_not_take_fallback() -> None:
    cb = FakeFlowCallbacks(
        ["可能吧", "收到"],
        _route(_command("OTHER_ANSWER", "可能吧", 0.7)),
    )
    await FlowExecutor(_build_delivery_flow(), cb).run("call-low-other")
    assert cb.entered_nodes[-1] == "end_received"
    assert "end_other" not in cb.entered_nodes


async def test_business_margin_rejects_ambiguous_transition() -> None:
    cb = FakeFlowCallbacks(
        ["好像可以", "没问题"],
        _route(
            _command("BUSINESS_INTENT", "available", 0.9),
            alternatives=[{"intent_id": "not_available", "confidence": 0.82}],
        ),
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-margin")
    assert cb.entered_nodes[-1] == "end_yes"
    assert "end_no" not in cb.entered_nodes
    assert cb.spoken[1].startswith("抱歉，我还没理解您的回答。")


async def test_unknown_edge_id_is_fail_closed() -> None:
    cb = FakeFlowCallbacks(
        ["大概可以", "没问题"],
        _route(_command("BUSINESS_INTENT", "invented-edge", 0.99)),
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-unknown")
    assert cb.entered_nodes[-1] == "end_yes"
    assert "end_no" not in cb.entered_nodes


async def test_plain_prose_provider_output_cannot_advance_flow() -> None:
    cb = FakeFlowCallbacks(["随便吧", "没问题"], "not_available")
    await FlowExecutor(_build_availability_flow(), cb).run("call-prose")
    assert cb.entered_nodes[-1] == "end_yes"
    assert "end_no" not in cb.entered_nodes


async def test_invalid_provider_output_uses_system_retry_not_user_no_match() -> None:
    cb = FakeFlowCallbacks(["随便吧", "没问题"], "not_available")
    await FlowExecutor(_build_availability_flow(), cb).run("call-provider-failure")
    assert cb.entered_nodes[-1] == "end_yes"
    assert cb.spoken[1] == "语音服务刚才有些延迟，请您再说一次。"
    assert all("没理解您的回答" not in text for text in cb.spoken)


async def test_provider_failure_on_possible_correction_discards_stale_pending() -> None:
    cb = FakeFlowCallbacks(
        ["不方便，等一下", "不对，我现在方便", "我说现在方便"],
        [
            _route(
                _command("BUSINESS_INTENT", "not_available", 0.96),
                _command("HOLD", None, 0.94),
                alternatives=[{"intent_id": "available", "confidence": 0.02}],
            ),
            "malformed provider output",
            "malformed provider output",
        ],
    )

    await FlowExecutor(_build_availability_flow(), cb).run("call-stale-provider")

    assert cb._ended
    assert cb.entered_nodes == ["start", "availability"]
    assert "end_no" not in cb.entered_nodes
    assert cb.spoken[-1] == "语音服务暂时无法完成识别，我们稍后再联系您。"


async def test_router_receives_latest_utterance_only_as_user_role() -> None:
    utterance = "现在可能不太方便"
    cb = FakeFlowCallbacks(
        utterance,
        _route(_command("BUSINESS_INTENT", "not_available", 0.95)),
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-roles")
    messages = cb.router_messages[0]
    assert [message.role for message in messages] == ["system", "user"]
    assert messages[1].content == utterance
    assert utterance not in messages[0].content
    assert "请问您现在方便沟通吗？" in messages[0].content
    assert cb.router_schemas[0]["additionalProperties"] is False


async def test_no_input_retries_are_local_then_end_without_transition() -> None:
    cb = FakeFlowCallbacks(["", "", ""])
    await FlowExecutor(_build_availability_flow(), cb).run("call-no-input")
    assert cb.entered_nodes == ["start", "availability"]
    assert cb.router_calls == 0
    assert cb._ended
    assert cb.spoken[-1] == "暂时没有听到您的回答，我们稍后再联系您。"


async def test_explicit_zero_retry_ends_after_first_no_input() -> None:
    cb = FakeFlowCallbacks("")
    await FlowExecutor(
        _build_availability_flow(retry_count=0), cb
    ).run("call-no-retry")
    assert cb.entered_nodes == ["start", "availability"]
    assert len(cb.spoken) == 2


async def test_unconditional_waiting_dialog_still_respects_no_input_budget() -> None:
    flow = TaskFlow(
        "single-flow",
        "single-flow",
        [
            FlowNode("start", NodeType.START, {"x": 0, "y": 0}, StartNodeData()),
            FlowNode(
                "dialog",
                NodeType.DIALOG,
                {"x": 0, "y": 0},
                DialogNodeData(
                    mode=DialogMode.SCRIPT,
                    text="请说一下您的情况。",
                    wait_for_response=True,
                    retry_count=1,
                ),
            ),
            FlowNode("end", NodeType.END, {"x": 0, "y": 0}, EndNodeData()),
        ],
        [
            FlowEdge("start-edge", "start", "dialog"),
            FlowEdge("continue", "dialog", "end"),
        ],
    )
    cb = FakeFlowCallbacks(["", "具体情况"])
    await FlowExecutor(flow, cb).run("call-unconditional")
    assert cb.entered_nodes[-1] == "end"
    assert cb.caller_speech == ["具体情况"]
    assert cb.router_calls == 0
    assert cb.spoken[1] == "抱歉，我没有听到您的回答。请说一下您的情况。"


@pytest.mark.parametrize("invalid_kind", ["duplicate_edge_id", "multiple_fallbacks"])
async def test_invalid_routing_configuration_is_rejected_before_execution(
    invalid_kind: str,
) -> None:
    flow = _build_delivery_flow()
    if invalid_kind == "duplicate_edge_id":
        flow.edges[2].id = flow.edges[1].id
        expected_error = "duplicate edge"
    else:
        flow.edges.append(
            FlowEdge("other-second", "delivery", "end_other", "默认")
        )
        expected_error = "fallback"
    cb = FakeFlowCallbacks("收到")

    with pytest.raises(ValueError, match=expected_error):
        executor = FlowExecutor(flow, cb)
        await executor.run(f"call-invalid-{invalid_kind}")

    assert cb.entered_nodes == []


async def test_silence_reprompt_is_llm_generated_by_default() -> None:
    """静默追问默认由 LLM 生成：指令携带静默提示词要求与未答问题。"""
    cb = FakeFlowCallbacks(
        ["", "可以"],
        generated_reply="您还在线吗？刚才想和您确认现在是否方便沟通。",
    )
    await FlowExecutor(_build_availability_flow(), cb).run("call-silence-llm")
    assert cb.entered_nodes[-1] == "end_yes"
    # 静默追问播报的是 LLM 生成文本，而非固定模板
    assert cb.spoken[1] == "您还在线吗？刚才想和您确认现在是否方便沟通。"
    instruction = next(
        m.content for m in cb.reply_messages[0] if m.role == "system"
    )
    assert "复述上一轮" in instruction
    assert "自然衔接" in instruction
    assert "请问您现在方便沟通吗？" in instruction


async def test_silence_reprompt_falls_back_to_template_on_empty_llm() -> None:
    """LLM 生成失败/为空时回退固定模板，追问不缺席。"""
    cb = FakeFlowCallbacks(["", "可以"], generated_reply="")
    await FlowExecutor(_build_availability_flow(), cb).run("call-silence-fb")
    assert cb.entered_nodes[-1] == "end_yes"
    assert cb.spoken[1] == "抱歉，我没有听到您的回答。请问您现在方便沟通吗？"


async def test_silence_budget_from_scenario_config() -> None:
    """场景 maxSilenceRounds 覆盖 env 默认：1 轮追问后即执行超限动作（默认挂机）。"""
    from voice_agent.repair_phrases import RepairPhrases

    repair = RepairPhrases.from_config({"maxSilenceRounds": 1})
    cb = FakeFlowCallbacks(["", "", ""], generated_reply="")
    await FlowExecutor(_build_availability_flow(), cb, repair=repair).run(
        "call-silence-budget"
    )
    # 1 次追问 + 1 次收尾语，随后结束
    assert cb.spoken[-1] == "暂时没有听到您的回答，我们稍后再联系您。"
    assert cb.is_ended("call-silence-budget")
    assert cb.escalations == []


async def test_silence_exhausted_transfer_action() -> None:
    """silenceAction=transfer：超限后播报转人工提示语并触发 on_escalate。"""
    from voice_agent.repair_phrases import RepairPhrases

    repair = RepairPhrases.from_config(
        {
            "maxSilenceRounds": 1,
            "silenceAction": "transfer",
            "silenceTransferPrompt": "别挂机，马上为您转接人工。",
        }
    )
    cb = FakeFlowCallbacks(["", "", ""], generated_reply="")
    await FlowExecutor(_build_availability_flow(), cb, repair=repair).run(
        "call-silence-transfer"
    )
    assert cb.spoken[-1] == "别挂机，马上为您转接人工。"
    assert cb.escalations == ["连续静默超限转人工"]
    assert cb.is_ended("call-silence-transfer")


async def test_node_retry_count_beats_scenario_silence_rounds() -> None:
    """节点显式 retryCount 优先于场景 maxSilenceRounds。"""
    from voice_agent.repair_phrases import RepairPhrases

    repair = RepairPhrases.from_config({"maxSilenceRounds": 5})
    cb = FakeFlowCallbacks(["", "", ""], generated_reply="")
    await FlowExecutor(
        _build_availability_flow(retry_count=1), cb, repair=repair
    ).run("call-silence-node-wins")
    # retryCount=1：1 次追问后就收尾（若场景值生效会追问 3 次都用完输入）
    assert cb.spoken[-1] == "暂时没有听到您的回答，我们稍后再联系您。"
    assert cb.is_ended("call-silence-node-wins")
