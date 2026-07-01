from __future__ import annotations

import pytest
from pydantic import ValidationError

from voice_agent.contracts import TaskContextContract


def test_task_context_accepts_published_flow_version() -> None:
    contract = TaskContextContract.model_validate(
        {
            "id": "task-1",
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
    assert contract.flow_version.version == 1


def test_task_context_rejects_invalid_node_type() -> None:
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
                    "nodes": [{"id": "x", "type": "shell", "position": {"x": 0, "y": 0}, "data": {}}],
                    "edges": [],
                    "createdAt": "2026-07-01T00:00:00.000Z",
                },
            }
        )
