/**
 * 纯函数工具：与运行环境无关的请求构造与响应解析。
 * client.ts / server.ts 共用。
 */
import { ApiError, type NestErrorBody, type RequestOptions } from './types';

/** 把 params 对象拼成 query string，跳过 undefined/null/空串 */
export function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

/** 解析非 2xx 响应体，构造 ApiError */
export async function toApiError(res: Response, path: string): Promise<ApiError> {
  if (res.status === 401) {
    return new ApiError(401, 'UNAUTHORIZED', '未授权或登录已过期', undefined, path);
  }
  let body: NestErrorBody | null = null;
  try {
    body = (await res.json()) as NestErrorBody;
  } catch {
    // 非 JSON 响应体
  }
  const message = Array.isArray(body?.message)
    ? body!.message.join('；')
    : body?.message ?? `请求失败 (${res.status})`;
  const code = body?.code ?? `HTTP_${res.status}`;
  return new ApiError(res.status, code, message, body, path);
}

/** 统一 body 处理：自动 stringify、设置 Content-Type */
export function normalizeInit(options?: RequestOptions): RequestInit {
  const { body, headers, timeoutMs, _retry, ...rest } = options ?? {};
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...((headers as Record<string, string> | undefined) ?? {}),
  };
  if (
    body !== undefined &&
    body !== null &&
    typeof body !== 'string' &&
    !(body instanceof FormData) &&
    !(body instanceof Blob)
  ) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  const init: RequestInit = {
    ...rest,
    headers: finalHeaders,
    body:
      body === undefined || body === null
        ? undefined
        : typeof body === 'string' || body instanceof FormData || body instanceof Blob
          ? (body as BodyInit)
          : JSON.stringify(body),
  };
  return init;
}

/** 处理 204 / 空响应，否则解析 JSON */
export async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
