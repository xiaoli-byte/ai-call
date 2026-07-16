"""插话（SIDE_QUESTION）应答过渡语（sideQuestionAck）回归测试。

覆盖：过渡语先于答案播报、答案生成与过渡语播放并行、自定义配置生效、
LLM 生成失败回退、过渡语播放被取消（barge-in/挂断）时生成任务不遗留孤儿。
fixtures 参照 tests/test_flow_executor_intent.py 中插话相关用例的搭法。
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable

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
from voice_agent.repair_phrases import RepairPhrases
from voice_agent.types import ChatMessage

# 默认过渡语，须与 repair_phrases.RepairPhrases.side_question_ack 一字不差
DEFAULT_ACK = "好的，稍等哈，我帮您看一下。"


def _command(kind: str, value: str | None, confidence: float = 0.95) -> dict[str, Any]:
    return {"type": kind, "value": value, "confidence": confidence}


def _route(*commands: dict[str, Any]) -> dict[str, Any]:
    return {
        "protocol_version": ROUTER_PROTOCOL_VERSION,
        "commands": list(commands),
        "alternatives": [],
    }


class AckFlowCallbacks:
    """插话过渡语专用假回调：可在 speak/generate_reply 上挂打点与故障注入。"""

    def __init__(
        self,
        user_replies: list[str],
        router_results: list[dict[str, Any]],
        generated_reply: str | Exception = "",
    ) -> None:
        self.user_replies = list(user_replies)
        self.router_results = list(router_results)
        self.generated_reply = generated_reply
        self._ended = False
        self._messages: list[ChatMessage] = []
        self.entered_nodes: list[str] = []
        self.spoken: list[str] = []
        self.caller_speech: list[str] = []
        self.reply_messages: list[list[ChatMessage]] = []
        self.reply_tools: list[list] = []
        self.generate_reply_calls = 0
        # 打点：LLM 入口已进入 / 生成任务被取消 / 生成协程已收尾
        self.llm_started = asyncio.Event()
        self.generation_cancelled = False
        self.generation_finished = False
        # 可注入钩子：speak 播报前、generate_reply 入口打点后各调用一次
        self.speak_hook: Callable[[str], Awaitable[None]] | None = None
        self.generate_hook: Callable[[], Awaitable[None]] | None = None

    async def speak(self, call_id: str, text: str) -> None:
        if self.speak_hook is not None:
            await self.speak_hook(text)
        self.spoken.append(text)

    async def wait_for_user_speech(self, call_id: str) -> str:
        return self.user_replies.pop(0) if self.user_replies else ""

    async def generate_reply(self, call_id, messages, tools=None) -> str:
        self.generate_reply_calls += 1
        self.reply_messages.append(list(messages))
        self.reply_tools.append(list(tools or []))
        self.llm_started.set()
        try:
            if self.generate_hook is not None:
                await self.generate_hook()
        except asyncio.CancelledError:
            self.generation_cancelled = True
            raise
        finally:
            self.generation_finished = True
        if isinstance(self.generated_reply, Exception):
            raise self.generated_reply
        return self.generated_reply

    async def generate_llm_text(self, call_id, messages, options=None) -> str:
        return ""

    async def classify_dialog_turn(self, call_id, messages, schema):
        if self.router_results:
            return self.router_results.pop(0)
        return _route(_command("UNANSWERED", None, 0.99))

    async def on_caller_speech(self, call_id: str, text: str) -> None:
        self.caller_speech.append(text)

    async def on_escalate(self, call_id, reason, extension=None) -> bool:
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
        pass


def _build_availability_flow() -> TaskFlow:
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
            ),
        ),
        FlowNode("end_no", NodeType.END, {"x": 0, "y": 0}, EndNodeData()),
        FlowNode("end_yes", NodeType.END, {"x": 0, "y": 0}, EndNodeData()),
    ]
    edges = [
        FlowEdge("start_edge", "start", "availability"),
        FlowEdge("not_available", "availability", "end_no", "不方便", ["现在没空"]),
        FlowEdge("available", "availability", "end_yes", "方便", ["可以", "没问题"]),
    ]
    return TaskFlow("ack-flow", "ack-flow", nodes, edges)


def _side_question_callbacks(
    generated_reply: str | Exception = "安装服务不收费。",
    followup: list[str] | None = None,
) -> AckFlowCallbacks:
    """标准插话剧本：先插问「安装收费吗？」，随后（可选）给出业务答案。"""
    return AckFlowCallbacks(
        ["安装收费吗？", *(followup if followup is not None else ["可以"])],
        [_route(_command("SIDE_QUESTION", "安装收费吗？", 0.97))],
        generated_reply=generated_reply,
    )


async def test_default_ack_spoken_before_answer() -> None:
    """默认配置：插话时先播过渡语，再播答案（按 speak 顺序断言）。"""
    cb = _side_question_callbacks()
    await FlowExecutor(_build_availability_flow(), cb).run("call-ack-order")
    assert cb.spoken == [
        "请问您现在方便沟通吗？",
        DEFAULT_ACK,
        "安装服务不收费。",
    ]
    assert cb.entered_nodes[-1] == "end_yes"
    # 插话链路的能力边界不变：不携带业务工具
    assert cb.reply_tools == [[]]


async def test_generation_starts_while_ack_is_playing() -> None:
    """并行性：过渡语 speak 尚未返回时，答案生成（RAG+LLM）已经开始。"""
    cb = _side_question_callbacks()
    answer_gate = asyncio.Event()
    ack_saw_generation_started = False

    async def speak_hook(text: str) -> None:
        nonlocal ack_saw_generation_started
        if text == DEFAULT_ACK:
            # 过渡语播放期间等待 LLM 入口打点；若实现退化为「播完再生成」，
            # 这里会超时抛错而不是死等
            await asyncio.wait_for(cb.llm_started.wait(), timeout=2)
            ack_saw_generation_started = True
            answer_gate.set()

    async def generate_hook() -> None:
        # 答案生成需等过渡语确认过并行后才返回；若实现退化为「先生成完
        # 再播过渡语」，这里会超时抛错（answer_gate 永远等不到）
        await asyncio.wait_for(answer_gate.wait(), timeout=2)

    cb.speak_hook = speak_hook
    cb.generate_hook = generate_hook
    await FlowExecutor(_build_availability_flow(), cb).run("call-ack-parallel")
    assert ack_saw_generation_started
    assert cb.spoken[1] == DEFAULT_ACK
    assert cb.spoken[2] == "安装服务不收费。"


async def test_custom_side_question_ack_from_config() -> None:
    """自定义 sideQuestionAck 生效：过渡语按场景配置播报。"""
    cb = _side_question_callbacks()
    repair = RepairPhrases.from_config({"sideQuestionAck": "稍等哈，我马上帮您查。"})
    await FlowExecutor(_build_availability_flow(), cb, repair=repair).run(
        "call-ack-custom"
    )
    assert cb.spoken[1] == "稍等哈，我马上帮您查。"
    assert cb.spoken[2] == "安装服务不收费。"
    assert DEFAULT_ACK not in cb.spoken


async def test_disabled_ack_skips_transition_and_speaks_answer_directly() -> None:
    """sideQuestionAck 配置为空串（显式禁用）：不播过渡语、直接播答案，生成仍并行启动。"""
    cb = _side_question_callbacks()
    generation_started_before_answer_spoken = False

    async def speak_hook(text: str) -> None:
        nonlocal generation_started_before_answer_spoken
        if text == "安装服务不收费。":
            # 答案播报时生成早已启动过（禁用过渡语不改变「先启动生成」的并行结构）
            generation_started_before_answer_spoken = cb.llm_started.is_set()

    cb.speak_hook = speak_hook
    repair = RepairPhrases.from_config({"sideQuestionAck": ""})
    await FlowExecutor(_build_availability_flow(), cb, repair=repair).run(
        "call-ack-disabled"
    )
    # 过渡语被跳过：问题话术之后直接是答案，任何过渡语（默认/空串）都不播
    assert cb.spoken == [
        "请问您现在方便沟通吗？",
        "安装服务不收费。",
    ]
    assert DEFAULT_ACK not in cb.spoken
    assert generation_started_before_answer_spoken
    assert cb.generate_reply_calls == 1
    assert cb.entered_nodes[-1] == "end_yes"


async def test_llm_failure_still_plays_ack_then_falls_back() -> None:
    """LLM 生成异常：过渡语照播，回退路径与改造前一致（兜底 + 模板承接）。"""
    cb = _side_question_callbacks(generated_reply=RuntimeError("llm exploded"))
    await FlowExecutor(_build_availability_flow(), cb).run("call-ack-llm-fail")
    assert cb.spoken == [
        "请问您现在方便沟通吗？",
        DEFAULT_ACK,
        # 兜底话术 + 模板承接：未答的主流程问题不因生成失败丢失
        "这部分我需要帮您确认后回复。 回到刚才的问题，请问您现在方便沟通吗？",
    ]
    assert cb.entered_nodes[-1] == "end_yes"


async def test_ack_cancellation_cancels_generation_without_orphan_task() -> None:
    """过渡语播放中被取消（barge-in/挂断）：生成任务被取消收尾，CancelledError 原样上抛。"""
    cb = _side_question_callbacks(followup=[])
    hang_forever = asyncio.Event()

    async def speak_hook(text: str) -> None:
        if text == DEFAULT_ACK:
            # 先等生成任务真正启动（真机上 TTS 播放远长于任务调度），
            # 再模拟 barge-in/挂断：过渡语播报在途中被取消
            await asyncio.wait_for(cb.llm_started.wait(), timeout=2)
            raise asyncio.CancelledError()

    async def generate_hook() -> None:
        # 生成永不主动完成，只能被取消——用于验证取消传播
        await hang_forever.wait()

    cb.speak_hook = speak_hook
    cb.generate_hook = generate_hook

    with pytest.raises(asyncio.CancelledError):
        await FlowExecutor(_build_availability_flow(), cb).run("call-ack-cancel")

    # 生成任务被取消且已收尾（await 过），不是悬空的孤儿任务
    assert cb.generation_cancelled
    assert cb.generation_finished
    assert "安装服务不收费。" not in cb.spoken
    leaked = [
        task
        for task in asyncio.all_tasks()
        if task is not asyncio.current_task()
        and not task.done()
        and "generate_reply" in repr(task)
    ]
    assert leaked == []
