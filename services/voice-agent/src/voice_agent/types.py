"""Voice Agent 内部类型定义。

复刻自 packages/shared/src/providers.ts，保持 Python 与 TS 版本结构同构，
便于双向迁移与对照调试。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal, Optional


# ---------------------------------------------------------------------------
# STT（语音识别）
# ---------------------------------------------------------------------------


@dataclass
class STTEvent:
    """STT 流式回调事件。

    partial: 用户正在说话，text 是中间结果（可能被后续 final 修正）
    final:   检测到端点（用户说完），text 是整句最终结果
    """

    type: Literal["partial", "final"]
    text: str


# ---------------------------------------------------------------------------
# Function Calling 工具
# ---------------------------------------------------------------------------


@dataclass
class ToolDefinition:
    """Function Calling 工具定义（对应 OpenAI tools[].function）。"""

    name: str
    description: str
    parameters: dict[str, Any]


@dataclass
class ToolCall:
    """工具调用请求（arguments 为 dict，发送给 OpenAI 前由适配器序列化为字符串）。"""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ToolResult:
    """工具调用结果。"""

    tool_call_id: str
    result: Any
    should_escalate: bool = False


# ---------------------------------------------------------------------------
# LLM（大语言模型）
# ---------------------------------------------------------------------------


@dataclass
class LLMEvent:
    """LLM 流式回调事件。"""

    type: Literal["delta", "tool_call", "done"]
    content: Optional[str] = None
    tool_call: Optional[ToolCall] = None


# ---------------------------------------------------------------------------
# TTS（语音合成）
# ---------------------------------------------------------------------------


@dataclass
class TTSChunk:
    """TTS 流式音频块。"""

    audio: bytes
    sample_rate: int
    is_final: bool = False


# ---------------------------------------------------------------------------
# 聊天消息
# ---------------------------------------------------------------------------


@dataclass
class ChatMessage:
    """聊天消息（项目内部模型）。

    与 OpenAI Chat Completions 的差异由 LLM 适配器负责转换：
    - assistant.tool_calls → OpenAI message.tool_calls（arguments 会被 JSON.stringify）
    - tool.tool_call_id   → OpenAI message.tool_call_id
    """

    role: Literal["system", "user", "assistant", "tool"]
    content: str
    tool_calls: Optional[list[ToolCall]] = None
    tool_call_id: Optional[str] = None
    name: Optional[str] = None


# ---------------------------------------------------------------------------
# 通话会话
# ---------------------------------------------------------------------------


@dataclass
class CallSession:
    """通话会话上下文。"""

    call_id: str
    scenario: str
    variables: dict[str, str]
    messages: list[ChatMessage]
    tenant_id: Optional[str] = None
    user_id: Optional[str] = None
    tools: list[ToolDefinition] = field(default_factory=list)


# ---------------------------------------------------------------------------
# 业务场景
# ---------------------------------------------------------------------------


class Scenario(str, Enum):
    COLLECTION = "collection"
    ECOMMERCE = "ecommerce"
    PRESALE = "presale"


@dataclass
class EscalationRule:
    """转人工触发规则。"""

    description: str
    keywords: Optional[list[str]] = None
    emotions: Optional[list[str]] = None
    consecutive_misses: Optional[int] = None


@dataclass
class ScenarioConfig:
    """业务场景配置。"""

    scenario: str | Scenario
    name: str
    description: str
    system_prompt: str
    greeting: str
    knowledge_base_id: str
    allowed_tools: list[str]
    escalation_rules: list[EscalationRule]
    tts_config: dict[str, Any] = field(default_factory=dict)
    agent_identity: str = ""
    communication_style: str = ""
    communication_style_prompt: str = ""
    business_goal: str = ""
    llm_constraints: list[str] = field(default_factory=list)
    default_flow_id: Optional[str] = None


# ---------------------------------------------------------------------------
# 通话结果（与 packages/shared/src/tasks.ts 对齐）
# ---------------------------------------------------------------------------


class CallOutcome(str, Enum):
    HIGH_INTENT = "high_intent"
    MEDIUM_INTENT = "medium_intent"
    LOW_INTENT = "low_intent"
    REJECTED = "rejected"
    UNREACHED = "unreached"
    ESCALATED = "escalated"
    ERROR = "error"
    COMPLETED = "completed"
