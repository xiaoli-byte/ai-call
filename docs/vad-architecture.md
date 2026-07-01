# VAD 分层架构

> 对 AI 外呼，VAD 放在 **FreeSWITCH 后、FunASR 前** 的 Python 音频网关层，不放前端，不塞 NestJS。

---

## 1. 设计原则

VAD（Voice Activity Detection）位置选择的 4 个核心原因：

| 原因 | 说明 |
| --- | --- |
| **节省 ASR 算力** | 外呼中大量时间是静音/呼吸/环境噪声。无 VAD 会把所有静音送进 FunASR 浪费 GPU；有 VAD 仅语音帧推送，100 并发场景下 GPU 压力差异显著 |
| **支持 barge-in** | 机器人播报时用户插话需立即检测开口 → 停止 TTS → 切换 ASR。这是 VAD first，不是 ASR first |
| **降低 ASR 延迟** | VAD 检测到 `speech_start` 立即启动 streaming ASR，比持续开流更稳 |
| **便于端点检测** | 用户说完一句后静音 700ms 判定 utterance end，本质是 VAD endpoint 逻辑 |

---

## 2. 分层职责矩阵

| 层级 | 位置 | VAD 实现 | 职责 | 适用场景 |
| --- | --- | --- | --- | --- |
| **前端 Demo** | `apps/dashboard/hooks/useAudioRecorder.ts` | RMS 能量双阈值 | 浏览器麦克风门控 | Demo / 网页测试 |
| **Python Voice Agent** | `services/voice-agent/src/voice_agent/vad.py` | WebRTC VAD + 滞后确认 + 预缓冲 | 生产外呼音频门控 | 商用外呼 |
| **NestJS** | `apps/api/` | 无 | 不参与音频处理（仅任务管理/状态机/业务接口） | — |
| **FreeSWITCH** | `freeswitch/` | 无（仅 RTP fork 透传） | 通信层透传 | — |

> **关键**：真实外呼链路是 `电话用户 → SIP/PSTN → FreeSWITCH → ASR`，客户音频根本不经过浏览器。前端 VAD 只能用于 Demo，不能用于电销/催收/外呼。

---

## 3. 生产链路数据流

```
FreeSWITCH mod_audio_fork
  ↓ WebSocket ws://host:8080/audio-stream（二进制 PCM 16kHz mono）
server.py _handle
  ↓ ws 二进制帧转发
agent.receive_audio(call_id, audio_bytes)
  ↓
audio.split_into_frames(audio_bytes, frame_ms=30, sample_rate=16000)
  ↓ 30ms 切片（960 bytes/帧）
vad.feed(frame) → (state, frames_to_send)
  ├─ state=silence:     frames_to_send=[]，丢弃，不送 STT
  ├─ state=speech:      stt.send_audio(frames_to_send) → FunASR
  └─ state=speech_end:  stt.send_audio(frames_to_send) + stt.end_speech()
                        → FunASR 触发 offline 整句识别
                        → STTEvent(type=final) → 唤醒 agent._endpoint_waiters
```

**TTS 回传路径**（同一 WebSocket）：
```
CosyVoice 流式合成 → agent.on_audio_output(pcm) → server.py ws.send(bytes)
  → FreeSWITCH 播放给通话方
```

---

## 4. VAD 算法详解

### 4.1 状态机

```
         speech_confirm_frames=3
silence ──────────────────────▶ speech
   ▲                                │
   │                                │ silence_confirm_frames=10
   │                                ▼
   └──────── speech_end ◀───────────┘
            (本帧仍发送)
```

### 4.2 核心机制

| 机制 | 默认值 | 作用 |
| --- | --- | --- |
| **WebRTC VAD 激进度** | `3`（最激进） | 0=宽松/3=激进，外呼推荐 3 以抑制环境噪声 |
| **滞后确认（speech）** | `speech_confirm_frames=3` | 连续 3 帧语音才转 speech，避免边界抖动 |
| **滞后确认（silence）** | `silence_confirm_frames=10` | 连续 10 帧静音才转 speech_end（30ms × 10 = 300ms） |
| **预缓冲** | `pre_buffer_ms=300` | 300ms 滚动 deque，silence→speech 时 flush 防丢首字 |

### 4.3 状态转换语义

- `silence → speech`：flush 预缓冲 + 当前帧一起发送（含之前缓冲的静音/未确认语音帧）
- `speech` 状态：每帧发送
- `speech → speech_end`：本帧仍发送（可能含末尾语音），调用方据此触发 `stt.end_speech()`
- `speech_end → silence`：进入静音等待，预缓冲重新滚动

---

## 5. 配置参数

