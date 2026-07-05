'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  CheckCircle2,
  Headphones,
  Mic,
  Pause,
  Play,
  PlusCircle,
  RefreshCw,
  Sparkles,
  Square,
  Upload,
  Volume2,
  Wand2,
  X,
} from 'lucide-react';
import { VoiceCloneModel, VoiceCloneStatus, type VoiceClone } from '@ai-call/shared';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useVoiceCloneMutations, useVoiceClones } from '@/hooks/use-voice-clones';
import { appToast } from '@/lib/toast';
import { DEFAULT_PREVIEW_TEXT, MAX_AUDIO_BYTES, MODEL_OPTIONS } from './_components/constants';
import { ModelCard } from './_components/model-card';
import { StepBadge } from './_components/step-badge';
import type { CaptureKind, CloneWorkbenchStatus } from './_components/types';
import { buildWavFile, formatBytes, withCacheBust } from './_components/utils';
import { VoiceCard } from './_components/voice-card';
import { WaveformBars } from './_components/waveform-bars';

export default function VoiceClonesPage() {
  const router = useRouter();
  const { data, error, isLoading } = useVoiceClones();
  const clones = data ?? [];
  const { createPreview, synthesize, confirm, remove } = useVoiceCloneMutations();
  const recorder = useAudioRecorder({ enableVAD: true });

  const [model, setModel] = useState<string>(VoiceCloneModel.QWEN);
  const [status, setStatus] = useState<CloneWorkbenchStatus>('idle');
  const [captureKind, setCaptureKind] = useState<CaptureKind | null>(null);
  const [name, setName] = useState('');
  const [previewText, setPreviewText] = useState(DEFAULT_PREVIEW_TEXT);
  const [description, setDescription] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [generatedCloneId, setGeneratedCloneId] = useState<string>('');
  const [previewClone, setPreviewClone] = useState<VoiceClone | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deletingId, setDeletingId] = useState<string>('');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [capturePlaying, setCapturePlaying] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const localAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const framesRef = useRef<ArrayBuffer[]>([]);
  const captureFramesRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);

  const selectedClone = useMemo(
    () => clones.find((clone) => clone.id === selectedId) ?? clones[0],
    [clones, selectedId],
  );
  const activePreviewClone = previewClone ?? selectedClone;
  const playbackUrl = activePreviewClone
    ? withCacheBust(
      activePreviewClone.previewAudioUrl ?? activePreviewClone.sourceAudioUrl,
      activePreviewClone.previewGeneratedAt ?? activePreviewClone.updatedAt,
    )
    : undefined;
  const hasAudio = Boolean(audioFile);
  const isLibraryPreview = status === 'preview' && activePreviewClone?.status === VoiceCloneStatus.READY;
  const showConfig = hasAudio && status !== 'idle' && status !== 'recording' && !isLibraryPreview;
  const canGenerate = Boolean(hasAudio && name.trim() && previewText.trim() && !generating);
  const draftFields = {
    name: name.trim(),
    model,
    text: previewText.trim(),
    description: description.trim() || undefined,
  };

  const { onAudioFrame } = recorder;

  useEffect(() => {
    onAudioFrame((pcm) => {
      if (captureFramesRef.current) framesRef.current.push(pcm.slice(0));
    });
  }, [onAudioFrame]);

  useEffect(() => {
    if (!recorder.isRecording) return undefined;
    const timer = window.setInterval(() => {
      if (!startedAtRef.current) return;
      setRecordingSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 300);
    return () => window.clearInterval(timer);
  }, [recorder.isRecording]);

  useEffect(() => {
    return () => {
      if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
    };
  }, [localAudioUrl]);

  function setLocalFile(file: File, kind: CaptureKind) {
    if (file.size > MAX_AUDIO_BYTES) {
      appToast.error(new Error('音频文件不能超过 10MB'));
      return;
    }
    setAudioFile(file);
    setLocalAudioUrl(URL.createObjectURL(file));
    setCaptureKind(kind);
    setStatus('ready');
    setGeneratedCloneId('');
    setPreviewClone(null);
    setPreviewPlaying(false);
  }

  async function startRecording() {
    framesRef.current = [];
    captureFramesRef.current = true;
    startedAtRef.current = Date.now();
    setRecordingSeconds(0);
    setStatus('recording');
    try {
      await recorder.start();
    } catch (err) {
      captureFramesRef.current = false;
      startedAtRef.current = null;
      setStatus(audioFile ? 'ready' : 'idle');
      appToast.error(err);
    }
  }

  function stopRecording() {
    captureFramesRef.current = false;
    recorder.stop();
    startedAtRef.current = null;
    if (framesRef.current.length === 0) {
      setStatus(audioFile ? 'ready' : 'idle');
      appToast.error(new Error('没有录到有效音频'));
      return;
    }
    setLocalFile(buildWavFile(framesRef.current), 'recorded');
  }

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) setLocalFile(file, 'uploaded');
    event.currentTarget.value = '';
  }

  function handleFileDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) setLocalFile(file, 'uploaded');
  }

  function resetAll() {
    captureFramesRef.current = false;
    if (recorder.isRecording) recorder.stop();
    startedAtRef.current = null;
    framesRef.current = [];
    setAudioFile(null);
    setLocalAudioUrl(null);
    setCaptureKind(null);
    setStatus('idle');
    setName('');
    setDescription('');
    setPreviewText(DEFAULT_PREVIEW_TEXT);
    setGeneratedCloneId('');
    setPreviewClone(null);
    setCapturePlaying(false);
    setPreviewPlaying(false);
    setRecordingSeconds(0);
  }

  async function toggleCapturePlayback() {
    if (!localAudioRef.current) return;
    if (capturePlaying) {
      localAudioRef.current.pause();
      setCapturePlaying(false);
      return;
    }
    try {
      await localAudioRef.current.play();
      setCapturePlaying(true);
    } catch (err) {
      appToast.error(err);
    }
  }

  async function togglePreviewPlayback() {
    if (!previewAudioRef.current || !playbackUrl) return;
    if (previewPlaying) {
      previewAudioRef.current.pause();
      setPreviewPlaying(false);
      return;
    }
    try {
      await previewAudioRef.current.play();
      setPreviewPlaying(true);
    } catch (err) {
      appToast.error(err);
    }
  }

  async function generatePreview() {
    if (!audioFile) {
      appToast.error(new Error('请先录音或上传提示音频'));
      return;
    }
    if (!name.trim()) {
      appToast.error(new Error('请填写音色名称'));
      return;
    }
    if (!previewText.trim()) {
      appToast.error(new Error('请填写试听文本'));
      return;
    }

    setGenerating(true);
    setStatus('generating');
    setPreviewPlaying(false);
    try {
      let clone = generatedCloneId
        ? previewClone ?? clones.find((item) => item.id === generatedCloneId) ?? null
        : null;
      if (clone?.status === VoiceCloneStatus.READY) {
        appToast.error(new Error('已加入音色库的音色不支持重新编辑，请重新克隆'));
        setStatus('preview');
        return;
      }

      const result = clone
        ? await synthesize(clone.id, draftFields)
        : await createPreview(
          {
            name: draftFields.name,
            model: draftFields.model,
            previewText: draftFields.text,
            description: draftFields.description,
          },
          audioFile,
        );

      clone = result.voiceClone;
      setSelectedId(clone.id);
      setGeneratedCloneId(clone.id);
      setPreviewClone(clone);
      setStatus('preview');
      if (result.usedFallback) {
        appToast.info(result.message ?? '已使用提示音频作为试听');
      } else {
        appToast.success('试听音色已生成');
      }
    } catch (err) {
      setStatus(audioFile ? 'ready' : 'idle');
      appToast.error(err);
    } finally {
      setGenerating(false);
    }
  }

  async function deleteClone(clone: VoiceClone) {
    if (!window.confirm(`删除音色「${clone.name}」？`)) return;
    setDeletingId(clone.id);
    try {
      await remove(clone.id);
      if (selectedId === clone.id) setSelectedId('');
      if (generatedCloneId === clone.id) {
        setGeneratedCloneId('');
        setPreviewClone(null);
      }
      appToast.success('音色已删除');
    } catch (err) {
      appToast.error(err);
    } finally {
      setDeletingId('');
    }
  }

  async function copyVoiceId(clone: VoiceClone) {
    await navigator.clipboard.writeText(clone.voiceId);
    appToast.success('音色 ID 已复制');
  }

  function previewLibraryClone(clone: VoiceClone) {
    setSelectedId(clone.id);
    setPreviewClone(clone);
    setGeneratedCloneId('');
    setStatus('preview');
    setPreviewPlaying(false);
  }

  async function confirmPreview() {
    if (!previewClone) {
      appToast.error(new Error('请先生成试听音色'));
      return;
    }
    setConfirming(true);
    try {
      const clone = await confirm(previewClone.id);
      resetAll();
      setSelectedId(clone.id);
      appToast.success('音色已加入音色库');
    } catch (err) {
      appToast.error(err);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="scenario-workbench detail voice-clone-page">
      <header className="voice-clone-header">
        <button type="button" className="voice-clone-back" onClick={() => router.back()}>
          <ChevronLeft size={15} />
          返回
        </button>
        <div className="voice-clone-title-row">
          <span className="voice-clone-title-icon">
            <Wand2 size={18} />
          </span>
          <div>
            <h1>音色克隆</h1>
            <p>上传或录制真人音频，一键复刻专属音色用于智能外呼</p>
          </div>
        </div>
      </header>

      <div className="voice-clone-layout">
        <main className="voice-clone-main">
          <section className="voice-clone-section">
            <div className="voice-clone-section-title">
              <StepBadge n={1} />
              <h2>选择克隆模型</h2>
            </div>
            <div className="voice-clone-model-grid">
              {MODEL_OPTIONS.map((option) => (
                <ModelCard
                  key={option.id}
                  model={option}
                  selected={model === option.id}
                  onSelect={() => setModel(option.id)}
                />
              ))}
            </div>
          </section>

          <section className="voice-clone-section">
            <div className="voice-clone-section-title compact">
              <StepBadge n={2} />
              <h2>提供需要克隆的人声录音</h2>
            </div>
            <p className="voice-clone-section-hint">
              录制或上传这个人说话的音频。建议 20-60 秒，在安静环境下清晰录制，效果更佳。
            </p>

            {status === 'idle' && (
              <div className="voice-clone-source-grid">
                <button type="button" className="voice-clone-source-card" onClick={startRecording}>
                  <span className="voice-clone-source-icon">
                    <Mic size={26} />
                  </span>
                  <strong>现场录制</strong>
                  <span>直接在浏览器中录音</span>
                </button>

                <button
                  type="button"
                  className={`voice-clone-source-card ${dragOver ? 'dragging' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleFileDrop}
                >
                  <span className="voice-clone-source-icon">
                    <Upload size={26} />
                  </span>
                  <strong>上传录音文件</strong>
                  <span>wav / mp3 / m4a · 10s 以上 · 10MB 以内</span>
                </button>
              </div>
            )}

            {status === 'recording' && (
              <div className="voice-clone-recording-card">
                <div className="voice-clone-recording-orb">
                  <Mic size={34} />
                </div>
                <WaveformBars active color="red" count={28} />
                <div className="voice-clone-recording-time">
                  {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
                  {String(recordingSeconds % 60).padStart(2, '0')}
                  <span>/ 建议最少 20 秒</span>
                </div>
                {recordingSeconds < 20 && (
                  <p>继续录制，至少录满 20 秒效果更好</p>
                )}
                <button
                  type="button"
                  className="voice-clone-stop-button"
                  onClick={stopRecording}
                  disabled={recordingSeconds < 1}
                >
                  <Square size={15} />
                  停止录制
                </button>
              </div>
            )}

            {hasAudio && (
              <div className="voice-clone-audio-card">
                <div className={`voice-clone-audio-icon ${captureKind === 'recorded' ? 'recorded' : ''}`}>
                  {captureKind === 'recorded' ? <Mic size={21} /> : <Upload size={21} />}
                </div>
                <div className="voice-clone-audio-info">
                  <strong>
                    {captureKind === 'recorded'
                      ? `刚才录制的音频（${recordingSeconds} 秒）`
                      : audioFile?.name}
                  </strong>
                  <span>
                    {captureKind === 'recorded'
                      ? '录制完成'
                      : `${audioFile ? formatBytes(audioFile.size) : '-'} · 已上传`}
                  </span>
                  <WaveformBars active={capturePlaying} color={capturePlaying ? 'primary' : 'muted'} count={36} />
                </div>
                <div className="voice-clone-audio-actions">
                  <button type="button" className="voice-clone-round-button" onClick={toggleCapturePlayback}>
                    {capturePlaying ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <button type="button" className="voice-clone-reset-button" onClick={resetAll}>
                    <X size={15} />
                    重新录入
                  </button>
                </div>
                {localAudioUrl && (
                  <audio
                    ref={localAudioRef}
                    src={localAudioUrl}
                    className="voice-clone-hidden-audio"
                    onEnded={() => setCapturePlaying(false)}
                    onPause={() => setCapturePlaying(false)}
                  />
                )}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/wav,audio/mpeg,audio/mp4,audio/aac,.wav,.mp3,.m4a,.aac"
              hidden
              onChange={handleFileSelect}
            />
          </section>

          {showConfig && status !== 'saved' && (
            <section className="voice-clone-section">
              <div className="voice-clone-section-title">
                <StepBadge n={3} />
                <h2>填写音色信息</h2>
              </div>

              <div className="voice-clone-form">
                <label>
                  <span>音色名称 <em>*</em></span>
                  <input
                    className="form-input"
                    value={name}
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="例如：王芳 - 客服专用、张总 - 催收话务"
                    disabled={status === 'generating'}
                  />
                </label>

                <label>
                  <span>需要生成语音的内容 <em>*</em></span>
                  <p>请填写试听语音的内容，AI 将对照此文字生成音频。</p>
                  <textarea
                    className="form-textarea"
                    value={previewText}
                    maxLength={500}
                    rows={2}
                    onChange={(event) => setPreviewText(event.target.value)}
                    placeholder={DEFAULT_PREVIEW_TEXT}
                    disabled={status === 'generating'}
                  />
                </label>

                {status !== 'generating' && (
                  <div className="voice-clone-examples">
                    <span>快速填入：</span>
                    {[
                      DEFAULT_PREVIEW_TEXT,
                      '您好，我是平安保险的智能助理，您有一份保单即将到期，请问方便了解续保详情吗？',
                      '您好，我是来电确认您的订单，请问您是否已收到我们寄出的商品？',
                    ].map((text, index) => (
                      <button key={text} type="button" onClick={() => setPreviewText(text)} title={text}>
                        示例 {index + 1}
                      </button>
                    ))}
                  </div>
                )}

                <label>
                  <span>备注</span>
                  <input
                    className="form-input"
                    value={description}
                    maxLength={500}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="适用场景、说话人授权记录等"
                    disabled={status === 'generating'}
                  />
                </label>
              </div>
            </section>
          )}

          {status === 'ready' && (
            <section className="voice-clone-action-section">
              <button
                type="button"
                className="voice-clone-generate-button"
                onClick={generatePreview}
                disabled={!canGenerate}
              >
                <Wand2 size={17} />
                生成试听音色
              </button>
              {!canGenerate && <p>请先填写音色名称和试听内容</p>}
            </section>
          )}

          {status === 'generating' && (
            <section className="voice-clone-generating">
              <div className="voice-clone-loading-dots">
                {[0, 1, 2, 3, 4].map((item) => (
                  <span key={item} style={{ animationDelay: `${item * 120}ms` }} />
                ))}
              </div>
              <strong>正在生成音色，请稍候...</strong>
              <span>通常需要 10-30 秒</span>
            </section>
          )}

          {status === 'preview' && activePreviewClone && (
            <section className="voice-clone-preview">
              <div className="voice-clone-preview-header">
                <CheckCircle2 size={18} />
                <div>
                  <strong>音色已生成，请试听后确认</strong>
                  <span>听一下生成效果，满意后即可在右侧音色库继续使用。</span>
                </div>
              </div>
              <div className="voice-clone-preview-player">
                <button type="button" className="voice-clone-preview-play" onClick={togglePreviewPlayback}>
                  {previewPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <WaveformBars active={previewPlaying} color={previewPlaying ? 'primary' : 'muted'} count={42} />
                <span>{previewPlaying ? '试听中' : '0:00'}</span>
                {playbackUrl && (
                  <audio
                    ref={previewAudioRef}
                    src={playbackUrl}
                    className="voice-clone-hidden-audio"
                    onEnded={() => setPreviewPlaying(false)}
                    onPause={() => setPreviewPlaying(false)}
                  />
                )}
              </div>
              {activePreviewClone.status === VoiceCloneStatus.PREVIEW && (
                <div className="voice-clone-preview-actions">
                  <button
                    type="button"
                    className="voice-clone-confirm-button"
                    onClick={() => void confirmPreview()}
                    disabled={confirming}
                  >
                    {confirming ? <RefreshCw size={17} className="spin" /> : <PlusCircle size={17} />}
                    {confirming ? '正在加入...' : '听起来不错，加入音色库'}
                  </button>
                  <button
                    type="button"
                    className="voice-clone-secondary-button"
                    onClick={generatePreview}
                    disabled={!canGenerate}
                  >
                    <RefreshCw size={15} />
                    重新生成
                  </button>
                </div>
              )}
            </section>
          )}

          {status === 'saved' && (
            <section className="voice-clone-saved">
              <span>
                <CheckCircle2 size={22} />
              </span>
              <div>
                <strong>「{previewClone?.name ?? name}」已成功加入音色库</strong>
                <p>可在右侧音色库中找到它，点击「使用此音色」可将其用于外呼场景配置。</p>
                <button type="button" onClick={resetAll}>
                  <Wand2 size={14} />
                  再克隆一个音色
                </button>
              </div>
            </section>
          )}

          <p className="voice-clone-legal">
            <strong>使用提示：</strong>
            您应对上传录音的内容和来源负责。若录音中含有他人声纹或个人信息，需提前获得当事人授权。
            因违规使用导致的法律责任由您自行承担。
          </p>
        </main>

        <aside className="voice-clone-sidebar">
          <div className="voice-clone-sidebar-title">
            <div>
              <h2>已克隆的音色</h2>
              <p>共 {clones.length} 个</p>
            </div>
            <Headphones size={18} />
          </div>

          {error && clones.length === 0 ? (
            <div className="voice-clone-empty">
              <strong>加载失败</strong>
              <span>{error instanceof Error ? error.message : '请检查后端服务'}</span>
            </div>
          ) : clones.length === 0 ? (
            <div className="voice-clone-empty">
              <div className="voice-clone-empty-illustration">
                <Volume2 size={34} />
              </div>
              <strong>{isLoading ? '正在加载...' : '暂无克隆音色'}</strong>
              <span>在左侧录制或上传一段声音后生成音色</span>
            </div>
          ) : (
            <div className="voice-clone-list">
              {clones.map((clone) => (
                <VoiceCard
                  key={clone.id}
                  clone={clone}
                  active={(previewClone?.id ?? selectedClone?.id) === clone.id}
                  onPreview={() => previewLibraryClone(clone)}
                  onUse={() => {
                    setSelectedId(clone.id);
                    appToast.success(`已选择音色：${clone.name}`);
                  }}
                  onCopy={() => copyVoiceId(clone)}
                  onDelete={() => {
                    if (!deletingId) void deleteClone(clone);
                  }}
                />
              ))}
            </div>
          )}

          <div className="voice-clone-sidebar-tip">
            <Sparkles size={14} />
            相似度 90% 以上为高质量音色，推荐用于正式外呼任务
          </div>
        </aside>
      </div>
    </div>
  );
}
