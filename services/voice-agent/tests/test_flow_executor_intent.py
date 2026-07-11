"""FlowExecutor 意图识别级联的回归测试。

覆盖错分缺陷修复：keyword 最长优先+否定守卫、LLM 逃生口+强健解析+永不炸、
边选择精确优先+最长 token。
"""

from __future__ import annotations

from typing import Any, Optional

from voice_agent.flow_executor import FlowExecutor
from voice_agent.flow_types import (
    DecisionMode,
    DecisionNodeData,
    DialogMode,
    DialogNodeData,
    EndMode,
    EndNodeData,
    FlowEdge,
    FlowNode,
    NodeType,
    StartNodeData,
    TaskFlow,
)
from voice_agent.types import ChatMessage


class FakeFlowCallbacks:
    """FlowExecutorCallbacks 的最小实现，供 run()/方法级测试共用。

    - generate_llm_text 返回预置的 llm_reply（模拟意图分类器输出）。
    - wait_for_user_speech 返回预置的 user_reply。
    """

    def __init__(self, user_reply: str = "", llm_reply: str = "") -> None:
        self.user_reply = user_reply
        self.llm_reply = llm_reply
        self._ended = False
        self._messages: list[ChatMessage] = []
        self.entered_nodes: list[str] = []
        self.hung_up = False

    async def speak(self, call_id: str, text: str) -> None:
        pass

    async def wait_for_user_speech(self, call_id: str) -> str:
        return self.user_reply

    async def generate_reply(self, call_id, messages, tools=None) -> str:
        return ""

    async def generate_llm_text(self, call_id, messages, options=None) -> str:
        return self.llm_reply

    async def on_caller_speech(self, call_id: str, text: str) -> None:
        pass

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
        return []

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


def _dummy_flow() -> TaskFlow:
    """方法级测试用的空流程（_match/_classify/_select 不依赖图结构）。"""
    return TaskFlow(id="f", name="f", nodes=[], edges=[])


def _build_decision_flow(intents: list[str], with_fallback: bool) -> TaskFlow:
    """构造 START → QUESTION → DECISION → 各意图 END（可选 fallback END）。

    每个意图一条 label 相同的出边指向独立 END；with_fallback 时再加一条
    无 label 的兜底边指向 fallback END。便于断言最终落到哪个 target。
    """
    nodes: list[FlowNode] = [
        FlowNode(id="start", type=NodeType.START, position={"x": 0, "y": 0}, data=StartNodeData()),
        FlowNode(
            id="q",
            type=NodeType.DIALOG,
            position={"x": 0, "y": 0},
            data=DialogNodeData(mode=DialogMode.QUESTION, prompt="您对本次服务满意吗？"),
        ),
        FlowNode(
            id="dec",
            type=NodeType.DECISION,
            position={"x": 0, "y": 0},
            data=DecisionNodeData(mode=DecisionMode.INTENT, intents=list(intents)),
        ),
    ]
    edges: list[FlowEdge] = [
        FlowEdge(id="e_start", source="start", target="q"),
        FlowEdge(id="e_q", source="q", target="dec"),
    ]
    for i, intent in enumerate(intents):
        end_id = f"end_{i}"
        nodes.append(
            FlowNode(
                id=end_id,
                type=NodeType.END,
                position={"x": 0, "y": 0},
                data=EndNodeData(mode=EndMode.COMPLETE, reason=intent),
            )
        )
        edges.append(FlowEdge(id=f"e_{i}", source="dec", target=end_id, label=intent))
    if with_fallback:
        nodes.append(
            FlowNode(
                id="end_fallback",
                type=NodeType.END,
                position={"x": 0, "y": 0},
                data=EndNodeData(mode=EndMode.COMPLETE, reason="fallback"),
            )
        )
        # 无 label 的兜底边
        edges.append(FlowEdge(id="e_fallback", source="dec", target="end_fallback", label=None))
    return TaskFlow(id="f", name="f", nodes=nodes, edges=edges)


