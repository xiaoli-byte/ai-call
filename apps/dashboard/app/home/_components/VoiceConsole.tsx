'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  AudioLines,
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Mic,
  PhoneCall,
  PhoneOff,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { useWebCall, type WebCallState } from '@/hooks/useWebCall';
import { apiClient } from '@/lib/api/client';
import type { WebDemoFlow } from '@/lib/api/endpoints/web-demo';
import styles from './voice-console.module.scss';

/** 默认优先选中的场景（电商 demo） */
const PREFERRED_SCENARIO = 'ecommerce';

type VisualStage = 'idle' | 'requesting' | 'listening' | 'thinking' | 'speaking' | 'complete' | 'error';

const stageCopy: Record<VisualStage, { label: string; hint: string }> = {
  idle: { label: '线路已就绪', hint: '选择已发布流程后，即可发起真实浏览器通话' },
  requesting: { label: '正在创建通话', hint: '正在锁定流程并建立安全语音连接' },
  listening: { label: '正在聆听', hint: '请自然说话，语音会实时传送给 AI 助理' },
  thinking: { label: '正在理解与查询', hint: 'AI 正在结合上下文和业务流程生成下一步' },
  speaking: { label: 'AI 正在回答', hint: '你可以随时开口打断并继续对话' },
  complete: { label: '本次通话已结束', hint: '通话记录与任务结果已经保留在控制台' },
  error: { label: '通话未能建立', hint: '请查看提示后重新发起，或检查语音服务状态' },
};

function stageFromCall(state: WebCallState, lastRole?: 'agent' | 'caller'): VisualStage {
  if (state === 'preparing' || state === 'dialing') return 'requesting';
  if (state === 'ended') return 'complete';
  if (state === 'error') return 'error';
  if (state === 'in-call') {
    if (lastRole === 'caller') return 'thinking';
    if (lastRole === 'agent') return 'speaking';
    return 'listening';
  }
  return 'idle';
}

const WAVE_BARS = [18, 28, 42, 32, 56, 72, 46, 84, 62, 36, 76, 92, 58, 44, 70, 52, 34, 24];

/**
 * 蓝色首页的语音入口。它与根首页 WebCallPanel 共用 useWebCall：
 * 建单、dispatch、麦克风 PCM 上行、语音服务 WebSocket、下行播放和实时字幕均走真实链路。
 * 全程匿名可用（/web-demo/* 公开端点），不做登录跳转。
 */
