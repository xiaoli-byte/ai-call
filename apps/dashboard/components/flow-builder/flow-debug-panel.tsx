'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { appToast } from '@/lib/toast';
import styles from './flow-debug-panel.module.scss';

interface DebugMessage {
  id: string;
  role: 'user' | 'agent' | 'action' | 'system';
  text: string;
  nodeName?: string;
}

interface FlowDebugPanelProps {
  flowId: string;
  flowName: string;
  open: boolean;
  onClose: () => void;
  onSaveFlow: () => Promise<void>;
}

type PanelState = 'idle' | 'saving' | 'connecting' | 'running' | 'ended' | 'error';

export function FlowDebugPanel({ flowId, flowName, open, onClose, onSaveFlow }: FlowDebugPanelProps) {
  const [state, setState] = useState<PanelState>('idle');
  const [messages, setMessages] = useState<DebugMessage[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const currentNodeName = useRef<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'hangup' }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // 关闭时清理
  useEffect(() => {
    if (!open) {
      cleanup();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const addMessage = useCallback((msg: Omit<DebugMessage, 'id'>) => {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` },
    ]);
  }, []);

  const handleWsMessage = (data: { type: string; [key: string]: unknown }) => {
    switch (data.type) {
      case 'connected':
        setSessionId(String(data.sessionId ?? ''));
        break;
      case 'node_enter':
        currentNodeName.current = String(data.nodeName ?? '');
        break;
      case 'agent_speech':
        addMessage({
          role: 'agent',
          text: String(data.text ?? ''),
          nodeName: String(data.nodeName ?? currentNodeName.current),
        });
        break;
      case 'caller_speech':
        // 本地已即时回显，服务端确认不再重复添加
        break;
      case 'action':
        addMessage({
          role: 'action',
          text: `[动作] ${data.actionType}：${data.note ?? '调试模式未真实执行'}`,
          nodeName: String(data.nodeName ?? currentNodeName.current),
        });
        break;
      case 'tool_call':
        addMessage({
          role: 'system',
          text: `[工具] ${data.name}：${data.result ?? ''}`,
        });
        break;
      case 'error':
        addMessage({ role: 'system', text: `[错误] ${data.message ?? '未知错误'}` });
        break;
      case 'end':
        setState('ended');
        break;
    }
  };

  const handleStart = async () => {
    setState('saving');
    setErrorMsg('');
    try {
      await onSaveFlow();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '保存失败');
      setState('error');
      return;
    }

    setState('connecting');
    const wsUrl = `${process.env.NEXT_PUBLIC_VOICE_AGENT_WS_URL}/text-test`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      setErrorMsg('调试服务未连接');
      setState('error');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', flowId, variables: {} }));
      setState('running');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      setErrorMsg('调试服务连接异常');
      setState('error');
    };

    ws.onclose = () => {
      if (state === 'running') {
        setState('ended');
      }
    };
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'user_input', text }));
    addMessage({ role: 'user', text });
    setInput('');
  };

  const handleReset = () => {
    cleanup();
    setMessages([]);
    setSessionId('');
    setInput('');
    setErrorMsg('');
    currentNodeName.current = '';
    setState('idle');
  };

  const handleClose = () => {
    cleanup();
    onClose();
  };

  if (!open) return null;

  const isRunning = state === 'running';
  const isBusy = state === 'saving' || state === 'connecting';

  return (
    <div className={styles.debugPanel}>
      <div className={styles.debugHeader}>
        <div className={styles.debugHeaderLeft}>
          <span className={styles.debugFlowName}>{flowName}</span>
          <span className={styles.debugEnvBadge}>测试环境</span>
        </div>
        <button type="button" onClick={handleClose} className={styles.debugCloseBtn} title="关闭">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className={styles.debugMessages}>
        {messages.length === 0 && state === 'idle' && (
          <div className={styles.debugEmpty}>
            <p>点击下方&ldquo;开始会话&rdquo;开始调试</p>
          </div>
        )}
        {messages.length === 0 && isBusy && (
          <div className={styles.debugEmpty}>
            <p>{state === 'saving' ? '正在保存流程…' : '正在连接调试服务…'}</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`${styles.debugMsg} ${styles[`debugMsg_${msg.role}`]}`}>
            <div className={styles.debugMsgText}>{msg.text}</div>
            {msg.role === 'agent' && msg.nodeName && (
              <details className={styles.debugInfo}>
                <summary>调试信息</summary>
                <div className={styles.debugInfoBody}>
                  <div>SessionId: {sessionId}</div>
                  <div>流程名称: {flowName}</div>
                  <div>节点名称: {msg.nodeName}</div>
                </div>
              </details>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {errorMsg && state === 'error' && <div className={styles.debugErrorBar}>{errorMsg}</div>}

      <div className={styles.debugFooter}>
        {state === 'idle' && (
          <button type="button" onClick={handleStart} className={styles.debugStartBtn}>
            开始会话
          </button>
        )}
        {isBusy && (
          <button type="button" disabled className={styles.debugStartBtn}>
            {state === 'saving' ? '保存中…' : '连接中…'}
          </button>
        )}
        {isRunning && (
          <>
            <button
              type="button"
              onClick={() => appToast.info('语音外呼功能即将上线')}
              className={styles.debugVoiceBtn}
              title="语音外呼（即将上线）"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="请输入您的问题…"
              className={styles.debugInput}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim()}
              className={styles.debugSendBtn}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </>
        )}
        {(state === 'ended' || state === 'error') && (
          <button type="button" onClick={handleReset} className={styles.debugStartBtn}>
            重置
          </button>
        )}
      </div>
    </div>
  );
}
