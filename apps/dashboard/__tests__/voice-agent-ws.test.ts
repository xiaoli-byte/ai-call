import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { voiceAgentWsBaseUrl } from '@/lib/voice-agent-ws';

const ENV_KEY = 'NEXT_PUBLIC_VOICE_AGENT_WS_URL';
const originalLocation = window.location;
const originalEnv = process.env[ENV_KEY];

function setLocation(protocol: string, hostname: string): void {
  Object.defineProperty(window, 'location', {
    value: { protocol, hostname },
    writable: true,
    configurable: true,
  });
}

function setEnv(value: string | undefined): void {
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
}

describe('voiceAgentWsBaseUrl', () => {
  beforeEach(() => {
    setEnv(undefined);
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    setEnv(originalEnv);
  });

  it('未配置时 http 页面派生 ws:// + 当前主机 + 8090', () => {
    setLocation('http:', 'localhost');
    expect(voiceAgentWsBaseUrl()).toBe('ws://localhost:8090');
  });

  it('未配置时 https 页面派生 wss:// + 当前主机 + 8090', () => {
    setLocation('https:', 'app.example.com');
    expect(voiceAgentWsBaseUrl()).toBe('wss://app.example.com:8090');
  });

  it('https 页面把配置里的 ws:// 升级为 wss://（避免混合内容被拦截）', () => {
    setLocation('https:', 'app.example.com');
    setEnv('ws://voice.internal:9000');
    expect(voiceAgentWsBaseUrl()).toBe('wss://voice.internal:9000');
  });

  it('http 页面不降级已配置的 wss://', () => {
    setLocation('http:', 'localhost');
    setEnv('wss://voice.example.com');
    expect(voiceAgentWsBaseUrl()).toBe('wss://voice.example.com');
  });

  it('去除配置末尾多余斜杠', () => {
    setLocation('http:', 'localhost');
    setEnv('ws://voice.internal:9000/');
    expect(voiceAgentWsBaseUrl()).toBe('ws://voice.internal:9000');
  });
});
