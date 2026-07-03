/**
 * Node.js 实例：API_INTERNAL_URL（服务端私有变量），
 * 从 next/headers 的 cookies() 注入 Cookie header。
 *
 * 注意：Server Component 渲染期 cookie store 只读，refresh 后无法写回。
 * 渲染期 401 直接 redirect('/login')；Route Handler / Server Action 可写。
 */
import 'server-only';
import { redirect } from 'next/navigation';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';
import { ApiError, type HttpAdapter, type RequestOptions } from './types';
import { normalizeInit, parseBody, toApiError } from './shared';
import { createApi } from './endpoints';

const BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3001/api';

async function getCookieStore(): Promise<ReadonlyRequestCookies> {
  const { cookies } = await import('next/headers');
  return cookies();
}

function cookiesToString(store: ReadonlyRequestCookies): string {
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** 服务端 refresh：调 NestJS /auth/refresh，解析 Set-Cookie 写回 store */
async function tryServerRefresh(
  currentCookie: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: currentCookie ? { Cookie: currentCookie } : {},
      cache: 'no-store',
    });
    if (!res.ok) return false;
    // Route Handler / Server Action 中 store 可写；渲染期 set 静默失败不影响逻辑
    const store = await getCookieStore();
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const [pair] = sc.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        try {
          store.set(pair.slice(0, eq), pair.slice(eq + 1));
        } catch {
          // 渲染期 store 只读，set 抛错时忽略（后续 redirect 兜底）
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

export const serverHttp: HttpAdapter = {
  async request<T>(path: string, options?: RequestOptions): Promise<T> {
    const store = await getCookieStore();
    const init = normalizeInit(options);
    const headers = init.headers as Record<string, string>;
    const cookieStr = cookiesToString(store);
    if (cookieStr) headers.Cookie = cookieStr;

    const doFetch = (cookieOverride?: string) =>
      fetch(`${BASE}${path}`, {
        ...init,
        headers: cookieOverride
          ? { ...headers, Cookie: cookieOverride }
          : headers,
        cache: 'no-store',
      });

    let res = await doFetch();

    if (res.status === 401 && !path.startsWith('/auth/') && !options?._retry) {
      const refreshed = await tryServerRefresh(cookieStr);
      if (refreshed) {
        // 重新读 store（refresh 可能已写入新 cookie），重试原请求
        const newStore = await getCookieStore();
        res = await doFetch(cookiesToString(newStore));
      } else {
        redirect('/login');
      }
    }

    if (!res.ok) throw await toApiError(res, path);
    return parseBody<T>(res);
  },
};

/** Server 实例的完整 API 对象 */
export const apiServer = createApi(serverHttp);
