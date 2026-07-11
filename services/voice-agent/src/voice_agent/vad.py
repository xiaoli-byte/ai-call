"""WebRTC VAD 封装 - 前置语音活动检测。

设计目标（参见 .trae/documents/python-voice-agent-replacement.md §vad.py，
候选阶段契约见 docs/superpowers/specs/2026-07-10-vad-barge-in-p0.md）：
- 输入：固定 20ms PCM16 帧（16kHz = 640 bytes，构造可改 10/30ms）
- 输出：(state, frames_to_send)
  - silence 状态：frames_to_send=[]，pre_buffer 滚动追加
  - silence → 起说确认：进入 pending 候选阶段，帧入候选缓冲**不下发**
  - pending 候选累计语音时长 ≥ min_speech_ms：一次性返回 'speech_start'，
    flush 预缓冲 + 候选帧；之后持续返回 'speech'
  - pending 期静音确认先到：整段丢弃回 silence（不产生 speech_end）
  - speech → silence 转换：state='speech_end'，最后一帧仍发送
- 滞后确认：连续 N 帧语音/静音才切换状态，避免边界抖动
- 预缓冲：300ms 滚动窗口，speech_start 时 flush 防丢首字
"""

from __future__ import annotations

from collections import deque
from typing import Callable, Literal, Optional

import webrtcvad

VadState = Literal["silence", "pending", "speech_start", "speech", "speech_end"]


