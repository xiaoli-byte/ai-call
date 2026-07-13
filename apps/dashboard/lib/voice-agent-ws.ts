/**
 * voice-agent WebSocket 基地址解析（浏览器侧）。
 *
 * 两条铁律：
 * 1. 协议随页面派生——https 页面上 `ws://` 会被浏览器按「混合内容」拦截，只能 `wss://`。
 * 2. 生产不带显式端口——生产由 nginx 反向代理按路径（/audio-stream 等）转发到 voice-agent，
 *    浏览器只连同源标准端口（wss://域名 → 443），绝不能出现 `:8090`。
 *
 * 解析优先级：
 * - 配置了 `NEXT_PUBLIC_VOICE_AGENT_WS_URL` → 采用之（生产若走独立子域/自定义前缀时显式配，
 *   如 wss://voice.example.com 或 wss://app.example.com/voice-ws）；仅当页面 https 且配置写
 *   ws:// 时升级为 wss://（不降级已配置的 wss://）。
 * - 未配置 + 本地开发（localhost/127.0.0.1）→ voice-agent 独立跑在 8090，与页面（:3000）
 *   不同源，直连 `<ws|wss>://<hostname>:8090`。
 * - 未配置 + 其它主机（生产域名）→ 同源、不带端口 `<ws|wss>://<host>`，交给 nginx 按路径转发。
 * - 服务端渲染（无 window）→ 占位 `ws://localhost:8090`，实际连接在浏览器发起。
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

  if (!isBrowser) return 'ws://localhost:8090';

  const wsProto = pageIsHttps ? 'wss:' : 'ws:';
  const { hostname, host } = window.location;
  // 本地开发：voice-agent 独立监听 8090，与页面不同源，需显式端口直连。
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${wsProto}//${hostname}:8090`;
  }
  // 生产：同源，端口交给 nginx（标准 443/80），按路径反向代理到 voice-agent，不拼 :8090。
  return `${wsProto}//${host}`;
}
