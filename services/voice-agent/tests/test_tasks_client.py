from __future__ import annotations

import httpx
import pytest

from voice_agent.tasks import TaskClient


@pytest.mark.asyncio
async def test_get_task_flow_uses_runtime_service_endpoint() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"id": "flow-1", "nodes": [], "edges": []})

    client = TaskClient(
        api_base_url="http://api.test/api",
        service_token="service-token",
    )
    await client._client.aclose()
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        headers={"X-Service-Token": "service-token"},
    )

    try:
        flow = await client.get_task_flow("flow-1")
    finally:
        await client.close()

    assert flow == {"id": "flow-1", "nodes": [], "edges": []}
    assert str(requests[0].url) == "http://api.test/api/task-flows/flow-1/runtime"
    assert requests[0].headers["x-service-token"] == "service-token"
