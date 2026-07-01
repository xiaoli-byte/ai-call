/**
 * Voice Agent 浏览器端 WebSocket 客户端
 *
 * 对接 Python Voice Agent 后端的 /asr-stream 和 /tts-stream 端点，
 * 复用后端的 WebRTC VAD + FunASR + Qwen-TTS，而非浏览器直连各服务。
 *
 * 协议见 services/voice-agent/src/voice_agent/demo_server.py
 */

// ─── ASRStreamClient ───

/** ASR 连接状态 */
export type ASRConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** ASR 客户端配置 */
export interface ASRStreamConfig {
  serverUrl: string;
  mode?: 'online' | 'offline' | '2pass';
  hotwords?: string;
  maxRetries?: number;
  reconnectInterval?: number;
}

/** ASR 回调集合 */
export interface ASRStreamCallbacks {
  onResult?: (result: { type: 'partial' | 'final'; text: string }) => void;
  onVadState?: (isSpeaking: boolean) => void;
  onStatusChange?: (state: ASRConnectionState) => void;
  onError?: (error: Error) => void;
}

const ASR_DEFAULTS: Required<Omit<ASRStreamConfig, 'serverUrl'>> = {
  mode: '2pass',
  hotwords: '',
  maxRetries: 3,
  reconnectInterval: 3000,
};

export class ASRStreamClient {
  private config: Required<ASRStreamConfig>;
  private callbacks: ASRStreamCallbacks;
  private ws: WebSocket | null = null;
  private state: ASRConnectionState = 'disconnected';
  private retryCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isReady = false;
  private intentionallyClosed = false;

  constructor(config: ASRStreamConfig, callbacks: ASRStreamCallbacks = {}) {
    this.config = { ...ASR_DEFAULTS, ...config };
    this.callbacks = callbacks;
  }

  get connectionState(): ASRConnectionState {
    return this.state;
  }

  get ready(): boolean {
    return this.isReady;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        resolve();
        return;
      }

      this.intentionallyClosed = false;
      this.setState('connecting');

      try {
        this.ws = new WebSocket(this.config.serverUrl);
        this.ws.binaryType = 'arraybuffer';
      } catch (err) {
        this.setState('error');
        reject(new Error(`WebSocket 创建失败: ${(err as Error).message}`));
        return;
      }

      this.ws.onopen = () => {
        this.retryCount = 0;
        this.isReady = true;
        this.setState('connected');
        this.sendConfig();
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event);
      };

      this.ws.onerror = () => {
        this.setState('error');
        this.callbacks.onError?.(new Error('WebSocket 连接错误'));
      };

      this.ws.onclose = () => {
        this.isReady = false;
        if (!this.intentionallyClosed && this.retryCount < this.config.maxRetries) {
          this.scheduleReconnect();
        } else {
          this.setState('disconnected');
        }
      };

      const timeout = setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
          this.setState('error');
          reject(new Error('连接超时（5s），请确认 Voice Agent 服务已启动'));
        }
      }, 5000);

      this.ws.addEventListener('open', () => clearTimeout(timeout));
    });
  }

  sendAudio(pcm: ArrayBuffer): void {
    if (this.isReady && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(pcm);
    }
  }

  endSpeech(): void {
    if (!this.isReady || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ is_speaking: false }));
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isReady = false;
    this.setState('disconnected');
  }

  private setState(state: ASRConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks.onStatusChange?.(state);
  }

  private sendConfig(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const config: Record<string, unknown> = {
      mode: this.config.mode,
      hotwords: this.config.hotwords,
    };
    this.ws.send(JSON.stringify(config));
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;
    let parsed: { type?: string; text?: string; is_speaking?: boolean; message?: string };
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }

    const msgType = parsed.type;
    if (!msgType) return;

    if (msgType === 'partial' || msgType === 'final') {
      this.callbacks.onResult?.({ type: msgType, text: parsed.text ?? '' });
    } else if (msgType === 'vad_state') {
      this.callbacks.onVadState?.(parsed.is_speaking ?? false);
    } else if (msgType === 'error') {
      this.callbacks.onError?.(new Error(parsed.message ?? '未知错误'));
    }
  }

  private scheduleReconnect(): void {
    this.retryCount++;
    this.setState('reconnecting');
    const delay = this.config.reconnectInterval * this.retryCount;
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {});
    }, Math.min(delay, 15000));
  }
}

