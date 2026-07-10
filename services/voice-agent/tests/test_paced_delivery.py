"""TTS 节拍投递（paced delivery）测试。

契约：docs/superpowers/specs/2026-07-11-tts-paced-delivery.md
- 投递按字节钟（32B=1ms）实时节流，首块/LEAD 窗口内立即放行
- on_audio_output_complete 等电话真实播完（+尾裕量）才返回 → _speaking 语义准确
- 打断（on_interrupted）优先杀在途：停泵 + 弃未投递音频
- 回退开关 TTS_PACED_DELIVERY_ENABLED=false → 逐块立即投递（旧路径）
- web 通道 raw-pcm 同样被节流，打断仍发 clear_audio

用小参数（chunk=100ms/lead=50ms/tail=20~100ms）保证单测快；断言均为"不早于"
下界，asyncio.sleep 只会向上溢出，故在 Windows 抖动下依然稳定。
"""

from __future__ import annotations

import asyncio
import json
import time

import pytest

from voice_agent.server import WebSocketCallbacks


class TimedWebSocket:
    """记录每次发送时刻的假 WS（区分二进制音频帧与文本事件帧）。"""

    open = True

    def __init__(self) -> None:
        self.binary: list[tuple[float, bytes]] = []
        self.text: list[str] = []

    async def send(self, message: bytes | str) -> None:
        if isinstance(message, bytes):
            self.binary.append((time.monotonic(), message))
        else:
            self.text.append(message)


class FakeTasks:
    async def get_task(self, _task_id: str):
        return None

    async def append_transcript(self, *_args: object, **_kwargs: object) -> None:
        pass

    async def hangup(self, *_args: object, **_kwargs: object) -> None:
        pass


class FakeESL:
    def __init__(self) -> None:
        self.commands: list[str] = []

    async def api(self, command: str) -> str:
        self.commands.append(command)
        return "+OK"


def _set_paced_env(monkeypatch, *, lead=50, tail=20, chunk_ms=100, enabled=True) -> None:
    monkeypatch.setenv("TTS_PACED_DELIVERY_ENABLED", "true" if enabled else "false")
    monkeypatch.setenv("TTS_PACED_LEAD_MS", str(lead))
    monkeypatch.setenv("TTS_PACED_TAIL_MARGIN_MS", str(tail))
    monkeypatch.setenv("FREESWITCH_PLAYBACK_CHUNK_MS", str(chunk_ms))


_CHUNK = b"\x00" * 3200  # 100ms @ 16kHz/16bit/mono


# ---------------------------------------------------------------------------
# ① 节拍：各块发送时刻不早于字节钟排程
# ---------------------------------------------------------------------------


async def test_paced_raw_pcm_throttles_by_byte_clock(monkeypatch) -> None:
    _set_paced_env(monkeypatch, lead=50, tail=20)
    ws = TimedWebSocket()
    cb = WebSocketCallbacks(ws, "call-1", FakeTasks())

    for _ in range(4):  # 4×100ms = 400ms 总音频
        await cb.on_audio_output(_CHUNK)

    t_before = time.monotonic()
    await cb.on_audio_output_complete()
    complete_dur = time.monotonic() - t_before

    assert len(ws.binary) == 4
    t0 = ws.binary[0][0]
    tol = 0.015
    # 第 k 块应在 t0 + k*100ms - LEAD(50ms) 之后发出
    for k, (ts, _) in enumerate(ws.binary):
        expected = max(0.0, k * 0.1 - 0.05)
        assert ts - t0 >= expected - tol, f"chunk {k} sent too early"
    # complete 需等电话播完（≥ total - lead）
    assert complete_dur >= 0.4 - 0.05 - tol
    assert cb._stream is None


# ---------------------------------------------------------------------------
# ② 持有：complete 返回时刻 ≥ t0 + total + tail_margin
# ---------------------------------------------------------------------------


async def test_complete_holds_until_real_playback_end(monkeypatch) -> None:
    _set_paced_env(monkeypatch, lead=50, tail=100)
    ws = TimedWebSocket()
    cb = WebSocketCallbacks(ws, "call-2", FakeTasks())

    for _ in range(2):  # 2×100ms = 200ms
        await cb.on_audio_output(_CHUNK)
    await cb.on_audio_output_complete()
    end = time.monotonic()

    t0 = ws.binary[0][0]
    # 真实播完(200ms) + 尾裕量(100ms)
    assert end - t0 >= 0.2 + 0.1 - 0.02
    assert cb._stream is None


