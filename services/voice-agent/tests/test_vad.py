"""VAD 状态机单元测试。

候选（pending）阶段契约见 docs/superpowers/specs/2026-07-10-vad-barge-in-p0.md：
- 起说确认后进入候选，帧入候选缓冲不下发
- 候选累计语音 ≥ min_speech_ms → 一次性 speech_start（flush 预缓冲+候选帧）
- 候选期静音确认先到 → 整段丢弃回 silence，不产生 speech_end
"""

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


def _make_vad(min_speech_ms: int = 0) -> VoiceActivityDetector:
    """构造测试用 VAD，底层 webrtcvad 替换为 mock 以隔离内部状态干扰。

    WebRTC VAD 有内部状态（会根据历史帧调整判定），导致相同输入在不同上下文下
    可能返回不同结果。单元测试应只验证状态机逻辑，不依赖 WebRTC VAD 的分类行为。
    min_speech_ms=0 时起说确认即晋升 speech_start（等价旧行为 + 新状态名）。
    """
    detector = VoiceActivityDetector(
        aggressiveness=0,
        frame_ms=FRAME_MS,
        sample_rate=SAMPLE_RATE,
        speech_confirm_frames=3,
        silence_confirm_frames=5,
        pre_buffer_ms=300,
        min_speech_ms=min_speech_ms,
    )
    # 替换底层 WebRTC VAD 为可控 mock
    detector._vad = MagicMock()
    detector._vad.is_speech = MagicMock(return_value=False)
    return detector


@pytest.fixture
def vad() -> VoiceActivityDetector:
    """min_speech_ms=0：起说确认即晋升（保留既有状态机行为的基线用例）。"""
    return _make_vad(min_speech_ms=0)


@pytest.fixture
def vad_candidate() -> VoiceActivityDetector:
    """min_speech_ms=150ms @30ms 帧：确认 3 帧（90ms）后还需 2 帧语音才晋升。"""
    return _make_vad(min_speech_ms=150)


def _enter_speech(detector: VoiceActivityDetector) -> None:
    """喂足语音帧让 min_speech_ms=0 的 VAD 进入 speech 状态。"""
    detector._vad.is_speech.return_value = True
    for _ in range(3):
        detector.feed(_voice_frame())
    assert detector.state == "speech"


def test_default_frame_ms_is_20() -> None:
    """构造默认 frame_ms 应为 20ms（16kHz = 640 bytes）。"""
    detector = VoiceActivityDetector()
    assert detector.frame_bytes == 640


def test_silent_frame_keeps_silence(vad: VoiceActivityDetector) -> None:
    """静音帧应保持 silence 状态且不发送任何音频。"""
    state, frames = vad.feed(_silent_frame())
    assert state == "silence"
    assert frames == []


def test_speech_confirm_frames_required(vad: VoiceActivityDetector) -> None:
    """需要连续 speech_confirm_frames 帧语音才起说确认（一次性 speech_start）。"""
    vad._vad.is_speech.return_value = True  # 所有帧判定为语音

    # 前两帧语音但未达阈值，仍为 silence
    for _ in range(2):
        state, frames = vad.feed(_voice_frame())
        assert state == "silence"
        assert frames == []

    # 第三帧语音，达到阈值（min_speech_ms=0 直接晋升），一次性 speech_start
    state, frames = vad.feed(_voice_frame())
    assert state == "speech_start"
    # 预缓冲应包含前两帧（被缓冲）+ 当前帧
    assert len(frames) == 3

    # 之后持续返回 speech
    state, frames = vad.feed(_voice_frame())
    assert state == "speech"
    assert len(frames) == 1


def test_pre_buffer_flush_on_speech_start(vad: VoiceActivityDetector) -> None:
    """speech_start 时应 flush 预缓冲（含之前的静音/未确认语音帧）。"""
    # 先喂几帧静音填充预缓冲
    vad._vad.is_speech.return_value = False
    for _ in range(5):
        vad.feed(_silent_frame())

    # 再喂足够的语音帧触发转换
    vad._vad.is_speech.return_value = True
    for _ in range(3):
        state, frames = vad.feed(_voice_frame())

    # 最后一次应返回 speech_start 且 frames 包含预缓冲内容（5 静音 + 3 语音）
    assert state == "speech_start"
    assert len(frames) == 8


def test_speech_to_silence_transition(vad: VoiceActivityDetector) -> None:
    """speech 状态下连续静音帧达阈值后应返回 speech_end。"""
    _enter_speech(vad)

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
    # speech_end 应携带本段语音时长（3 语音 flush + 5 静音确认 = 8 帧 * 30ms）
    assert vad.last_segment_ms == 8 * FRAME_MS
    # speech_end 是一次性事件，内部状态应立即回到 silence。
    assert vad.state == "silence"


def test_speech_end_does_not_repeat_during_following_silence(
    vad: VoiceActivityDetector,
) -> None:
    """speech_end 后持续静音不应反复触发 end_speech。"""
    _enter_speech(vad)

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
    _enter_speech(vad)

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


# ---------------------------------------------------------------------------
# pending 候选阶段（min_speech_ms > 0）
# ---------------------------------------------------------------------------