// ─── TTSStreamClient ───

/** TTS 连接状态 */
export type TTSConnectionState = 'idle' | 'synthesizing' | 'error';

/** TTS 客户端配置 */
export interface TTSStreamConfig {
  serverUrl: string;
  sampleRate?: number;
  timeout?: number;
}

/** TTS 回调集合 */
export interface TTSStreamCallbacks {
  onChunk?: (chunk: { audio: ArrayBuffer; isFinal: boolean }) => void;
  onStatusChange?: (state: TTSConnectionState) => void;
  onError?: (error: Error) => void;
}

const TTS_DEFAULTS: Required<Omit<TTSStreamConfig, 'serverUrl'>> = {
  sampleRate: 16000,
  timeout: 30000,
};

export class TTSStreamClient {
  private config: Required<TTSStreamConfig>;
  private callbacks: TTSStreamCallbacks;
  private ws: WebSocket | null = null;
  private _isSynthesizing = false;
  private synthResolve: (() => void) | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: TTSStreamConfig, callbacks: TTSStreamCallbacks = {}) {
    this.config = { ...TTS_DEFAULTS, ...config };
    this.callbacks = callbacks;
  }

  get isSynthesizing(): boolean {
    return this._isSynthesizing;
  }

  get sampleRate(): number {
    return this.config.sampleRate;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.serverUrl);
        this.ws.binaryType = 'arraybuffer';
      } catch (err) {
        reject(new Error(`WebSocket 创建失败: ${(err as Error).message}`));
        return;
      }

      this.ws.onopen = () => resolve();

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event);
      };

      this.ws.onerror = () => {
        this.callbacks.onError?.(new Error('TTS WebSocket 连接错误'));
        reject(new Error('TTS WebSocket 连接错误'));
      };

      this.ws.onclose = () => {
        if (this._isSynthesizing) {
          this.finishSynthesis();
        }
      };

      const timeout = setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
          reject(new Error('TTS 连接超时（5s）'));
        }
      }, 5000);

      this.ws.addEventListener('open', () => clearTimeout(timeout));
    });
  }

  async synthesize(
    text: string,
    options: { speaker?: string; instructText?: string } = {},
  ): Promise<void> {
    if (!text.trim()) return;

    // 确保连接已建立
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    if (this._isSynthesizing) {
      this.interrupt();
    }

    this._isSynthesizing = true;
    this.callbacks.onStatusChange?.('synthesizing');

    const request = {
      text,
      speaker: options.speaker,
      instruct_text: options.instructText,
    };
    this.ws!.send(JSON.stringify(request));

    // 超时处理
    this.timeoutTimer = setTimeout(() => {
      if (this._isSynthesizing) {
        this.interrupt();
        this.callbacks.onError?.(new Error('TTS 合成超时'));
      }
    }, this.config.timeout);

    // 等待合成完成（由 final 消息 resolve）
    return new Promise((resolve) => {
      this.synthResolve = resolve;
    });
  }

  interrupt(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'cancel' }));
    }
    this.finishSynthesis();
  }

  disconnect(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._isSynthesizing = false;
    this.synthResolve = null;
  }

  private handleMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer) {
      // 二进制 PCM 音频
      if (event.data.byteLength > 0) {
        this.callbacks.onChunk?.({ audio: event.data, isFinal: false });
      }
    } else if (typeof event.data === 'string') {
      let parsed: { type?: string };
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (parsed.type === 'final') {
        this.callbacks.onChunk?.({ audio: new ArrayBuffer(0), isFinal: true });
        this.finishSynthesis();
      }
    }
  }

  private finishSynthesis(): void {
    this._isSynthesizing = false;
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.callbacks.onStatusChange?.('idle');
    if (this.synthResolve) {
      this.synthResolve();
      this.synthResolve = null;
    }
  }
}
