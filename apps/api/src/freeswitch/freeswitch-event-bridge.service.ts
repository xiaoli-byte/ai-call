import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { ProviderActiveSnapshotDto } from '../tasks/dto/provider-active-snapshot.dto.js';
import type { ProviderCallEventDto } from '../tasks/dto/provider-call-event.dto.js';
import {
  parseFreeSwitchEventHeaders,
  type FreeSwitchEventHeaders,
} from './freeswitch-event-parser.js';

export class FreeSwitchBridgeError extends Error {
  readonly name = 'FreeSwitchBridgeError';

  constructor(
    readonly operation: 'provider-event' | 'active-snapshot',
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(
      'FreeSWITCH bridge ' + operation + ' failed'
      + (status ? ' (HTTP ' + status + ')' : ''),
    );
  }
}

@Injectable()
export class FreeSwitchEventBridgeService {
  async postFreeSwitchHeaders(headers: FreeSwitchEventHeaders): Promise<void> {
    await this.postProviderEvent(parseFreeSwitchEventHeaders(headers));
  }

  async postProviderEvent(event: ProviderCallEventDto): Promise<void> {
    await this.postJson(
      this.providerEventsUrl(),
      event,
      'provider-event',
    );
  }

  async postActiveSnapshot(snapshot: ProviderActiveSnapshotDto): Promise<void> {
    await this.postJson(
      this.activeSnapshotsUrl(),
      snapshot,
      'active-snapshot',
    );
  }

  private async postJson(
    url: string,
    body: unknown,
    operation: 'provider-event' | 'active-snapshot',
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.requestHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch {
      throw new FreeSwitchBridgeError(operation, true);
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new FreeSwitchBridgeError(
        operation,
        isRetryableStatus(response.status),
        response.status,
      );
    }
  }

  private providerEventsUrl(): string {
    return this.apiUrl('/tasks/provider-events');
  }

  private activeSnapshotsUrl(): string {
    return this.apiUrl('/tasks/provider-active-snapshots');
  }

  private apiUrl(path: string): string {
    const baseUrl = cleanBaseUrl(
      process.env.INTERNAL_API_BASE_URL
        ?? process.env.API_BASE_URL
        ?? 'http://127.0.0.1:3000',
    );
    return baseUrl + path;
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
  return value.trim().replace(/\/+$/, '');
}

function signServiceRequest(timestamp: string, token: string): string {
  const secret = process.env.SERVICE_API_SIGNING_SECRET
    || process.env.SERVICE_API_TOKEN
    || '';
  return createHmac('sha256', secret)
    .update(timestamp + '.' + token)
    .digest('hex');
}

function isRetryableStatus(status: number): boolean {
  return status === 404
    || status === 408
    || status === 409
    || status === 425
    || status === 429
    || status >= 500;
}
