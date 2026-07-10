'use client';

/**
 * WebCallPanel — 首页 hero 面板的浏览器模拟外呼入口
 *
 * 契约 §4（docs/superpowers/specs/2026-07-10-voice-test-call-design.md）：
 *   - 拨号 <Phone/> 可点：未登录（流程列表 401）→ 跳 /login?redirect=/；
 *   - 已登录展开：已发布流程下拉（默认电商 demo）+ 被叫号输入（默认 1001）；
 *   - 发起：POST /tasks → POST /tasks/:id/dispatch { channel:'web' } → 连 WS；
 *   - 通话中：实时字幕列表 + 状态徽标 + 挂断；
 *   - 结束态：显示任务 ID 与「在控制台查看任务」链接（/tasks）；
 *   - 400/422/权限错误在面板内展示。
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Keyboard, Phone, PhoneCall, PhoneOff, X } from 'lucide-react';
import type { TaskFlow } from '@ai-call/shared';
import { apiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/types';
import { useWebCall, type WebCallState } from '@/hooks/useWebCall';
import heroStyles from '@/app/page.module.scss';
import styles from './web-call-panel.module.scss';

/** 被叫号默认值：本机联调 SIP 分机（仅作任务记录） */
const DEFAULT_CALLEE = '1001';
/** 流程未携带场景配置时的兜底场景 */
const FALLBACK_SCENARIO = 'ecommerce';

const STATE_LABEL: Record<WebCallState, string> = {
  idle: '待发起',
  preparing: '创建任务中…',
  dialing: '拨号中…',
  'in-call': '通话中',
  ended: '已结束',
  error: '通话失败',
};

function statusClass(state: WebCallState): string {
  if (state === 'in-call') return `${styles.statusBadge} ${styles.statusInCall}`;
  if (state === 'ended') return `${styles.statusBadge} ${styles.statusEnded}`;
  if (state === 'error') return `${styles.statusBadge} ${styles.statusError}`;
  return styles.statusBadge;
}

