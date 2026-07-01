'use client';

/**
 * AudioVisualizer — 音频电平可视化组件
 *
 * 实时显示麦克风输入的音量电平，以竖条形式呈现。
 * 支持渐变色彩（低→绿，中→黄，高→红）。
 */

import { useEffect, useRef } from 'react';
import styles from './voice-demo.module.scss';

interface AudioVisualizerProps {
  /** 音量级别 0.0 ~ 1.0 */
  level: number;
  /** 是否活跃（正在录音） */
  active: boolean;
  /** 可视化条数 */
  bars?: number;
}

export function AudioVisualizer({ level, active, bars = 24 }: AudioVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const children = container.children;
    const activeBars = Math.round(level * bars);

    for (let i = 0; i < children.length; i++) {
      const bar = children[i] as HTMLElement;
      const isActive = active && i < activeBars;
      const heightPercent = active ? Math.max(0.15, level * (1 - i / bars) * 1.5) : 0.1;

      bar.style.height = `${Math.min(heightPercent * 100, 100)}%`;

      if (isActive) {
        // 渐变色彩：低 → 绿，中 → 黄，高 → 红
        if (level > 0.7) {
          bar.style.background = 'var(--danger)';
        } else if (level > 0.4) {
          bar.style.background = 'var(--warning)';
        } else {
          bar.style.background = 'var(--success)';
        }
        bar.style.opacity = '1';
      } else {
        bar.style.background = 'var(--panel-2)';
        bar.style.opacity = active ? '0.3' : '0.15';
      }
    }
  }, [level, active, bars]);

  return (
    <div ref={containerRef} className={styles.audioVisualizer}>
      {Array.from({ length: bars }).map((_, i) => (
        <div key={i} className={styles.visualizerBar} />
      ))}
    </div>
  );
}
