import { toast } from 'sonner';
import { ApiError } from '@/lib/api/types';

/**
 * 统一 toast 封装。
 * - success：操作成功提示
 * - error：自动识别 ApiError，提取 message；其他 Error 取 message；未知错误兜底
 */
export const appToast = {
  success: (msg: string) => toast.success(msg),
  error: (err: unknown) => {
    const message =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : '操作失败';
    toast.error(message);
  },
  info: (msg: string) => toast.info(msg),
};