def test_candidate_promoted_to_speech_start(
    vad_candidate: VoiceActivityDetector,
) -> None:
    """候选累计语音达 min_speech_ms 才晋升为一次性 speech_start。"""
    vad_candidate._vad.is_speech.return_value = True

    # 前 2 帧：未达起说确认
    for _ in range(2):
        state, frames = vad_candidate.feed(_voice_frame())
        assert state == "silence"
        assert frames == []

    # 第 3 帧：起说确认 → pending（90ms < 150ms），帧不下发
    state, frames = vad_candidate.feed(_voice_frame())
    assert state == "silence"
    assert frames == []
    assert vad_candidate.state == "pending"

    # 第 4 帧：候选累计 120ms，仍不下发
    state, frames = vad_candidate.feed(_voice_frame())
    assert state == "silence"
    assert frames == []

    # 第 5 帧：候选累计 150ms 达标 → speech_start，flush 预缓冲+候选帧（共 5 帧）
    state, frames = vad_candidate.feed(_voice_frame())
    assert state == "speech_start"
    assert len(frames) == 5
    assert vad_candidate.last_flush_ms == 5 * FRAME_MS
    assert vad_candidate.state == "speech"

    # 之后持续 speech
    state, frames = vad_candidate.feed(_voice_frame())
    assert state == "speech"
    assert len(frames) == 1


def test_short_speech_discarded_without_speech_end(
    vad_candidate: VoiceActivityDetector,
) -> None:
    """候选期静音确认先到：整段丢弃回 silence，不产生 speech_end。"""
    # 起说确认进入 pending（3 帧语音 = 90ms < 150ms）
    vad_candidate._vad.is_speech.return_value = True
    for _ in range(3):
        state, frames = vad_candidate.feed(_voice_frame())
        assert frames == []
    assert vad_candidate.state == "pending"

    # 静音确认（5 帧）先到 → 全程返回 silence，无 speech_start/speech_end
    vad_candidate._vad.is_speech.return_value = False
    for _ in range(5):
        state, frames = vad_candidate.feed(_silent_frame())
        assert state == "silence"
        assert frames == []
    assert vad_candidate.state == "silence"

    # 丢弃事件可一次性取出（累计语音 90ms），再取为 None
    assert vad_candidate.pop_discarded_ms() == 3 * FRAME_MS
    assert vad_candidate.pop_discarded_ms() is None


def test_new_speech_after_discard_promotes_normally(
    vad_candidate: VoiceActivityDetector,
) -> None:
    """短语音丢弃后，新一段足长语音应正常晋升 speech_start。"""
    # 第一段：短语音被丢弃
    vad_candidate._vad.is_speech.return_value = True
    for _ in range(3):
        vad_candidate.feed(_voice_frame())
    vad_candidate._vad.is_speech.return_value = False
    for _ in range(5):
        vad_candidate.feed(_silent_frame())
    assert vad_candidate.state == "silence"
    vad_candidate.pop_discarded_ms()

    # 第二段：5 帧语音（150ms）应正常晋升
    vad_candidate._vad.is_speech.return_value = True
    states = [vad_candidate.feed(_voice_frame())[0] for _ in range(5)]
    assert states[-1] == "speech_start"
    assert vad_candidate.state == "speech"


def test_candidate_short_pause_frames_are_kept_in_flush(
    vad_candidate: VoiceActivityDetector,
) -> None:
    """候选期未达静音确认的短停顿帧也入候选缓冲，晋升时一并下发不丢内容。"""
    vad_candidate._vad.is_speech.return_value = True
    for _ in range(3):
        vad_candidate.feed(_voice_frame())  # 起说确认 → pending（90ms）

    # 2 帧短停顿（< 静音确认 5 帧），不计语音时长但入候选缓冲
    vad_candidate._vad.is_speech.return_value = False
    for _ in range(2):
        state, frames = vad_candidate.feed(_silent_frame())
        assert state == "silence"
        assert frames == []

    # 恢复语音 2 帧 → 累计 150ms 达标，flush 应含短停顿帧（3+2+2 = 7 帧）
    vad_candidate._vad.is_speech.return_value = True
    state, frames = vad_candidate.feed(_voice_frame())
    assert state == "silence"
    state, frames = vad_candidate.feed(_voice_frame())
    assert state == "speech_start"
    assert len(frames) == 7


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
    _enter_speech(vad)

    vad.reset()
    assert vad.state == "silence"

    # reset 后第一帧静音应直接返回 silence
    vad._vad.is_speech.return_value = False
    state, frames = vad.feed(_silent_frame())
    assert state == "silence"
    assert frames == []


def test_reset_clears_pending_candidate(vad_candidate: VoiceActivityDetector) -> None:
    """pending 候选期 reset（barge-in 场景）应丢弃候选且不留丢弃事件。"""
    vad_candidate._vad.is_speech.return_value = True
    for _ in range(3):
        vad_candidate.feed(_voice_frame())
    assert vad_candidate.state == "pending"

    vad_candidate.reset()
    assert vad_candidate.state == "silence"
    assert vad_candidate.pop_discarded_ms() is None
