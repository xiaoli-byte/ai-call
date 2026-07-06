import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { GlobalConfigService } from '../global-config/global-config.service.js';
import { ToolsService } from '../tools/tools.service.js';

@Injectable()
export class ActionDeliveryService {
  constructor(
    @Optional() private readonly globalConfig?: GlobalConfigService,
    @Optional() private readonly tools?: ToolsService,
  ) {}

  async deliverSms(payload: {
    taskId: string;
    attemptId?: string;
    to?: string;
    config: Record<string, unknown>;
  }, idempotencyKey: string): Promise<void> {
    const endpoint = process.env.SMS_GATEWAY_URL ?? process.env.SMS_WEBHOOK_URL;
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

  async deliverCrm(payload: {
    taskId: string;
    attemptId?: string;
    to?: string;
    config: Record<string, unknown>;
  }, _idempotencyKey: string): Promise<unknown> {
    if (!this.tools) throw new Error('ToolsService is not configured');
    const action = String(payload.config.action ?? payload.config.toolName ?? '');
    if (!action) throw new BadRequestException('CRM action is required');
    const args = isPlainObject(payload.config.arguments)
      ? payload.config.arguments
      : omitKeys(payload.config, ['action', 'toolName', 'arguments']);
    return this.dispatchTool(action, args);
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

  private dispatchTool(action: string, args: Record<string, unknown>): unknown {
    switch (action) {
      case 'query_repayment_info':
        return this.tools!.queryRepaymentInfo(args);
      case 'calculate_penalty':
        return this.tools!.calculatePenalty(args as { overdueDays: number; principal: number });
      case 'create_extension_request':
        return this.tools!.createExtensionRequest(args as { reason: string; customerId?: string });
      case 'query_order':
        return this.tools!.queryOrder(args as { orderNo: string });
      case 'query_refund_status':
        return this.tools!.queryRefundStatus(args as { orderNo: string });
      case 'create_pickup_appointment':
        return this.tools!.createPickupAppointment(args as {
          orderNo: string;
          date: string;
          timeSlot: string;
          address?: string;
        });
      case 'create_after_sale_ticket':
        return this.tools!.createAfterSaleTicket(args as {
          orderNo: string;
          issueType: string;
          description: string;
        });
      case 'query_car_model':
        return this.tools!.queryCarModel(args as { model?: string });
      case 'query_activity':
        return this.tools!.queryActivity(args as { activityId?: string });
      case 'create_test_drive_appointment':
        return this.tools!.createTestDriveAppointment(args as {
          customerName: string;
          phone: string;
          date: string;
          timeSlot: string;
          model?: string;
        });
      case 'transfer_to_human':
        return this.tools!.transferToHuman(args as { reason: string });
      default:
        throw new BadRequestException(`Unsupported CRM action: ${action}`);
    }
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function omitKeys(
  value: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
}
