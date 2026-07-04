from __future__ import annotations

import base64
import json

import pytest

from voice_agent.agent import VoiceAgent
from voice_agent.server import VoiceAgentServer, WebSocketCallbacks
from voice_agent.text_test_callbacks import TextTestCallbacks


class FakeWebSocket:
    open = True

    def __init__(self) -> None:
        self.messages: list[bytes | str] = []

    async def send(self, message: bytes | str) -> None:
        self.messages.append(message)


class FakeTasks:
    def __init__(self) -> None:
        self.transfers: list[tuple[str, str | None]] = []
        self.statuses: list[tuple[str, str]] = []
        self.transcripts: list[tuple[str, str, str]] = []
        self.hangups: list[str] = []
        self.outcomes: list[tuple[str, str]] = []
        self.task: dict | None = None

    async def get_task(self, task_id: str):
        if self.task and self.task.get("id") == task_id:
            return self.task
        return None

    async def update_status(self, task_id: str, status: str) -> None:
        self.statuses.append((task_id, status))

    async def append_transcript(
        self,
        task_id: str,
        role: str,
        content: str,
        *_args: object,
        **_kwargs: object,
    ) -> None:
        self.transcripts.append((task_id, role, content))

    async def transfer_to_human(self, task_id: str, extension: str | None = None) -> None:
        self.transfers.append((task_id, extension))

    async def hangup(self, task_id: str) -> None:
        self.hangups.append(task_id)

    async def set_outcome(self, task_id: str, outcome: str, *_args: object) -> None:
        self.outcomes.append((task_id, outcome))


@pytest.mark.asyncio
async def test_text_test_events_include_current_node() -> None:
    ws = FakeWebSocket()
    callbacks = TextTestCallbacks(ws, "test-call")

    await callbacks.on_node_enter("node-1", "对话(ai)")
    await callbacks.on_agent_speech("您好")
    await callbacks.on_action("crm", {"action": "create_after_sale_ticket"})

    speech = json.loads(str(ws.messages[1]))
    action = json.loads(str(ws.messages[2]))

    assert speech["nodeId"] == "node-1"
    assert speech["nodeName"] == "对话(ai)"
    assert action["nodeId"] == "node-1"
    assert action["nodeName"] == "对话(ai)"


@pytest.mark.asyncio
async def test_audio_fork_receives_raw_pcm() -> None:
    ws = FakeWebSocket()
    callbacks = WebSocketCallbacks(ws, "call-1", FakeTasks())

    await callbacks.on_audio_output(b"\x01\x02")

    assert ws.messages == [b"\x01\x02"]


@pytest.mark.asyncio
async def test_audio_stream_receives_base64_json() -> None:
    ws = FakeWebSocket()
    callbacks = WebSocketCallbacks(
        ws,
        "call-1",
        FakeTasks(),
        audio_response_format="base64-json",
    )

    await callbacks.on_audio_output(b"\x01\x02")

    payload = json.loads(str(ws.messages[0]))
    assert payload["type"] == "streamAudio"
    assert payload["data"]["audioDataType"] == "raw"
    assert payload["data"]["sampleRate"] == 16000
    assert base64.b64decode(payload["data"]["audioData"]) == b"\x01\x02"


def test_rejects_unknown_audio_response_format() -> None:
    with pytest.raises(ValueError, match="Unsupported audio response format"):
        WebSocketCallbacks(
            FakeWebSocket(),
            "call-1",
            FakeTasks(),
            audio_response_format="mp3",
        )


@pytest.mark.asyncio
async def test_escalation_forwards_extension() -> None:
    tasks = FakeTasks()
    callbacks = WebSocketCallbacks(FakeWebSocket(), "call-1", tasks)

    await callbacks.on_escalate("客户要求人工", "1001")

    assert tasks.transfers == [("call-1", "1001")]


@pytest.mark.asyncio
async def test_audio_stream_counts_and_forwards_pcm() -> None:
    class StreamingWebSocket:
        def __init__(self) -> None:
            metadata = base64.b64encode(
                json.dumps({"dialog_id": "call-1"}).encode()
            ).decode()
            self.messages = [f"base64:{metadata}", b"\x01\x02", b"\x03\x04"]

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self.messages:
                raise StopAsyncIteration
            return self.messages.pop(0)

    class FakeAgent:
        def __init__(self) -> None:
            self.audio: list[bytes] = []
            self.ended: list[str] = []

        async def receive_audio(self, _call_id: str, audio: bytes) -> None:
            self.audio.append(audio)

        async def end_session(self, call_id: str) -> None:
            self.ended.append(call_id)

    agent = FakeAgent()
    server = VoiceAgentServer.__new__(VoiceAgentServer)
    server._agent = agent

    async def fake_start(*_args: object) -> None:
        return None

    server._start_agent_session = fake_start
    await server._handle_audio_stream(StreamingWebSocket())

    assert agent.audio == [b"\x01\x02", b"\x03\x04"]
    assert agent.ended == ["call-1"]


@pytest.mark.asyncio
async def test_audio_stream_start_loads_task_and_executes_locked_flow() -> None:
    """FreeSWITCH attemptId -> task context -> in_call -> flow action/end."""
    tasks = FakeTasks()
    tasks.task = {
        "id": "attempt-1",
        "scenario": "ecommerce",
        "variables": {"company": "测试公司"},
        "flowVersion": {
            "id": "version-1",
            "name": "locked flow",
            "nodes": [
                {"id": "start", "type": "start", "data": {}},
                {
                    "id": "welcome",
                    "type": "dialog",
                    "data": {"mode": "script", "text": "您好，{company}"},
                },
                {
                    "id": "transfer",
                    "type": "action",
                    "data": {
                        "actionType": "transfer",
                        "config": {"extension": "1001", "reason": "客户要求人工"},
                    },
                },
                {
                    "id": "end",
                    "type": "end",
                    "data": {"mode": "hangup", "farewell": "请稍候"},
                },
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "welcome"},
                {"id": "e2", "source": "welcome", "target": "transfer"},
                {"id": "e3", "source": "transfer", "target": "end"},
            ],
        },
    }
    agent = VoiceAgent(llm=None, tts=None, tasks=tasks)
    server = VoiceAgentServer(
        host="127.0.0.1",
        port=0,
        path="/audio-stream",
        agent=agent,
        tasks=tasks,
    )

    await server._start_agent_session(FakeWebSocket(), "attempt-1", {})
    await agent.end_session("attempt-1")

    assert tasks.statuses == [("attempt-1", "in_call")]
    assert tasks.transcripts == [
        ("attempt-1", "agent", "您好，测试公司"),
        ("attempt-1", "agent", "请稍候"),
    ]
    assert tasks.transfers == [("attempt-1", "1001")]
    assert tasks.hangups == ["attempt-1"]
    assert tasks.outcomes == [("attempt-1", "escalated")]
