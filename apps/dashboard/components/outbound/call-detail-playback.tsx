'use client';

import type { MouseEvent, RefObject } from 'react';
import { Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import type { TranscriptTurn } from '@ai-call/shared';
import { cn } from '@/lib/utils';

import styles from './call-detail-dialog.module.scss';
import { formatDuration, roleAtTime, SPEEDS, WAVEFORM_BARS } from './call-detail-utils';

export function CallDetailPlayback({
  recordingUrl,
  transcript,
  totalSecs,
  current,
  progress,
  playing,
  speed,
  volume,
  muted,
  audioRef,
  onSeek,
  onTogglePlay,
  onSpeedChange,
  onMutedChange,
  onVolumeChange,
  onTimeUpdate,
  onEnded,
}: {
  recordingUrl?: string;
  transcript: TranscriptTurn[];
  totalSecs: number;
  current: number;
  progress: number;
  playing: boolean;
  speed: number;
  volume: number;
  muted: boolean;
  audioRef: RefObject<HTMLAudioElement>;
  onSeek: (seconds: number) => void;
  onTogglePlay: () => void;
  onSpeedChange: (speed: number) => void;
  onMutedChange: (muted: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onTimeUpdate: (seconds: number) => void;
  onEnded: () => void;
}) {
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const handleSeekClick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    onSeek(ratio * totalSecs);
  };

  return (
    <div className={styles.summary}>
      <div className={styles.waveform} aria-hidden="true">
        {Array.from({ length: WAVEFORM_BARS }, (_, index) => {
          const seconds = totalSecs > 0 ? (index / WAVEFORM_BARS) * totalSecs : 0;
          const role = roleAtTime(transcript, seconds);
          const filled = totalSecs > 0 && (index / WAVEFORM_BARS) * 100 <= progress;
          const height = 18 + Math.abs(Math.sin(index * 0.43 + 1) * 18) + Math.abs(Math.cos(index * 0.71) * 8);
          return (
            <i
              key={index}
              className={cn(filled && styles.filled, styles[role])}
              style={{ height: `${Math.min(100, height)}%` }}
            />
          );
        })}
      </div>

      <div
        className={styles.seek}
        onClick={handleSeekClick}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={totalSecs}
        aria-valuenow={Math.round(current)}
      >
        <span className={styles.seekFill} style={{ width: `${progress}%` }} />
        {transcript.map((turn, index) => (
          <i
            key={turn.id ?? `tick-${index}`}
            className={styles.seekMarker}
            style={{ left: `${totalSecs > 0 ? (turn.timestamp / totalSecs) * 100 : 0}%` }}
          />
        ))}
        <b className={styles.seekThumb} style={{ left: `calc(${progress}% - 6px)` }} />
      </div>

      <div className={styles.audioControls}>
        <button type="button" className={styles.controlButton} onClick={() => onSeek(current - 5)} aria-label="后退 5 秒">
          <SkipBack size={14} />
        </button>
        <button type="button" className={styles.playButton} onClick={onTogglePlay} aria-label={playing ? '暂停' : '播放'}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button type="button" className={styles.controlButton} onClick={() => onSeek(current + 5)} aria-label="前进 5 秒">
          <SkipForward size={14} />
        </button>
        <span className={styles.timeLabel}>{formatDuration(current)} / {formatDuration(totalSecs)}</span>
        <div className={styles.audioSpacer} />
        <div className={styles.speedGroup} aria-label="播放速度">
          {SPEEDS.map((item) => (
            <button
              type="button"
              key={item}
              className={cn(styles.speedButton, speed === item && styles.active)}
              onClick={() => onSpeedChange(item)}
            >
              {item}x
            </button>
          ))}
        </div>
        <div className={styles.volumeGroup}>
          <button
            type="button"
            className={styles.controlButton}
            onClick={() => onMutedChange(!muted)}
            aria-label={muted ? '取消静音' : '静音'}
          >
            <VolumeIcon size={14} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(event) => {
              onMutedChange(false);
              onVolumeChange(Number(event.target.value));
            }}
            aria-label="音量"
          />
        </div>
      </div>

      {recordingUrl ? (
        <audio
          ref={audioRef}
          src={recordingUrl}
          className={styles.nativeAudio}
          onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
          onEnded={onEnded}
        />
      ) : null}
    </div>
  );
}