export default function WebCallPanel() {
  const router = useRouter();
  const call = useWebCall();

  const [expanded, setExpanded] = useState(false);
  const [flows, setFlows] = useState<TaskFlow[]>([]);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [flowsError, setFlowsError] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState('');
  const [callee, setCallee] = useState(DEFAULT_CALLEE);

  const callActive =
    call.state === 'preparing' || call.state === 'dialing' || call.state === 'in-call';

  /** 拉已发布流程；401 视为未登录 → /login?redirect=/ */
  const loadFlows = useCallback(async () => {
    setFlowsLoading(true);
    setFlowsError(null);
    try {
      const list = await apiClient.taskFlows.list();
      const published = list.filter((flow) => flow.status === 'published');
      setFlows(published);
      const preferred =
        published.find(
          (flow) =>
            flow.scenarioConfig?.scenario === FALLBACK_SCENARIO || flow.name.includes('电商'),
        ) ?? published[0];
      setSelectedFlowId((prev) => prev || preferred?.id || '');
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        router.push('/login?redirect=/');
        return;
      }
      setFlowsError(err instanceof Error ? err.message : '加载流程列表失败');
    } finally {
      setFlowsLoading(false);
    }
  }, [router]);

  const handlePhoneClick = useCallback(() => {
    if (expanded) {
      if (!callActive) setExpanded(false);
      return;
    }
    setExpanded(true);
    void loadFlows();
  }, [expanded, callActive, loadFlows]);

  const handleClose = useCallback(() => {
    if (callActive) call.hangup();
    setExpanded(false);
  }, [callActive, call]);

  const selectedFlow = useMemo(
    () => flows.find((flow) => flow.id === selectedFlowId),
    [flows, selectedFlowId],
  );

  const handleStart = useCallback(async () => {
    if (!selectedFlow) return;
    await call.startCall({
      to: callee.trim() || DEFAULT_CALLEE,
      scenario: selectedFlow.scenarioConfig?.scenario ?? FALLBACK_SCENARIO,
      flowId: selectedFlow.id,
    });
  }, [call, selectedFlow, callee]);

  const showForm = call.state === 'idle' || call.state === 'preparing';

  return (
    <>
      <div className={heroStyles.callControls}>
        <button
          type="button"
          className={`${heroStyles.callControl} ${styles.phoneButton} ${
            expanded ? styles.phoneButtonActive : ''
          }`}
          aria-label="发起模拟外呼"
          aria-expanded={expanded}
          onClick={handlePhoneClick}
        >
          <Phone aria-hidden="true" />
        </button>
        <span className={heroStyles.callControlPrimary} aria-hidden="true">
          <Keyboard />
        </span>
      </div>

      {expanded ? (
        <section className={styles.panel} aria-label="浏览器模拟外呼">
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>
              <PhoneCall aria-hidden="true" />
              模拟外呼体验
            </span>
            <button
              type="button"
              className={styles.closeButton}
              aria-label="关闭通话面板"
              onClick={handleClose}
            >
              <X aria-hidden="true" />
            </button>
          </div>

          <div className={styles.statusRow}>
            <span className={statusClass(call.state)}>{STATE_LABEL[call.state]}</span>
          </div>

          {flowsError ? (
            <>
              <p className={styles.errorText}>{flowsError}</p>
              <button type="button" className={styles.ghostButton} onClick={() => void loadFlows()}>
                重新加载流程
              </button>
            </>
          ) : null}

          {showForm && !flowsError ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void handleStart();
              }}
            >
              <div className={styles.field}>
                <label htmlFor="web-call-flow">已发布流程</label>
                <select
                  id="web-call-flow"
                  value={selectedFlowId}
                  onChange={(event) => setSelectedFlowId(event.target.value)}
                  disabled={flowsLoading || call.state === 'preparing'}
                >
                  {flowsLoading ? <option value="">加载中…</option> : null}
                  {!flowsLoading && flows.length === 0 ? (
                    <option value="">暂无已发布流程</option>
                  ) : null}
                  {flows.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="web-call-to">被叫号码（仅作任务记录）</label>
                <input
                  id="web-call-to"
                  value={callee}
                  onChange={(event) => setCallee(event.target.value)}
                  placeholder={DEFAULT_CALLEE}
                  disabled={call.state === 'preparing'}
                />
              </div>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={flowsLoading || !selectedFlow || call.state === 'preparing'}
              >
                <PhoneCall aria-hidden="true" />
                {call.state === 'preparing' ? '正在发起…' : '发起模拟外呼'}
              </button>
            </form>
          ) : null}

          {call.state === 'dialing' || call.state === 'in-call' ? (
            <>
              <ul className={styles.subtitleList} aria-label="实时字幕" aria-live="polite">
                {call.subtitles.length === 0 ? (
                  <li className={styles.subtitleEmpty}>
                    {call.state === 'dialing' ? '正在接通语音服务…' : '等待对话开始…'}
                  </li>
                ) : null}
                {call.subtitles.map((line) => (
                  <li
                    key={line.id}
                    className={`${styles.subtitleItem} ${
                      line.role === 'caller' ? styles.subtitleCaller : ''
                    }`}
                  >
                    <span className={styles.subtitleRole}>
                      {line.role === 'agent' ? 'AI 助理' : '我'}
                    </span>
                    <span>{line.text}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className={styles.hangupButton} onClick={call.hangup}>
                <PhoneOff aria-hidden="true" />
                挂断
              </button>
            </>
          ) : null}

          {call.state === 'ended' ? (
            <>
              {call.subtitles.length > 0 ? (
                <ul className={styles.subtitleList} aria-label="通话字幕回顾">
                  {call.subtitles.map((line) => (
                    <li
                      key={line.id}
                      className={`${styles.subtitleItem} ${
                        line.role === 'caller' ? styles.subtitleCaller : ''
                      }`}
                    >
                      <span className={styles.subtitleRole}>
                        {line.role === 'agent' ? 'AI 助理' : '我'}
                      </span>
                      <span>{line.text}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {call.taskId ? (
                <p className={styles.metaText}>任务 ID：{call.taskId}（已真实落库）</p>
              ) : null}
              <div className={styles.endedActions}>
                <Link href="/tasks" className={styles.ghostButton}>
                  在控制台查看任务
                </Link>
                <button type="button" className={styles.ghostButton} onClick={call.reset}>
                  再拨一次
                </button>
              </div>
            </>
          ) : null}

          {call.state === 'error' ? (
            <>
              {call.error ? <p className={styles.errorText}>{call.error}</p> : null}
              {call.taskId ? <p className={styles.metaText}>任务 ID：{call.taskId}</p> : null}
              <button type="button" className={styles.ghostButton} onClick={call.reset}>
                返回重试
              </button>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
