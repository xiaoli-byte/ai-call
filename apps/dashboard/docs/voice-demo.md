# 语音交互演示 — 组件文档与部署指南

## 概述

语音交互演示页面复用 **Python Voice Agent** 后端的音频网关能力，
提供开箱即用的浏览器端语音交互体验：

- **VAD**：Python WebRTC VAD（服务端，前置门控）
- **ASR**：FunASR 流式语音识别（由 Python 后端代理连接）
- **TTS**：Qwen-TTS 云端流式语音合成（阿里云 DashScope）

前端仅负责麦克风采集、PCM 转发、音频播放，所有音频处理（VAD/ASR/TTS）均在 Python 后端完成，
与生产外呼链路共享同一套代码，确保 Demo 行为与生产一致。

**访问路径**：`http://localhost:3000/voice-demo`

## ⚠️ 适用范围

本页面用于**浏览器 Demo / 网页测试**，复用 Python 音频网关的 VAD + FunASR + Qwen-TTS。

- **前端 Demo 链路**：浏览器麦克风 → WebSocket `/asr-stream` → Python WebRTC VAD → FunASR
- **生产外呼链路**：FreeSWITCH mod_audio_fork → WebSocket `/audio-stream` → Python WebRTC VAD → FunASR
- 两条链路共享 Python 后端的 VAD/STT/TTS 代码，但会话隔离
- 前端 `useAudioRecorder.enableVAD` 默认为 `false`，VAD 完全由服务端处理

详见项目根 [`docs/vad-architecture.md`](../../../docs/vad-architecture.md)。

---

## 目录结构

```
apps/dashboard/
├── app/voice-demo/page.tsx              # 演示页面路由
├── hooks/
│   ├── useASR.ts                        # ASR Hook（/asr-stream 集成）
│   ├── useTTS.ts                        # TTS Hook（/tts-stream 集成）
│   └── useAudioRecorder.ts              # 麦克风采集 Hook（VAD 默认关闭）
├── lib/
│   ├── audio-utils.ts                   # 音频处理工具（PCM 转换、重采样）
│   └── voice-agent-client.ts            # Voice Agent WebSocket 客户端（ASRStreamClient + TTSStreamClient）
├── components/voice-demo/
│   ├── VoiceDemo.tsx                    # 主容器（整合 ASR + TTS）
│   ├── ASRPanel.tsx                     # 语音识别面板
│   ├── TTSPanel.tsx                     # 语音合成面板
│   ├── AudioVisualizer.tsx              # 音量可视化
│   └── StatusBadge.tsx                  # 状态指示器
├── __tests__/
│   ├── audio-utils.test.ts              # 工具函数测试（16 个）
│   ├── useASR.test.ts                   # ASR Hook 测试（6 个）
│   └── useTTS.test.ts                   # TTS Hook 测试（10 个）
└── vitest.config.ts                     # 测试配置
```

---

## Hook API

### useASR

实时流式语音识别 Hook，通过 Python 后端 `/asr-stream` 端点复用 WebRTC VAD + FunASR。
前端仅采集麦克风音频并转发，VAD 和 ASR 均在服务端处理。

```typescript
import { useASR } from '@/hooks/useASR';

function MyComponent() {
  const {
    state,          // 'idle' | 'connecting' | 'listening' | 'reconnecting' | 'error'
    isListening,    // boolean
    partialText,    // 实时中间结果
    finalTexts,     // 已确认的完整句子数组
    error,          // string | null
    audioLevel,     // 0.0 ~ 1.0
    isSpeaking,     // 服务端 VAD 检测到说话中
    start,          // () => Promise<void>
    stop,           // () => void
    endSentence,    // () => void — 手动触发当前句子的 final
    clear,          // () => void — 清空结果
  } = useASR();

  return <button onClick={start}>开始识别</button>;
}
```

**配置选项**：

```typescript
useASR({
  serverUrl: 'ws://localhost:8090/asr-stream',  // Voice Agent /asr-stream 端点
  mode: '2pass',                                // online | offline | 2pass
  hotwords: '还款 50 逾期 50',                  // 热词
  recorder: {
    enableVAD: false,  // VAD 在服务端，前端关闭
  },
});
```

