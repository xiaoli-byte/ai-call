from __future__ import annotations

import asyncio
import base64
import json

import pytest

from voice_agent.agent import VoiceAgent
from voice_agent.scenarios import get_scenario
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
        self.flow: dict | None = None

    async def get_task(self, task_id: str):
        if self.task and self.task.get("id") == task_id:
            return self.task
        return None

    async def get_task_flow(self, flow_id: str):
        if self.flow and self.flow.get("id") == flow_id:
            return self.flow
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


class TextTestWebSocket(FakeWebSocket):
    """/text-test 假连接：recv() 弹出第一帧（start），随后 async-for 依次给出后续帧。"""

    def __init__(self, frames: list[str]) -> None:
        super().__init__()
        self._frames = list(frames)

    async def recv(self) -> str:
        return self._frames.pop(0)

    def __aiter__(self):
        return self

    async def __anext__(self):
        # 每帧之间让出事件循环，保证 create_task 启动的会话任务有机会执行
        await asyncio.sleep(0)
        if not self._frames:
            raise StopAsyncIteration
        return self._frames.pop(0)


class CapturingAgent:
    """记录 start_session 入参的假 Agent（用于断言 /text-test 传入的场景配置）。"""

    def __init__(self) -> None:
        self.sessions: list[dict] = []
        self.ended: list[str] = []

    async def start_session(
        self,
        call_id: str,
        scenario,
        variables,
        callbacks,
        *,
        flow_version=None,
        dry_run: bool = False,
        **_kwargs,
    ) -> None:
        self.sessions.append(
            {
                "call_id": call_id,
                "scenario": scenario,
                "variables": variables,
                "flow_version": flow_version,
                "dry_run": dry_run,
            }
        )

    async def inject_user_text(self, call_id: str, text: str) -> None:
        pass

    async def end_session(self, call_id: str) -> None:
        self.ended.append(call_id)


def _text_test_flow(scenario_config: dict | None) -> dict:
    """构造 /text-test 用的最小流程 dict（可选携带绑定场景的 scenarioConfig）。"""
    flow: dict = {
        "id": "flow-1",
        "flowId": "flow-1",
        "version": 1,
        "name": "调试流程",
        "nodes": [],
        "edges": [],
        "createdAt": "2026-07-16T00:00:00.000Z",
    }
    if scenario_config is not None:
        flow["scenarioConfig"] = scenario_config
    return flow


@pytest.mark.asyncio
async def test_text_test_uses_flow_bound_scenario_config() -> None:
    """/text-test 使用流程绑定场景的真实配置（含自定义 dialogRepair.sideQuestionAck）。"""
    tasks = FakeTasks()
    tasks.flow = _text_test_flow(
        {
            "scenario": "custom_scene",
            "name": "自定义场景",
            "description": "",
            "systemPrompt": "你是自定义场景的客服",
            "greeting": "您好，这里是自定义场景",
            "knowledgeBaseId": "",
            "allowedTools": [],
            "escalationRules": [],
            "dialogRepair": {"sideQuestionAck": "稍等哈，我马上帮您查。"},
        }
    )
    agent = CapturingAgent()
    server = VoiceAgentServer(
        host="127.0.0.1", port=0, path="/text-test", agent=agent, tasks=tasks
    )
    ws = TextTestWebSocket(
        [
            json.dumps({"type": "start", "flowId": "flow-1"}),
            json.dumps({"type": "hangup"}),
        ]
    )

    await server._handle_text_test(ws)

    assert len(agent.sessions) == 1
    session = agent.sessions[0]
    assert session["dry_run"] is True
    assert session["flow_version"] is tasks.flow
    scenario = session["scenario"]
    # 场景来自流程绑定的 scenarioConfig，而非硬编码内置 ecommerce
    assert scenario.scenario == "custom_scene"
    assert scenario.name == "自定义场景"
    assert scenario.system_prompt == "你是自定义场景的客服"
    # 自定义插话应答过渡语随场景配置透传到运行时
    assert scenario.dialog_repair == {"sideQuestionAck": "稍等哈，我马上帮您查。"}


