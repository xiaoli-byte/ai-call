"""PCM 音频处理工具。

提供：
- PCM16 与 numpy float 互转
- 采样率重采样（scipy.signal.resample_poly，适合流式分块）
- 按 VAD 帧长切片
"""

from __future__ import annotations

from collections.abc import Iterator
from math import gcd

import numpy as np
from scipy.signal import resample_poly


def pcm16_to_float(pcm: bytes) -> np.ndarray:
    """PCM 16-bit signed LE bytes → float32 ndarray（范围 -1.0 ~ 1.0）。"""
    if not pcm:
        return np.zeros(0, dtype=np.float32)
    arr = np.frombuffer(pcm, dtype="<i2").astype(np.float32)
    arr /= 32768.0
    return arr


def float_to_pcm16(arr: np.ndarray) -> bytes:
    """float32 ndarray → PCM 16-bit signed LE bytes。"""
    clipped = np.clip(arr, -1.0, 1.0)
    return (clipped * 32768.0).astype("<i2").tobytes()


def resample(pcm: bytes, src_rate: int, dst_rate: int) -> bytes:
    """重采样 PCM16 音频。

    使用 scipy.signal.resample_poly：
    - 相比线性插值质量更高（无相位失真）
    - 相比 librosa 启动快（无 numba JIT 预热）
    - 适合流式分块处理（小块边界可能有轻微振铃，但语音场景可接受）

    若输入为空或采样率相同，原样返回。
    """
    if not pcm or src_rate == dst_rate:
        return pcm

    samples = pcm16_to_float(pcm)
    if samples.size == 0:
        return b""

    g = gcd(src_rate, dst_rate)
    up = dst_rate // g
    down = src_rate // g
    resampled = resample_poly(samples, up, down)
    return float_to_pcm16(resampled)


def split_into_frames(
    pcm: bytes, frame_ms: int, sample_rate: int
) -> Iterator[bytes]:
    """按固定帧长切片 PCM16 数据。

    WebRTC VAD 要求 10/20/30ms 固定帧长。本函数按 frame_ms 切片，
    末尾不足一帧的部分丢弃（不送入 VAD，避免 ValueError）。

    每帧字节数 = sample_rate * 2 (bytes/sample) * frame_ms / 1000
    """
    bytes_per_frame = sample_rate * 2 * frame_ms // 1000
    if bytes_per_frame <= 0:
        raise ValueError(f"invalid frame size: {bytes_per_frame} bytes")

    total = len(pcm)
    aligned = (total // bytes_per_frame) * bytes_per_frame
    for offset in range(0, aligned, bytes_per_frame):
        yield pcm[offset : offset + bytes_per_frame]


def merge_frames(frames: list[bytes]) -> bytes:
    """合并多个 PCM 帧。"""
    if not frames:
        return b""
    if len(frames) == 1:
        return frames[0]
    return b"".join(frames)


def compute_rms(pcm: bytes) -> float:
    """计算 PCM16 音频的 RMS（用于调试/可视化）。"""
    if not pcm:
        return 0.0
    samples = pcm16_to_float(pcm)
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(samples**2)))
