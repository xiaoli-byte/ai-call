import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class ActionDeliveryService {
  async deliverSms(payload: {
    taskId: string;
    attemptId?: string;
    to?: string;
    config: Record<string, unknown>;
  }, idempotencyKey: string): Promise<void> {
    const endpoint = process.env.SMS_GATEWAY_URL;
    if (!endpoint) throw new Error('SMS_GATEWAY_URL is not configured');
    await this.request(endpoint, 'POST', {
      to: payload.config.phone ?? payload.to,
      template: payload.config.template ?? payload.config.templateId,
      params: payload.config.params ?? {},
      taskId: payload.taskId,
      attemptId: payload.attemptId,
    }, {
      ...(process.env.SMS_GATEWAY_TOKEN
        ? { Authorization: `Bearer ${process.env.SMS_GATEWAY_TOKEN}` }
        : {}),
      'Idempotency-Key': idempotencyKey,
    });
  }

  async deliverWebhook(payload: {
    taskId: string;
    attemptId?: string;
    config: Record<string, unknown>;
  }, idempotencyKey: string): Promise<void> {
    const url = String(payload.config.url ?? '');
    this.assertAllowedWebhook(url);
    const method = String(payload.config.method ?? 'POST').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new BadRequestException(`Unsupported webhook method: ${method}`);
    }
    const body = method === 'GET' ? undefined : {
      data: payload.config.body ?? {},
      taskId: payload.taskId,
      attemptId: payload.attemptId,
    };
    const configuredHeaders = (payload.config.headers ?? {}) as Record<string, string>;
    await this.request(url, method, body, {
      ...configuredHeaders,
      'Idempotency-Key': idempotencyKey,
    }, Number(payload.config.timeout ?? 10) * 1000);
  }

  private assertAllowedWebhook(rawUrl: string): void {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Invalid webhook URL');
    }
    const allowlist = (process.env.ACTION_WEBHOOK_ALLOWLIST ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (allowlist.length === 0 || !allowlist.includes(url.hostname.toLowerCase())) {
      throw new BadRequestException(`Webhook host is not allowlisted: ${url.hostname}`);
    }
    const localDev = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !localDev) {
      throw new BadRequestException('Webhook URL must use HTTPS');
    }
  }

  private async request(
    url: string,
    method: string,
    body: unknown,
    headers: Record<string, string>,
    timeoutMs = 10_000,
  ): Promise<void> {
    const response = await fetch(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min(60_000, Math.max(1_000, timeoutMs))),
    });
    if (!response.ok) {
      throw new Error(`Action delivery failed: HTTP ${response.status}`);
    }
  }
}
