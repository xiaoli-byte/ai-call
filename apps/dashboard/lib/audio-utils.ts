/**
 * 音频处理工具库
 *
 * 提供 PCM 格式转换、重采样、音频电平计算等通用函数，
 * 供 useAudioRecorder / useASR / useTTS 等 Hook 复用。
 */

/** 目标采样率：FunASR 要求 16kHz */
export const TARGET_SAMPLE_RATE = 16000;

/** PCM16 每个采样点字节数 */
export const PCM16_BYTES_PER_SAMPLE = 2;

/** 计算指定采样率和帧长下的 PCM16 帧字节数。 */
export function getPCM16FrameByteLength(
  sampleRate = TARGET_SAMPLE_RATE,
  frameMs = 20,
): number {
  const bytes = (sampleRate * PCM16_BYTES_PER_SAMPLE * frameMs) / 1000;
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new Error(`无效的 PCM 帧长度: sampleRate=${sampleRate}, frameMs=${frameMs}`);
  }
  return bytes;
}

export interface PCM16FrameBuffer {
  readonly bufferedBytes: number;
  push: (chunk: ArrayBuffer) => ArrayBuffer[];
  flush: () => ArrayBuffer | null;
  clear: () => void;
}

/**
 * 将任意大小的 PCM16 分片聚合为固定字节数帧。
 *
 * AudioWorklet 默认按 128 个原始采样回调，48kHz 降采样后约为 86B，
 * 小于 WebRTC VAD 需要的 10/20/30ms 完整帧。这里在前端先聚合，
 * 避免 /asr-stream 被大量无效小包刷屏。
 */
export function createPCM16FrameBuffer(frameByteLength: number): PCM16FrameBuffer {
  if (!Number.isInteger(frameByteLength) || frameByteLength <= 0) {
    throw new Error(`无效的 PCM 帧字节数: ${frameByteLength}`);
  }

  let pending = new Uint8Array(0);

  return {
    get bufferedBytes() {
      return pending.byteLength;
    },

    push(chunk: ArrayBuffer) {
      if (chunk.byteLength === 0) return [];

      const incoming = new Uint8Array(chunk);
      const merged = new Uint8Array(pending.byteLength + incoming.byteLength);
      merged.set(pending, 0);
      merged.set(incoming, pending.byteLength);

      const frames: ArrayBuffer[] = [];
      let offset = 0;
      while (offset + frameByteLength <= merged.byteLength) {
        frames.push(merged.slice(offset, offset + frameByteLength).buffer);
        offset += frameByteLength;
      }

      pending = merged.slice(offset);
      return frames;
    },

    flush() {
      if (pending.byteLength === 0) return null;
      const remaining = pending.buffer.slice(
        pending.byteOffset,
        pending.byteOffset + pending.byteLength,
      );
      pending = new Uint8Array(0);
      return remaining;
    },

    clear() {
      pending = new Uint8Array(0);
    },
  };
}

/**
 * 将 Float32 采样数据转换为 16-bit PCM (Little-Endian) ArrayBuffer。
 *
 * 浏览器 AudioWorklet 输出的原始音频为 Float32（-1.0 ~ 1.0），
 * 而 FunASR / CosyVoice 均使用 Int16 PCM 二进制传输。
 *
 * @param input Float32Array 音频样本
 * @returns ArrayBuffer，每样本 2 字节，可直接作为 WebSocket binary frame 发送
 */
export function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    // Float32 → Int16：乘以 32767 并截断
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

/**
 * 将 Int16 PCM ArrayBuffer 转回 Float32Array，用于 AudioBuffer 播放。
 *
 * @param input PCM 二进制数据
 * @returns Float32Array，范围 -1.0 ~ 1.0
 */
export function pcm16ToFloat32(input: ArrayBuffer): Float32Array {
  const view = new DataView(input);
  const result = new Float32Array(input.byteLength / 2);
  for (let i = 0; i < result.length; i++) {
    const int16 = view.getInt16(i * 2, true);
    result[i] = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
  }
  return result;
}

/**
 * 线性插值降采样 / 升采样。
 *
 * 浏览器 AudioContext 通常运行在 44100 或 48000 Hz，
 * 需降采样到 16000 Hz 才能发送给 FunASR。
 *
 * @param input 原始 Float32Array
 * @param fromRate 原始采样率
 * @param toRate 目标采样率
 * @returns 重采样后的 Float32Array
 */
export function downsampleBuffer(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (toRate === fromRate) return input;
  if (toRate > fromRate) {
    throw new Error(`升采样不支持：${fromRate} → ${toRate}，请检查 AudioContext 采样率`);
  }
  const ratio = fromRate / toRate;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetInput = 0;
  while (offsetResult < newLength) {
    const nextOffset = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetInput; i < nextOffset && i < input.length; i++) {
      accum += input[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetInput = nextOffset;
  }
  return result;
}

/**
 * 计算 RMS（均方根）音量，用于 VAD 判断和可视化。
 *
 * @param input 音频样本
 * @returns 0.0 ~ 1.0 的音量值
 */
export function calculateRMS(input: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    sum += input[i] * input[i];
  }
  return Math.sqrt(sum / input.length);
}

/**
 * 创建或恢复 AudioContext。
 *
 * 浏览器策略要求 AudioContext 在用户交互后才能 resume，
 * 此函数封装了创建 + resume 逻辑，确保上下文处于运行状态。
 */
export async function ensureAudioContext(): Promise<AudioContext> {
  const AudioCtx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  return ctx;
}

/**
 * 将多个 ArrayBuffer 拼接为一个。
 * 用于 TTS 流式播放时累积 PCM 块。
 */
export function concatenateBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result.buffer;
}

/**
 * AudioWorklet 处理器源码。
 *
 * 通过 Blob URL 动态注册，无需额外静态文件。
 * 作用：将 AudioWorkletNode 的输入通道数据通过 port.postMessage 传回主线程。
 */
const AUDIO_WORKLET_SOURCE = `
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0];
    if (channel && channel[0]) {
      // 只取第一个通道（mono），复制后传输避免缓冲区复用问题
      this.port.postMessage(channel[0].slice(0));
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
`;

/**
 * 动态注册 AudioWorklet 处理器。
 * 使用 Blob URL 避免依赖 public 目录下的静态文件。
 */
export async function registerAudioWorklet(ctx: AudioContext): Promise<void> {
  const blob = new Blob([AUDIO_WORKLET_SOURCE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
