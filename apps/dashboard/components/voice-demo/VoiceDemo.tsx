'use client';

/**
 * VoiceDemo — 语音交互演示主容器
 *
 * 整合 useASR 和 useTTS，提供完整的语音交互体验：
 *   - 左侧：语音识别面板（麦克风输入 → FunASR → 实时文字）
 *   - 右侧：语音合成面板（文字输入 → Qwen-TTS → 流式播放）
 *
 * 联动模式（可选）：
 *   开启"语音联动"后，ASR 的 final 结果会自动填入 TTS 输入框，
 *   实现"听到什么就说什么"的回声演示效果。
 */

import { useEffect, useState } from 'react';
import { useASR } from '@/hooks/useASR';
import { useTTS } from '@/hooks/useTTS';
import { ASRPanel } from './ASRPanel';
import { TTSPanel } from './TTSPanel';

export function VoiceDemo() {
  const asr = useASR();
  const tts = useTTS();

  const [linkMode, setLinkMode] = useState(false);
  const [lastFinalCount, setLastFinalCount] = useState(0);

  // 语音联动：ASR final 结果自动触发 TTS
  useEffect(() => {
    if (!linkMode) return;
    if (asr.finalTexts.length > lastFinalCount && asr.finalTexts.length > 0) {
      const latest = asr.finalTexts[asr.finalTexts.length - 1];
      tts.speak(latest);
    }
    setLastFinalCount(asr.finalTexts.length);
  }, [linkMode, asr.finalTexts, lastFinalCount, tts]);

  return (
    <div className="voice-demo">
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">语音交互演示</h1>
          <p className="subtitle">
            Python WebRTC VAD + FunASR + Qwen-TTS 云端 · 前端复用后端音频网关
          </p>
        </div>
        <div className="page-actions">
          <label className="link-toggle" style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text)',
          }}>
            <input
              type="checkbox"
              checked={linkMode}
              onChange={(e) => {
                setLinkMode(e.target.checked);
                setLastFinalCount(asr.finalTexts.length);
              }}
            />
            <span>语音联动</span>
            <span className="link-hint" style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
              （ASR 自动合成）
            </span>
          </label>
        </div>
      </div>

      {/* 服务依赖检查 */}
      <div className="dependency-check">
        <div className="dep-item">
          <span className="dep-name">Voice Agent WS</span>
          <code>{process.env.NEXT_PUBLIC_VOICE_AGENT_WS_URL ?? 'ws://localhost:8080'}</code>
        </div>
        <div className="dep-item">
          <span className="dep-name">FunASR (via Python)</span>
          <code>{process.env.NEXT_PUBLIC_FUNASR_WS_URL ?? 'ws://localhost:10095'}</code>
        </div>
      </div>

      <div className="grid grid-2">
        <ASRPanel asr={asr} />
        <TTSPanel tts={tts} />
      </div>

      {/* 技术说明 */}
      <div className="card tech-notes">
        <h2 className="card-title">技术架构</h2>
        <div className="grid grid-2">
          <div>
            <h3 className="section-title">ASR 链路</h3>
            <pre className="arch-flow">{`麦克风 → AudioWorklet
  → 降采样 16kHz
  → Float32→PCM16
  → WebSocket /asr-stream
  → Python WebRTC VAD
  → FunASR 2pass
  → partial/final 回推`}</pre>
          </div>
          <div>
            <h3 className="section-title">TTS 链路</h3>
            <pre className="arch-flow">{`文本输入 → WebSocket /tts-stream
  → Qwen-TTS Realtime
  → PCM16 流式回推
  → PCM16→Float32
  → AudioBufferSource
  → GainNode → 播放
  → 边收边播（流式）`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
