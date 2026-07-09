from __future__ import annotations

import httpx
import pytest

from voice_agent.rag import RagService
from voice_agent.scenarios import SCENARIO_CONFIGS
from voice_agent.types import Scenario


@pytest.mark.asyncio
async def test_rag_retrieve_forwards_service_token_and_identity_headers() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "query": "怎么延期",
                "results": [
                    {
                        "id": "chunk-1",
                        "content": "外部知识片段",
                        "source": "external.md",
                        "score": 0.91,
                    }
                ],
            },
        )

    rag = RagService(
        api_base_url="http://api.test/api",
        service_token="service-token",
    )
    await rag._client.aclose()
    rag._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        headers={"X-Service-Token": "service-token"},
    )

    try:
        context = await rag.retrieve(
            SCENARIO_CONFIGS[Scenario.ECOMMERCE],
            "怎么延期",
            tenant_id="tenant-1",
            user_id="user-1",
        )
    finally:
        await rag.close()

    assert "external.md" in context
    assert str(requests[0].url).endswith(
        f"/knowledge-base/{SCENARIO_CONFIGS[Scenario.ECOMMERCE].knowledge_base_id}/retrieve"
    )
    assert requests[0].headers["x-service-token"] == "service-token"
    assert requests[0].headers["x-tenant-id"] == "tenant-1"
    assert requests[0].headers["x-user-id"] == "user-1"