> VAD 参数（threshold/speechFrames/silenceFrames）由 Python 后端环境变量配置，
> 前端不再支持运行时调整。详见 [`docs/vad-architecture.md`](../../../docs/vad-architecture.md) 第 5 节。

### useTTS

流式语音合成 Hook，通过 Python 后端 `/tts-stream` 端点使用 Qwen-TTS Realtime 云端合成，
前端接收流式 PCM 数据并通过 Web Audio API 边收边播。

```typescript
import { useTTS } from '@/hooks/useTTS';

function MyComponent() {
  const {
    state,              // 'idle' | 'synthesizing' | 'playing' | 'error'
    isBusy,             // boolean
    error,              // string | null
    voiceParams,        // { volume, speaker, instructText? }
    updateVoiceParams,  // (params) => void
    speak,              // (text: string) => Promise<void>
    stop,               // () => void — 中断合成和播放
  } = useTTS();

  return (
    <button onClick={() => speak('你好世界')}>播放</button>
  );
}
```

> Qwen-TTS Realtime 不支持语速（speed）控制，`VoiceParams` 已移除 `speed` 字段。
> 支持的说话人：Cherry（女声）/ Serena（女声）/ Ethan（男声）/ Chelsie（女声）。

### useAudioRecorder

底层麦克风采集 Hook，可独立使用。VAD 默认关闭（由 Python 后端处理）。

```typescript
import { useAudioRecorder } from '@/hooks/useAudioRecorder';

const {
  isRecording,
  audioLevel,
  isSpeaking,      // VAD 状态（enableVAD=false 时恒为 false）
  start,
  stop,
  onAudioFrame,    // (callback) => void — 注册 PCM 数据回调
  onSpeechEnd,     // (callback) => void — 注册 VAD 说话结束回调
} = useAudioRecorder({
  enableVAD: false,  // 默认 false，VAD 在 Python 后端
  // vad: { threshold: 0.03, speechFrames: 3, silenceFrames: 15 },  // 仅 enableVAD=true 时生效
});
```

---

## 组件 API

### VoiceDemo

主容器组件，整合 ASR 和 TTS 面板，支持语音联动模式。

```tsx
import { VoiceDemo } from '@/components/voice-demo/VoiceDemo';

// 直接使用（无 props）
<VoiceDemo />
```

### ASRPanel

独立的语音识别面板，接收 `useASR` 返回值作为 props。

```tsx
import { ASRPanel } from '@/components/voice-demo/ASRPanel';
import { useASR } from '@/hooks/useASR';

function MyPage() {
  const asr = useASR();
  return <ASRPanel asr={asr} />;
}
```

### TTSPanel

独立的语音合成面板，接收 `useTTS` 返回值作为 props。

```tsx
import { TTSPanel } from '@/components/voice-demo/TTSPanel';
import { useTTS } from '@/hooks/useTTS';

function MyPage() {
  const tts = useTTS();
  return <TTSPanel tts={tts} />;
}
```

### AudioVisualizer

音量可视化组件。

```tsx
import { AudioVisualizer } from '@/components/voice-demo/AudioVisualizer';

<AudioVisualizer level={0.5} active={true} bars={24} />
```

### StatusBadge

状态指示器。

```tsx
import { StatusBadge } from '@/components/voice-demo/StatusBadge';

<StatusBadge label="ASR" status="listening" />
```

---

## 部署指南

### 1. 启动 FunASR（语音识别）

FunASR 由 Python Voice Agent 后端连接，前端不直连。

```bash
# Docker 一键启动（CPU 版本）
docker run -d \
  --name funasr \
  -p 10095:10095 \
  registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-online-cpu-0.1.12
```

验证：浏览器访问 `ws://localhost:10095` 应能建立 WebSocket 连接。

### 2. 启动 Python Voice Agent（VAD + ASR 代理 + TTS 代理）

Python Voice Agent 提供 `/asr-stream`（VAD + FunASR）和 `/tts-stream`（Qwen-TTS）端点。

```powershell
cd services/voice-agent

# 安装依赖（含 Qwen-TTS 可选依赖）
pip install -e ".[dev,tts-qwen]"

# 配置环境变量
cp .env.example .env
# 编辑 .env，至少填写：
#   TTS_PROVIDER=qwen
#   DASHSCOPE_API_KEY=<你的阿里云 DashScope API Key>
#   FUNASR_WS_URL=ws://localhost:10095

# 启动 WebSocket 服务（默认端口 8090）
python -m voice_agent.main
```

