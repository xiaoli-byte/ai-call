'use client';

/**
 * TTSPanel — 语音合成控制面板
 *
 * 功能：
 *   - 文本输入区
 *   - 语音参数控制（说话人、语速、音量）
 *   - 合成/播放/停止按钮
 *   - 状态指示
 */

import { useState } from 'react';
import { StatusBadge } from './StatusBadge';
import type { UseTTSReturn } from '@/hooks/useTTS';
import styles from './voice-demo.module.scss';

interface TTSPanelProps {
  tts: UseTTSReturn;
}

export function TTSPanel({ tts }: TTSPanelProps) {
  const { state, isBusy, error, voiceParams, updateVoiceParams, speak, stop } = tts;
  const [text, setText] = useState('');

  const handleSpeak = () => {
    if (text.trim()) {
      speak(text);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+Enter 合成
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSpeak();
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">语音合成 (Qwen-TTS)</h2>
        <StatusBadge label="TTS" status={state} />
      </div>

      {/* 服务配置提示 */}
      <div className={styles.configInfo}>
        <code>{process.env.NEXT_PUBLIC_VOICE_AGENT_WS_URL ?? 'ws://localhost:8080'}/tts-stream</code>
        <span className="badge badge-dim">{voiceParams.speaker}</span>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className={styles.errorBanner}>
          <strong>错误：</strong> {error}
        </div>
      )}

      {/* 文本输入 */}
      <div className="form-group">
        <label className="form-label">合成文本</label>
        <textarea
          className="form-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入要合成的文本，支持中英文混合...（Ctrl+Enter 合成）"
          rows={4}
        />
      </div>

      {/* 语音参数 */}
      <div className={styles.voiceParams}>
        <div className="form-group">
          <label className="form-label">说话人</label>
          <select
            className="form-select"
            value={voiceParams.speaker}
            onChange={(e) => updateVoiceParams({ speaker: e.target.value })}
          >
            <option value="Cherry">Cherry（女声）</option>
            <option value="Serena">Serena（女声）</option>
            <option value="Ethan">Ethan（男声）</option>
            <option value="Chelsie">Chelsie（女声）</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">
            音量 <span className={styles.paramValue}>{Math.round(voiceParams.volume * 100)}%</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={voiceParams.volume}
            onChange={(e) => updateVoiceParams({ volume: parseFloat(e.target.value) })}
            className={styles.slider}
          />
        </div>
      </div>

      {/* 指令文本（可选） */}
      <div className="form-group">
        <label className="form-label">
          指令文本 <span className={styles.paramHint}>（可选，控制语气/情感，需 instruct 模型）</span>
        </label>
        <input
          type="text"
          className="form-input"
          value={voiceParams.instructText ?? ''}
          onChange={(e) => updateVoiceParams({ instructText: e.target.value || undefined })}
          placeholder="如：用开心的语气说"
        />
      </div>

      {/* 操作按钮 */}
      <div className={styles.buttonGroup}>
        <button
          className="btn"
          onClick={handleSpeak}
          disabled={!text.trim() || isBusy}
        >
          {state === 'synthesizing' ? '合成中...' : '合成并播放'}
        </button>
        <button
          className="btn btn-danger"
          onClick={stop}
          disabled={!isBusy}
        >
          停止播放
        </button>
      </div>

      {/* 快捷文本 */}
      <div className={styles.quickTexts}>
        <span className={styles.quickLabel}>快捷文本：</span>
        {[
          '您好，欢迎使用语音合成演示系统。',
          'Hello, this is a text-to-speech demo.',
          '今天天气真好，适合出门散步。',
        ].map((t, i) => (
          <button
            key={i}
            className={`btn btn-secondary ${styles.quickBtn}`}
            onClick={() => setText(t)}
          >
            {t.slice(0, 12)}...
          </button>
        ))}
      </div>
    </div>
  );
}
