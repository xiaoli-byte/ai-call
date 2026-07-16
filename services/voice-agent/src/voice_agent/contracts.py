"""跨服务 HTTP 契约模型。

模型与 contracts/task-api.schema.json 对齐；所有来自 NestJS 的响应先在边界处校验，
避免把任意 dict 传入实时语音执行链。
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class FlowNodeContract(ContractModel):
    id: str
    type: Literal["start", "dialog", "action", "end"]
    position: dict[str, float]
    data: dict[str, Any] = Field(default_factory=dict)


class FlowEdgeContract(ContractModel):
    id: str
    source: str
    target: str
    label: Optional[str] = None
    # 边级意图例句（供 embedding 相似度匹配）。ContractModel 的 extra="ignore" 会丢弃
    # 未声明字段，缺这行会导致 voice-agent 拿到的 edge 无例句 → embedding 层被跳过。
    intent_examples: list[str] = Field(default_factory=list, alias="intentExamples")


class TaskFlowVersionContract(ContractModel):
    id: str
    flow_id: str = Field(alias="flowId")
    version: int
    name: str
    description: str = ""
    scenario_id: Optional[str] = Field(default=None, alias="scenarioId")
    scenario_config: Optional["ScenarioConfigContract"] = Field(default=None, alias="scenarioConfig")
    nodes: list[FlowNodeContract]
    edges: list[FlowEdgeContract]
    created_at: str = Field(alias="createdAt")


class EscalationRuleContract(ContractModel):
    description: str
    keywords: Optional[list[str]] = None
    emotions: Optional[list[str]] = None
    consecutive_misses: Optional[int] = Field(default=None, alias="consecutiveMisses")


class ScenarioConfigContract(ContractModel):
    id: Optional[str] = None
    scenario: str
    name: str
    description: str
    status: Optional[str] = None
    tts_config: dict[str, Any] = Field(default_factory=dict, alias="ttsConfig")
    agent_identity: str = Field(default="", alias="agentIdentity")
    communication_style: str = Field(default="", alias="communicationStyle")
    communication_style_prompt: str = Field(default="", alias="communicationStylePrompt")
    business_goal: str = Field(default="", alias="businessGoal")
    llm_constraints: list[str] = Field(default_factory=list, alias="llmConstraints")
    system_prompt: str = Field(alias="systemPrompt")
    greeting: str
    knowledge_base_id: str = Field(alias="knowledgeBaseId")
    allowed_tools: list[str] = Field(alias="allowedTools")
    escalation_rules: list[EscalationRuleContract] = Field(alias="escalationRules")
    default_flow_id: Optional[str] = Field(default=None, alias="defaultFlowId")
    # 对话修复配置（无应答重问/未理解澄清/静默超时等，见 shared 的 DialogRepairConfig）。
    # ContractModel 的 extra="ignore" 会丢弃未声明字段，缺这行会导致 API 返回的
    # dialogRepair 在边界被静默吞掉 → 场景自定义修复话术永远不生效（同 intentExamples 的坑）。
    dialog_repair: dict[str, Any] = Field(default_factory=dict, alias="dialogRepair")


class TaskContextContract(ContractModel):
    id: str
    tenant_id: Optional[str] = Field(default=None, alias="tenantId")
    owner_id: Optional[str] = Field(default=None, alias="ownerId")
    scenario: str
    variables: dict[str, str] = Field(default_factory=dict)
    scenario_config: Optional[ScenarioConfigContract] = Field(default=None, alias="scenarioConfig")
    flow_id: Optional[str] = Field(default=None, alias="flowId")
    flow_version_id: Optional[str] = Field(default=None, alias="flowVersionId")
    flow_version: Optional[TaskFlowVersionContract] = Field(default=None, alias="flowVersion")
