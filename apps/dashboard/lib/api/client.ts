/**
 * 浏览器实例：同源 /api（dev→rewrites，prod→Route Handler），
 * credentials: 'include'，单飞 refresh。
 */
import { ApiError, type HttpAdapter, type RequestOptions } from './types';
import { normalizeInit, parseBody, toApiError } from './shared';
import { createApi } from './endpoints';

const BASE = '/api';

let refreshPromise: Promise<boolean> | null = null;

/** 单飞 refresh：并发 401 只刷新一次，refresh 后浏览器自动收 Set-Cookie */
async function refreshToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function redirectToLogin(): Promise<never> {
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    const redirect = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    window.location.href = `/login?redirect=${redirect}`;
  }
  throw new ApiError(401, 'UNAUTHORIZED', '登录已过期，请重新登录');
}

export const clientHttp: HttpAdapter = {
  async request<T>(path: string, options?: RequestOptions): Promise<T> {
    const init = normalizeInit(options);
    const doFetch = () =>
      fetch(`${BASE}${path}`, {
        ...init,
        credentials: 'include',
        cache: 'no-store',
      });

    let res = await doFetch();

    // 401 自动刷新（排除 auth 端点本身，避免循环）
    if (res.status === 401 && !path.startsWith('/auth/') && !options?._retry) {
      const ok = await refreshToken();
      if (ok) {
        // refresh 后浏览器已自动存新 cookie，直接重试原请求
        res = await doFetch();
      } else {
        await redirectToLogin();
      }
    }

    if (!res.ok) throw await toApiError(res, path);
    return parseBody<T>(res);
  },
};

/** SWR 默认 fetcher */
export const swrFetcher = clientHttp.request;

/** Client 实例的完整 API 对象 */
export const apiClient = createApi(clientHttp);