# ---------------------------------------------------------------------------
# ③ 打断：on_interrupted 停泵 + 弃在途 + uuid_break，随后新 utterance 正常
# ---------------------------------------------------------------------------


async def test_interrupt_cancels_pump_and_drops_pending(monkeypatch) -> None:
    _set_paced_env(monkeypatch, lead=50, tail=20)
    cb = WebSocketCallbacks(
        TimedWebSocket(), "call-3", FakeTasks(), audio_response_format="esl-file"
    )
    esl = FakeESL()
    cb._playback_esl = esl  # 复用既有 ESL 控制连接（避免真连 FreeSWITCH）

    played: list[bytes] = []

    async def fake_play(audio: bytes) -> None:
        # 绕过写盘 + uuid_broadcast，只记录"落地播放"的聚合块
        cb._playback_sequence += 1
        played.append(audio)

    monkeypatch.setattr(cb, "_play_audio_chunk", fake_play)

    for _ in range(5):  # 5×100ms，喂满队列
        await cb.on_audio_output(_CHUNK)
    await asyncio.sleep(0.02)  # 只够放第 0 块（第 1 块排程在 50ms）
    played_at_interrupt = len(played)
    assert played_at_interrupt == 1

    await cb.on_interrupted()

    await asyncio.sleep(0.3)  # 若泵没停，本该继续放后续块
    assert len(played) == played_at_interrupt  # 打断后零发送
    assert cb._stream is None  # 泵已终结、队列已弃
    assert esl.commands == ["uuid_break call-3 all"]

    # 随后新 utterance 正常工作
    await cb.on_audio_output(_CHUNK)
    await cb.on_audio_output_complete()
    assert len(played) == played_at_interrupt + 1
    assert cb._stream is None


# ---------------------------------------------------------------------------
# ④ 回退：TTS_PACED_DELIVERY_ENABLED=false → 逐块立即投递
# ---------------------------------------------------------------------------


async def test_fallback_delivers_immediately(monkeypatch) -> None:
    _set_paced_env(monkeypatch, enabled=False)
    ws = TimedWebSocket()
    cb = WebSocketCallbacks(ws, "call-4", FakeTasks())

    # 无 complete、无事件循环让出，旧路径应已同步发完
    await cb.on_audio_output(b"\x01\x02")
    await cb.on_audio_output(b"\x03\x04")
    assert [data for _, data in ws.binary] == [b"\x01\x02", b"\x03\x04"]

    t_before = time.monotonic()
    await cb.on_audio_output_complete()
    assert time.monotonic() - t_before < 0.05  # 旧路径 complete 立即返回
    assert cb._stream is None


# ---------------------------------------------------------------------------
# ⑤ web 通道：raw-pcm 同样被节流，打断仍发 clear_audio
# ---------------------------------------------------------------------------


async def test_web_channel_paced_and_interrupt_sends_clear_audio(monkeypatch) -> None:
    _set_paced_env(monkeypatch, lead=50, tail=20)
    ws = TimedWebSocket()
    cb = WebSocketCallbacks(ws, "call-5", FakeTasks(), channel="web")

    for _ in range(4):
        await cb.on_audio_output(_CHUNK)
    await asyncio.sleep(0.02)  # 只够放第 0 块
    sent_at_interrupt = len(ws.binary)
    assert sent_at_interrupt == 1  # 被节流：其余块仍在 Python 侧

    await cb.on_interrupted()

    await asyncio.sleep(0.3)
    assert len(ws.binary) == sent_at_interrupt  # 打断后零发送
    assert cb._stream is None
    assert {"type": "clear_audio"} in [json.loads(m) for m in ws.text]


# ---------------------------------------------------------------------------
# ⑥ 回退开关关闭时,非法 env 值不应让 WebSocketCallbacks 构造炸(安全解析)
# ---------------------------------------------------------------------------


def test_invalid_paced_env_does_not_crash_init(monkeypatch) -> None:
    monkeypatch.setenv("TTS_PACED_DELIVERY_ENABLED", "false")
    monkeypatch.setenv("TTS_PACED_LEAD_MS", "abc")  # 非数字
    monkeypatch.setenv("TTS_PACED_TAIL_MARGIN_MS", "")  # 空串
    cb = WebSocketCallbacks(TimedWebSocket(), "call-6", FakeTasks())  # 不应抛
    assert cb._paced_lead_ms == 1200  # 回退默认值
    assert cb._paced_tail_margin_ms == 200
