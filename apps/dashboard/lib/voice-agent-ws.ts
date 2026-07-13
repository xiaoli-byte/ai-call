/**
 * voice-agent WebSocket 基地址解析（浏览器侧）。
 *
 * 关键：WS 协议必须随当前页面协议派生——https 页面上 `ws://` 会被浏览器按
 * 「混合内容」拦截，只能用 `wss://`；http 页面用 `ws://`。因此不能硬编码前缀。
 *
 * 解析规则：
 * - 配置了 `NEXT_PUBLIC_VOICE_AGENT_WS_URL`（生产显式配置，如 wss://voice.example.com）
 *   → 采用之；仅当页面为 https 且配置写的是 ws:// 时升级为 wss://（不降级已配置的 wss://）。
 * - 未配置 → host 取当前页面主机，端口默认 8090（voice-agent 监听端口），
 *   协议随页面。
 * - 服务端渲染（无 window）→ 回退 `ws://localhost:8090`，仅用于占位，实际连接在浏览器发起。
 */
export function voiceAgentWsBaseUrl(): string {
  const isBrowser = typeof window !== 'undefined';
  const pageIsHttps = isBrowser && window.location.protocol === 'https:';
  const configured = process.env.NEXT_PUBLIC_VOICE_AGENT_WS_URL?.trim();

  if (configured) {
    try {
      const url = new URL(configured);
      // 仅升级：https 页面上的 ws:// 会被拦截，改 wss://；已配置的 wss:// 不动。
      if (pageIsHttps && url.protocol === 'ws:') url.protocol = 'wss:';
      return url.toString().replace(/\/+$/, '');
    } catch {
      const upgraded = pageIsHttps ? configured.replace(/^ws:\/\//i, 'wss://') : configured;
      return upgraded.replace(/\/+$/, '');
    }
  }

  const wsProto = pageIsHttps ? 'wss:' : 'ws:';
  const host = isBrowser ? window.location.hostname || 'localhost' : 'localhost';
  return `${wsProto}//${host}:8090`;
}
