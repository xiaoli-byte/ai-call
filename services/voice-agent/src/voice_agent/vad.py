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

import logging
from collections import deque
from typing import Callable, Literal, Optional, Protocol, runtime_checkable

import webrtcvad

logger = logging.getLogger(__name__)

VadState = Literal["silence", "pending", "speech_start", "speech", "speech_end"]


# ---------------------------------------------------------------------------
# 帧级语音检测器抽象（B-P2a）
#
# VoiceActivityDetector 的状态机与「单帧是否为语音」的判定解耦：状态机负责
# 滞后确认 / 预缓冲 / 候选丢弃 / 端点判停，帧级检测器只回答「这一帧是不是语音」。
# 这样底层模型（webrtcvad / Silero VAD / …）可插拔，且主链路绝不依赖某个模型
# 的可用性——silero 装不上或运行中抛异常都能无缝回退到 webrtc，通话不断。
# ---------------------------------------------------------------------------


@runtime_checkable
class FrameSpeechDetector(Protocol):
    """帧级语音检测器协议：输入单帧 PCM16 字节，返回是否为语音。

    - is_speech(frame) 必须**永不抛异常**（内部自行兜底），否则会把 VAD 主循环带崩。
    - reset() 可选（barge-in / 新一句时清模型内部状态）；未实现时调用方应跳过。
    """

    def is_speech(self, frame: bytes) -> bool:  # pragma: no cover - 协议声明
        ...

    def reset(self) -> None:  # pragma: no cover - 协议声明（可选实现）
        ...


class WebRtcFrameDetector:
    """webrtcvad 帧级封装——与旧内联调用逐帧等价。

    行为对齐现有 VoiceActivityDetector 内联路径：调用 webrtcvad.Vad.is_speech，
    对全零帧等偶发异常一律按静音（False）兜底。webrtcvad 无可重置的外部状态
    （历史上 reset 也从不重建它），故 reset() 为空实现。
    """

    def __init__(self, aggressiveness: int = 3, sample_rate: int = 16000) -> None:
        if aggressiveness not in (0, 1, 2, 3):
            raise ValueError(f"aggressiveness must be 0-3, got {aggressiveness}")
        if sample_rate not in (8000, 16000, 32000, 48000):
            raise ValueError(f"sample_rate must be 8/16/32/48kHz, got {sample_rate}")
        self._vad = webrtcvad.Vad(aggressiveness)
        self._sample_rate = sample_rate

    def is_speech(self, frame: bytes) -> bool:
        # webrtcvad 偶尔对全零帧抛异常，静音判定即可（与旧行为一致）
        try:
            return bool(self._vad.is_speech(frame, self._sample_rate))
        except Exception:
            return False

    def reset(self) -> None:
        # webrtcvad 无外部可重置状态，空实现（历史行为：reset 从不重建它）。
        pass


class SileroFrameDetector:
    """Silero VAD（pysilero-vad，onnx/ggml 后端，无 torch）帧级封装。

    Silero 模型窗口固定为 512 样本 @16kHz s16le（= 1024 字节），而 VAD 主循环
    喂入的是 10/20/30ms 帧（如 20ms = 320 样本 = 640 字节）。二者对不齐，故内部
    以字节缓冲累积逐帧 append，凑够 1024 字节即取一窗跑一次推理（hop=1024，消费掉），
    缓存最近一次概率；is_speech 返回「最近概率 >= threshold」。

    - 模型尚未出过概率前（首 1~2 帧，样本不足一窗）返回 False：宁可迟判 speech_start
      约 32ms，也不误触发。
    - 推理抛异常：告警一次并**永久降级**为 webrtc 检测器（运行中回退，通话不断）。
    - reset() 清缓冲 + 模型内部状态（新一句 / barge-in）。
    """

    _CHUNK_BYTES = 1024  # Silero 固定窗口：512 样本 @16kHz s16le

    def __init__(
        self,
        threshold: float = 0.5,
        aggressiveness: int = 3,
        sample_rate: int = 16000,
        model: Optional[Callable[[bytes], float]] = None,
    ) -> None:
        # model 注入点：默认真模型；测试可注入 fake 概率函数隔离缓冲数学。
        if model is None:
            from pysilero_vad import SileroVoiceActivityDetector

            model = SileroVoiceActivityDetector()
        self._model = model
        self._threshold = threshold
        self._aggressiveness = aggressiveness
        self._sample_rate = sample_rate

        self._buf = bytearray()
        self._last_prob = 0.0
        self._have_prob = False  # 是否已出过至少一次概率（首帧前为 False）

        # 运行中降级：一旦推理抛异常，永久切到 webrtc 兜底检测器。
        self._degraded = False
        self._fallback: Optional[WebRtcFrameDetector] = None

    def is_speech(self, frame: bytes) -> bool:
        if self._degraded and self._fallback is not None:
            return self._fallback.is_speech(frame)

        self._buf += frame
        try:
            # while 而非 if：即使一帧凑出多窗（如大帧/补齐）也全部消费，
            # 循环末次即「最新」窗口的概率。
            while len(self._buf) >= self._CHUNK_BYTES:
                chunk = bytes(self._buf[: self._CHUNK_BYTES])
                del self._buf[: self._CHUNK_BYTES]
                self._last_prob = float(self._model(chunk))
                self._have_prob = True
        except Exception as err:  # 推理异常 → 永久降级 webrtc
            self._degrade(err)
            return self._fallback.is_speech(frame) if self._fallback else False

        return self._have_prob and self._last_prob >= self._threshold

    def _degrade(self, err: Exception) -> None:
        logger.warning("[VAD] silero degraded to webrtc: %s", err)
        self._degraded = True
        self._fallback = WebRtcFrameDetector(self._aggressiveness, self._sample_rate)

    def reset(self) -> None:
        self._buf.clear()
        self._last_prob = 0.0
        self._have_prob = False
        reset_fn = getattr(self._model, "reset", None)
        if callable(reset_fn):
            try:
                reset_fn()
            except Exception:
                pass
        if self._degraded and self._fallback is not None:
            self._fallback.reset()


