"""DashScopeFunASRClient（云端 Fun-ASR 实时识别）协议交互回归测试。

用 FakeWS 替换 websockets.connect，不发真实网络请求，验证：
- run-task 指令格式（action/model/format/sample_rate）
- task-started 后 connect 完成
- result-generated：sentence_end=False→partial、True→final
- send_audio 发二进制帧、连接前缓冲 flush
- end_speech 为 no-op（不向服务端发送任何内容）
- close 发 finish-task
- 防御性取文本（output.text 兜底）
- create_stt_client 工厂：缺 key 回退本地、dashscope 正常选择
"""

from __future__ import annotations

import asyncio
import json

import pytest
import websockets

from voice_agent.stt import (
    DashScopeFunASRClient,
    FunASRClient,
    create_stt_client,
)


class FakeWS:
    """最小 WebSocket 桩：记录 client 发送内容，按序吐出服务端消息后结束。"""

    def __init__(self, server_msgs: list[str]) -> None:
        self.sent: list[object] = []
        self._msgs = list(server_msgs)
        self.closed = False

    async def send(self, data: object) -> None:
        self.sent.append(data)

    def __aiter__(self) -> "FakeWS":
        return self

    async def __anext__(self) -> str:
        await asyncio.sleep(0)  # 让出控制权，模拟异步收帧
        if self._msgs:
            return self._msgs.pop(0)
        raise StopAsyncIteration

    async def close(self) -> None:
        self.closed = True


def _patch_connect(monkeypatch: pytest.MonkeyPatch, fake: FakeWS) -> None:
    async def fake_connect(*_args: object, **_kwargs: object) -> FakeWS:
        return fake

    monkeypatch.setattr(websockets, "connect", fake_connect)


def _msg(event: str, payload: dict | None = None) -> str:
    return json.dumps({"header": {"event": event}, "payload": payload or {}})


def _result(text: str, sentence_end: bool) -> str:
    return _msg(
        "result-generated",
        {"output": {"sentence": {"text": text, "sentence_end": sentence_end}}},
    )


async def _drain() -> None:
    """让 background recv_loop 有机会处理完已排队的服务端消息。"""
    for _ in range(5):
        await asyncio.sleep(0)


