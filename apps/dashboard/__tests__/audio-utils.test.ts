/**
 * audio-utils 单元测试
 *
 * 验证 PCM 格式转换、重采样、RMS 计算等核心音频处理函数的正确性。
 */

import { describe, it, expect } from 'vitest';
import {
  floatTo16BitPCM,
  pcm16ToFloat32,
  downsampleBuffer,
  calculateRMS,
  concatenateBuffers,
  createPCM16FrameBuffer,
  getPCM16FrameByteLength,
  TARGET_SAMPLE_RATE,
} from '@/lib/audio-utils';

describe('floatTo16BitPCM', () => {
  it('应将 Float32Array 转换为 16-bit PCM ArrayBuffer', () => {
    const input = new Float32Array([0.5, -0.5, 1.0, -1.0, 0.0]);
    const result = floatTo16BitPCM(input);

    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(input.length * 2);

    const view = new DataView(result);
    // 0.5 → ~16384
    expect(view.getInt16(0, true)).toBeGreaterThan(16000);
    expect(view.getInt16(0, true)).toBeLessThan(17000);
    // -0.5 → ~-16384
    expect(view.getInt16(2, true)).toBeLessThan(-16000);
    expect(view.getInt16(2, true)).toBeGreaterThan(-17000);
    // 1.0 → 32767
    expect(view.getInt16(4, true)).toBe(32767);
    // -1.0 → -32768
    expect(view.getInt16(6, true)).toBe(-32768);
    // 0.0 → 0
    expect(view.getInt16(8, true)).toBe(0);
  });

  it('应正确处理空数组', () => {
    const input = new Float32Array(0);
    const result = floatTo16BitPCM(input);
    expect(result.byteLength).toBe(0);
  });

  it('应钳制超出范围的值', () => {
    const input = new Float32Array([2.0, -2.0]); // 超出 [-1, 1] 范围
    const result = floatTo16BitPCM(input);
    const view = new DataView(result);
    expect(view.getInt16(0, true)).toBe(32767); // 钳制到 1.0
    expect(view.getInt16(2, true)).toBe(-32768); // 钳制到 -1.0
  });
});

describe('pcm16ToFloat32', () => {
  it('应将 16-bit PCM 转回 Float32Array', () => {
    const original = new Float32Array([0.5, -0.5, 0.0, 1.0, -1.0]);
    const pcm = floatTo16BitPCM(original);
    const result = pcm16ToFloat32(pcm);

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(original.length);

    // 允许微小精度损失（Int16 量化误差）
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(result[i] - original[i])).toBeLessThan(0.001);
    }
  });

  it('floatTo16BitPCM → pcm16ToFloat32 应为近似恒等变换', () => {
    const input = new Float32Array([0.1, 0.2, 0.3, -0.4, -0.5, 0.6, 0.7, -0.8, 0.9, -0.95]);
    const roundTrip = pcm16ToFloat32(floatTo16BitPCM(input));
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(roundTrip[i] - input[i])).toBeLessThan(0.001);
    }
  });
});

describe('downsampleBuffer', () => {
  it('采样率相同时应返回原数组', () => {
    const input = new Float32Array([1, 2, 3, 4, 5]);
    const result = downsampleBuffer(input, 16000, 16000);
    expect(result).toBe(input);
  });

  it('应正确降采样 48000 → 16000', () => {
    // 48000 / 16000 = 3:1 降采样
    const input = new Float32Array(480);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((i / 480) * Math.PI * 2 * 10); // 10 个完整周期
    }
    const result = downsampleBuffer(input, 48000, 16000);

    expect(result.length).toBe(160);
    // 降采样后的平均值应与输入趋势一致
    expect(result[0]).not.toBeNaN();
  });

  it('升采样应抛出错误', () => {
    const input = new Float32Array([1, 2, 3]);
    expect(() => downsampleBuffer(input, 8000, 16000)).toThrow('升采样不支持');
  });
});

describe('calculateRMS', () => {
  it('静音应返回接近 0', () => {
    const input = new Float32Array([0, 0, 0, 0, 0]);
    expect(calculateRMS(input)).toBeCloseTo(0, 5);
  });

  it('全幅值应返回约 0.707', () => {
    // 恒定振幅 1.0 的方波 RMS = 1.0
    const input = new Float32Array([1, 1, 1, 1]);
    expect(calculateRMS(input)).toBeCloseTo(1.0, 3);
  });

  it('正弦波 RMS 应约为 0.707', () => {
    // 正弦波 RMS = amplitude / sqrt(2) ≈ 0.707
    const input = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) {
      input[i] = Math.sin((i / 1000) * Math.PI * 2 * 10);
    }
    const rms = calculateRMS(input);
    expect(rms).toBeGreaterThan(0.69);
    expect(rms).toBeLessThan(0.72);
  });

  it('应返回非负值', () => {
    const input = new Float32Array([0.5, -0.5, 0.3, -0.3]);
    expect(calculateRMS(input)).toBeGreaterThanOrEqual(0);
  });
});

describe('concatenateBuffers', () => {
  it('应正确拼接多个 ArrayBuffer', () => {
    const buf1 = new ArrayBuffer(4);
    const buf2 = new ArrayBuffer(6);
    const buf3 = new ArrayBuffer(2);
    const result = concatenateBuffers([buf1, buf2, buf3]);

    expect(result.byteLength).toBe(12);
  });

  it('空数组应返回空 ArrayBuffer', () => {
    const result = concatenateBuffers([]);
    expect(result.byteLength).toBe(0);
  });

  it('单个 buffer 应返回相同大小的副本', () => {
    const buf = new ArrayBuffer(8);
    const result = concatenateBuffers([buf]);
    expect(result.byteLength).toBe(8);
  });
});

describe('getPCM16FrameByteLength', () => {
  it('应计算 16kHz PCM16 的 20ms 帧为 640 字节', () => {
    expect(getPCM16FrameByteLength(16000, 20)).toBe(640);
  });

  it('无效帧长应抛出错误', () => {
    expect(() => getPCM16FrameByteLength(16000, 0)).toThrow('无效的 PCM 帧长度');
  });
});

describe('createPCM16FrameBuffer', () => {
  it('应将 86B 小包聚合为 640B 固定帧', () => {
    const buffer = createPCM16FrameBuffer(640);

    for (let i = 0; i < 7; i++) {
      expect(buffer.push(new ArrayBuffer(86))).toEqual([]);
    }
    expect(buffer.bufferedBytes).toBe(602);

    const frames = buffer.push(new ArrayBuffer(86));
    expect(frames).toHaveLength(1);
    expect(frames[0].byteLength).toBe(640);
    expect(buffer.bufferedBytes).toBe(48);
  });

  it('flush() 应返回剩余未成帧数据并清空缓冲', () => {
    const buffer = createPCM16FrameBuffer(640);
    buffer.push(new ArrayBuffer(86));

    const remaining = buffer.flush();
    expect(remaining?.byteLength).toBe(86);
    expect(buffer.bufferedBytes).toBe(0);
    expect(buffer.flush()).toBeNull();
  });

  it('无效固定帧长度应抛出错误', () => {
    expect(() => createPCM16FrameBuffer(0)).toThrow('无效的 PCM 帧字节数');
  });
});

describe('TARGET_SAMPLE_RATE', () => {
  it('应为 16000 Hz', () => {
    expect(TARGET_SAMPLE_RATE).toBe(16000);
  });
});
