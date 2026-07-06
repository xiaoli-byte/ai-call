import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { ProviderCallEventDto } from '../tasks/dto/provider-call-event.dto.js';
import {
  parseFreeSwitchEventHeaders,
  type FreeSwitchEventHeaders,
} from './freeswitch-event-parser.js';

@Injectable()
export class FreeSwitchEventBridgeService {
  async postFreeSwitchHeaders(headers: FreeSwitchEventHeaders): Promise<void> {
    await this.postProviderEvent(parseFreeSwitchEventHeaders(headers));
  }

  async postProviderEvent(event: ProviderCallEventDto): Promise<void> {
    const response = await fetch(this.providerEventsUrl(), {
      method: 'POST',
      headers: this.requestHeaders(),
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(this.timeoutMs()),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `provider event POST failed: HTTP ${response.status}${body ? ` ${body.slice(0, 1000)}` : ''}`,
      );
    }
  }

  private providerEventsUrl(): string {
    const baseUrl = cleanBaseUrl(
      process.env.INTERNAL_API_BASE_URL
        ?? process.env.API_BASE_URL
        ?? 'http://127.0.0.1:3000',
    );
    return `${baseUrl}/tasks/provider-events`;
  }

  private requestHeaders(): Record<string, string> {
    const token = process.env.SERVICE_API_TOKEN ?? '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-service-token': token,
    };

    if (process.env.SERVICE_API_REQUIRE_SIGNATURE?.toLowerCase() === 'true') {
      const timestamp = String(Date.now());
      headers['x-service-timestamp'] = timestamp;
      headers['x-service-signature'] = signServiceRequest(timestamp, token);
    }

    return headers;
  }

  private timeoutMs(): number {
    const configured = Number(process.env.FREESWITCH_EVENT_POST_TIMEOUT_MS ?? 10_000);
    if (!Number.isFinite(configured)) return 10_000;
    return Math.min(60_000, Math.max(1_000, configured));
  }
}

function cleanBaseUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/\/+$/, '');
}

function signServiceRequest(timestamp: string, token: string): string {
  const secret = process.env.SERVICE_API_SIGNING_SECRET || process.env.SERVICE_API_TOKEN || '';
  return createHmac('sha256', secret)
    .update(`${timestamp}.${token}`)
    .digest('hex');
}