# --- 1. keyword 最长优先 ---
def test_keyword_longest_first_picks_negative_intent():
    ex = FlowExecutor(_dummy_flow(), FakeFlowCallbacks())
    assert ex._match_intent_by_keyword(["满意", "不满意"], "我不满意") == "不满意"


# --- 2. keyword 否定守卫：无对应意图时本层弃权 ---
def test_keyword_negation_guard_defers_to_llm():
    ex = FlowExecutor(_dummy_flow(), FakeFlowCallbacks())
    # 仅有"满意"，"我不满意"里的"满意"被否定字挡住 → 返回 ""，交 LLM
    assert ex._match_intent_by_keyword(["满意"], "我不满意") == ""


# --- 3. LLM 结果解析最长优先 ---
async def test_llm_parse_longest_first():
    cb = FakeFlowCallbacks(llm_reply="不满意")
    ex = FlowExecutor(_dummy_flow(), cb)
    result = await ex._classify_intent_llm("c1", ["满意", "不满意"], "还行吧", has_fallback=False)
    assert result == "不满意"


# --- 4. LLM 输出"其他" + 无 label fallback 边 → 走 fallback target ---
async def test_decision_routes_to_fallback_on_other():
    cb = FakeFlowCallbacks(user_reply="别说话", llm_reply="其他")
    flow = _build_decision_flow(["满意", "不满意"], with_fallback=True)
    ex = FlowExecutor(flow, cb)
    await ex.run("c1")
    # fallback END 的 reason 标记为 fallback
    assert cb.entered_nodes[-1] == "end_fallback"


# --- 5. LLM 输出无关内容 + 无 fallback 边 → 强制 intents[0]，不抛 ValueError ---
async def test_decision_forced_first_intent_without_fallback():
    cb = FakeFlowCallbacks(user_reply="别说话", llm_reply="今天天气不错")
    flow = _build_decision_flow(["满意", "不满意"], with_fallback=False)
    ex = FlowExecutor(flow, cb)
    # 不应抛异常
    await ex.run("c1")
    # intents[0] = "满意" → end_0
    assert cb.entered_nodes[-1] == "end_0"


# --- 6. _select_decision_edge 精确命中 ---
async def test_select_edge_exact_match():
    cb = FakeFlowCallbacks()
    ex = FlowExecutor(_dummy_flow(), cb)
    edges = [
        FlowEdge(id="a", source="dec", target="t_satisfied", label="满意"),
        FlowEdge(id="b", source="dec", target="t_unsatisfied", label="不满意"),
    ]
    selected = await ex._select_decision_edge("c1", edges, "不满意")
    assert selected is not None
    assert selected.target == "t_unsatisfied"


async def test_dialog_routes_directly_by_edge_intent():
    cb = FakeFlowCallbacks(user_reply="请帮我转人工客服")
    nodes = [
        FlowNode(id="start", type=NodeType.START, position={"x": 0, "y": 0}, data=StartNodeData()),
        FlowNode(
            id="dialog",
            type=NodeType.DIALOG,
            position={"x": 0, "y": 0},
            data=DialogNodeData(
                mode=DialogMode.SCRIPT,
                text="请问需要什么帮助？",
                wait_for_response=True,
            ),
        ),
        FlowNode(id="end_help", type=NodeType.END, position={"x": 0, "y": 0}, data=EndNodeData()),
        FlowNode(id="end_default", type=NodeType.END, position={"x": 0, "y": 0}, data=EndNodeData()),
    ]
    edges = [
        FlowEdge(id="e1", source="start", target="dialog"),
        FlowEdge(
            id="e2",
            source="dialog",
            target="end_help",
            label="转人工",
            intent_examples=["帮我找人工客服"],
        ),
        FlowEdge(id="e3", source="dialog", target="end_default"),
    ]

    await FlowExecutor(TaskFlow(id="f", name="f", nodes=nodes, edges=edges), cb).run("c1")

    assert cb.entered_nodes[-1] == "end_help"