async def test_run_task_format_and_partial_final(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeWS(
        [
            _msg("task-started"),
            _result("你好", False),
            _result("你好世界", True),
        ]
    )
    _patch_connect(monkeypatch, fake)

    events: list[tuple[str, str]] = []

    async def on_event(ev) -> None:
        events.append((ev.type, ev.text))

    client = DashScopeFunASRClient(call_id="t1", api_key="k", on_event=on_event)
    await client.connect()
    await client.send_audio(b"\x00" * 640)  # 首帧音频触发 run-task（延迟发，防空闲超时）
    await _drain()

    # run-task 由首帧音频触发（不再在 connect 时立即发）
    text_frames = [json.loads(d) for d in fake.sent if isinstance(d, str)]
    run_task = next(f for f in text_frames if f["header"].get("action") == "run-task")
    assert run_task["payload"]["model"] == "fun-asr-realtime"
    assert run_task["payload"]["parameters"] == {"format": "pcm", "sample_rate": 16000}
    assert run_task["payload"]["task"] == "asr"

    assert ("partial", "你好") in events
    assert ("final", "你好世界") in events

    await client.close()


async def test_send_audio_and_pre_connect_buffering(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeWS([_msg("task-started")])
    _patch_connect(monkeypatch, fake)

    client = DashScopeFunASRClient(call_id="t2", api_key="k")
    # 连接前发送 → 应缓冲
    await client.send_audio(b"\x01" * 640)
    await client.connect()
    await _drain()
    # 连接后发送
    await client.send_audio(b"\x02" * 640)

    binary_sent = [d for d in fake.sent if isinstance(d, (bytes, bytearray))]
    assert b"\x01" * 640 in binary_sent  # 缓冲的被 flush
    assert b"\x02" * 640 in binary_sent

    await client.close()


async def test_end_speech_sends_no_ws_message(monkeypatch: pytest.MonkeyPatch) -> None:
    # end_speech 只在本地合成 final（不向服务端发 WS 指令）；无 partial 时什么都不做
    fake = FakeWS([_msg("task-started")])
    _patch_connect(monkeypatch, fake)

    events: list[tuple[str, str]] = []

    async def on_event(ev) -> None:
        events.append((ev.type, ev.text))

    client = DashScopeFunASRClient(call_id="t3", api_key="k", on_event=on_event)
    await client.connect()
    await _drain()
    sent_before = len(fake.sent)
    await client.end_speech()  # 尚无 partial
    assert len(fake.sent) == sent_before  # 不向服务端发任何 WS 消息
    assert events == []  # 无 partial → 不合成 final

    await client.close()


async def test_end_speech_finalizes_last_partial(monkeypatch: pytest.MonkeyPatch) -> None:
    # 门控架构下服务端收不到句尾静音，end_speech 用最近 partial 兜底成 final
    fake = FakeWS(
        [
            _msg("task-started"),
            _result("我想咨询", False),
            _result("我想咨询优惠", False),
        ]
    )
    _patch_connect(monkeypatch, fake)

    events: list[tuple[str, str]] = []

    async def on_event(ev) -> None:
        events.append((ev.type, ev.text))

    client = DashScopeFunASRClient(call_id="t3b", api_key="k", on_event=on_event)
    await client.connect()
    await _drain()
    await client.end_speech()

    assert ("partial", "我想咨询优惠") in events
    assert ("final", "我想咨询优惠") in events  # 用最近 partial 合成 final
    # 再次 end_speech 不重复（_current_text 已清空）
    events.clear()
    await client.end_speech()
    assert events == []

    await client.close()


async def test_close_sends_finish_task(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeWS([_msg("task-started")])
    _patch_connect(monkeypatch, fake)

    client = DashScopeFunASRClient(call_id="t4", api_key="k")
    await client.connect()
    await client.send_audio(b"\x00" * 640)  # 触发 run-task，close 才需 finish-task
    await _drain()
    await client.close()

    text_frames = [json.loads(d) for d in fake.sent if isinstance(d, str)]
    actions = [f["header"].get("action") for f in text_frames]
    assert "finish-task" in actions
    assert fake.closed is True
    # 幂等：再次 close 不抛
    await client.close()


async def test_defensive_text_fallback_output_text(monkeypatch: pytest.MonkeyPatch) -> None:
    # 结果不在 output.sentence.text，而在 output.text（兜底路径）
    fake = FakeWS(
        [
            _msg("task-started"),
            _msg("result-generated", {"output": {"text": "兜底文本"}}),
        ]
    )
    _patch_connect(monkeypatch, fake)

    events: list[tuple[str, str]] = []

    async def on_event(ev) -> None:
        events.append((ev.type, ev.text))

    client = DashScopeFunASRClient(call_id="t5", api_key="k", on_event=on_event)
    await client.connect()
    await _drain()
    assert ("partial", "兜底文本") in events
    await client.close()


async def test_task_failed_does_not_crash(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeWS(
        [
            _msg("task-started"),
            json.dumps(
                {
                    "header": {
                        "event": "task-failed",
                        "error_code": "InvalidParam",
                        "error_message": "bad",
                    },
                    "payload": {},
                }
            ),
        ]
    )
    _patch_connect(monkeypatch, fake)

    client = DashScopeFunASRClient(call_id="t6", api_key="k")
    await client.connect()
    await _drain()
    # recv_loop 收到 task-failed 后应干净结束，不抛异常
    await client.close()


def test_factory_falls_back_without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STT_PROVIDER", "dashscope")
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    client = create_stt_client(
        call_id="c",
        ws_url="ws://localhost:10095",
        mode="2pass",
        hotwords="",
        on_event=None,
    )
    assert isinstance(client, FunASRClient)  # 缺 key → 回退本地


def test_factory_selects_dashscope(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STT_PROVIDER", "dashscope")
    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-test")
    client = create_stt_client(
        call_id="c",
        ws_url="ws://localhost:10095",
        mode="2pass",
        hotwords="",
        on_event=None,
    )
    assert isinstance(client, DashScopeFunASRClient)


def test_factory_default_is_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STT_PROVIDER", raising=False)
    client = create_stt_client(
        call_id="c",
        ws_url="ws://localhost:10095",
        mode="2pass",
        hotwords="",
        on_event=None,
    )
    assert isinstance(client, FunASRClient)


async def test_run_task_deferred_until_first_audio(monkeypatch: pytest.MonkeyPatch) -> None:
    """修复:run-task 延迟到首帧音频,避免 DashScope task 空闲 23s 超时(task-failed→1007)。"""
    fake = FakeWS([_msg("task-started")])
    _patch_connect(monkeypatch, fake)

    client = DashScopeFunASRClient(call_id="t7", api_key="k")
    await client.connect()
    await _drain()
    # connect 后不应发出 run-task（WS 已建、靠 ping 保活，但 task 未开始计时）
    actions = [
        json.loads(d).get("header", {}).get("action")
        for d in fake.sent if isinstance(d, str)
    ]
    assert "run-task" not in actions

    # 首帧音频后才发 run-task
    await client.send_audio(b"\x00" * 640)
    await _drain()
    actions = [
        json.loads(d).get("header", {}).get("action")
        for d in fake.sent if isinstance(d, str)
    ]
    assert "run-task" in actions

    await client.close()