@pytest.mark.asyncio
async def test_text_test_falls_back_to_builtin_scenario_without_config() -> None:
    """流程未绑定场景（无 scenarioConfig）时，/text-test 回退内置 ecommerce 场景。"""
    tasks = FakeTasks()
    tasks.flow = _text_test_flow(None)
    agent = CapturingAgent()
    server = VoiceAgentServer(
        host="127.0.0.1", port=0, path="/text-test", agent=agent, tasks=tasks
    )
    ws = TextTestWebSocket(
        [
            json.dumps({"type": "start", "flowId": "flow-1"}),
            json.dumps({"type": "hangup"}),
        ]
    )

    await server._handle_text_test(ws)

    assert len(agent.sessions) == 1
    assert agent.sessions[0]["scenario"] is get_scenario("ecommerce")


@pytest.mark.asyncio
async def test_audio_fork_receives_raw_pcm() -> None:
    ws = FakeWebSocket()
    callbacks = WebSocketCallbacks(ws, "call-1", FakeTasks())

    await callbacks.on_audio_output(b"\x01\x02")

    assert ws.messages == [b"\x01\x02"]


@pytest.mark.asyncio
async def test_far_end_observer_receives_pcm_at_transport_send_boundary(
    monkeypatch,
) -> None:
    monkeypatch.setenv("TTS_PACED_DELIVERY_ENABLED", "false")
    ws = FakeWebSocket()
    callbacks = WebSocketCallbacks(ws, "call-observer", FakeTasks(), channel="web")
    observed: list[bytes] = []

    def observer(pcm: bytes) -> None:
        # The websocket has not been written yet: this is the exact pre-send tap.
        assert ws.messages == []
        observed.append(pcm)

    callbacks.set_far_end_observer(observer)
    await callbacks.on_audio_output(b"\x01\x02")

    assert observed == [b"\x01\x02"]
    assert ws.messages == [b"\x01\x02"]
    callbacks.clear_far_end_observer(observer)
    assert callbacks._far_end_observer is None


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


class FakeESL:
    """模拟既有 ESL 控制连接。"""

    def __init__(self, fail: bool = False) -> None:
        self.commands: list[str] = []
        self.fail = fail

    async def api(self, command: str) -> str:
        self.commands.append(command)
        if self.fail:
            raise RuntimeError("-ERR no such channel")
        return "+OK"


@pytest.mark.asyncio
async def test_esl_file_interrupt_sends_uuid_break() -> None:
    """FreeSWITCH esl-file 播放通道：on_interrupted 经 ESL 发 uuid_break。"""
    ws = FakeWebSocket()
    callbacks = WebSocketCallbacks(
        ws,
        "call-1",
        FakeTasks(),
        audio_response_format="esl-file",
    )
    esl = FakeESL()
    callbacks._playback_esl = esl  # 复用既有 ESL 控制连接
    callbacks._playback_buffer.extend(b"\x01" * 64)  # 未落盘的 TTS 残余

    await callbacks.on_interrupted()

    assert esl.commands == ["uuid_break call-1 all"]
    # 残余播放缓冲应被清空，避免打断后续播旧内容
    assert len(callbacks._playback_buffer) == 0
    # 不向 FreeSWITCH 发任何文本帧
    assert ws.messages == []


@pytest.mark.asyncio
async def test_esl_file_interrupt_failure_only_warns() -> None:
    """uuid_break 失败（如通道已挂断）仅 warn，不向上抛异常。"""
    callbacks = WebSocketCallbacks(
        FakeWebSocket(),
        "call-1",
        FakeTasks(),
        audio_response_format="esl-file",
    )
    esl = FakeESL(fail=True)
    callbacks._playback_esl = esl

    await callbacks.on_interrupted()  # 不应抛异常

    assert esl.commands == ["uuid_break call-1 all"]


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
