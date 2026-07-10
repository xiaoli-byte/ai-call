"""web 通道（浏览器直连 /audio-stream）行为测试。

契约：docs/superpowers/specs/2026-07-10-voice-test-call-design.md §2
- channel=="web"：字幕/事件走同一 WS 的文本帧，且仍照常上报 NestJS
- channel 缺省/freeswitch：不发任何文本帧（防 FreeSWITCH 把 JSON 当音频播）
- web 断线兜底：会话未正常收尾时调用 tasks.hangup 推任务到终态
"""

from __future__ import annotations

import asyncio
import base64
import json

import pytest

from voice_agent.server import VoiceAgentServer, WebSocketCallbacks


class FakeWebSocket:
    open = True

    def __init__(self) -> None:
        self.messages: list[bytes | str] = []

    async def send(self, message: bytes | str) -> None:
        self.messages.append(message)


class FakeTasks:
    def __init__(self) -> None:
        self.transcripts: list[tuple[str, str, str]] = []
        self.hangups: list[tuple[str, bool]] = []

    async def get_task(self, _task_id: str):
        return None

    async def append_transcript(
        self,
        task_id: str,
        role: str,
        content: str,
        *_args: object,
        **_kwargs: object,
    ) -> None:
        self.transcripts.append((task_id, role, content))

    async def hangup(self, task_id: str, *, quiet: bool = False) -> None:
        self.hangups.append((task_id, quiet))


class StreamingWebSocket:
    """模拟浏览器：首帧 metadata + 若干 PCM 帧后断开。"""

    open = True

    def __init__(self, metadata: dict) -> None:
        encoded = base64.b64encode(json.dumps(metadata).encode()).decode()
        self.messages: list[bytes | str] = [f"base64:{encoded}", b"\x01\x02"]
        self.sent: list[bytes | str] = []

    def __aiter__(self):
        return self

    async def __anext__(self):
        # 让出事件循环，让 create_task 出来的 session 任务有机会被调度
        # （真实场景中 ws.recv 的网络 IO 天然让出）
        await asyncio.sleep(0)
        if not self.messages:
            raise StopAsyncIteration
        return self.messages.pop(0)

    async def send(self, message: bytes | str) -> None:
        self.sent.append(message)


class FakeAgent:
    def __init__(self) -> None:
        self.audio: list[bytes] = []
        self.ended: list[str] = []

    async def receive_audio(self, _call_id: str, audio: bytes) -> None:
        self.audio.append(audio)

    async def end_session(self, call_id: str) -> None:
        self.ended.append(call_id)


def _make_server(tasks: FakeTasks) -> VoiceAgentServer:
    server = VoiceAgentServer.__new__(VoiceAgentServer)
    server._agent = FakeAgent()
    server._tasks = tasks
    return server


def _text_frames(ws: FakeWebSocket) -> list[dict]:
    return [json.loads(m) for m in ws.messages if isinstance(m, str)]


# ---------------------------------------------------------------------------
# ① channel=web：字幕文本帧 + 照常上报 NestJS
# ---------------------------------------------------------------------------


async def test_web_channel_sends_subtitle_frames_and_reports_transcript() -> None:
    ws = FakeWebSocket()
    tasks = FakeTasks()
    callbacks = WebSocketCallbacks(ws, "call-1", tasks, channel="web")

    await callbacks.on_agent_speech("您好，请问是张三吗")
    await callbacks.on_caller_speech("是的")

    assert _text_frames(ws) == [
        {"type": "agent_speech", "text": "您好，请问是张三吗"},
        {"type": "caller_speech", "text": "是的"},
    ]
    # 仍照常上报 NestJS transcript
    assert tasks.transcripts == [
        ("call-1", "agent", "您好，请问是张三吗"),
        ("call-1", "caller", "是的"),
    ]


async def test_web_channel_audio_stays_binary() -> None:
    """web 通道下音频回程仍走二进制帧（raw-pcm 分支零改动）。"""
    ws = FakeWebSocket()
    callbacks = WebSocketCallbacks(ws, "call-1", FakeTasks(), channel="web")

    await callbacks.on_audio_output(b"\x01\x02")

    assert b"\x01\x02" in ws.messages