class VoiceActivityDetector:
    """WebRTC VAD 状态机封装。

    线程安全性：实例为单 call 绑定，仅在 agent 的事件循环中调用，无需加锁。
    """

    def __init__(
        self,
        aggressiveness: int = 3,
        frame_ms: int = 20,
        sample_rate: int = 16000,
        speech_confirm_frames: int = 3,
        silence_confirm_frames: int = 10,
        pre_buffer_ms: int = 300,
        min_speech_ms: int = 200,
        extra_silence_frames_provider: Callable[[], int] = lambda: 0,
    ) -> None:
        if frame_ms not in (10, 20, 30):
            raise ValueError(f"WebRTC VAD only supports 10/20/30ms frames, got {frame_ms}")
        if aggressiveness not in (0, 1, 2, 3):
            raise ValueError(f"aggressiveness must be 0-3, got {aggressiveness}")
        if sample_rate not in (8000, 16000, 32000, 48000):
            raise ValueError(f"sample_rate must be 8/16/32/48kHz, got {sample_rate}")

        self._vad = webrtcvad.Vad(aggressiveness)
        self._frame_ms = frame_ms
        self._sample_rate = sample_rate
        self._frame_bytes = sample_rate * 2 * frame_ms // 1000

        pre_buffer_capacity = max(1, pre_buffer_ms // frame_ms)
        self._pre_buffer: deque[bytes] = deque(maxlen=pre_buffer_capacity)

        self._speech_confirm = speech_confirm_frames
        self._silence_confirm = silence_confirm_frames
        self._min_speech_ms = max(0, min_speech_ms)

        # 语义自适应端点检测（B-P1b）：端点判停的静音确认阈值可被动态延长。
        # provider 每帧查询、返回「额外静音确认帧数」，默认 lambda:0（与固定
        # 静音窗逐帧等价）。仅作用于 speech→silence 端点判停，不影响 pending
        # 候选期的噪声丢弃阈值（那里没有 partial 文本可依据，延长它只会削弱噪声拒识）。
        self._extra_silence_frames_provider = extra_silence_frames_provider

        self._state: VadState = "silence"
        self._speech_count = 0
        self._silence_count = 0

        # pending 候选阶段：起说确认后帧先入候选缓冲，累计语音时长达标才下发
        self._pending_frames: list[bytes] = []
        self._pending_voice_ms = 0

        # 观测数据（供 agent 结构化日志使用）
        self._last_flush_ms = 0  # speech_start 一次性 flush 的时长（预缓冲+候选）
        self._segment_ms = 0  # 当前语音段累计时长
        self._last_segment_ms = 0  # 最近一次 speech_end 的语音段时长
        self._discarded_ms: Optional[int] = None  # 最近一次短语音丢弃的累计语音时长

    @property
    def frame_bytes(self) -> int:
        """期望的单帧字节数。"""
        return self._frame_bytes

    @property
    def state(self) -> VadState:
        """当前状态（含内部 pending 候选阶段）。"""
        return self._state

    @property
    def last_flush_ms(self) -> int:
        """最近一次 speech_start flush 的音频时长（预缓冲+候选，毫秒）。"""
        return self._last_flush_ms

    @property
    def last_segment_ms(self) -> int:
        """最近一次 speech_end 时本段语音的累计时长（毫秒）。"""
        return self._last_segment_ms

    def pop_discarded_ms(self) -> Optional[int]:
        """一次性取出最近的短语音丢弃事件（无则 None），供调用方打观测日志。"""
        discarded, self._discarded_ms = self._discarded_ms, None
        return discarded

    def feed(self, pcm_frame: bytes) -> tuple[VadState, list[bytes]]:
        """喂入一帧 PCM，返回 (state, frames_to_send)。

        state 取值：
        - 'silence'：当前判定为静音（含 pending 候选期，外部不感知），frames_to_send 为空
        - 'speech_start'：候选累计语音达 min_speech_ms，一次性事件；
          frames_to_send = 预缓冲 + 候选缓冲（含本帧）
        - 'speech'：持续语音，frames_to_send 含本帧
        - 'speech_end'：本帧触发了 speech → silence 转换，frames_to_send 含本帧

        调用方应在 state='speech_end' 后通知 STT 端点（end_speech）。
        pending 候选期静音确认先到时整段丢弃，返回 'silence'（不产生 speech_end），
        丢弃时长可经 pop_discarded_ms() 取出。
        """
        if len(pcm_frame) != self._frame_bytes:
            raise ValueError(
                f"frame size mismatch: expected {self._frame_bytes} bytes, "
                f"got {len(pcm_frame)}"
            )

        # WebRTC VAD 偶尔对全零帧抛异常，静音判定即可
        try:
            is_voice = self._vad.is_speech(pcm_frame, self._sample_rate)
        except Exception:
            is_voice = False

        if self._state == "silence":
            return self._handle_silence_state(is_voice, pcm_frame)
        if self._state == "pending":
            return self._handle_pending_state(is_voice, pcm_frame)
        return self._handle_speech_state(is_voice, pcm_frame)

    def _handle_silence_state(
        self, is_voice: bool, frame: bytes
    ) -> tuple[VadState, list[bytes]]:
        if is_voice:
            self._speech_count += 1
            self._silence_count = 0
            # 滚动缓冲：哪怕即将转 pending/speech，本帧也入预缓冲
            self._pre_buffer.append(frame)

            if self._speech_count >= self._speech_confirm:
                # 起说确认 → 进入 pending 候选阶段。确认帧本身是真实语音，
                # 计入候选累计时长（确认帧已在预缓冲内，晋升时随 flush 下发）。
                self._state = "pending"
                self._pending_frames = []
                self._pending_voice_ms = self._speech_count * self._frame_ms
                self._speech_count = 0
                return self._maybe_promote()
            return "silence", []

        # 静音中保持静音：滚动追加预缓冲，不发送
        self._speech_count = 0
        self._pre_buffer.append(frame)
        return "silence", []

    def _handle_pending_state(
        self, is_voice: bool, frame: bytes
    ) -> tuple[VadState, list[bytes]]:
        # 候选期所有帧入候选缓冲（含未达静音确认的短停顿帧），晋升时不丢内容
        self._pending_frames.append(frame)
        if is_voice:
            self._silence_count = 0
            self._pending_voice_ms += self._frame_ms
            return self._maybe_promote()

        self._silence_count += 1
        if self._silence_count >= self._silence_confirm:
            # 静音确认先到：累计语音不足 min_speech_ms，判噪声整段丢弃，
            # 回 silence 且不产生 speech_end（STT 从未收到这段音频）。
            self._discarded_ms = self._pending_voice_ms
            self._reset_to_silence()
            return "silence", []
        return "silence", []

    def _maybe_promote(self) -> tuple[VadState, list[bytes]]:
        """候选累计语音达标则晋升为一次性 speech_start，flush 预缓冲+候选帧。"""
        if self._pending_voice_ms < self._min_speech_ms:
            return "silence", []
        frames = list(self._pre_buffer) + self._pending_frames
        self._pre_buffer.clear()
        self._pending_frames = []
        self._pending_voice_ms = 0
        self._state = "speech"
        self._silence_count = 0
        self._last_flush_ms = len(frames) * self._frame_ms
        self._segment_ms = self._last_flush_ms
        return "speech_start", frames

    def _handle_speech_state(
        self, is_voice: bool, frame: bytes
    ) -> tuple[VadState, list[bytes]]:
        if is_voice:
            self._silence_count = 0
            self._segment_ms += self._frame_ms
            return "speech", [frame]

        self._silence_count += 1
        if self._silence_count >= self._endpoint_silence_confirm():
            # speech → silence：本帧仍发送（可能含末尾语音），但 speech_end
            # 只是一次性事件；内部状态立即回到 silence，避免后续静音帧
            # 周期性重复触发 end_speech()。
            self._segment_ms += self._frame_ms
            self._last_segment_ms = self._segment_ms
            self._reset_to_silence()
            return "speech_end", [frame]

        # 静音帧但未达确认阈值：继续发送（防止短停顿误断句）
        self._segment_ms += self._frame_ms
        return "speech", [frame]

    def _endpoint_silence_confirm(self) -> int:
        """端点判停的有效静音确认帧数 = 基础阈值 + 语义延长（provider 动态查询）。

        provider 默认返回 0（行为与固定静音窗完全一致）；返回负数按 0 处理。
        provider 抛异常一律按 0 兜底——语义延长绝不能把 VAD 主循环带崩。
        """
        try:
            extra = int(self._extra_silence_frames_provider())
        except Exception:
            extra = 0
        return self._silence_confirm + max(0, extra)

    def _reset_to_silence(self) -> None:
        self._state = "silence"
        self._speech_count = 0
        self._silence_count = 0
        self._pending_frames = []
        self._pending_voice_ms = 0
        self._segment_ms = 0
        self._pre_buffer.clear()

    def reset(self) -> None:
        """重置状态机（用于 barge-in 后重新开始检测）。"""
        self._reset_to_silence()
        self._discarded_ms = None
