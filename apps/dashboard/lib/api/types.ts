/**
 * HTTP 适配器接口与统一错误类型。
 * client.ts 与 server.ts 都实现 HttpAdapter，保证调用层一致。
 */

/** 请求选项：扩展 RequestInit，body 支持自动 JSON.stringify */
export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** 超时毫秒数（未实现底层 abort，目前仅作标记保留扩展位） */
  timeoutMs?: number;
  /** 内部标记：本次请求是否为 refresh 重试，避免无限循环 */
  _retry?: boolean;
}

/** 两个实例必须实现的统一接口 */
export interface HttpAdapter {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
}

/** NestJS 返回的业务错误体（ValidationPipe / HttpException） */
export interface NestErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
  code?: string;
}

/** 统一错误类型，区分网络错误/超时/未授权/业务错误 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public path?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isTimeout(): boolean {
    return this.code === 'TIMEOUT';
  }
  get isBusinessError(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 401;
  }
}
