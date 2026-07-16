import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@/lib/api/types';
import { toApiError } from '@/lib/api/shared';

/**
 * 生产 BFF 代理：浏览器同源 /api/* 请求 → NestJS（API_INTERNAL_URL）。
 *
 * dev 环境不会走到这里：next.config.js 的 rewrites 优先级更高，
 * /api/* 在 dev 直接被 rewrite 到 NestJS。
 *
 * cookie 双向透传：req.headers.get('cookie') 转发给 NestJS，
 * NestJS 返回的 Set-Cookie 用 getSetCookie() 逐条回写浏览器。
 * body 流式透传，支持未来 SSE。
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3001/api';

async function proxy(
  req: NextRequest,
  context: { params: { path: string[] } },
) {
  const { path } = context.params;
  const target = `${API_BASE}/${path.join('/')}${req.nextUrl.search}`;

  // 1. 构造转发请求头：透传 cookie、Content-Type，剥离 host
  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const cookie = req.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  // 透传来源 IP：后端匿名端点（/web-demo/*）按 IP 限流
  const clientIp = req.ip ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (clientIp) headers.set('x-forwarded-for', clientIp);

  // 2. 读取 body（GET/HEAD 无 body）
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? await req.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch (e) {
    // 网络层错误：NestJS 不可达
    const err = new ApiError(
      0,
      'NETWORK',
      `无法连接后端服务: ${(e as Error).message}`,
      undefined,
      `/${path.join('/')}`,
    );
    return NextResponse.json(
      { statusCode: 502, code: err.code, message: err.message },
      { status: 502 },
    );
  }

  // 3. 构造响应，透传 Set-Cookie（关键！）
  const resHeaders = new Headers();
  const passthrough = [
    'content-type',
    'cache-control',
    'etag',
    'last-modified',
  ];
  for (const h of passthrough) {
    const v = upstream.headers.get(h);
    if (v) resHeaders.set(h, v);
  }
  // Set-Cookie 逐条透传（getSetCookie 是 Node 18+ API，处理多值 cookie）
  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    resHeaders.append('set-cookie', sc);
  }

  // 4. 流式透传 body（支持 SSE / chunked，非流式也兼容）
  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
