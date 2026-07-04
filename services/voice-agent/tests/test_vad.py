"""VAD 状态机单元测试。"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from voice_agent.vad import VoiceActivityDetector


SAMPLE_RATE = 16000
FRAME_MS = 30
FRAME_BYTES = SAMPLE_RATE * 2 * FRAME_MS // 1000  # 960


def _silent_frame() -> bytes:
    """生成全零静音帧。"""
    return b"\x00" * FRAME_BYTES


def _voice_frame() -> bytes:
    """生成能量足够的语音帧（白噪声放大）。"""
    import random

    random.seed(42)
    return bytes(random.randint(-128, 127) & 0xFF for _ in range(FRAME_BYTES))


@pytest.fixture
def vad() -> VoiceActivityDetector:
    """构造测试用 VAD，底层 webrtcvad 替换为 mock 以隔离内部状态干扰。

    WebRTC VAD 有内部状态（会根据历史帧调整判定），导致相同输入在不同上下文下
    可能返回不同结果。单元测试应只验证状态机逻辑，不依赖 WebRTC VAD 的分类行为。
    """
    detector = VoiceActivityDetector(
        aggressiveness=0,
        frame_ms=FRAME_MS,
        sample_rate=SAMPLE_RATE,
        speech_confirm_frames=3,
        silence_confirm_frames=5,
        pre_buffer_ms=300,
    )
    # 替换底层 WebRTC VAD 为可控 mock
    detector._vad = MagicMock()
    detector._vad.is_speech = MagicMock(return_value=False)
    return detector


def test_silent_frame_keeps_silence(vad: VoiceActivityDetector) -> None:
    """静音帧应保持 silence 状态且不发送任何音频。"""
    state, frames = vad.feed(_silent_frame())
    assert state == "silence"
    assert frames == []


def test_speech_confirm_frames_required(vad: VoiceActivityDetector) -> None:
    """需要连续 speech_confirm_frames 帧语音才转 speech。"""
    vad._vad.is_speech.return_value = True  # 所有帧判定为语音

    # 前两帧语音但未达阈值，仍为 silence
    for _ in range(2):
        state, frames = vad.feed(_voice_frame())
        assert state == "silence"
        assert frames == []

    # 第三帧语音，达到阈值，转为 speech，应 flush 预缓冲
    state, frames = vad.feed(_voice_frame())
    assert state == "speech"
    # 预缓冲应包含前两帧（被缓冲）+ 当前帧
    assert len(frames) >= 1


def test_pre_buffer_flush_on_speech_start(vad: VoiceActivityDetector) -> None:
    """silence→speech 转换时应 flush 预缓冲（含之前的静音/未确认语音帧）。"""
    # 先喂几帧静音填充预缓冲
    vad._vad.is_speech.return_value = False
    for _ in range(5):
        vad.feed(_silent_frame())

    # 再喂足够的语音帧触发转换
    vad._vad.is_speech.return_value = True
    for _ in range(3):
        state, frames = vad.feed(_voice_frame())

    # 最后一次应返回 speech 且 frames 包含预缓冲内容
    assert state == "speech"
    assert len(frames) > 0


def test_speech_to_silence_transition(vad: VoiceActivityDetector) -> None:
    """speech 状态下连续静音帧达阈值后应返回 speech_end。"""
    # 进入 speech 状态
    vad._vad.is_speech.return_value = True
    for _ in range(3):
        vad.feed(_voice_frame())
    assert vad.state == "speech"

    # 切换为静音判定
    vad._vad.is_speech.return_value = False

    # 喂 4 帧静音（未达阈值 5），仍为 speech
    for _ in range(4):
        state, _ = vad.feed(_silent_frame())
        assert state == "speech"

    # 第 5 帧静音，触发 speech_end
    state, frames = vad.feed(_silent_frame())
    assert state == "speech_end"
    # speech_end 时本帧仍发送
    assert len(frames) == 1
    # speech_end 是一次性事件，内部状态应立即回到 silence。
    assert vad.state == "silence"


def test_speech_end_does_not_repeat_during_following_silence(
    vad: VoiceActivityDetector,
) -> None:
    """speech_end 后持续静音不应反复触发 end_speech。"""
    # 进入 speech 状态
    vad._vad.is_speech.return_value = True
    for _ in range(3):
        vad.feed(_voice_frame())

    # 连续静音触发一次 speech_end
    vad._vad.is_speech.return_value = False
    for _ in range(4):
        state, _ = vad.feed(_silent_frame())
        assert state == "speech"
    state, frames = vad.feed(_silent_frame())
    assert state == "speech_end"
    assert len(frames) == 1

    # 后续静音应保持 silence，不再每隔 silence_confirm_frames 重复 speech_end。
    for _ in range(10):
        state, frames = vad.feed(_silent_frame())
        assert state == "silence"
        assert frames == []


def test_short_pause_does_not_trigger_end(vad: VoiceActivityDetector) -> None:
    """speech 中短暂停顿（< silence_confirm_frames）不应触发 speech_end。"""
    # 进入 speech 状态
    vad._vad.is_speech.return_value = True
    for _ in range(3):
        vad.feed(_voice_frame())

    # 2 帧静音（< 阈值 5）
    vad._vad.is_speech.return_value = False
    for _ in range(2):
        state, frames = vad.feed(_silent_frame())
        assert state == "speech"
        assert len(frames) == 1

    # 恢复语音
    vad._vad.is_speech.return_value = True
    state, frames = vad.feed(_voice_frame())
    assert state == "speech"
    assert len(frames) == 1


def test_frame_size_mismatch_raises(vad: VoiceActivityDetector) -> None:
    """帧长不匹配应抛 ValueError。"""
    with pytest.raises(ValueError, match="frame size mismatch"):
        vad.feed(b"\x00" * 100)


def test_invalid_frame_ms_raises() -> None:
    """frame_ms 不在 10/20/30 中应抛 ValueError。"""
    with pytest.raises(ValueError, match="WebRTC VAD only supports"):
        VoiceActivityDetector(frame_ms=25)


def test_invalid_aggressiveness_raises() -> None:
    """aggressiveness 不在 0-3 应抛 ValueError。"""
    with pytest.raises(ValueError, match="aggressiveness must be"):
        VoiceActivityDetector(aggressiveness=5)


def test_reset_clears_state(vad: VoiceActivityDetector) -> None:
    """reset 应清空状态机和预缓冲。"""
    vad._vad.is_speech.return_value = True
    for _ in range(3):
        vad.feed(_voice_frame())
    assert vad.state == "speech"

    vad.reset()
    assert vad.state == "silence"

    # reset 后第一帧静音应直接返回 silence
    state, frames = vad.feed(_silent_frame())
    assert state == "silence"
    assert frames == []
