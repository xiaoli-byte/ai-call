"""WebRTC VAD 封装 - 前置语音活动检测。

设计目标（参见 .trae/documents/python-voice-agent-replacement.md §vad.py）：
- 输入：固定 30ms PCM16 帧（16kHz = 960 bytes）
- 输出：(state, frames_to_send)
  - silence 状态：frames_to_send=[]，pre_buffer 滚动追加
  - silence → speech 转换：frames_to_send = pre_buffer + current
  - speech 状态：frames_to_send = [current]
  - speech → silence 转换：state='speech_end'，最后一帧仍发送
- 滞后确认：连续 N 帧语音/静音才切换状态，避免边界抖动
- 预缓冲：300ms 滚动窗口，silence→speech 时 flush 防丢首字
"""

from __future__ import annotations

from collections import deque
from typing import Literal

import webrtcvad

VadState = Literal["silence", "speech", "speech_end"]


class VoiceActivityDetector:
    """WebRTC VAD 状态机封装。

    线程安全性：实例为单 call 绑定，仅在 agent 的事件循环中调用，无需加锁。
    """

    def __init__(
        self,
        aggressiveness: int = 3,
        frame_ms: int = 30,
        sample_rate: int = 16000,
        speech_confirm_frames: int = 3,
        silence_confirm_frames: int = 10,
        pre_buffer_ms: int = 300,
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

        self._state: VadState = "silence"
        self._speech_count = 0
        self._silence_count = 0

    @property
    def frame_bytes(self) -> int:
        """期望的单帧字节数。"""
        return self._frame_bytes

    @property
    def state(self) -> VadState:
        """当前状态。"""
        return self._state

    def feed(self, pcm_frame: bytes) -> tuple[VadState, list[bytes]]:
        """喂入一帧 PCM，返回 (state, frames_to_send)。

        state 取值：
        - 'silence'：当前判定为静音，frames_to_send 为空
        - 'speech'：当前判定为语音，frames_to_send 含本帧（及可能的预缓冲）
        - 'speech_end'：本帧触发了 speech → silence 转换，frames_to_send 含本帧

        调用方应在 state='speech_end' 后通知 STT 端点（end_speech）。
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
        else:
            return self._handle_speech_state(is_voice, pcm_frame)

    def _handle_silence_state(
        self, is_voice: bool, frame: bytes
    ) -> tuple[VadState, list[bytes]]:
        if is_voice:
            self._speech_count += 1
            self._silence_count = 0
            # 滚动缓冲：哪怕即将转 speech，本帧也入预缓冲
            self._pre_buffer.append(frame)

            if self._speech_count >= self._speech_confirm:
                # silence → speech：flush 预缓冲 + 当前帧
                # 注意：当前帧已 append 到 pre_buffer，需去重
                frames = list(self._pre_buffer)
                self._pre_buffer.clear()
                self._state = "speech"
                self._speech_count = 0
                return "speech", frames
            return "silence", []

        # 静音中保持静音：滚动追加预缓冲，不发送
        self._speech_count = 0
        self._pre_buffer.append(frame)
        return "silence", []

    def _handle_speech_state(
        self, is_voice: bool, frame: bytes
    ) -> tuple[VadState, list[bytes]]:
        if is_voice:
            self._silence_count = 0
            self._state = "speech"
            return "speech", [frame]

        self._silence_count += 1
        if self._silence_count >= self._silence_confirm:
            # speech → silence：本帧仍发送（可能含末尾语音），但 speech_end
            # 只是一次性事件；内部状态立即回到 silence，避免后续静音帧
            # 周期性重复触发 end_speech()。
            self._state = "silence"
            self._speech_count = 0
            self._silence_count = 0
            self._pre_buffer.clear()
            return "speech_end", [frame]

        # 静音帧但未达确认阈值：继续发送（防止短停顿误断句）
        return "speech", [frame]

    def reset(self) -> None:
        """重置状态机（用于 barge-in 后重新开始检测）。"""
        self._state = "silence"
        self._speech_count = 0
        self._silence_count = 0
        self._pre_buffer.clear()
