"""语义自适应端点检测（B-P1b）单元测试。

覆盖三层：
1. vad.py 的 extra_silence_frames_provider 注入点（帧数学，端点窗口延长/封顶/兜底）
2. agent.py 的 _semantic_extend_ms 分类 + _semantic_extra_silence_frames 计算（含封顶/开关）
3. agent.py 的 partial 缓存复位（speech_start / speech_end / 打断）与 provider 绑定后的真机端点行为

设计契约见 docs/backlog.md B-P1b。VAD 底层 webrtcvad 用 mock 隔离，只验状态机数学。
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from voice_agent.agent import VoiceAgent, _semantic_extend_ms
from voice_agent.types import STTEvent
from voice_agent.vad import VoiceActivityDetector


SAMPLE_RATE = 16000
FRAME_MS = 30
FRAME_BYTES = SAMPLE_RATE * 2 * FRAME_MS // 1000  # 960


# ---------------------------------------------------------------------------
# 公共构造
# ---------------------------------------------------------------------------


def _silent_frame() -> bytes:
    return b"\x00" * FRAME_BYTES


def _voice_frame() -> bytes:
    return b"\x10" * FRAME_BYTES


def _make_vad(min_speech_ms: int = 0, provider=None) -> VoiceActivityDetector:
    """构造测试 VAD（底层 webrtcvad → mock），可注入 extra_silence_frames_provider。

    speech_confirm=3、silence_confirm=5，端点基础窗 = 5 帧。
    """
    detector = VoiceActivityDetector(
        aggressiveness=0,
        frame_ms=FRAME_MS,
        sample_rate=SAMPLE_RATE,
        speech_confirm_frames=3,
        silence_confirm_frames=5,
        pre_buffer_ms=300,
        min_speech_ms=min_speech_ms,
        extra_silence_frames_provider=provider or (lambda: 0),
    )
    detector._vad = MagicMock()
    detector._vad.is_speech = MagicMock(return_value=False)
    return detector


def _enter_speech(detector: VoiceActivityDetector) -> None:
    detector._vad.is_speech.return_value = True
    for _ in range(3):
        detector.feed(_voice_frame())
    assert detector.state == "speech"


def _make_agent(**kw) -> VoiceAgent:
    """构造测试 VoiceAgent，AI 依赖全部 mock（本用例不触达它们）。"""
    return VoiceAgent(
        llm=MagicMock(),
        tts=MagicMock(),
        rag=MagicMock(),
        tools=MagicMock(),
        tasks=MagicMock(),
        **kw,
    )


class _FakeSTT:
    def __init__(self) -> None:
        self.sent: list[bytes] = []
        self.ended = 0

    async def send_audio(self, pcm: bytes) -> None:
        self.sent.append(pcm)

    async def end_speech(self) -> None:
        self.ended += 1


class _FakeVAD:
    """固定返回指定 state 的假 VAD，用于驱动 receive_audio 的分支。"""

    def __init__(self, state: str) -> None:
        self._state = state

    def feed(self, frame: bytes):
        return self._state, [frame]

    def reset(self) -> None:
        pass


# ---------------------------------------------------------------------------
# 1) VAD 注入点：端点窗口的帧数学
# ---------------------------------------------------------------------------


def test_provider_zero_matches_fixed_window() -> None:
    """provider 恒 0：端点判停仍在基础窗（5 帧），与固定静音窗零差异。"""
    vad = _make_vad(provider=lambda: 0)
    _enter_speech(vad)
    vad._vad.is_speech.return_value = False
    for _ in range(4):  # 4 帧 < 5
        assert vad.feed(_silent_frame())[0] == "speech"
    assert vad.feed(_silent_frame())[0] == "speech_end"


def test_provider_extends_endpoint_window() -> None:
    """provider 返回额外 3 帧：端点判停推迟到 5+3=8 帧。"""
    vad = _make_vad(provider=lambda: 3)
    _enter_speech(vad)
    vad._vad.is_speech.return_value = False
    for _ in range(7):  # 7 帧 < 8
        assert vad.feed(_silent_frame())[0] == "speech"
    assert vad.feed(_silent_frame())[0] == "speech_end"


def test_provider_queried_dynamically_per_frame() -> None:
    """provider 每帧查询：延长量中途消失（partial 结尾语义变化）→ 立即按基础窗判停。"""
    box = {"extra": 10}
    vad = _make_vad(provider=lambda: box["extra"])
    _enter_speech(vad)
    vad._vad.is_speech.return_value = False
    for _ in range(5):  # 5 帧：base=5 但 extra=10 → 阈值 15，仍 speech
        assert vad.feed(_silent_frame())[0] == "speech"
    # 语义消失（extra→0）：下一帧 silence_count=6 >= 5 → 立即端点
    box["extra"] = 0
    assert vad.feed(_silent_frame())[0] == "speech_end"


def test_provider_negative_treated_as_zero() -> None:
    """provider 返回负数按 0 处理（max(0,...)），不会缩短基础窗。"""
    vad = _make_vad(provider=lambda: -100)
    _enter_speech(vad)
    vad._vad.is_speech.return_value = False
    for _ in range(4):
        assert vad.feed(_silent_frame())[0] == "speech"
    assert vad.feed(_silent_frame())[0] == "speech_end"


def test_provider_exception_falls_back_to_base() -> None:
    """provider 抛异常按 0 兜底，绝不让语义延长把 VAD 主循环带崩。"""

    def boom() -> int:
        raise RuntimeError("provider 故障")

    vad = _make_vad(provider=boom)
    _enter_speech(vad)
    vad._vad.is_speech.return_value = False
    for _ in range(4):
        assert vad.feed(_silent_frame())[0] == "speech"
    assert vad.feed(_silent_frame())[0] == "speech_end"


def test_provider_does_not_affect_pending_discard() -> None:
    """延长只作用于 speech→silence 端点，不作用于 pending 候选期的噪声丢弃阈值。

    否则会削弱 P0 的短语音噪声拒识（且候选期尚无 partial 文本可依据）。
    """
    vad = _make_vad(min_speech_ms=150, provider=lambda: 100)  # extra 极大
    vad._vad.is_speech.return_value = True
    for _ in range(3):  # 起说确认 → pending（90ms < 150ms）
        vad.feed(_voice_frame())
    assert vad.state == "pending"
    # 静音确认仍在基础 5 帧（未被 +100 延长）→ 整段丢弃回 silence
    vad._vad.is_speech.return_value = False
    for _ in range(5):
        assert vad.feed(_silent_frame())[0] == "silence"
    assert vad.state == "silence"
    assert vad.pop_discarded_ms() == 3 * FRAME_MS


# ---------------------------------------------------------------------------
# 2) 语义分类 _semantic_extend_ms
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected_ms,expected_reason",
    [
        ("138", 600, "digit"),  # 阿拉伯数字结尾
        ("我的号码是一三八", 600, "digit"),  # 中文数字结尾（八）
        ("尾号零", 600, "digit"),  # 中文零
        ("两", 600, "digit"),  # 两
        ("嗯", 400, "hesitation"),  # 单字犹豫词
        ("呃", 400, "hesitation"),
        ("那个", 400, "hesitation"),  # 双字犹豫词
        ("我想想就是", 400, "hesitation"),  # 结尾窗口命中
        ("然后呢", 0, "none"),  # 结尾是「呢」，非后缀命中（防「只要包含」误判）
        ("好的", 0, "none"),
        ("", 0, "none"),
        ("   ", 0, "none"),
    ],
)
def test_semantic_extend_ms_classification(
    text: str, expected_ms: int, expected_reason: str
) -> None:
    ms, reason = _semantic_extend_ms(text, digit_ms=600, hesitation_ms=400)
    assert (ms, reason) == (expected_ms, expected_reason)


def test_semantic_extend_ms_digit_beats_hesitation() -> None:
    """数字优先级高于犹豫词（结尾同时可解释时取数字延长）。"""
    ms, reason = _semantic_extend_ms("嗯8", digit_ms=600, hesitation_ms=400)
    assert (ms, reason) == (600, "digit")


# ---------------------------------------------------------------------------
# 3) agent 计算 _semantic_extra_silence_frames（默认 frame_ms=20, silence_confirm=10）
# ---------------------------------------------------------------------------


def test_extra_frames_digit_partial() -> None:
    """数字 partial → 600ms / 20ms = 30 帧（默认参数下未触顶）。"""
    agent = _make_agent()
    agent._recent_partial["c"] = "138"
    assert agent._semantic_extra_silence_frames("c") == 30


def test_extra_frames_hesitation_partial() -> None:
    """犹豫词 partial → 400ms / 20ms = 20 帧，延长量小于数字。"""
    agent = _make_agent()
    agent._recent_partial["c"] = "嗯"
    assert agent._semantic_extra_silence_frames("c") == 20


def test_extra_frames_normal_partial_is_zero() -> None:
    """普通结尾 partial → 0（默认开启也与现状零差异）。"""
    agent = _make_agent()
    agent._recent_partial["c"] = "好的"
    assert agent._semantic_extra_silence_frames("c") == 0


def test_extra_frames_no_partial_is_zero() -> None:
    agent = _make_agent()
    assert agent._semantic_extra_silence_frames("c") == 0


def test_extra_frames_disabled_is_zero() -> None:
    """开关关闭 → 恒 0，即使 partial 结尾是数字。"""
    agent = _make_agent(vad_semantic_endpoint_enabled=False)
    agent._recent_partial["c"] = "138"
    assert agent._semantic_extra_silence_frames("c") == 0


def test_extra_frames_capped_by_max_total() -> None:
    """总窗封顶：max_total=300ms、基础窗=10*20=200ms → 延长至多 100ms=5 帧。"""
    agent = _make_agent(vad_semantic_max_total_ms=300)
    agent._recent_partial["c"] = "138"  # 想延长 600ms，被压到 100ms
    assert agent._semantic_extra_silence_frames("c") == 5


def test_extra_frames_zero_when_base_already_exceeds_max_total() -> None:
    """基础窗已 >= max_total → 无可延长空间，返回 0。"""
    agent = _make_agent(vad_semantic_max_total_ms=100)  # 基础 200ms > 100ms
    agent._recent_partial["c"] = "138"
    assert agent._semantic_extra_silence_frames("c") == 0


def test_extra_frames_logs_once_per_utterance() -> None:
    """provider 每帧被查询，但同一 utterance 仅打一行 [VAD/Semantic] 日志（去重）。"""
    agent = _make_agent()
    agent._recent_partial["c"] = "138"
    for _ in range(5):
        agent._semantic_extra_silence_frames("c")
    assert "c" in agent._semantic_extend_logged
    # 复位后可再次记录
    agent._reset_semantic_partial("c")
    assert "c" not in agent._semantic_extend_logged


# ---------------------------------------------------------------------------
# 4) partial 缓存复位 + provider 绑定的真机端点行为
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_partial_reset_on_speech_start() -> None:
    """新 speech_start：清掉上一句遗留 partial，避免带进下一句端点。"""
    agent = _make_agent()
    cid = "recv-start"
    agent._stt_handles[cid] = _FakeSTT()  # type: ignore[assignment]
    agent._vads[cid] = _FakeVAD("speech_start")  # type: ignore[assignment]
    agent._channels[cid] = "freeswitch"
    agent._recent_partial[cid] = "138"
    agent._semantic_extend_logged.add(cid)

    await agent.receive_audio(cid, b"\x01" * 640)

    assert cid not in agent._recent_partial
    assert cid not in agent._semantic_extend_logged


@pytest.mark.asyncio
async def test_partial_reset_on_speech_end() -> None:
    """utterance 结束（speech_end）：清掉本句 partial。"""
    agent = _make_agent()
    cid = "recv-end"
    stt = _FakeSTT()
    agent._stt_handles[cid] = stt  # type: ignore[assignment]
    agent._vads[cid] = _FakeVAD("speech_end")  # type: ignore[assignment]
    agent._channels[cid] = "freeswitch"
    agent._recent_partial[cid] = "138"
    agent._semantic_extend_logged.add(cid)

    await agent.receive_audio(cid, b"\x01" * 640)

    assert cid not in agent._recent_partial
    assert cid not in agent._semantic_extend_logged
    assert stt.ended == 1  # speech_end 仍照常通知 STT 端点


def test_partial_reset_on_barge_in() -> None:
    """打断（_interrupt_speaking，speaking=True）：复位 partial 缓存。"""
    agent = _make_agent()
    cid = "barge"
    agent._speaking[cid] = True
    agent._recent_partial[cid] = "138"
    agent._semantic_extend_logged.add(cid)

    agent._interrupt_speaking(cid)

    assert cid not in agent._recent_partial
    assert cid not in agent._semantic_extend_logged


@pytest.mark.asyncio
async def test_on_stt_partial_stores_recent_text_after_barge_in() -> None:
    """barge-in 期收到 partial：打断复位后仍把「触发打断的这条 partial」存为本句缓存。"""
    agent = _make_agent()
    cid = "partial-barge"
    agent._speaking[cid] = True
    await agent._on_stt_event(cid, STTEvent(type="partial", text="我的号码是138"))
    assert agent._recent_partial[cid] == "我的号码是138"


@pytest.mark.asyncio
async def test_on_stt_partial_stores_recent_text_no_tts() -> None:
    """非播报期收到 partial：正常存为本句缓存。"""
    agent = _make_agent()
    cid = "partial-normal"
    await agent._on_stt_event(cid, STTEvent(type="partial", text="嗯"))
    assert agent._recent_partial[cid] == "嗯"


def test_agent_provider_extends_real_vad_for_digits() -> None:
    """端到端：把 agent 的 provider 绑到真 VAD，数字 partial 让端点判停延后。"""
    agent = _make_agent(vad_silence_confirm_frames=5)  # 基础窗缩到 5 帧加速测试
    cid = "int-digit"
    vad = VoiceActivityDetector(
        aggressiveness=0,
        frame_ms=20,
        sample_rate=16000,
        speech_confirm_frames=3,
        silence_confirm_frames=5,
        pre_buffer_ms=300,
        min_speech_ms=0,
        extra_silence_frames_provider=(
            lambda cid=cid: agent._semantic_extra_silence_frames(cid)
        ),
    )
    vad._vad = MagicMock()
    vad._vad.is_speech = MagicMock(return_value=True)
    for _ in range(3):
        vad.feed(b"\x10" * 640)
    assert vad.state == "speech"

    # 数字 partial：延长 600ms/20=30 帧（base=5*20=100ms，max_total 1600 未触顶）
    agent._recent_partial[cid] = "138"
    vad._vad.is_speech.return_value = False
    for _ in range(34):  # 34 帧 < 5+30=35
        assert vad.feed(b"\x00" * 640)[0] == "speech"
    assert vad.feed(b"\x00" * 640)[0] == "speech_end"


def test_agent_provider_no_extend_for_normal_partial() -> None:
    """端到端：普通结尾 partial → 端点仍在基础窗（默认开启也零差异）。"""
    agent = _make_agent(vad_silence_confirm_frames=5)
    cid = "int-normal"
    vad = VoiceActivityDetector(
        aggressiveness=0,
        frame_ms=20,
        sample_rate=16000,
        speech_confirm_frames=3,
        silence_confirm_frames=5,
        pre_buffer_ms=300,
        min_speech_ms=0,
        extra_silence_frames_provider=(
            lambda cid=cid: agent._semantic_extra_silence_frames(cid)
        ),
    )
    vad._vad = MagicMock()
    vad._vad.is_speech = MagicMock(return_value=True)
    for _ in range(3):
        vad.feed(b"\x10" * 640)
    agent._recent_partial[cid] = "好的"
    vad._vad.is_speech.return_value = False
    for _ in range(4):  # 4 帧 < 5
        assert vad.feed(b"\x00" * 640)[0] == "speech"
    assert vad.feed(b"\x00" * 640)[0] == "speech_end"
