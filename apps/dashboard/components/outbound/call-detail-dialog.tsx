'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import {
  Bot,
  Bug,
  CheckCircle2,
  Download,
  Headphones,
  MessageSquareText,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  UserRound,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { CallHistoryDetail, TranscriptTurn } from '@ai-call/shared';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const WAVEFORM_BARS = 80;

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function formatDuration(seconds?: number) {
  const safe = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function getTotalDuration(call: CallHistoryDetail) {
  if (call.duration && call.duration > 0) return call.duration;
  const lastTurn = call.transcript[call.transcript.length - 1];
  return lastTurn ? Math.max(1, Math.ceil(lastTurn.timestamp + 5)) : 0;
}

function getActiveTurnIndex(turns: TranscriptTurn[], current: number) {
  let activeIndex = -1;
  for (let index = 0; index < turns.length; index += 1) {
    if (turns[index].timestamp <= current) activeIndex = index;
  }
  return activeIndex;
}

function roleAtTime(turns: TranscriptTurn[], seconds: number) {
  let role: TranscriptTurn['role'] = turns[0]?.role ?? 'agent';
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (seconds >= turns[index].timestamp) {
      role = turns[index].role;
      break;
    }
  }
  return role;
}

function clampTime(seconds: number, total: number) {
  return Math.max(0, Math.min(total, seconds));
}

function debugRows({
  call,
  taskId,
  turn,
  index,
}: {
  call: CallHistoryDetail;
  taskId: string;
  turn: TranscriptTurn;
  index: number;
}) {
  return [
    { label: 'TaskId', value: taskId, copyable: true },
    { label: 'AttemptId', value: call.id, copyable: true },
    { label: 'ProviderCallId', value: call.providerCallId ?? '—', copyable: Boolean(call.providerCallId) },
    { label: 'TurnId', value: turn.id ?? `turn-${index + 1}`, copyable: Boolean(turn.id) },
    { label: '角色 / 偏移', value: `${turn.role} / ${formatDuration(turn.timestamp)}`, copyable: false },
    { label: '事件数', value: String(call.events.length), copyable: false },
  ];
}

