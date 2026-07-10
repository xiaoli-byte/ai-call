import { Injectable } from '@nestjs/common';
import { connect } from 'node:net';
import type {
  PlatformComponent,
  PlatformHealthCheck,
  PlatformHealthStatus,
} from '@ai-call/shared';
import { envProvider } from './platform-utils.js';

@Injectable()
export class HealthChecksService {
  async getPlatformHealthChecks(): Promise<PlatformHealthCheck[]> {
    const checkedAt = new Date().toISOString();
    const sttProvider = envProvider('STT_PROVIDER', 'funasr');
    const voiceEndpoint = hostPortFromUrl(
      process.env.VOICE_AGENT_WS_URL
        ?? 'ws://' + (process.env.VOICE_AGENT_WS_HOST ?? '127.0.0.1')
          + ':' + (process.env.VOICE_AGENT_WS_PORT ?? 8090)
          + (process.env.VOICE_AGENT_WS_PATH ?? '/audio-stream'),
    );
    const [freeSwitch, eventWorker, voiceAgent, funasr] = await Promise.all([
      checkTcpHealth({
        component: 'telephony',
        name: 'FreeSWITCH ESL',
        host: process.env.FREESWITCH_ESL_HOST ?? '127.0.0.1',
        port: Number(process.env.FREESWITCH_ESL_PORT ?? 8021),
        checkedAt,
        action:
          'Start FreeSWITCH or fix FREESWITCH_ESL_HOST/FREESWITCH_ESL_PORT.',
      }).then((check) => {
        if (
          check.status === 'healthy'
          && process.env.FREESWITCH_AUDIO_FORK_ENABLED !== 'true'
        ) {
          return {
            ...check,
            status: 'degraded' as PlatformHealthStatus,
            message: 'ESL is reachable, but audio fork is disabled.',
            action:
              'Set FREESWITCH_AUDIO_FORK_ENABLED=true before real voice calls.',
          };
        }
        return check;
      }),
      checkHttpJsonHealth({
        component: 'telephony',
        name: 'FreeSWITCH Event Worker',
        url:
          'http://' + healthHost(
            process.env.FREESWITCH_EVENT_HEALTH_HOST ?? '127.0.0.1',
          )
          + ':' + (process.env.FREESWITCH_EVENT_HEALTH_PORT ?? 3012)
          + '/health/ready',
        checkedAt,
        action:
          'Run the FreeSWITCH event worker and confirm ESL subscription.',
        isReady: (body) => body.ready === true,
      }),
      checkHttpJsonHealth({
        component: 'voice_agent',
        name: 'Voice Agent',
        url:
          'http://' + healthHost(voiceEndpoint.host) + ':'
          + voiceEndpoint.port + '/health/ready',
        checkedAt,
        action:
          'Run pnpm dev:agent-py and confirm real TTS/ESL readiness.',
        isReady: (body) => body.ready === true,
      }),
      sttProvider === 'funasr'
        ? checkHttpJsonHealth({
            component: 'funasr',
            name: 'FunASR',
            url: httpHealthUrl(
              process.env.FUNASR_WS_URL ?? 'ws://127.0.0.1:10095',
              '/health',
            ),
            checkedAt,
            action: 'Run pnpm dev:funasr or update FUNASR_WS_URL.',
            isReady: (body) =>
              body.status === 'ok' && body.models_loaded === true,
          })
        : Promise.resolve<PlatformHealthCheck>({
            component: 'funasr',
            name: 'FunASR',
            status: sttProvider === 'mock' ? 'degraded' : 'unknown',
            message:
              'STT_PROVIDER=' + sttProvider
              + '; FunASR is not the active STT provider.',
            checkedAt,
            action: sttProvider === 'mock'
              ? 'Set STT_PROVIDER=funasr for local ASR calls.'
              : undefined,
          }),
    ]);

    const llmProvider = envProvider('LLM_PROVIDER', 'mock');
    const ttsProvider = envProvider('TTS_PROVIDER', 'mock');
    return [
      {
        component: 'database',
        name: 'PostgreSQL',
        status: 'healthy',
        message: 'Dashboard API can query product tables.',
        checkedAt,
      },
      {
        component: 'dashboard',
        name: 'Dashboard',
        status: 'healthy',
        message: 'Current request reached the dashboard API.',
        checkedAt,
      },
      freeSwitch,
      eventWorker,
      voiceAgent,
      funasr,
      {
        component: 'llm',
        name: 'LLM Provider',
        status: llmProvider === 'mock' ? 'degraded' : 'healthy',
        message: 'LLM_PROVIDER=' + llmProvider,
        checkedAt,
        action: llmProvider === 'mock'
          ? 'Configure a real LLM provider for production-like calls.'
          : undefined,
      },
      {
        component: 'tts',
        name: 'TTS Provider',
        status: ttsProvider === 'mock' ? 'degraded' : 'healthy',
        message: 'TTS_PROVIDER=' + ttsProvider,
        checkedAt,
        action: ttsProvider === 'mock'
          ? 'Configure TTS_PROVIDER for real voice playback.'
          : undefined,
      },
    ];
  }
}

