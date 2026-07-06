'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bot, CheckCircle2, Download, Headphones, MessageSquareText, X } from 'lucide-react';
import type { CallHistoryDetail } from '@ai-call/shared';
import { cn } from '@/lib/utils';

import styles from './call-detail-dialog.module.scss';
import { CallDetailEventTimeline } from './call-detail-event-timeline';
import { CallDetailPlayback } from './call-detail-playback';
import { CallDetailTranscript } from './call-detail-transcript';
import { clampTime, formatDate, formatDuration, getActiveTurnIndex, getTotalDuration, sortEvents } from './call-detail-utils';

export function CallDetailDialog({
  call,
  taskId,
  customerName,
  robotName,
}: {
  call: CallHistoryDetail;
  taskId: string;
  customerName: string;
  robotName: string;
}) {
  const totalSecs = useMemo(() => getTotalDuration(call), [call]);
  const transcript = call.transcript;
  const [debugMode, setDebugMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  const activeIndex = useMemo(() => getActiveTurnIndex(transcript, current), [current, transcript]);
  const events = useMemo(() => sortEvents(call.events), [call.events]);
  const progress = totalSecs > 0 ? Math.min((current / totalSecs) * 100, 100) : 0;

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setSpeed(1);
  }, [call.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
    audio.volume = volume;
    audio.muted = muted;
  }, [muted, speed, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !call.recordingUrl) return;
    if (playing) {
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [call.recordingUrl, playing]);

  useEffect(() => {
    if (call.recordingUrl || !playing) return undefined;
    if (totalSecs <= 0) {
      setPlaying(false);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setCurrent((value) => {
        const next = clampTime(value + 0.25 * speed, totalSecs);
        if (next >= totalSecs) {
          setPlaying(false);
          return totalSecs;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [call.recordingUrl, playing, speed, totalSecs]);

  useEffect(() => {
    if (playing && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeIndex, playing]);

  const seek = (seconds: number) => {
    const next = clampTime(seconds, totalSecs);
    setCurrent(next);
    if (audioRef.current) audioRef.current.currentTime = next;
  };

  const togglePlay = () => {
    if (totalSecs <= 0) return;
    if (current >= totalSecs) seek(0);
    setPlaying((value) => !value);
  };

  const outcomeText = call.intentTags?.[0] ?? call.outcome ?? '待识别';

  return (
    <div className={styles.backdrop}>
      <Link href={`/tasks/${taskId}`} className={styles.scrim} aria-label="关闭通话记录" />
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="外呼记录详情">
        <header className={styles.header}>
          <div className={styles.avatar}><Headphones size={16} /></div>
          <div className={styles.person}>
            <strong>{customerName} 的通话记录</strong>
            <p><span>{call.to}</span><span>{formatDate(call.startedAt)}</span><span>时长 {formatDuration(totalSecs)}</span></p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={debugMode}
            className={cn(styles.debugSwitch, debugMode && styles.debugActive)}
            onClick={() => setDebugMode((value) => !value)}
          >
            调试 <i />
          </button>
          <Link href={`/tasks/${taskId}`} className={styles.close} aria-label="关闭"><X size={16} /></Link>
        </header>

        <div className={styles.metaStrip}>
          <span><Bot size={12} />{robotName}</span>
          <span><CheckCircle2 size={12} />{call.hangupCause || '已完成通话'}</span>
          <span>意图：<b>{outcomeText}</b></span>
        </div>

        <CallDetailPlayback
          recordingUrl={call.recordingUrl}
          transcript={transcript}
          totalSecs={totalSecs}
          current={current}
          progress={progress}
          playing={playing}
          speed={speed}
          volume={volume}
          muted={muted}
          audioRef={audioRef}
          onSeek={seek}
          onTogglePlay={togglePlay}
          onSpeedChange={setSpeed}
          onMutedChange={setMuted}
          onVolumeChange={setVolume}
          onTimeUpdate={setCurrent}
          onEnded={() => {
            setPlaying(false);
            setCurrent(totalSecs);
          }}
        />

        <CallDetailTranscript
          call={call}
          taskId={taskId}
          customerName={customerName}
          robotName={robotName}
          transcript={transcript}
          activeIndex={activeIndex}
          debugMode={debugMode}
          activeRef={activeRef}
          onSeek={seek}
        />

        <CallDetailEventTimeline events={events} />

        <footer className={styles.footer}>
          <span><MessageSquareText size={13} />共 {transcript.length} 条对话记录</span>
          <div className={styles.footerActions}>
            <button type="button" className={styles.footerButton}><Download size={13} />导出对话</button>
            <Link href={`/tasks/${taskId}`} className={cn(styles.footerButton, styles.footerLink)}>关闭</Link>
          </div>
        </footer>
      </section>
    </div>
  );
}