验证：日志输出 `[VoiceAgentServer] listening on ws://0.0.0.0:8090 (paths: /audio-stream, /asr-stream, /tts-stream)`。

### 3. 配置前端环境变量

在 `apps/dashboard/.env.local` 中配置：

```ini
# Voice Agent WebSocket（Python 后端，含 /audio-stream + /asr-stream + /tts-stream）
# 不配置时：本地(localhost/127.0.0.1)按页面协议直连 <ws|wss>://<host>:8090；
# 生产同源、不带端口（<ws|wss>://<域名>），由 nginx 按路径反向代理转发到 voice-agent。
# 仅当走独立子域/自定义前缀时才显式配（如 wss://voice.example.com、wss://app.example.com/voice-ws）。
# 生产 nginx 需为 /audio-stream、/asr-stream、/tts-stream 配 WebSocket upgrade + proxy_pass 到 :8090。
NEXT_PUBLIC_VOICE_AGENT_WS_URL=ws://localhost:8090

# FunASR（仅用于显示，实际连接由 Python 后端代理）
NEXT_PUBLIC_FUNASR_WS_URL=ws://localhost:10095
NEXT_PUBLIC_FUNASR_MODE=2pass
NEXT_PUBLIC_FUNASR_HOTWORDS=

# TTS（仅用于显示，实际合成由 Python 后端代理）
NEXT_PUBLIC_QWEN_TTS_VOICE=Cherry
NEXT_PUBLIC_TTS_SAMPLE_RATE=16000

# NestJS API
API_INTERNAL_URL=http://localhost:3001/api
```

### 4. 启动 Dashboard

```bash
cd apps/dashboard
pnpm dev
```

访问 `http://localhost:3000/voice-demo`。

---

## 技术细节

### 音频处理链路

**ASR（录音 → 识别）**：
```
麦克风 → getUserMedia(16kHz, mono)
       → AudioWorkletNode（每帧 128 samples）
       → downsampleBuffer(48k→16k)
       → floatTo16BitPCM(Float32→Int16)
       → WebSocket /asr-stream（binary PCM）
       → Python WebRTC VAD（前置门控，仅语音帧转发）
       → FunASR 2pass 识别
       → JSON 响应（partial / final / vad_state）回推浏览器
```

**TTS（合成 → 播放）**：
```
文本 → WebSocket /tts-stream（JSON { text, speaker, instruct_text }）
    → Python 后端调用 Qwen-TTS Realtime
    → 流式 PCM 16-bit 16kHz 回推（binary chunks）
    → 浏览器 pcm16ToFloat32(Int16→Float32)
    → AudioBuffer（16000Hz）
    → AudioBufferSourceNode（无缝排队播放）
    → GainNode（音量控制）→ destination
    → 结束 JSON { "type": "final" } 标记合成完成
```

### VAD 算法

VAD 在 **Python 后端** 实现（`services/voice-agent/src/voice_agent/vad.py`），前端仅转发音频：

- **算法**：WebRTC VAD（激进度 3）+ 滞后确认 + 预缓冲
- **状态机**：`silence → speech → speech_end → silence`
- **speech_start**：连续 3 帧语音 → flush 预缓冲（300ms）+ 当前帧发送
- **speech_end**：连续 10 帧静音（300ms）→ 本帧仍发送 + 触发 `stt.end_speech()`
- **vad_state 事件**：状态变化时推 `{"type":"vad_state","is_speaking":true/false}` 给浏览器

前端 `isSpeaking` 状态由服务端 `vad_state` 事件驱动，非本地计算。

详见 [`docs/vad-architecture.md`](../../../docs/vad-architecture.md) 第 4 节。

### 自动重连

ASRStreamClient 内置自动重连：
- 最大重连次数：3 次
- 重连间隔：3s × 重连次数（最大 15s）
- 重连期间音频不发送（连接恢复后继续转发）
- 主动断开（`disconnect()`）不触发重连

### 浏览器兼容性

