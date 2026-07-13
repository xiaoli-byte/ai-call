from __future__ import annotations

import json
from typing import Any

import pytest

from voice_agent import demo_server
from voice_agent.demo_server import DemoServer
from voice_agent.types import TTSChunk


class FakeWebSocket:
    open = True

    def __init__(self, messages: list[bytes | str]) -> None:
        self.messages = list(messages)
        self.sent: list[bytes | str] = []

    def __aiter__(self):
        return self

    async def __anext__(self) -> bytes | str:
        if not self.messages:
            raise StopAsyncIteration
        return self.messages.pop(0)

    async def send(self, message: bytes | str) -> None:
        self.sent.append(message)


class FakeSTT:
    instances: list["FakeSTT"] = []

    def __init__(self, *_args: Any, **_kwargs: Any) -> None:
        self.sent_audio: list[bytes] = []
        self.end_speech_calls = 0
        self.closed = False
        FakeSTT.instances.append(self)

    async def connect(self) -> None:
        return None

    async def send_audio(self, pcm: bytes) -> None:
        self.sent_audio.append(pcm)

    async def end_speech(self) -> None:
        self.end_speech_calls += 1

    async def close(self) -> None:
        self.closed = True


class FakeVAD:
    frame_bytes = 640

    def feed(self, frame: bytes) -> tuple[str, list[bytes]]:
        assert len(frame) == self.frame_bytes
        return "speech", [frame]


def make_server() -> DemoServer:
    return DemoServer(
        funasr_ws_url="ws://funasr.test",
        funasr_mode="2pass",
        funasr_hotwords="",
        vad_aggressiveness=3,
        vad_frame_ms=20,
        vad_pre_buffer_ms=300,
        vad_silence_confirm_frames=10,
        vad_speech_confirm_frames=3,
        tts=None,
    )


@pytest.fixture(autouse=True)
def fake_asr_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSTT.instances.clear()
    # demo_server 现在经 create_stt_client 工厂创建 STT：显式走本地分支，
    # 并 patch 工厂内部引用的 stt.FunASRClient（而非 demo_server.FunASRClient）。
    monkeypatch.setenv("STT_PROVIDER", "funasr")
    monkeypatch.setattr("voice_agent.stt.FunASRClient", FakeSTT)
    monkeypatch.setattr(demo_server, "VoiceActivityDetector", lambda **_kwargs: FakeVAD())


@pytest.mark.asyncio
async def test_asr_stream_buffers_small_binary_chunks_before_vad() -> None:
    ws = FakeWebSocket(
        [
            json.dumps({"mode": "2pass"}),
            *[b"\x01" * 86 for _ in range(8)],
        ]
    )

    await make_server().handle_asr(ws)

    stt = FakeSTT.instances[0]
    assert [len(frame) for frame in stt.sent_audio] == [640]
    assert stt.closed is True


@pytest.mark.asyncio
async def test_asr_stream_manual_end_speech_clears_pending_pcm() -> None:
    ws = FakeWebSocket(
        [
            json.dumps({"mode": "2pass"}),
            b"\x01" * 86,
            json.dumps({"is_speaking": False}),
            b"\x02" * 554,
        ]
    )

    await make_server().handle_asr(ws)

    stt = FakeSTT.instances[0]
    assert stt.sent_audio == []
    assert stt.end_speech_calls == 1


class FakeTTS:
    """记录合成调用的假 TTS，用于验证 /tts-stream 的路由与 sample_rate 回传。"""

    def __init__(self, name: str, sample_rate: int, audio: bytes = b"\x11\x22") -> None:
        self._name = name
        self._sample_rate = sample_rate
        self._audio = audio
        self.synth_calls: list[dict[str, Any]] = []
        self.interrupted = 0
        self.closed = False

    @property
    def name(self) -> str:
        return self._name

    async def synthesize(
        self,
        text: str,
        on_chunk: Any,
        speaker: Any = None,
        instruct_text: Any = None,
    ) -> None:
        self.synth_calls.append(
            {"text": text, "speaker": speaker, "instruct_text": instruct_text}
        )
        await on_chunk(
            TTSChunk(audio=self._audio, sample_rate=self._sample_rate, is_final=False)
        )
        await on_chunk(
            TTSChunk(audio=b"", sample_rate=self._sample_rate, is_final=True)
        )

    def interrupt(self) -> None:
        self.interrupted += 1

    async def close(self) -> None:
        self.closed = True


def make_tts_server(shared_tts: Any) -> DemoServer:
    return DemoServer(
        funasr_ws_url="ws://funasr.test",
        funasr_mode="2pass",
        funasr_hotwords="",
        vad_aggressiveness=3,
        vad_frame_ms=20,
        vad_pre_buffer_ms=300,
        vad_silence_confirm_frames=10,
        vad_speech_confirm_frames=3,
        tts=shared_tts,
    )


@pytest.mark.asyncio
async def test_tts_stream_provider_routes_to_scoped_instance_and_reports_sample_rate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """指定 provider 时用 provider 专属临时实例合成，final 帧带 sample_rate。"""
    shared = FakeTTS(name="mock", sample_rate=16000)
    created: dict[str, FakeTTS] = {}

    def fake_create_tts(provider: str) -> FakeTTS:
        inst = FakeTTS(name=provider, sample_rate=24000)
        created[provider] = inst
        return inst

    monkeypatch.setattr(demo_server, "create_tts", fake_create_tts)

    ws = FakeWebSocket(
        [
            json.dumps(
                {
                    "text": "你好，测试克隆音色试听",
                    "speaker": "cosyvoice-v2-cvabc-1234",
                    "provider": "cosyvoice",
                }
            ),
        ]
    )

    await make_tts_server(shared).handle_tts(ws)

    # 共享实例不参与试听合成；专属 cosyvoice 实例被创建并合成一次
    assert shared.synth_calls == []
    assert "cosyvoice" in created
    scoped = created["cosyvoice"]
    assert len(scoped.synth_calls) == 1
    assert scoped.synth_calls[0]["speaker"] == "cosyvoice-v2-cvabc-1234"
    # 连接结束时临时实例被关闭
    assert scoped.closed is True

    binary = [m for m in ws.sent if isinstance(m, (bytes, bytearray))]
    finals = [json.loads(m) for m in ws.sent if isinstance(m, str)]
    assert binary == [b"\x11\x22"]
    assert finals[-1] == {"type": "final", "sample_rate": 24000}


@pytest.mark.asyncio
async def test_tts_stream_without_provider_uses_shared_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """省略 provider（浏览器 demo 链路）时用共享实例，不建临时实例。"""
    shared = FakeTTS(name="mock", sample_rate=16000)

    def fail_create_tts(provider: str) -> FakeTTS:  # pragma: no cover - 不应被调用
        raise AssertionError("create_tts 不应在省略 provider 时被调用")

    monkeypatch.setattr(demo_server, "create_tts", fail_create_tts)

    ws = FakeWebSocket([json.dumps({"text": "浏览器 demo 合成"})])

    await make_tts_server(shared).handle_tts(ws)

    assert len(shared.synth_calls) == 1
    # 共享实例不在连接结束时被关闭
    assert shared.closed is False
    finals = [json.loads(m) for m in ws.sent if isinstance(m, str)]
    assert finals[-1] == {"type": "final", "sample_rate": 16000}
