/**
 * WebCallClient — 浏览器模拟外呼的 voice-agent WebSocket 客户端
 *
 * 对接 voice-agent 生产端点 `/audio-stream`（浏览器扮演 FreeSWITCH 角色）：
 *   1. 连接后首帧发送 JSON metadata（dialog_id=attemptId、channel:"web"、
 *      audio_response_format:"raw-pcm"，可选 token）；
 *   2. 之后上行为裸二进制 PCM（16kHz mono s16le）；
 *   3. 下行二进制帧 = 音频（16k s16le，交给上层排队播放），
 *      文本帧 = JSON 字幕/事件（agent_speech / caller_speech / end / error / clear_audio）。
 *
 * 契约见 docs/superpowers/specs/2026-07-10-voice-test-call-design.md §3。
 * 注意：与 lib/voice-agent-client.ts（demo 端点 /asr-stream、/tts-stream）无关。
 */

import { voiceAgentWsBaseUrl } from './voice-agent-ws';

const VOICE_AGENT_WS_TOKEN = process.env.NEXT_PUBLIC_VOICE_AGENT_WS_TOKEN;

/** WebSocket readyState 常量（不依赖全局 WebSocket 静态属性，便于测试 mock） */
const WS_CONNECTING = 0;
const WS_OPEN = 1;

/** 首帧 metadata（契约 §3） */
export interface WebCallMetadata {
  /** 会话标识：dispatch 返回的 attemptId */
  dialog_id: string;
  /** 任务 from 号码，可省 */
  caller_id?: string;
  /** web 通道标记：voice-agent 据此回推字幕文本帧 */
  channel: 'web';
  /** 浏览器直接播放裸 PCM */
  audio_response_format: 'raw-pcm';
  /** VOICE_AGENT_WS_TOKEN 鉴权；未配置则省略 */
  token?: string;
}

/** 构造首帧 metadata。token 缺省读 NEXT_PUBLIC_VOICE_AGENT_WS_TOKEN，未配置则不带该字段。 */
export function buildCallMetadata(
  attemptId: string,
  options: { callerId?: string; token?: string } = {},
): WebCallMetadata {
  const metadata: WebCallMetadata = {
    dialog_id: attemptId,
    channel: 'web',
    audio_response_format: 'raw-pcm',
  };
  if (options.callerId) {
    metadata.caller_id = options.callerId;
  }
  const token = options.token ?? VOICE_AGENT_WS_TOKEN;
  if (token) {
    metadata.token = token;
  }
  return metadata;
}

/** 服务端文本帧（契约 §2/§3） */
export type WebCallServerEvent =
  | { type: 'agent_speech'; text: string }
  | { type: 'caller_speech'; text: string }
  | { type: 'end'; reason?: string }
  | { type: 'error'; message?: string }
  | { type: 'clear_audio' };

export interface WebCallClientCallbacks {
  /** 下行二进制音频帧（16kHz mono s16le） */
  onAudio?: (pcm: ArrayBuffer) => void;
  /** 下行文本帧（字幕 / 会话事件） */
  onEvent?: (event: WebCallServerEvent) => void;
  /** 连接建立后异常关闭（用户主动 close() 不触发） */
  onClose?: (info: { code?: number; reason?: string }) => void;
  /** 连接建立后的传输错误 */
  onError?: (error: Error) => void;
}

export interface WebCallClientConfig {
  metadata: WebCallMetadata;
  /** 完整 WS 端点；缺省 `${NEXT_PUBLIC_VOICE_AGENT_WS_URL}/audio-stream` */
  serverUrl?: string;
}

export class WebCallClient {
  private ws: WebSocket | null = null;
  private readonly metadata: WebCallMetadata;
  private readonly serverUrl: string;
  private readonly callbacks: WebCallClientCallbacks;

  constructor(config: WebCallClientConfig, callbacks: WebCallClientCallbacks = {}) {
    this.metadata = config.metadata;
    // 惰性解析（构造时在浏览器运行）：WS 前缀随页面协议派生（https→wss），不硬编码。
    this.serverUrl = config.serverUrl ?? `${voiceAgentWsBaseUrl()}/audio-stream`;
    this.callbacks = callbacks;
  }

  /** 建立连接：onopen 时发送首帧 metadata 后 resolve */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.serverUrl);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('无法连接语音服务'));
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      let settled = false;

      ws.onopen = () => {
        ws.send(JSON.stringify(this.metadata));
        settled = true;
        resolve();
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('无法连接语音服务，请确认 voice-agent 已启动'));
        } else {
          this.callbacks.onError?.(new Error('语音连接出现异常'));
        }
      };

      ws.onclose = (event: CloseEvent) => {
        if (!settled) {
          settled = true;
          reject(new Error('语音连接建立前被关闭'));
          return;
        }
        this.callbacks.onClose?.({ code: event?.code, reason: event?.reason });
      };

      ws.onmessage = (event: MessageEvent) => {
        const { data } = event;
        if (typeof data === 'string') {
          let parsed: WebCallServerEvent;
          try {
            parsed = JSON.parse(data) as WebCallServerEvent;
          } catch {
            return; // 忽略非法文本帧
          }
          this.callbacks.onEvent?.(parsed);
          return;
        }
        if (data instanceof ArrayBuffer && data.byteLength > 0) {
          this.callbacks.onAudio?.(data);
        }
      };
    });
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WS_OPEN;
  }

  /** 上行二进制 PCM（16kHz mono s16le；未连接时静默丢弃） */
  sendAudio(pcm: ArrayBuffer): void {
    if (this.ws && this.ws.readyState === WS_OPEN && pcm.byteLength > 0) {
      this.ws.send(pcm);
    }
  }

  /** 主动关闭（挂断/卸载）：先摘除回调，避免触发 onClose 二次状态迁移 */
  close(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    if (ws.readyState === WS_CONNECTING || ws.readyState === WS_OPEN) {
      try {
        ws.close();
      } catch {
        // 忽略重复关闭
      }
    }
  }
}
