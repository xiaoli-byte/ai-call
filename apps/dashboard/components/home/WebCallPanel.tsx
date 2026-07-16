'use client';

/**
 * WebCallPanel — 首页 hero 面板的浏览器模拟外呼入口
 *
 * 契约 §4（docs/superpowers/specs/2026-07-10-voice-test-call-design.md，2026-07-17 更新）：
 *   - 全程匿名可用（/web-demo/* 公开端点），不做任何登录跳转；
 *   - 展开面板：已发布流程下拉（默认电商 demo）；被叫号固定 1001（服务端强制），不展示输入框；
 *   - hero 左上角徽标由本组件渲染，展示当前选中话术名称（挂载时预取流程列表）；
 *   - 发起：POST /web-demo/calls { flowId } → 连 WS；
 *   - 通话中：实时字幕列表 + 状态徽标 + 挂断；
 *   - 结束态：仅保留字幕回顾与「再拨一次」，不展示任务 ID 等调试信息；
 *   - 400/422/权限错误在面板内展示。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, Phone, PhoneCall, PhoneOff, X } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import type { WebDemoFlow } from '@/lib/api/endpoints/web-demo';
import { useWebCall, type WebCallState } from '@/hooks/useWebCall';
import heroStyles from '@/app/page.module.scss';
import styles from './web-call-panel.module.scss';

/** 默认优先选中的场景（电商 demo） */
const PREFERRED_SCENARIO = 'ecommerce';

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
  const call = useWebCall();

  const [expanded, setExpanded] = useState(false);
  const [flows, setFlows] = useState<WebDemoFlow[]>([]);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [flowsError, setFlowsError] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState('');

  const callActive =
    call.state === 'preparing' || call.state === 'dialing' || call.state === 'in-call';

  /**
   * 拉可体验流程（匿名公开端点，服务端只返回已发布流程的 id/name/scenario）。
   * 失败仅在面板内提示，绝不跳登录页——首页体验无需账号。
   */
  const loadFlows = useCallback(async () => {
    setFlowsLoading(true);
    setFlowsError(null);
    try {
      const list = await apiClient.webDemo.flows();
      setFlows(list);
      const preferred =
        list.find(
          (flow) => flow.scenario === PREFERRED_SCENARIO || flow.name.includes('电商'),
        ) ?? list[0];
      setSelectedFlowId((prev) => prev || preferred?.id || '');
    } catch (err) {
      setFlowsError(err instanceof Error ? err.message : '加载流程列表失败');
    } finally {
      setFlowsLoading(false);
    }
  }, []);

  // 挂载时预取一次（供 hero 徽标显示话术名）。空依赖：loadFlows 无外部依赖，仅跑一次。
  useEffect(() => {
    void loadFlows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    await call.startCall({ flowId: selectedFlow.id });
  }, [call, selectedFlow]);

  const showForm = call.state === 'idle' || call.state === 'preparing';

  return (
    <>
      <div className={heroStyles.demoStatus}>
        <span className={heroStyles.liveDot} />
        <span className={heroStyles.demoStatusText}>
          {selectedFlow ? selectedFlow.name : '电商售后回访场景'} · 体验中
        </span>
      </div>

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
              <div className={styles.endedActions}>
                <button type="button" className={styles.ghostButton} onClick={call.reset}>
                  再拨一次
                </button>
              </div>
            </>
          ) : null}

          {call.state === 'error' ? (
            <>
              {call.error ? <p className={styles.errorText}>{call.error}</p> : null}
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