function DebugPanel({
  rows,
}: {
  rows: Array<{ label: string; value: string; copyable: boolean }>;
}) {
  const [collapsed, setCollapsed] = useState(true);

  const copy = (value: string) => {
    if (!value || value === '—') return;
    navigator.clipboard?.writeText(value).catch(() => {});
  };

  return (
    <div className="outbound-debug-panel">
      <button type="button" onClick={() => setCollapsed((value) => !value)}>
        <Bug size={13} />
        <span>调试信息</span>
        <i className={collapsed ? '' : 'open'} />
      </button>
      {!collapsed && (
        <div className="outbound-debug-body">
          {rows.map((row) => (
            <div className="outbound-debug-row" key={row.label}>
              <span>{row.label}</span>
              <code>{row.value}</code>
              {row.copyable && (
                <button type="button" onClick={() => copy(row.value)}>
                  复制
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const progress = totalSecs > 0 ? (current / totalSecs) * 100 : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

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

  const handleSeekClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    seek(ratio * totalSecs);
  };

  const outcomeText = call.intentTags?.[0] ?? call.outcome ?? '待识别';

  return (
    <div className="outbound-dialog-backdrop">
      <Link href={`/tasks/${taskId}`} className="outbound-dialog-scrim" aria-label="关闭通话记录" />
      <section className="outbound-call-dialog" role="dialog" aria-modal="true" aria-label="外呼记录详情">
        <header>
          <div className="outbound-call-avatar"><Headphones size={16} /></div>
          <div className="outbound-call-person">
            <strong>{customerName} 的通话记录</strong>
            <p><span>{call.to}</span><span>{formatDate(call.startedAt)}</span><span>时长 {formatDuration(totalSecs)}</span></p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={debugMode}
            className={`outbound-debug-switch ${debugMode ? 'active' : ''}`}
            onClick={() => setDebugMode((value) => !value)}
          >
            调试 <i />
          </button>
          <Link href={`/tasks/${taskId}`} className="outbound-close" aria-label="关闭"><X size={16} /></Link>
        </header>

        <div className="outbound-call-meta-strip">
          <span><Bot size={12} />{robotName}</span>
          <span><CheckCircle2 size={12} />{call.hangupCause || '已完成通话'}</span>
          <span>意图：<b>{outcomeText}</b></span>
        </div>

        <div className="outbound-call-summary">
          <div className="outbound-waveform" aria-hidden="true">
            {Array.from({ length: WAVEFORM_BARS }, (_, index) => {
              const seconds = totalSecs > 0 ? (index / WAVEFORM_BARS) * totalSecs : 0;
              const role = roleAtTime(transcript, seconds);
              const filled = totalSecs > 0 && (index / WAVEFORM_BARS) * 100 <= progress;
              const height = 18 + Math.abs(Math.sin(index * 0.43 + 1) * 18) + Math.abs(Math.cos(index * 0.71) * 8);
              return (
                <i
                  key={index}
                  className={`${filled ? 'filled' : ''} ${role === 'caller' ? 'caller' : role === 'system' ? 'system' : 'agent'}`}
                  style={{ height: `${Math.min(100, height)}%` }}
                />
              );
            })}
          </div>

          <div className="outbound-seek" onClick={handleSeekClick} role="slider" aria-valuemin={0} aria-valuemax={totalSecs} aria-valuenow={Math.round(current)}>
            <span style={{ width: `${progress}%` }} />
            {transcript.map((turn, index) => (
              <i key={turn.id ?? `tick-${index}`} style={{ left: `${totalSecs > 0 ? (turn.timestamp / totalSecs) * 100 : 0}%` }} />
            ))}
            <b style={{ left: `calc(${progress}% - 6px)` }} />
          </div>

          <div className="outbound-audio-controls">
            <button type="button" onClick={() => seek(current - 5)} aria-label="后退 5 秒"><SkipBack size={14} /></button>
            <button type="button" className="outbound-play-button" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button type="button" onClick={() => seek(current + 5)} aria-label="前进 5 秒"><SkipForward size={14} /></button>
            <span>{formatDuration(current)} / {formatDuration(totalSecs)}</span>
            <div className="outbound-audio-spacer" />
            <div className="outbound-speed-group" aria-label="播放速度">
              {SPEEDS.map((item) => (
                <button
                  type="button"
                  key={item}
                  className={speed === item ? 'active' : ''}
                  onClick={() => setSpeed(item)}
                >
                  {item}x
                </button>
              ))}
            </div>
            <div className="outbound-volume-group">
              <button type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? '取消静音' : '静音'}>
                <VolumeIcon size={14} />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(event) => {
                  setMuted(false);
                  setVolume(Number(event.target.value));
                }}
                aria-label="音量"
              />
            </div>
          </div>

          {call.recordingUrl ? (
            <audio
              ref={audioRef}
              src={call.recordingUrl}
              className="outbound-native-audio"
              onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
              onEnded={() => {
                setPlaying(false);
                setCurrent(totalSecs);
              }}
            />
          ) : null}
        </div>

        <div className="outbound-transcript">
          {transcript.length ? transcript.map((turn, index) => {
            const isCaller = turn.role === 'caller';
            const isSystem = turn.role === 'system';
            const isActive = index === activeIndex;
            const isPast = activeIndex > -1 && index < activeIndex;
            return (
              <article
                key={turn.id ?? `${turn.timestamp}-${index}`}
                ref={isActive ? activeRef : null}
                className={`${isCaller ? 'caller' : isSystem ? 'system' : 'agent'} ${isActive ? 'active' : ''} ${isPast ? 'past' : ''}`}
                onClick={() => seek(turn.timestamp)}
                title={`跳转到 ${formatDuration(turn.timestamp)}`}
              >
                {!isCaller && <div className="outbound-turn-avatar">{isSystem ? <Bug size={13} /> : <Bot size={13} />}</div>}
                <div className="outbound-turn-content">
                  {debugMode && <DebugPanel rows={debugRows({ call, taskId, turn, index })} />}
                  <div className="outbound-turn-meta"><span>{isCaller ? customerName : isSystem ? '系统' : robotName}</span><time>{formatDuration(turn.timestamp)}</time></div>
                  <p>{turn.content}</p>
                </div>
                {isCaller && <div className="outbound-turn-avatar caller"><UserRound size={13} /></div>}
              </article>
            );
          }) : <div className="outbound-empty compact"><MessageSquareText size={20} /><strong>暂无对话记录</strong><span>通话转写完成后会显示在这里</span></div>}
        </div>

        <footer>
          <span><MessageSquareText size={13} />共 {transcript.length} 条对话记录</span>
          <div><button type="button"><Download size={13} />导出对话</button><Link href={`/tasks/${taskId}`}>关闭</Link></div>
        </footer>
      </section>
    </div>
  );
}
