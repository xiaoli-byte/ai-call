'use client';

import { useEffect, useState } from 'react';

import { voiceAgentWsBaseUrl } from '@/lib/voice-agent-ws';

/**
 * 返回 voice-agent WS 基地址（供 demo 面板展示与连接）。
 *
 * 规避 SSR/CSR 水合不一致：首帧用 SSR 安全的确定值（env 或占位），挂载后再换成
 * 按当前页面协议（http→ws / https→wss）派生的实际地址。
 */
export function useVoiceAgentWsBaseUrl(): string {
  const [url, setUrl] = useState(() =>
    (process.env.NEXT_PUBLIC_VOICE_AGENT_WS_URL?.trim() || 'ws://localhost:8090').replace(/\/+$/, ''),
  );
  useEffect(() => {
    setUrl(voiceAgentWsBaseUrl());
  }, []);
  return url;
}
