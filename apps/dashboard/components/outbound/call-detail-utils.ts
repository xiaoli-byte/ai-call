import type { CallEventRecord, CallHistoryDetail, TranscriptTurn } from '@ai-call/shared';

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
export const WAVEFORM_BARS = 80;

const EVENT_LABELS: Record<string, string> = {
  'task.created': '任务创建',
  'call.dispatch_requested': '请求派发',
  'call.dispatch_accepted': '派发接受',
  'task.status_changed': '状态变更',
  'transcript.appended': '转写写入',
  'call.outcome_set': '结果更新',
  'call.transferred': '转人工',
  'call.hung_up': '挂机完成',
  'call.policy_blocked': '策略拦截',
  'call.dispatch_requested.retrying': '派发重试',
  'call.dispatch_requested.failed': '派发失败',
  'action.sms.requested': '短信请求',
  'action.sms.delivered': '短信送达',
  'action.sms.retrying': '短信重试',
  'action.sms.failed': '短信失败',
  'action.api.requested': 'API 请求',
  'action.api.delivered': 'API 完成',
  'action.api.retrying': 'API 重试',
  'action.api.failed': 'API 失败',
};

export function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

export function formatDuration(seconds?: number) {
  const safe = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export function formatEventTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
}

export function getEventLabel(type: string) {
  return EVENT_LABELS[type] ?? type;
}

export function getEventTone(type: string) {
  if (type.includes('failed') || type.includes('blocked')) return 'danger';
  if (type.includes('retrying')) return 'warning';
  if (type.includes('accepted') || type.includes('delivered') || type.includes('hung_up')) return 'success';
  return 'neutral';
}

export function summarizePayload(type: string, payload: Record<string, unknown>) {
  if (type === 'task.status_changed') {
    return `${payload.from ?? '—'} → ${payload.to ?? '—'}`;
  }
  if (type === 'call.policy_blocked') {
    return String(payload.message ?? payload.code ?? '规则拦截');
  }
  if (type === 'call.transferred') {
    return `转接 ${payload.extension ?? '—'}`;
  }
  if (type === 'call.hung_up') {
    return payload.outcome ? `结果 ${payload.outcome}` : '通话结束';
  }
  if (type === 'transcript.appended') {
    return `角色 ${payload.role ?? '—'}`;
  }
  if ('error' in payload) {
    return String(payload.error);
  }
  const entries = Object.entries(payload).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return '—';
  return entries.slice(0, 2).map(([key, value]) => `${key}: ${String(value)}`).join(' / ');
}

export function getTotalDuration(call: CallHistoryDetail) {
  if (call.duration && call.duration > 0) return call.duration;
  const lastTurn = call.transcript[call.transcript.length - 1];
  return lastTurn ? Math.max(1, Math.ceil(lastTurn.timestamp + 5)) : 0;
}

export function getActiveTurnIndex(turns: TranscriptTurn[], current: number) {
  let activeIndex = -1;
  for (let index = 0; index < turns.length; index += 1) {
    if (turns[index].timestamp <= current) activeIndex = index;
  }
  return activeIndex;
}

export function roleAtTime(turns: TranscriptTurn[], seconds: number) {
  let role: TranscriptTurn['role'] = turns[0]?.role ?? 'agent';
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (seconds >= turns[index].timestamp) {
      role = turns[index].role;
      break;
    }
  }
  return role;
}

export function clampTime(seconds: number, total: number) {
  return Math.max(0, Math.min(total, seconds));
}

export function sortEvents(events: CallEventRecord[]) {
  return [...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function debugRows({
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
