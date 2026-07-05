import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { GlobalConfigService } from '../global-config/global-config.service.js';

@Injectable()
export class ActionDeliveryService {
  constructor(@Optional() private readonly globalConfig?: GlobalConfigService) {}

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
    const config = await this.resolveWebhookConfig(payload.config);
    const url = String(config.url ?? '');
    this.assertAllowedWebhook(url);
    const method = String(config.method ?? 'POST').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new BadRequestException(`Unsupported webhook method: ${method}`);
    }
    const body = method === 'GET' ? undefined : {
      data: config.body ?? {},
      taskId: payload.taskId,
      attemptId: payload.attemptId,
    };
    const configuredHeaders = (config.headers ?? {}) as Record<string, string>;
    await this.request(url, method, body, {
      ...configuredHeaders,
      'Idempotency-Key': idempotencyKey,
    }, Number(config.timeout ?? 10) * 1000);
  }

  private async resolveWebhookConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> {
    const pluginKey = String(config.pluginId ?? config.pluginName ?? '');
    if (!pluginKey || !this.globalConfig) return config;
    const plugin = await this.globalConfig.findApiPlugin(pluginKey);
    if (!plugin) return config;
    const pluginConfig = {
      pluginId: plugin.id,
      pluginName: plugin.name,
      url: plugin.url,
      method: plugin.method,
      headers: plugin.headers,
      body: plugin.bodyTemplate,
      timeout: plugin.timeoutSeconds,
    };
    return {
      ...pluginConfig,
      ...config,
      url: config.url ?? pluginConfig.url,
      method: config.method ?? pluginConfig.method,
      headers: config.headers ?? pluginConfig.headers,
      body: config.body ?? pluginConfig.body,
      timeout: config.timeout ?? pluginConfig.timeout,
    };
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