所有参数通过环境变量加载，定义在项目根 `.env`：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VAD_AGGRESSIVENESS` | `3` | WebRTC VAD 激进度（0-3，3 最激进，推荐外呼） |
| `VAD_FRAME_MS` | `30` | VAD 帧长（10/20/30ms，WebRTC VAD 仅支持这三种） |
| `VAD_PRE_BUFFER_MS` | `300` | 预缓冲窗口（防丢首字） |
| `VAD_SILENCE_CONFIRM_FRAMES` | `10` | 连续静音多少帧后判定 speech_end |
| `VAD_SPEECH_CONFIRM_FRAMES` | `3` | 连续语音多少帧后判定 speech_start |

**调优建议**：
- 噪声环境 → 提高 `VAD_AGGRESSIVENESS` 至 3，增大 `VAD_SPEECH_CONFIRM_FRAMES` 至 5
- 想更快断句 → 减小 `VAD_SILENCE_CONFIRM_FRAMES` 至 5（150ms），但可能误断短停顿
- 丢首字严重 → 增大 `VAD_PRE_BUFFER_MS` 至 500

---

## 6. 与前端 Demo VAD 的边界

> **更新**：前端 `/voice-demo` 页面现已复用 Python 音频网关的 WebRTC VAD（通过 `/asr-stream` 端点），
> 不再使用浏览器自带 VAD。`useAudioRecorder` 的 `enableVAD` 默认为 `false`，音频直接转发给 Python 后端处理。

| 维度 | 前端 Demo（旧） | 前端 Demo（新） | Python Voice Agent VAD |
| --- | --- | --- | --- |
| **位置** | `apps/dashboard/hooks/useAudioRecorder.ts` | `apps/dashboard/lib/voice-agent-client.ts` → `/asr-stream` | `services/voice-agent/src/voice_agent/vad.py` |
| **算法** | RMS 能量双阈值（已弃用） | 复用后端 WebRTC VAD | WebRTC VAD + 滞后确认 |
| **服务页面** | `/voice-demo`（浏览器麦克风 Demo） | `/voice-demo`（浏览器麦克风 Demo） | 生产外呼链路 + 前端 Demo |
| **音频来源** | `getUserMedia` 浏览器麦克风 | `getUserMedia` 浏览器麦克风 | FreeSWITCH mod_audio_fork / 浏览器 |
| **是否共享代码/配置** | 否，独立演进 | 是，复用后端 VAD | 是 |

**关键边界**：
- 前端 Demo 通过 `/asr-stream` WebSocket 端点复用 Python 后端的 WebRTC VAD + FunASR
- `useAudioRecorder.enableVAD` 默认为 `false`，VAD 逻辑保留但不启用（可显式开启用于纯网页测试）
- 生产外呼链路通过 `/audio-stream` 使用同一套 VAD + FunASR
- 两套入口（`/asr-stream` Demo + `/audio-stream` 生产）共享 VAD/STT 代码，但会话隔离

---

## 7. 关键文件索引

| 文件 | 行号 | 职责 |
| --- | --- | --- |
| [`services/voice-agent/src/voice_agent/vad.py`](../services/voice-agent/src/voice_agent/vad.py) | L1-145 | WebRTC VAD 状态机（feed/state/reset） |
| [`services/voice-agent/src/voice_agent/agent.py`](../services/voice-agent/src/voice_agent/agent.py#L346-L389) | L346-389 | `receive_audio`：VAD 调用与音频门控 |
| [`services/voice-agent/src/voice_agent/server.py`](../services/voice-agent/src/voice_agent/server.py#L90-L104) | L90-104 | WS 多路径路由（`/audio-stream` + `/asr-stream` + `/tts-stream`） |
| [`services/voice-agent/src/voice_agent/demo_server.py`](../services/voice-agent/src/voice_agent/demo_server.py) | L61-183 | `handle_asr`：Demo ASR 端点（复用 VAD + FunASR） |
| [`services/voice-agent/src/voice_agent/main.py`](../services/voice-agent/src/voice_agent/main.py#L88-L102) | L88-102 | VAD 配置从环境变量加载 + DemoServer 构造 |
| [`apps/dashboard/lib/voice-agent-client.ts`](../apps/dashboard/lib/voice-agent-client.ts) | L39-187 | `ASRStreamClient`：浏览器 WS 客户端（`/asr-stream`） |
| [`apps/dashboard/hooks/useASR.ts`](../apps/dashboard/hooks/useASR.ts) | L133-136 | PCM 直接转发给后端，VAD 在服务端 |
| [`apps/dashboard/hooks/useAudioRecorder.ts`](../apps/dashboard/hooks/useAudioRecorder.ts#L88-L90) | L88-90 | `enableVAD` 默认 false（VAD 在服务端） |

---

## 8. 未来扩展预案：100–1000 并发的 audio-gateway 拆分

当前 < 50 并发采用合并方案（VAD + ASR + TTS 同在 `services/voice-agent/`）。当并发 > 50 路时，建议拆分为独立 Audio Gateway：

```
services/
├── audio-gateway/        # 新增（并发 > 50 时拆分）
│   ├── vad.py            # WebRTC VAD 状态机
│   ├── rtp_server.py     # RTP 解码 + G711 → PCM
│   ├── session.py        # 会话管理
│   └── stream_router.py  # 重采样 16k + 流缓冲
└── voice-agent/          # 仅保留 ASR/LLM/TTS 编排
```

### 拆分动机

| 服务 | 职责 | 关注点 |
| --- | --- | --- |
| **Audio Gateway** | RTP 解码 + VAD + 重采样 + 流缓冲 | 音频处理吞吐、CPU |
| **Voice Agent** | ASR + LLM + TTS 编排 | GPU/LLM API 延迟 |

### 拆分条件

- 并发 > 50 路：考虑拆分
- 并发 > 100 路：强烈建议拆分
- 并发 > 1000 路：必须拆分，Audio Gateway 可独立水平扩展

### 当前合并方案的取舍

| 优势 | 劣势 |
| --- | --- |
| 简单：单进程内通信，无需跨进程序列化 | 单点故障：Audio Gateway 与 ASR 同生死 |
| 低延迟：函数调用而非网络往返 | 扩展受限：无法独立扩缩 VAD 与 ASR |
| 部署简便：一个 Python 进程 | 资源争抢：CPU 密集的 VAD 与 GPU 密集的 ASR 共进程 |

**结论**：< 50 并发场景下，合并方案的简单性优于拆分的可扩展性。文档记录此预案供后续演进参考。