export default function VoiceConsole() {
  const call = useWebCall();
  const [expanded, setExpanded] = useState(false);
  const [flows, setFlows] = useState<WebDemoFlow[]>([]);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [flowsError, setFlowsError] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState('');

  const lastSubtitle = call.subtitles[call.subtitles.length - 1];
  const stage = stageFromCall(call.state, lastSubtitle?.role);
  const copy = stageCopy[stage];
  const selectedFlow = useMemo(
    () => flows.find((flow) => flow.id === selectedFlowId),
    [flows, selectedFlowId],
  );
  const callActive = call.state === 'preparing' || call.state === 'dialing' || call.state === 'in-call';
  const isSetup = expanded && (call.state === 'idle' || call.state === 'preparing');

  const loadFlows = useCallback(async () => {
    setFlowsLoading(true);
    setFlowsError(null);
    try {
      // 匿名公开端点：服务端只返回已发布流程的 id/name/scenario
      const list = await apiClient.webDemo.flows();
      setFlows(list);
      const preferred = list.find(
        (flow) => flow.scenario === PREFERRED_SCENARIO || flow.name.includes('电商'),
      ) ?? list[0];
      setSelectedFlowId((current) => current || preferred?.id || '');
    } catch (error) {
      setFlowsError(error instanceof Error ? error.message : '暂时无法读取已发布流程');
    } finally {
      setFlowsLoading(false);
    }
  }, []);

  const openSetup = useCallback(() => {
    if (call.state === 'ended' || call.state === 'error') call.reset();
    setExpanded(true);
    void loadFlows();
  }, [call, loadFlows]);

  const closeSetup = useCallback(() => {
    if (callActive) call.hangup();
    setExpanded(false);
  }, [call, callActive]);

  const startCall = useCallback(async () => {
    if (!selectedFlow) return;
    await call.startCall({ flowId: selectedFlow.id });
  }, [call, selectedFlow]);

  const reset = useCallback(() => {
    call.reset();
    setExpanded(false);
  }, [call]);

  return (
    <section className={`${styles.console} ${styles[`stage-${stage}`]}`} aria-label="企业语音智能体交互演示">
      <div className={styles.topbar}>
        <div className={styles.lineStatus}>
          <span />
          <strong>AI AGENT</strong>
          <small>售后服务 · 在线</small>
        </div>
        <div className={styles.securityStatus}>
          <ShieldCheck aria-hidden="true" />
          加密会话
        </div>
      </div>

      <div className={styles.stage}>
        {expanded && !callActive ? (
          <button type="button" className={styles.closeButton} onClick={closeSetup} aria-label="关闭通话配置">
            <X aria-hidden="true" />
          </button>
        ) : null}

        <div className={styles.signalField} aria-hidden="true">
          <span className={styles.orbit} />
          <span className={styles.orbit} />
          <div className={styles.waveform}>
            {WAVE_BARS.map((height, index) => (
              <i key={index} style={{ '--height': `${height}%`, '--delay': `${index * -36}ms` } as React.CSSProperties} />
            ))}
          </div>
          <div className={styles.voiceCore}>
            {stage === 'requesting' || stage === 'thinking' ? <LoaderCircle /> : null}
            {stage === 'speaking' ? <Volume2 /> : null}
            {stage === 'complete' ? <Check /> : null}
            {stage === 'idle' || stage === 'listening' || stage === 'error' ? <Mic /> : null}
          </div>
        </div>

        <div className={styles.stageCopy} aria-live="polite">
          <div><span />{copy.label}</div>
          <p>{copy.hint}</p>
        </div>

        {isSetup ? (
          <form
            className={styles.callForm}
            onSubmit={(event) => {
              event.preventDefault();
              void startCall();
            }}
          >
            {flowsError ? (
              <div className={styles.errorBox} role="alert">
                <CircleAlert aria-hidden="true" />
                <span>{flowsError}</span>
                <button type="button" onClick={() => void loadFlows()}>重试</button>
              </div>
            ) : (
              <>
                <label>
                  <span>已发布流程</span>
                  <div className={styles.selectWrap}>
                    <select
                      value={selectedFlowId}
                      onChange={(event) => setSelectedFlowId(event.target.value)}
                      disabled={flowsLoading || call.state === 'preparing'}
                    >
                      {flowsLoading ? <option value="">正在读取流程…</option> : null}
                      {!flowsLoading && flows.length === 0 ? <option value="">暂无已发布流程</option> : null}
                      {flows.map((flow) => (
                        <option key={flow.id} value={flow.id}>
                          {flow.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </div>
                </label>
                <button type="submit" className={styles.callButton} disabled={flowsLoading || !selectedFlow || call.state === 'preparing'}>
                  {call.state === 'preparing' ? <LoaderCircle className={styles.spinner} /> : <PhoneCall />}
                  {call.state === 'preparing' ? '正在发起真实通话…' : '发起真实语音通话'}
                </button>
              </>
            )}
          </form>
        ) : null}

        {callActive || call.state === 'ended' ? (
          <div className={styles.transcript} aria-live="polite">
            {call.subtitles.length === 0 ? (
              <p className={styles.emptyLine}>{call.state === 'dialing' ? '正在接通语音服务…' : '等待对话开始…'}</p>
            ) : null}
            {call.subtitles.map((line) => (
              <p key={line.id} className={line.role === 'agent' ? styles.agentLine : styles.customerLine}>
                <span>{line.role === 'agent' ? 'AI' : '你'}</span>
                {line.text}
              </p>
            ))}
          </div>
        ) : null}

        {call.state === 'error' ? (
          <div className={styles.errorBox} role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{call.error ?? '语音服务连接异常，请稍后重试。'}</span>
          </div>
        ) : null}

      </div>

      <div className={styles.controls}>
        {callActive ? (
          <button type="button" className={styles.endButton} onClick={call.hangup} aria-label="挂断通话">
            <PhoneOff aria-hidden="true" />
          </button>
        ) : <span className={styles.controlSpacer} />}

        {!expanded && call.state === 'idle' ? (
          <button type="button" className={styles.mainControl} onClick={openSetup}>
            <Mic aria-hidden="true" />
            <span>开始真实通话</span>
          </button>
        ) : null}
        {callActive ? (
          <button type="button" className={styles.mainControl} onClick={call.hangup}>
            <PhoneOff aria-hidden="true" />
            <span>结束通话</span>
          </button>
        ) : null}
        {call.state === 'ended' || call.state === 'error' ? (
          <button type="button" className={styles.mainControl} onClick={reset}>
            <RotateCcw aria-hidden="true" />
            <span>重新发起</span>
          </button>
        ) : null}
        {isSetup ? <span className={styles.setupHint}>配置后将申请麦克风权限</span> : null}

        {call.state === 'ended' || call.state === 'error' ? (
          <button type="button" className={styles.resetButton} onClick={reset} aria-label="返回初始状态">
            <RotateCcw aria-hidden="true" />
          </button>
        ) : <span className={styles.controlSpacer} />}
      </div>

      <div className={styles.footer}>
        <span><AudioLines aria-hidden="true" /> Real-time Web Call</span>
        <span><Sparkles aria-hidden="true" /> Task · WebSocket · Transcript</span>
      </div>
    </section>
  );
}