| 浏览器 | 支持版本 | 备注 |
|--------|----------|------|
| Chrome | 66+ | 完整支持 |
| Edge | 79+ | 完整支持 |
| Firefox | 76+ | 完整支持 |
| Safari | 14.1+ | AudioWorklet 需 14.1+ |
| Opera | 53+ | 完整支持 |

**要求**：
- `AudioWorklet` API
- `WebSocket` API（同时用于 ASR 和 TTS）
- `getUserMedia` API（需 HTTPS 或 localhost）
- `AudioContext` + `AudioBufferSourceNode`（TTS 播放）

### 内存管理

- AudioBufferSourceNode 播放结束后自动从 `activeSourcesRef` 移除
- 组件卸载时清理所有资源：AudioContext、MediaStream、WebSocket
- TTS 中断时立即停止所有 source 并发送 `{"type":"cancel"}` 给后端

---

## 测试

### 运行测试

```bash
cd apps/dashboard
pnpm test          # 单次运行
pnpm test:watch    # 监听模式
```

### 测试覆盖

| 测试文件 | 测试数 | 覆盖内容 |
|----------|--------|----------|
| audio-utils.test.ts | 16 | PCM 转换、重采样、RMS、拼接 |
| useASR.test.ts | 6 | 状态转换、结果处理、vad_state、错误处理 |
| useTTS.test.ts | 10 | 合成、中断、参数更新、错误处理 |

### 手动测试清单

- [ ] 麦克风权限拒绝后显示错误提示
- [ ] Voice Agent 服务未启动时显示连接超时
- [ ] FunASR 服务未启动时显示后端错误（通过 Python 后端代理）
- [ ] 说话时音量可视化条实时跳动
- [ ] 服务端 VAD 检测到 speech_end 后自动触发 final 识别
- [ ] isSpeaking 状态随服务端 vad_state 事件实时切换
- [ ] TTS 播放中可随时中断
- [ ] 音量滑块实时生效
- [ ] 说话人切换（Cherry/Serena/Ethan/Chelsie）后合成声音对应变化
- [ ] 语音联动模式下 ASR 结果自动合成播放

---

## 常见问题

### Q: 麦克风无法启动？

**A**: 检查浏览器权限设置。`getUserMedia` 要求 HTTPS 或 localhost。
在 Chrome 地址栏点击锁图标 → 网站设置 → 麦克风 → 允许。

### Q: Voice Agent 连接超时？

**A**: 确认 Python Voice Agent 服务已启动：
```powershell
# 检查进程
Get-Process python* | Where-Object { $_.CommandLine -like "*voice_agent*" }

# 检查端口
Test-NetConnection localhost -Port 8090
```

确认日志输出 `listening on ws://0.0.0.0:8090`。若未启动：
```powershell
cd services/voice-agent
python -m voice_agent.main
```

### Q: FunASR 连接超时？

**A**: 前端通过 Python 后端代理连接 FunASR，不直连 10095 端口。
确认：
1. FunASR Docker 容器已启动：`docker ps | findstr funasr`
2. Python 后端 `.env` 中 `FUNASR_WS_URL=ws://localhost:10095` 配置正确
3. Voice Agent 服务日志中无 `FunASR 连接失败` 错误

### Q: Qwen-TTS 合成无声音？

**A**: 检查 Python 后端 `.env` 配置：
- `TTS_PROVIDER=qwen`（不是 mock）
- `DASHSCOPE_API_KEY` 已填写有效的阿里云 DashScope API Key
- `pip install -e ".[tts-qwen]"` 已安装 dashscope SDK
- `NEXT_PUBLIC_TTS_SAMPLE_RATE=16000` 与服务端 `target_sample_rate` 一致
- Voice Agent 启动日志显示 `TTS provider: qwen`（不是 `mock`）

### Q: 识别结果延迟很高？

**A**: 2pass 模式下，final 结果在说话结束后才返回（需等待服务端 VAD 检测到 speech_end + FunASR offline 识别 ~500ms）。
如需更低延迟，切换为 `online` 模式（但准确率降低）：
在 Python 后端 `.env` 中设置 `FUNASR_MODE=online`，或前端连接时传 `mode: 'online'`。

### Q: AudioWorklet 注册失败？

**A**: 某些旧版浏览器不支持 AudioWorklet。升级到 Chrome 66+ 或 Firefox 76+。
