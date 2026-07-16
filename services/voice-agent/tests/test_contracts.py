from __future__ import annotations

import pytest
from pydantic import ValidationError

from voice_agent.contracts import TaskContextContract
from voice_agent.repair_phrases import RepairPhrases
from voice_agent.scenarios import scenario_from_contract

# 最小可校验的场景配置（含 dialogRepair 自定义值），供回归测试复用
_SCENARIO_CONFIG_WITH_REPAIR = {
    "scenario": "ecommerce",
    "name": "回访",
    "description": "",
    "systemPrompt": "prompt",
    "greeting": "您好",
    "knowledgeBaseId": "kb-1",
    "allowedTools": [],
    "escalationRules": [],
    "dialogRepair": {
        "silenceTimeoutMs": 8000,
        "maxSilenceRounds": 3,
        "sideQuestionResumePrompt": "x",
    },
}


def test_task_context_accepts_published_flow_version() -> None:
    contract = TaskContextContract.model_validate(
        {
            "id": "task-1",
            "tenantId": "tenant-1",
            "ownerId": "user-1",
            "scenario": "ecommerce",
            "variables": {"customerName": "张三"},
            "flowId": "flow-1",
            "flowVersionId": "version-1",
            "flowVersion": {
                "id": "version-1",
                "flowId": "flow-1",
                "version": 1,
                "name": "回访",
                "description": "",
                "nodes": [{"id": "start", "type": "start", "position": {"x": 0, "y": 0}, "data": {}}],
                "edges": [],
                "createdAt": "2026-07-01T00:00:00.000Z",
            },
        }
    )
    assert contract.flow_version is not None
    assert contract.tenant_id == "tenant-1"
    assert contract.owner_id == "user-1"
    assert contract.flow_version.version == 1


def test_task_context_rejects_removed_decision_node_type() -> None:
    with pytest.raises(ValidationError):
        TaskContextContract.model_validate(
            {
                "id": "task-1",
                "scenario": "ecommerce",
                "variables": {},
                "flowVersion": {
                    "id": "version-1",
                    "flowId": "flow-1",
                    "version": 1,
                    "name": "bad",
                    "nodes": [{"id": "x", "type": "decision", "position": {"x": 0, "y": 0}, "data": {}}],
                    "edges": [],
                    "createdAt": "2026-07-01T00:00:00.000Z",
                },
            }
        )


def test_scenario_config_preserves_dialog_repair_after_dump() -> None:
    """回归：extra="ignore" 曾静默丢弃 dialogRepair，导致场景自定义修复话术从未生效。"""
    dumped = TaskContextContract.model_validate(
        {
            "id": "task-1",
            "scenario": "ecommerce",
            "variables": {},
            "scenarioConfig": _SCENARIO_CONFIG_WITH_REPAIR,
        }
    ).model_dump(by_alias=True)
    assert dumped["scenarioConfig"]["dialogRepair"] == {
        "silenceTimeoutMs": 8000,
        "maxSilenceRounds": 3,
        "sideQuestionResumePrompt": "x",
    }


def test_flow_version_scenario_config_preserves_dialog_repair() -> None:
    """回归：flow 快照（flowVersion.scenarioConfig）里的 dialogRepair 同样必须完整保留。"""
    dumped = TaskContextContract.model_validate(
        {
            "id": "task-1",
            "scenario": "ecommerce",
            "variables": {},
            "flowVersion": {
                "id": "version-1",
                "flowId": "flow-1",
                "version": 1,
                "name": "回访",
                "description": "",
                "scenarioConfig": _SCENARIO_CONFIG_WITH_REPAIR,
                "nodes": [{"id": "start", "type": "start", "position": {"x": 0, "y": 0}, "data": {}}],
                "edges": [],
                "createdAt": "2026-07-01T00:00:00.000Z",
            },
        }
    ).model_dump(by_alias=True)
    assert dumped["flowVersion"]["scenarioConfig"]["dialogRepair"] == {
        "silenceTimeoutMs": 8000,
        "maxSilenceRounds": 3,
        "sideQuestionResumePrompt": "x",
    }


def test_dialog_repair_flows_through_to_repair_phrases() -> None:
    """端到端：契约 dump → scenario_from_contract → RepairPhrases.from_config 取到自定义值。"""
    dumped = TaskContextContract.model_validate(
        {
            "id": "task-1",
            "scenario": "ecommerce",
            "variables": {},
            "scenarioConfig": _SCENARIO_CONFIG_WITH_REPAIR,
        }
    ).model_dump(by_alias=True)
    scenario = scenario_from_contract(dumped["scenarioConfig"])
    phrases = RepairPhrases.from_config(scenario.dialog_repair)
    assert phrases.silence_timeout_ms == 8000
    assert phrases.max_silence_rounds == 3
    assert phrases.side_question_resume_prompt == "x"
