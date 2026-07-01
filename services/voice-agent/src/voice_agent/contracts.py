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
    type: Literal["start", "dialog", "decision", "action", "end"]
    position: dict[str, float]
    data: dict[str, Any] = Field(default_factory=dict)


class FlowEdgeContract(ContractModel):
    id: str
    source: str
    target: str
    label: Optional[str] = None


class TaskFlowVersionContract(ContractModel):
    id: str
    flow_id: str = Field(alias="flowId")
    version: int
    name: str
    description: str = ""
    nodes: list[FlowNodeContract]
    edges: list[FlowEdgeContract]
    created_at: str = Field(alias="createdAt")


class EscalationRuleContract(ContractModel):
    description: str
    keywords: Optional[list[str]] = None
    emotions: Optional[list[str]] = None
    consecutive_misses: Optional[int] = Field(default=None, alias="consecutiveMisses")


class ScenarioConfigContract(ContractModel):
    scenario: Literal["collection", "ecommerce", "presale"]
    name: str
    description: str
    system_prompt: str = Field(alias="systemPrompt")
    greeting: str
    knowledge_base_id: str = Field(alias="knowledgeBaseId")
    allowed_tools: list[str] = Field(alias="allowedTools")
    escalation_rules: list[EscalationRuleContract] = Field(alias="escalationRules")


class TaskContextContract(ContractModel):
    id: str
    scenario: str
    variables: dict[str, str] = Field(default_factory=dict)
    scenario_config: Optional[ScenarioConfigContract] = Field(default=None, alias="scenarioConfig")
    flow_id: Optional[str] = Field(default=None, alias="flowId")
    flow_version_id: Optional[str] = Field(default=None, alias="flowVersionId")
    flow_version: Optional[TaskFlowVersionContract] = Field(default=None, alias="flowVersion")