function checkHttpJsonHealth(input: {
  component: PlatformComponent;
  name: string;
  url: string;
  checkedAt: string;
  action: string;
  isReady: (body: Record<string, unknown>) => boolean;
}): Promise<PlatformHealthCheck> {
  return fetch(input.url, { signal: AbortSignal.timeout(1_000) })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      const ready = response.ok
        && isPlainRecord(body)
        && input.isReady(body);
      return {
        component: input.component,
        name: input.name,
        status: ready ? 'healthy' : 'down',
        message: ready
          ? input.name + ' reports ready.'
          : input.name + ' is reachable but not ready.',
        checkedAt: input.checkedAt,
        action: ready ? undefined : input.action,
      } satisfies PlatformHealthCheck;
    })
    .catch(() => ({
      component: input.component,
      name: input.name,
      status: 'down',
      message: input.name + ' health endpoint is unreachable.',
      checkedAt: input.checkedAt,
      action: input.action,
    }));
}

function checkTcpHealth(input: {
  component: PlatformComponent;
  name: string;
  host: string;
  port: number;
  checkedAt: string;
  action: string;
}): Promise<PlatformHealthCheck> {
  const host = healthHost(input.host);
  if (!host || !Number.isFinite(input.port) || input.port <= 0) {
    return Promise.resolve({
      component: input.component,
      name: input.name,
      status: 'unknown',
      message: 'Endpoint is not configured.',
      checkedAt: input.checkedAt,
      action: input.action,
    });
  }
  return new Promise((resolve) => {
    const socket = connect(input.port, host);
    const done = (status: PlatformHealthStatus, message: string) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({
        component: input.component,
        name: input.name,
        status,
        message,
        checkedAt: input.checkedAt,
        action: status === 'healthy' ? undefined : input.action,
      });
    };
    socket.setTimeout(500);
    socket.once(
      'connect',
      () => done(
        'healthy',
        input.name + ' is reachable at ' + host + ':' + input.port + '.',
      ),
    );
    socket.once(
      'timeout',
      () => done(
        'down',
        input.name + ' timed out at ' + host + ':' + input.port + '.',
      ),
    );
    socket.once(
      'error',
      () => done(
        'down',
        input.name + ' is unreachable at ' + host + ':' + input.port + '.',
      ),
    );
  });
}

function hostPortFromUrl(raw: string): { host: string; port: number } {
  try {
    const url = new URL(raw);
    const defaultPort =
      url.protocol === 'wss:' || url.protocol === 'https:' ? 443 : 80;
    return {
      host: url.hostname,
      port: Number(url.port || defaultPort),
    };
  } catch {
    return { host: '', port: 0 };
  }
}

function httpHealthUrl(raw: string, path: string): string {
  try {
    const url = new URL(raw);
    const protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    return protocol + '//' + url.host + path;
  } catch {
    return 'http://127.0.0.1:0' + path;
  }
}

function healthHost(value: string): string {
  return value === '0.0.0.0' ? '127.0.0.1' : value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
