"""流程节点类型定义（镜像 packages/shared/src/task-flows.ts）。

5 节点极简系统的 Python dataclass：
- StartNodeData: 唯一入口，无配置
- DialogNodeData: script/question/ai 三模式
- DecisionNodeData: condition/intent 两模式
- ActionNodeData: transfer/sms/crm/api 四动作
- EndNodeData: complete/hangup 两模式

FlowNode.data 按 type 分发到上述 dataclass，通过 from_dict 工厂构造。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class NodeType(str, Enum):
    START = "start"
    DIALOG = "dialog"
    DECISION = "decision"
    ACTION = "action"
    END = "end"


class DialogMode(str, Enum):
    SCRIPT = "script"
    QUESTION = "question"
    AI = "ai"


class DecisionMode(str, Enum):
    CONDITION = "condition"
    INTENT = "intent"


class ActionType(str, Enum):
    TRANSFER = "transfer"
    SMS = "sms"
    CRM = "crm"
    API = "api"


class EndMode(str, Enum):
    COMPLETE = "complete"
    HANGUP = "hangup"


@dataclass
class StartNodeData:
    """开始节点：无配置字段。"""


@dataclass
class DialogNodeData:
    """对话节点：固定话术 / 提问 / AI 回复。"""

    mode: DialogMode = DialogMode.SCRIPT
    text: Optional[str] = None
    prompt: Optional[str] = None
    system_prompt: Optional[str] = None
    temperature: Optional[float] = None
    interruptible: bool = True
    wait_for_response: bool = False
    timeout_seconds: Optional[int] = None
    retry_count: Optional[int] = None


@dataclass
class DecisionNodeData:
    """判断节点：条件表达式 / 意图分类。"""

    mode: DecisionMode = DecisionMode.INTENT
    expression: Optional[str] = None
    intents: list[str] = field(default_factory=list)
    # intent 模式：每个意图的例句（键=意图名，值=例句数组），供 embedding 相似度层使用。
    # 例句随 node.data 进快照，任务锁版本执行；运行时忽略键不在 intents 里的例句。
    intent_examples: dict[str, list[str]] = field(default_factory=dict)


@dataclass
class ActionNodeData:
    """动作节点：转人工 / 发短信 / CRM / Webhook。

    config 字段按 action_type 不同结构不同（镜像 packages/shared/src/task-flows.ts）：
    - transfer: { extension?: str, reason?: str }
    - sms:       { template?: str, params?: dict }  收件人为来电号码
    - crm:       { action?: str, priority?: 'low'|'normal'|'high', note?: str }
    - api:       { url?: str, method?: str, headers?: dict, body?: Any, timeout?: int }
    """

    action_type: ActionType = ActionType.API
    config: dict[str, Any] = field(default_factory=dict)


@dataclass
class EndNodeData:
    """结束节点：正常结束 / 挂机。"""

    mode: EndMode = EndMode.COMPLETE
    reason: Optional[str] = None
    farewell: Optional[str] = None


@dataclass
class FlowNode:
    """流程节点。data 按 type 分发到对应 dataclass。"""

    id: str
    type: NodeType
    position: dict[str, float]
    data: Any = None

    def as_dialog(self) -> DialogNodeData:
        if not isinstance(self.data, DialogNodeData):
            raise TypeError(f"node {self.id} data is {type(self.data).__name__}, not DialogNodeData")
        return self.data

    def as_decision(self) -> DecisionNodeData:
        if not isinstance(self.data, DecisionNodeData):
            raise TypeError(f"node {self.id} data is {type(self.data).__name__}, not DecisionNodeData")
        return self.data

    def as_action(self) -> ActionNodeData:
        if not isinstance(self.data, ActionNodeData):
            raise TypeError(f"node {self.id} data is {type(self.data).__name__}, not ActionNodeData")
        return self.data

    def as_end(self) -> EndNodeData:
        if not isinstance(self.data, EndNodeData):
            raise TypeError(f"node {self.id} data is {type(self.data).__name__}, not EndNodeData")
        return self.data


@dataclass
class FlowEdge:
    """流程边。label 为分支条件（Decision 出口）。"""

    id: str
    source: str
    target: str
    label: Optional[str] = None


@dataclass
class TaskFlow:
    """流程定义（运行时强类型版本）。"""

    id: str
    name: str
    nodes: list[FlowNode]
    edges: list[FlowEdge]

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "TaskFlow":
        """从 NestJS API 返回的 dict 构造强类型流程。"""
        nodes = [_parse_node(n) for n in d.get("nodes", [])]
        edges = [_parse_edge(e) for e in d.get("edges", [])]
        return cls(
            id=str(d.get("id", "")),
            name=str(d.get("name", "")),
            nodes=nodes,
            edges=edges,
        )

    def node_by_id(self, node_id: str) -> Optional[FlowNode]:
        return next((n for n in self.nodes if n.id == node_id), None)

    def find_entry(self) -> Optional[FlowNode]:
        return next((n for n in self.nodes if n.type == NodeType.START), None)

    def outgoing_edges(self, node_id: str) -> list[FlowEdge]:
        return [e for e in self.edges if e.source == node_id]


def _parse_node(n: dict[str, Any]) -> FlowNode:
    """解析节点，按 type 构造对应 data dataclass。"""
    raw_type = str(n.get("type", "start"))
    node_type = NodeType(raw_type)
    raw_data = n.get("data") or {}
    data = _parse_node_data(node_type, raw_data)
    pos = n.get("position") or {}
    return FlowNode(
        id=str(n.get("id", "")),
        type=node_type,
        position={"x": float(pos.get("x", 0)), "y": float(pos.get("y", 0))},
        data=data,
    )


def _parse_node_data(node_type: NodeType, raw: dict[str, Any]) -> Any:
    """按节点类型解析 data 字段为强类型 dataclass。"""
    if node_type == NodeType.START:
        return StartNodeData()
    if node_type == NodeType.DIALOG:
        return DialogNodeData(
            mode=DialogMode(str(raw.get("mode", "script"))),
            text=raw.get("text"),
            prompt=raw.get("prompt"),
            system_prompt=raw.get("systemPrompt"),
            temperature=raw.get("temperature"),
            interruptible=bool(raw.get("interruptible", True)),
            wait_for_response=bool(raw.get("waitForResponse", False)),
            timeout_seconds=raw.get("timeoutSeconds"),
            retry_count=raw.get("retryCount"),
        )
    if node_type == NodeType.DECISION:
        return DecisionNodeData(
            mode=DecisionMode(str(raw.get("mode", "intent"))),
            expression=raw.get("expression"),
            intents=list(raw.get("intents", [])),
            intent_examples=_parse_intent_examples(raw.get("intentExamples")),
        )
    if node_type == NodeType.ACTION:
        return ActionNodeData(
            action_type=ActionType(str(raw.get("actionType", "api"))),
            config=dict(raw.get("config", {})),
        )
    if node_type == NodeType.END:
        return EndNodeData(
            mode=EndMode(str(raw.get("mode", "complete"))),
            reason=raw.get("reason"),
            farewell=raw.get("farewell"),
        )
    return None


def _parse_intent_examples(raw: Any) -> dict[str, list[str]]:
    """防御性解析 intentExamples：脏数据（非 dict/非 list/非 str）静默丢弃。

    仅保留 键=str、值=非空 str 列表 的条目；空白例句过滤后为空则丢弃该键。
    """
    if not isinstance(raw, dict):
        return {}
    result: dict[str, list[str]] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, list):
            continue
        examples = [s.strip() for s in value if isinstance(s, str) and s.strip()]
        if examples:
            result[key] = examples
    return result


def _parse_edge(e: dict[str, Any]) -> FlowEdge:
    return FlowEdge(
        id=str(e.get("id", "")),
        source=str(e.get("source", "")),
        target=str(e.get("target", "")),
        label=e.get("label"),
    )
