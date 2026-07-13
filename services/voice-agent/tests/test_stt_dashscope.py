"""DashScopeFunASRClient（云端 Fun-ASR 实时识别）协议交互回归测试。

用 FakeWS 替换 websockets.connect，不发真实网络请求，验证：
- run-task 指令格式（action/model/format/sample_rate）
- task-started 后 connect 完成
- result-generated：sentence_end=False→partial、True→final
- send_audio 发二进制帧、连接前缓冲 flush
- end_speech：无活跃 task 时不发消息；有活跃 task 时发 finish-task 并为下一句
  重置出全新 task_id（回归：真机曾出现第二句文本累加在第一句后面）
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
        # 队列空时等待而非结束迭代：真实 WS 连接消息发完不会自动断开，
        # 靠 client.close() 主动 cancel 接收任务才会终止（各测试均有 close()）。
        while not self._msgs:
            if self.closed:
                raise StopAsyncIteration
            await asyncio.sleep(0)
        return self._msgs.pop(0)

    async def close(self) -> None:
        self.closed = True


def _patch_connect(monkeypatch: pytest.MonkeyPatch, fake: FakeWS) -> None:
    async def fake_connect(*_args: object, **_kwargs: object) -> FakeWS:
        return fake

    monkeypatch.setattr(websockets, "connect", fake_connect)


def _msg(event: str, payload: dict | None = None, task_id: str | None = None) -> str:
    header: dict = {"event": event}
    if task_id is not None:
        header["task_id"] = task_id
    return json.dumps({"header": header, "payload": payload or {}})


def _result(text: str, sentence_end: bool, task_id: str | None = None) -> str:
    return _msg(
        "result-generated",
        {"output": {"sentence": {"text": text, "sentence_end": sentence_end}}},
        task_id=task_id,
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
    # 没有 send_audio 过 → 无活跃 task（_run_task_sent=False）→ end_speech 不发任何 WS 消息
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
    # （本例未调 send_audio，_run_task_sent 仍为 False，不涉及 finish-task/task 重置）
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


async def test_end_speech_resets_task_for_next_utterance(monkeypatch: pytest.MonkeyPatch) -> None:
    """回归测试：真机曾出现第二句话把第一句文本带上继续拼接（"到了呀" →
    "到了呀，明天下午2点"）。根因：一通电话只建一个云端 task，服务端识别缓冲从不
    清空。修复后 end_speech 应结束当前 task（发 finish-task）并让下一句用全新
    task_id 开一个新 task；本测试验证两轮 run-task 的 task_id 不同，且 finish-task
    结束的是第一轮的 task_id（而非第二轮）。
    """
    # FakeWS 的消息队列会被 recv_loop 一次性尽量抽干（_drain 多次 tick 无法卡在
    # "只处理到这里"），所以第二句的消息分阶段追加，确保断言第一句时它们还没到。
    fake = FakeWS([_msg("task-started"), _result("到了呀", False)])
    _patch_connect(monkeypatch, fake)

    events: list[tuple[str, str]] = []

    async def on_event(ev) -> None:
        events.append((ev.type, ev.text))

    client = DashScopeFunASRClient(call_id="two-turns", api_key="k", on_event=on_event)
    await client.connect()

    # 第一句
    await client.send_audio(b"\x00" * 640)
    await _drain()
    assert client._current_text == "到了呀"
    await client.end_speech()
    assert ("final", "到了呀") in events

    # 第二句：应触发全新 task（新 task_id），第二句结果不应带上第一句文本
    fake._msgs.extend([_msg("task-finished"), _msg("task-started"), _result("明天下午2点", False)])
    await client.send_audio(b"\x00" * 640)
    await _drain()
    assert client._current_text == "明天下午2点"  # 不是 "到了呀，明天下午2点"

    text_frames = [json.loads(d) for d in fake.sent if isinstance(d, str)]
    run_tasks = [f for f in text_frames if f["header"].get("action") == "run-task"]
    finish_tasks = [f for f in text_frames if f["header"].get("action") == "finish-task"]

    assert len(run_tasks) == 2
    assert run_tasks[0]["header"]["task_id"] != run_tasks[1]["header"]["task_id"]
    assert len(finish_tasks) == 1
    assert finish_tasks[0]["header"]["task_id"] == run_tasks[0]["header"]["task_id"]

    await client.close()


async def test_stale_final_from_finished_task_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    """回归测试：真机曾出现"用户沉默却被记上一句"。根因：end_speech 本地合成
    final 并发 finish-task 换新 task_id 后，服务端把旧 task 缓冲句 flush 成
    sentence_end=true 的 result-generated（带旧 task_id）发回来——同一句话出了
    第二个 final，被缓存成"待处理输入"并在下一问播完后当成回答消费。
    修复后 _recv_loop 按当前活跃 task_id 过滤，旧 task 的迟到消息一律丢弃。
    """
    fake = FakeWS([_msg("task-started"), _result("收到了", False)])
    _patch_connect(monkeypatch, fake)

    events: list[tuple[str, str]] = []

    async def on_event(ev) -> None:
        events.append((ev.type, ev.text))

    client = DashScopeFunASRClient(call_id="stale", api_key="k", on_event=on_event)
    await client.connect()
    await client.send_audio(b"\x00" * 640)
    await _drain()

    old_task_id = client._task_id
    await client.end_speech()  # 本地合成 final「收到了」+ finish-task + 换新 task_id
    assert ("final", "收到了") in events
    assert client._task_id != old_task_id

    # 服务端迟到的旧 task flush final（真机上带标点「收到了。」）→ 应被丢弃
    events.clear()
    fake._msgs.extend(
        [
            _result("收到了。", True, task_id=old_task_id),
            _msg("task-finished", task_id=old_task_id),
        ]
    )
    await _drain()
    assert events == []  # 不产生重复 final/partial

    # 下一句新 task 的结果正常放行（带新 task_id 与不带 task_id 都兼容）
    fake._msgs.extend(
        [
            _msg("task-started", task_id=client._task_id),
            _result("明天下午", False, task_id=client._task_id),
        ]
    )
    await client.send_audio(b"\x00" * 640)
    await _drain()
    assert ("partial", "明天下午") in events

    await client.close()


async def test_end_speech_waits_for_server_flush_to_complete_text(monkeypatch: pytest.MonkeyPatch) -> None:
    """flush 等待：真机复现快语速答"收到了"，speech_end 时 partial 只到"收"，
    本地合成 final「收」→ LLM 判成"未收到"走错分支。修复后 end_speech 发
    finish-task 后等服务端句末 flush（文本更完整），拿到就用它出 final。"""
    fake = FakeWS([_msg("task-started"), _result("收", False)])
    _patch_connect(monkeypatch, fake)

    events: list[tuple[str, str]] = []

    async def on_event(ev) -> None:
        events.append((ev.type, ev.text))

    client = DashScopeFunASRClient(call_id="flush", api_key="k", on_event=on_event)
    await client.connect()
    await client.send_audio(b"\x00" * 640)
    await _drain()
    assert client._current_text == "收"

    old_task_id = client._task_id
    end_task = asyncio.create_task(client.end_speech())
    await _drain()  # end_speech 已发 finish-task、正在等 flush
    assert not end_task.done()

    # 服务端 flush 完整句子（旧 task_id）→ end_speech 用它出 final
    fake._msgs.extend(
        [
            _result("收到了。", True, task_id=old_task_id),
            _msg("task-finished", task_id=old_task_id),
        ]
    )
    await asyncio.wait_for(end_task, timeout=2)
    finals = [e for e in events if e[0] == "final"]
    assert finals == [("final", "收到了。")]  # 完整文本，且只有一条（不重复）
    assert client._flush_rescue_task_id is None

    await client.close()


async def test_end_speech_flush_timeout_falls_back_to_partial(monkeypatch: pytest.MonkeyPatch) -> None:
    """flush 超时：服务端一直不回 → 回退最近 partial 合成 final（老行为），
    且关闭救援窗口——此后旧 task 迟到的 flush 视为重复丢弃，不出第二条 final。"""
    fake = FakeWS([_msg("task-started"), _result("收到了", False)])
    _patch_connect(monkeypatch, fake)

    events: list[tuple[str, str]] = []

    async def on_event(ev) -> None:
        events.append((ev.type, ev.text))

    client = DashScopeFunASRClient(
        call_id="flush-to", api_key="k", on_event=on_event, flush_wait_ms=50
    )
    await client.connect()
    await client.send_audio(b"\x00" * 640)
    await _drain()

    old_task_id = client._task_id
    await client.end_speech()  # 50ms 内无 flush → 超时回退
    assert ("final", "收到了") in events
    assert client._flush_rescue_task_id is None

    # 超时后迟到的 flush → 丢弃
    events.clear()
    fake._msgs.append(_result("收到了。", True, task_id=old_task_id))
    await _drain()
    assert events == []

    await client.close()


async def test_slow_recognition_rescued_by_old_task_flush(monkeypatch: pytest.MonkeyPatch) -> None:
    """救援窗口：语音段短于云端识别延迟时，speech_end 时刻一个 partial 都没到、
    本地合成不出 final——此时旧 task 的句末 flush 是这句话唯一的识别结果，必须
    放行（真机复现：第一句"喂"整句丢失）。放行第一条 final 后窗口关闭，
    后续同 task 消息照常丢弃；在途 partial 不放行也不污染新 task 的 _current_text。
    """
    fake = FakeWS([_msg("task-started")])
    _patch_connect(monkeypatch, fake)

    events: list[tuple[str, str]] = []

    async def on_event(ev) -> None:
        events.append((ev.type, ev.text))

    client = DashScopeFunASRClient(call_id="rescue", api_key="k", on_event=on_event)
    await client.connect()
    await client.send_audio(b"\x00" * 640)
    await _drain()

    old_task_id = client._task_id
    await client.end_speech()  # 无 partial → 本地不合成 final，开救援窗口
    assert events == []
    assert client._flush_rescue_task_id == old_task_id

    # 旧 task 在途 partial → 丢弃；句末 flush final → 放行并关窗
    fake._msgs.extend(
        [
            _result("喂", False, task_id=old_task_id),
            _result("喂。", True, task_id=old_task_id),
            _msg("task-finished", task_id=old_task_id),
        ]
    )
    await _drain()
    assert events == [("final", "喂。")]
    assert client._flush_rescue_task_id is None
    assert client._current_text == ""  # 救援不污染新 task 的 partial 缓存

    # 关窗后同 task 再来消息不再放行
    events.clear()
    fake._msgs.append(_result("幽灵", True, task_id=old_task_id))
    await _drain()
    assert events == []

    await client.close()


async def test_rescue_window_closes_on_task_finished_without_text(monkeypatch: pytest.MonkeyPatch) -> None:
    """旧 task 收尾（task-finished/task-failed）时始终没出词 → 关窗，
    避免陈旧救援窗口误放行更晚的消息。"""
    fake = FakeWS([_msg("task-started")])
    _patch_connect(monkeypatch, fake)

    events: list[tuple[str, str]] = []

    async def on_event(ev) -> None:
        events.append((ev.type, ev.text))

    client = DashScopeFunASRClient(call_id="rescue2", api_key="k", on_event=on_event)
    await client.connect()
    await client.send_audio(b"\x00" * 640)
    await _drain()

    old_task_id = client._task_id
    await client.end_speech()
    assert client._flush_rescue_task_id == old_task_id

    fake._msgs.append(_msg("task-finished", task_id=old_task_id))
    await _drain()
    assert client._flush_rescue_task_id is None

    fake._msgs.append(_result("迟到文本", True, task_id=old_task_id))
    await _drain()
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