# ---------------------------------------------------------------------------
# ② channel 缺省 / freeswitch：不发任何文本帧（防 FreeSWITCH 噪声回归）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("kwargs", [{}, {"channel": "freeswitch"}])
async def test_non_web_channel_never_sends_text_frames(kwargs: dict) -> None:
    ws = FakeWebSocket()
    tasks = FakeTasks()
    callbacks = WebSocketCallbacks(ws, "call-1", tasks, **kwargs)

    await callbacks.on_agent_speech("您好")
    await callbacks.on_caller_speech("你好")
    await callbacks.on_end("对话结束")

    assert [m for m in ws.messages if isinstance(m, str)] == []
    # transcript 上报不受影响
    assert tasks.transcripts == [
        ("call-1", "agent", "您好"),
        ("call-1", "caller", "你好"),
    ]


# ---------------------------------------------------------------------------
# ③ web 会话断线清理：任务未终态时调用 hangup 兜底
# ---------------------------------------------------------------------------


async def test_web_disconnect_before_session_end_triggers_hangup() -> None:
    """浏览器中途关 WS → 会话被 cancel（set_outcome 未执行）→ hangup 兜底。"""
    tasks = FakeTasks()
    server = _make_server(tasks)

    async def never_finishing_session(*_args: object) -> bool:
        await asyncio.sleep(3600)
        return True

    server._start_agent_session = never_finishing_session
    ws = StreamingWebSocket({"dialog_id": "call-1", "channel": "web"})

    await server._handle_audio_stream(ws)

    assert tasks.hangups == [("call-1", True)]
    assert server._agent.ended == ["call-1"]


async def test_web_session_completed_normally_skips_hangup() -> None:
    """会话正常收尾（agent 内部已 set_outcome）时不再调用 hangup。"""
    tasks = FakeTasks()
    server = _make_server(tasks)

    async def completed_session(*_args: object) -> bool:
        return True

    server._start_agent_session = completed_session
    ws = StreamingWebSocket({"dialog_id": "call-1", "channel": "web"})

    await server._handle_audio_stream(ws)

    assert tasks.hangups == []


@pytest.mark.parametrize(
    "metadata",
    [{"dialog_id": "call-1"}, {"dialog_id": "call-1", "channel": "freeswitch"}],
)
async def test_non_web_disconnect_never_triggers_hangup(metadata: dict) -> None:
    """FreeSWITCH 路径断线行为零变化：不做 hangup 兜底。"""
    tasks = FakeTasks()
    server = _make_server(tasks)

    async def never_finishing_session(*_args: object) -> bool:
        await asyncio.sleep(3600)
        return True

    server._start_agent_session = never_finishing_session

    await server._handle_audio_stream(StreamingWebSocket(metadata))

    assert tasks.hangups == []


# ---------------------------------------------------------------------------
# ④ 会话结束 / 错误事件帧
# ---------------------------------------------------------------------------


async def test_web_channel_sends_end_frame_on_session_end() -> None:
    ws = FakeWebSocket()
    callbacks = WebSocketCallbacks(ws, "call-1", FakeTasks(), channel="web")

    await callbacks.on_end("对话结束")

    assert _text_frames(ws)[-1] == {"type": "end", "reason": "对话结束"}


async def test_web_channel_sends_error_frame_when_session_fails() -> None:
    class ExplodingAgent:
        async def start_session(self, *_args: object, **_kwargs: object) -> None:
            raise RuntimeError("boom")

    tasks = FakeTasks()
    server = VoiceAgentServer(
        host="127.0.0.1",
        port=0,
        path="/audio-stream",
        agent=ExplodingAgent(),
        tasks=tasks,
    )
    ws = FakeWebSocket()

    finalized = await server._start_agent_session(
        ws, "call-1", {"channel": "web"}
    )

    assert finalized is False
    assert {"type": "error", "message": "boom"} in _text_frames(ws)


async def test_freeswitch_session_failure_sends_no_error_frame() -> None:
    class ExplodingAgent:
        async def start_session(self, *_args: object, **_kwargs: object) -> None:
            raise RuntimeError("boom")

    server = VoiceAgentServer(
        host="127.0.0.1",
        port=0,
        path="/audio-stream",
        agent=ExplodingAgent(),
        tasks=FakeTasks(),
    )
    ws = FakeWebSocket()

    finalized = await server._start_agent_session(ws, "call-1", {})

    assert finalized is False
    assert ws.messages == []
