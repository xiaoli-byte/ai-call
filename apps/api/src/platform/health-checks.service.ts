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
    const sttProvider = envProvider('STT_PROVIDER', 'mock');
    const [freeSwitch, voiceAgent, funasr] = await Promise.all([
      checkTcpHealth({
        component: 'telephony',
        name: 'FreeSWITCH ESL',
        host: process.env.FREESWITCH_ESL_HOST ?? '127.0.0.1',
        port: Number(process.env.FREESWITCH_ESL_PORT ?? 8021),
        checkedAt,
        action: 'Start FreeSWITCH or fix FREESWITCH_ESL_HOST/FREESWITCH_ESL_PORT.',
      }).then((check) => {
        if (check.status === 'healthy' && process.env.FREESWITCH_AUDIO_FORK_ENABLED !== 'true') {
          return {
            ...check,
            status: 'degraded' as PlatformHealthStatus,
            message: 'ESL is reachable, but audio fork is disabled.',
            action: 'Set FREESWITCH_AUDIO_FORK_ENABLED=true before real voice streaming demos.',
          };
        }
        return check;
      }),
      checkTcpHealth({
        component: 'voice_agent',
        name: 'Voice Agent',
        ...hostPortFromUrl(
          process.env.VOICE_AGENT_WS_URL ??
            `ws://${process.env.VOICE_AGENT_WS_HOST ?? '127.0.0.1'}:${process.env.VOICE_AGENT_WS_PORT ?? 8080}${process.env.VOICE_AGENT_WS_PATH ?? '/audio-stream'}`,
        ),
        checkedAt,
        action: 'Run pnpm dev:agent-py and confirm VOICE_AGENT_WS_PORT.',
      }),
      sttProvider === 'funasr'
        ? checkTcpHealth({
            component: 'funasr',
            name: 'FunASR',
            ...hostPortFromUrl(process.env.FUNASR_WS_URL ?? 'ws://127.0.0.1:10095'),
            checkedAt,
            action: 'Run pnpm dev:funasr or update FUNASR_WS_URL.',
          })
        : Promise.resolve<PlatformHealthCheck>({
            component: 'funasr',
            name: 'FunASR',
            status: sttProvider === 'mock' ? 'degraded' : 'unknown',
            message: `STT_PROVIDER=${sttProvider}; FunASR is not the active STT provider.`,
            checkedAt,
            action: sttProvider === 'mock' ? 'Set STT_PROVIDER=funasr for local ASR demos.' : undefined,
          }),
    ]);

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
      voiceAgent,
      funasr,
      {
        component: 'llm',
        name: 'LLM Provider',
        status: envProvider('LLM_PROVIDER', 'mock') === 'mock' ? 'degraded' : 'healthy',
        message: `LLM_PROVIDER=${envProvider('LLM_PROVIDER', 'mock')}`,
        checkedAt,
        action: envProvider('LLM_PROVIDER', 'mock') === 'mock'
          ? 'Configure LLM_PROVIDER and provider API key for production-like calls.'
          : undefined,
      },
      {
        component: 'tts',
        name: 'TTS Provider',
        status: envProvider('TTS_PROVIDER', 'mock') === 'mock' ? 'degraded' : 'healthy',
        message: `TTS_PROVIDER=${envProvider('TTS_PROVIDER', 'mock')}`,
        checkedAt,
        action: envProvider('TTS_PROVIDER', 'mock') === 'mock'
          ? 'Configure TTS_PROVIDER for real voice playback.'
          : undefined,
      },
    ];
  }
}

function checkTcpHealth(input: {
  component: PlatformComponent;
  name: string;
  host: string;
  port: number;
  checkedAt: string;
  action: string;
}): Promise<PlatformHealthCheck> {
  const host = input.host === '0.0.0.0' ? '127.0.0.1' : input.host;
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
    socket.once('connect', () => done('healthy', `${input.name} is reachable at ${host}:${input.port}.`));
    socket.once('timeout', () => done('down', `${input.name} timed out at ${host}:${input.port}.`));
    socket.once('error', (error) => done('down', `${input.name} is unreachable at ${host}:${input.port}: ${error.message}`));
  });
}

function hostPortFromUrl(raw: string): { host: string; port: number } {
  try {
    const url = new URL(raw);
    const defaultPort = url.protocol === 'wss:' || url.protocol === 'https:' ? 443 : 80;
    return { host: url.hostname, port: Number(url.port || defaultPort) };
  } catch {
    return { host: '', port: 0 };
  }
}
