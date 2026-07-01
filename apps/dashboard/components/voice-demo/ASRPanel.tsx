'use client';

/**
 * ASRPanel — 语音识别结果展示面板
 *
 * 显示：
 *   - 实时 partial 结果（灰色，随识别动态更新）
 *   - 已确认的 final 结果列表（白色，每句一段）
 *   - VAD 说话状态指示
 *   - 操作按钮（开始/停止/清空/手动断句）
 */

import { StatusBadge } from './StatusBadge';
import { AudioVisualizer } from './AudioVisualizer';
import type { UseASRReturn } from '@/hooks/useASR';

interface ASRPanelProps {
  asr: UseASRReturn;
}

export function ASRPanel({ asr }: ASRPanelProps) {
  const {
    state,
    isListening,
    partialText,
    finalTexts,
    error,
    audioLevel,
    isSpeaking,
    start,
    stop,
    endSentence,
    clear,
  } = asr;

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">语音识别 (Python VAD + FunASR)</h2>
        <StatusBadge label="ASR" status={state} />
      </div>

      {/* 服务配置提示 */}
      <div className="config-info">
        <code>{process.env.NEXT_PUBLIC_VOICE_AGENT_WS_URL ?? 'ws://localhost:8080'}/asr-stream</code>
        <span className="badge badge-dim">{process.env.NEXT_PUBLIC_FUNASR_MODE ?? '2pass'}</span>
      </div>

      {/* 音量可视化 */}
      <div className="visualizer-section">
        <AudioVisualizer level={audioLevel} active={isListening} />
        <div className="vad-indicator">
          {isSpeaking ? (
            <span className="badge badge-success pulse">说话中</span>
          ) : (
            <span className="badge badge-dim">静音</span>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="error-banner">
          <strong>错误：</strong> {error}
        </div>
      )}

      {/* 识别结果 */}
      <div className="asr-results">
        <div className="asr-section-label">识别结果</div>
        {finalTexts.length === 0 && !partialText && !isListening && (
          <div className="empty">点击"开始监听"后说话，识别结果将实时显示</div>
        )}
        {finalTexts.map((text, i) => (
          <div key={i} className="asr-final-text">
            <span className="asr-index">{i + 1}.</span>
            <span>{text}</span>
          </div>
        ))}
        {partialText && (
          <div className="asr-partial-text">
            <span className="asr-cursor">▶</span>
            {partialText}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="button-group">
        {!isListening ? (
          <button className="btn" onClick={start} disabled={state === 'connecting'}>
            {state === 'connecting' ? '连接中...' : '开始监听'}
          </button>
        ) : (
          <button className="btn btn-danger" onClick={stop}>
            停止监听
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={endSentence}
          disabled={!isListening}
          title="手动触发当前句子的 final 识别"
        >
          手动断句
        </button>
        <button
          className="btn btn-secondary"
          onClick={clear}
          disabled={finalTexts.length === 0 && !partialText}
        >
          清空结果
        </button>
      </div>
    </div>
  );
}
