"""TTS interrupt 任务所有权回归测试（僵尸会话根因，2026-07-12）。

契约：interrupt()（barge-in）只取消合成「子任务」，绝不取消调用方任务。
旧实现记录 asyncio.current_task()（= 会话任务）并对它 .cancel()，导致
调用方取消计数被 +1，agent._speak 用 task.cancelling() 区分
「打断吞掉 / 挂断上抛」的判别器把打断误判成挂断，拆掉整个会话协程
（真机复现：打断后媒体循环还活着但无人应答，僵尸通话直到用户挂断）。
"""

from __future__ import annotations

import asyncio

import pytest

from voice_agent.tts import CosyVoiceTTS, MockTTS
from voice_agent.tts_qwen import QwenTTS
from voice_agent.types import TTSChunk


async def _hang_chunk(chunk: TTSChunk) -> None:
    """挂起的 on_chunk：模拟下游（ws/节拍泵）阻塞，让合成停在 await 处。"""
    await asyncio.Event().wait()


def _make_mock() -> MockTTS:
    return MockTTS()


def _make_cosyvoice(monkeypatch: pytest.MonkeyPatch) -> CosyVoiceTTS:
    async def hang(self, text, on_chunk, speaker, instruct_text):
        await asyncio.Event().wait()

    monkeypatch.setattr(CosyVoiceTTS, "_do_synthesize", hang)
    return CosyVoiceTTS(base_url="http://localhost:1")


def _make_qwen(monkeypatch: pytest.MonkeyPatch) -> QwenTTS:
    async def hang(self, text, on_chunk, speaker, instruct_text, cancel_event):
        await asyncio.Event().wait()

    monkeypatch.setattr(QwenTTS, "_run_synthesis", hang)
    return QwenTTS(api_key="test-key")


@pytest.fixture(params=["mock", "cosyvoice", "qwen"])
def tts(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch):
    if request.param == "mock":
        return _make_mock()
    if request.param == "cosyvoice":
        return _make_cosyvoice(monkeypatch)
    return _make_qwen(monkeypatch)


async def test_interrupt_cancels_child_not_caller(tts) -> None:
    """barge-in：调用方收到 CancelledError 但自身取消计数为 0（可吞掉继续）。"""
    state: dict[str, object] = {}

    async def caller() -> None:
        try:
            await tts.synthesize("你好", _hang_chunk)
        except asyncio.CancelledError:
            current = asyncio.current_task()
            assert current is not None
            state["cancelling"] = current.cancelling()
            if current.cancelling():
                raise  # 外部取消必须上抛（此测试中不应发生）
            state["swallowed"] = True

    task = asyncio.create_task(caller())
    await asyncio.sleep(0.05)
    tts.interrupt()
    await asyncio.wait_for(task, 2)  # 调用方任务正常结束，没有被误杀

    assert state.get("swallowed") is True
    assert state.get("cancelling") == 0
    assert tts._synthesis_task is None  # 子任务登记已清理


async def test_external_cancel_propagates_and_reaps_child(tts) -> None:
    """挂断：外部取消调用方任务须上抛，且子任务被级联停掉、不泄漏。"""

    async def caller() -> None:
        await tts.synthesize("你好", _hang_chunk)

    task = asyncio.create_task(caller())
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, 2)

    assert tts._synthesis_task is None


async def test_reusable_after_interrupt(tts) -> None:
    """连环打断：打断后能立刻开启下一轮合成，旧一轮的收尾不影响新登记。"""
    for _ in range(2):
        swallowed = False

        async def caller() -> None:
            nonlocal swallowed
            try:
                await tts.synthesize("你好", _hang_chunk)
            except asyncio.CancelledError:
                current = asyncio.current_task()
                assert current is not None and not current.cancelling()
                swallowed = True

        task = asyncio.create_task(caller())
        await asyncio.sleep(0.05)
        tts.interrupt()
        await asyncio.wait_for(task, 2)
        assert swallowed is True

    # 两轮之后仍是干净状态
    assert tts._synthesis_task is None


async def test_mock_tts_completes_normally() -> None:
    """无打断时 MockTTS 行为不变：回调一次 is_final=True 后正常返回。"""
    chunks: list[TTSChunk] = []

    async def collect(chunk: TTSChunk) -> None:
        chunks.append(chunk)

    tts = MockTTS()
    await tts.synthesize("你好", collect)
    assert len(chunks) == 1
    assert chunks[0].is_final is True
    assert tts._synthesis_task is None
