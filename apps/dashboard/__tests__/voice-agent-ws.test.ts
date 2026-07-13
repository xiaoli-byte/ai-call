import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { voiceAgentWsBaseUrl } from '@/lib/voice-agent-ws';

const ENV_KEY = 'NEXT_PUBLIC_VOICE_AGENT_WS_URL';
const originalLocation = window.location;
const originalEnv = process.env[ENV_KEY];

function setLocation(protocol: string, hostname: string, host?: string): void {
  Object.defineProperty(window, 'location', {
    value: { protocol, hostname, host: host ?? hostname },
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

  it('本地 http 开发未配置时直连 ws://localhost:8090', () => {
    setLocation('http:', 'localhost', 'localhost:3000');
    expect(voiceAgentWsBaseUrl()).toBe('ws://localhost:8090');
  });

  it('本地 https 开发未配置时直连 wss://localhost:8090', () => {
    setLocation('https:', '127.0.0.1', '127.0.0.1:3000');
    expect(voiceAgentWsBaseUrl()).toBe('wss://127.0.0.1:8090');
  });

  it('生产 https 未配置时同源、不带端口（由 nginx 反向代理转发）', () => {
    setLocation('https:', 'app.example.com', 'app.example.com');
    expect(voiceAgentWsBaseUrl()).toBe('wss://app.example.com');
  });

  it('生产同源保留页面的非标准端口', () => {
    setLocation('https:', 'app.example.com', 'app.example.com:8443');
    expect(voiceAgentWsBaseUrl()).toBe('wss://app.example.com:8443');
  });

  it('https 页面把配置里的 ws:// 升级为 wss://（避免混合内容被拦截）', () => {
    setLocation('https:', 'app.example.com', 'app.example.com');
    setEnv('ws://voice.internal:9000');
    expect(voiceAgentWsBaseUrl()).toBe('wss://voice.internal:9000');
  });

  it('http 页面不降级已配置的 wss://', () => {
    setLocation('http:', 'localhost', 'localhost:3000');
    setEnv('wss://voice.example.com');
    expect(voiceAgentWsBaseUrl()).toBe('wss://voice.example.com');
  });

  it('配置带路径前缀时原样保留（供 nginx 按前缀转发）', () => {
    setLocation('https:', 'app.example.com', 'app.example.com');
    setEnv('wss://app.example.com/voice-ws');
    expect(voiceAgentWsBaseUrl()).toBe('wss://app.example.com/voice-ws');
  });

  it('去除配置末尾多余斜杠', () => {
    setLocation('http:', 'localhost', 'localhost:3000');
    setEnv('ws://voice.internal:9000/');
    expect(voiceAgentWsBaseUrl()).toBe('ws://voice.internal:9000');
  });
});