def make_frame_detector_factory(
    provider: Optional[str],
    aggressiveness: int = 3,
    sample_rate: int = 16000,
    silero_threshold: float = 0.5,
) -> Callable[[], Optional[FrameSpeechDetector]]:
    """按 provider 返回一个零参工厂：每次调用产出一个**新的**帧级检测器实例。

    - 返回 None 表示用 VoiceActivityDetector 内建 webrtc（默认路径，零改动）。
    - provider=silero：启动时探针加载一次模型；成功则工厂产出 SileroFrameDetector，
      并打印 `[VAD] provider=silero threshold=0.50`。
    - provider=silero 但 import/初始化失败 → 告警 + 回退 webrtc（返回 lambda: None），
      启动不炸。
    - 每通电话新建独立实例：Silero 有逐句内部状态，绝不跨通话复用。
    """
    name = (provider or "webrtc").strip().lower()
    if name == "silero":
        try:
            from pysilero_vad import SileroVoiceActivityDetector

            SileroVoiceActivityDetector()  # 探针：确认模型可加载（早失败早回退）
        except Exception as err:
            logger.warning("[VAD] provider=silero 不可用，回退 webrtc: %s", err)
            return lambda: None
        logger.info("[VAD] provider=silero threshold=%.2f", silero_threshold)
        return lambda: SileroFrameDetector(
            threshold=silero_threshold,
            aggressiveness=aggressiveness,
            sample_rate=sample_rate,
        )
    logger.info("[VAD] provider=webrtc")
    return lambda: None


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
        detector: Optional[FrameSpeechDetector] = None,
    ) -> None:
        if frame_ms not in (10, 20, 30):
            raise ValueError(f"WebRTC VAD only supports 10/20/30ms frames, got {frame_ms}")
        if aggressiveness not in (0, 1, 2, 3):
            raise ValueError(f"aggressiveness must be 0-3, got {aggressiveness}")
        if sample_rate not in (8000, 16000, 32000, 48000):
            raise ValueError(f"sample_rate must be 8/16/32/48kHz, got {sample_rate}")

        # 帧级检测器（B-P2a）：默认 None → 走内建 webrtcvad 内联路径（与旧行为
        # 逐字节等价，且保留 `_vad` 属性供既有测试 monkeypatch）；注入 detector
        # （如 SileroFrameDetector）时改走 detector.is_speech。
        self._detector = detector
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

        # 帧级判定：注入 detector 时走它（自身兜底，永不抛）；否则走内建
        # webrtcvad 内联路径（全零帧偶发异常按静音兜底，与旧行为一致）。
        if self._detector is not None:
            is_voice = self._detector.is_speech(pcm_frame)
        else:
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
        # 同步重置帧级检测器的模型内部状态（如 Silero 的逐句状态）。
        if self._detector is not None:
            reset_fn = getattr(self._detector, "reset", None)
            if callable(reset_fn):
                try:
                    reset_fn()
                except Exception:
                    pass
