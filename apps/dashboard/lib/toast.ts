import { toast } from 'sonner';
import { ApiError } from '@/lib/api/types';

/**
 * 统一 toast 封装。
 * - success：操作成功提示
 * - error：自动识别 ApiError，提取 message；其他 Error 取 message；未知错误兜底
 * - info：一般提示
 *
 * 对调用方 API 保持不变（success/error/info 签名不变），内部做了三层防刷屏：
 * - 自动消失：统一 4 秒后自动关闭；
 * - 同屏最多 3 条：超出上限时主动丢弃最旧的一条（而非排队等待稍后展示）；
 * - 文案去重：相同类型 + 文案在 DEDUPE_WINDOW_MS 内重复触发时直接忽略，
 *   避免用户连点被拒绝（如 403）的按钮时同一条提示反复刷屏。
 */

const AUTO_DISMISS_MS = 4000;
const MAX_VISIBLE_TOASTS = 3;
const DEDUPE_WINDOW_MS = 2000;

type ToastKind = 'success' | 'error' | 'info';

/** 当前仍在展示中的 toast id，按出现顺序排列，用于超出上限时定位最旧的一条。 */
const activeToastIds: string[] = [];
/** 每种“类型+文案”最近一次触发的时间戳，用于短窗口去重。 */
const recentMessages = new Map<string, number>();

let nextToastSeq = 0;
function createToastId(): string {
  nextToastSeq += 1;
  return `app-toast-${Date.now()}-${nextToastSeq}`;
}

function forgetToastId(id: string) {
  const index = activeToastIds.indexOf(id);
  if (index !== -1) activeToastIds.splice(index, 1);
}

function pushToastId(id: string) {
  activeToastIds.push(id);
  // 超出同屏展示上限时，主动丢弃最旧的一条，而不是让它排队等待展示。
  while (activeToastIds.length > MAX_VISIBLE_TOASTS) {
    const oldestId = activeToastIds.shift();
    if (oldestId !== undefined) toast.dismiss(oldestId);
  }
}

/** 清理过期的去重记录，避免长会话下 Map 无限增长。 */
function pruneStaleMessages(now: number) {
  for (const [key, timestamp] of recentMessages) {
    if (now - timestamp >= DEDUPE_WINDOW_MS) recentMessages.delete(key);
  }
}

function show(kind: ToastKind, message: string) {
  const now = Date.now();
  pruneStaleMessages(now);

  const dedupeKey = `${kind}:${message}`;
  const lastShownAt = recentMessages.get(dedupeKey);
  if (lastShownAt !== undefined && now - lastShownAt < DEDUPE_WINDOW_MS) {
    // 同一类型+文案在去重窗口内重复触发，直接忽略，不再新开一条。
    return;
  }
  recentMessages.set(dedupeKey, now);

  const id = createToastId();
  const options = {
    id,
    duration: AUTO_DISMISS_MS,
    onDismiss: () => forgetToastId(id),
    onAutoClose: () => forgetToastId(id),
  };
  switch (kind) {
    case 'success':
      toast.success(message, options);
      break;
    case 'error':
      toast.error(message, options);
      break;
    case 'info':
      toast.info(message, options);
      break;
  }
  pushToastId(id);
}

export const appToast = {
  success: (msg: string) => show('success', msg),
  error: (err: unknown) => {
    const message =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : '操作失败';
    show('error', message);
  },
  info: (msg: string) => show('info', msg),
};
