# Python Voice Agent

AI 外呼机器人语音代理服务 — FreeSWITCH WebSocket 直连 + WebRTC VAD + FunASR + Qwen-TTS/CosyVoice + LLM 工具调用。

## 架构

```
电话用户 → SIP/PSTN → FreeSWITCH (mod_audio_fork)
                            ↓ WebSocket ws://host:8090/audio-stream
                     Python Voice Agent
                     ├── 第一帧 JSON metadata 解析
                     ├── WebRTC VAD 粗筛（前置门控，节省 ASR 算力）
                     ├── FunASR 流式 ASR（2pass 模式）
                     ├── RAG 检索（NestJS 知识库 API）
                     ├── OpenAI 兼容 LLM（DeepSeek 等，SSE 流式 + tool_calls 聚合）
                     ├── 工具调用循环（HTTP 调 NestJS /api/tools/:name）
                     ├── TTS 流式合成（Qwen-TTS / CosyVoice，可切换）
                     └── barge-in 中断（STT partial → cancel TTS/LLM）
                            ↓ ws.send(pcm_bytes)
                     FreeSWITCH 播放给通话方

前端 Demo → 浏览器麦克风
                ↓ WebSocket ws://host:8090/asr-stream
           DemoServer.handle_asr（复用 WebRTC VAD + FunASR）
                ↓ JSON {partial|final|vad_state}
           浏览器显示识别结果

前端 Demo → 文本输入
                ↓ WebSocket ws://host:8090/tts-stream
           DemoServer.handle_tts（复用 Qwen-TTS / CosyVoice）
                ↓ 二进制 PCM + JSON {final}
           浏览器 Web Audio API 播放
```

> VAD 分层架构、生产链路数据流、与前端 Demo VAD 的边界、100–1000 并发的 audio-gateway 拆分预案详见 [`docs/vad-architecture.md`](../../docs/vad-architecture.md)。

## 依赖服务

| 服务 | 用途 | 默认地址 |
| ---- | ---- | ------ |
| FreeSWITCH | 电话接入 + mod_audio_fork 音频双向流 | `ws://host.docker.internal:8090/audio-stream` |
| FunASR | 流式语音识别 | `ws://localhost:10095` |
| Qwen-TTS | 流式语音合成（云端，TTS_PROVIDER=qwen） | `wss://dashscope.aliyuncs.com/api-ws/v1/realtime` |
| CosyVoice | 流式语音合成（本地，TTS_PROVIDER=cosyvoice） | `http://localhost:50000` |
| NestJS API | 工具调用 / RAG / 任务上下文 / transcript 上报 | `http://localhost:3001/api` |
| LLM API | 对话生成（OpenAI 兼容协议） | `https://api.deepseek.com/v1` |

> 未配置 `LLM_API_KEY` 或 TTS 凭证时自动降级到 Mock provider，可跑通对话主循环但不产生真实音频/智能回复。
> TTS 通过 `TTS_PROVIDER` 环境变量切换：`qwen`（云端 Qwen-TTS）/ `cosyvoice`（本地）/ `mock`（默认）。

## 快速启动

```powershell
cd services/voice-agent

# 1. 安装依赖（推荐用 uv，也可用 pip）
pip install -e ".[dev]"
# 使用 Qwen-TTS 云端合成需额外安装可选依赖：
pip install -e ".[dev,tts-qwen]"
# 或 uv sync --extra dev --extra tts-qwen

# 2. 配置环境变量（在项目根目录 .env 中配置，无需单独创建）
# 至少填写 LLM_DEEPSEEK_API_KEY；TTS_PROVIDER=qwen 时需填 DASHSCOPE_API_KEY

# 3a. WebSocket 模式（接 FreeSWITCH + 前端 Demo）
python -m voice_agent.main

# 3b. CLI 模式（终端模拟对话，跳过 STT/TTS）
python -m voice_agent.main --cli
```

也可在仓库根目录用 pnpm 快捷脚本：

```powershell
pnpm dev:agent-py        # WebSocket 模式
pnpm dev:agent-py:cli    # CLI 模式
```

## 环境变量

完整变量见项目根 [.env](../../.env)。关键项：

| 变量 | 默认值 | 说明 |
| ---- | ----- | ---- |
| `VOICE_AGENT_WS_HOST` | `0.0.0.0` | WS 监听地址 |
| `VOICE_AGENT_WS_PORT` | `8090` | WS 监听端口（与 FreeSWITCH 配置一致） |
| `VOICE_AGENT_WS_PATH` | `/audio-stream` | WS 路径 |
| `LLM_API_KEY` | `""` | LLM 认证；空则用 MockLLM |
| `LLM_BASE_URL` | `https://api.deepseek.com/v1` | LLM API 地址 |
| `LLM_MODEL` | `deepseek-chat` | 模型名 |
| `TTS_PROVIDER` | `mock` | TTS 切换：qwen / cosyvoice / mock |
| `DASHSCOPE_API_KEY` | `""` | Qwen-TTS 认证（TTS_PROVIDER=qwen 时需要） |
| `QWEN_TTS_MODEL` | `qwen3-tts-flash-realtime` | Qwen-TTS 模型名 |
| `QWEN_TTS_VOICE` | `Cherry` | Qwen-TTS 系统音色 |
| `COSYVOICE_BASE_URL` | `http://localhost:50000` | CosyVoice 地址（TTS_PROVIDER=cosyvoice 时需要） |
| `FUNASR_WS_URL` | `ws://localhost:10095` | FunASR WS 地址 |
| `API_BASE_URL` | `http://localhost:3001/api` | NestJS API 基址 |
| `VAD_AGGRESSIVENESS` | `3` | WebRTC VAD 激进度（0-3，3 最激进） |
| `VAD_FRAME_MS` | `30` | VAD 帧长（10/20/30ms） |
| `VAD_PRE_BUFFER_MS` | `300` | 预缓冲防丢首字 |
| `MAX_TURNS` | `30` | 单次通话最大对话轮数 |
| `TURN_TIMEOUT_S` | `30` | 单轮等待用户说话超时 |

## CLI 模式使用示例

```powershell
python -m voice_agent.main --cli

# ===== Python Voice Agent CLI =====
#
# 可选场景：
#   1. 贷后催收 - 信用卡/贷款还款提醒、逾期催收
#   2. 电商售后 - 订单售后回访、退款进度查询、退换货预约
#   3. 售前邀约 - 4S店试驾、产品体验、活动邀约
#
# 选择场景 [1-3，默认 2]: 2
#
# 🤖 您好，我是示例公司的售后助理，关于您订单 DEMO20260627001 的售后事项想跟您确认，现在方便吗？
# 你> 我想查一下退款进度
# 🔧 query_refund_status → {'status': 'processing'}
# 🤖 好的，我帮您查到了，您的退款正在处理中...
# 你> quit
```

## 测试

```powershell
cd services/voice-agent
pytest tests/ -v
```

测试覆盖：
- `test_vad.py` — WebRTC VAD 状态机（silence/speech/speech_end 转换、预缓冲、滞后确认）
- `test_llm_sse.py` — OpenAI SSE 解析（delta 累加、tool_calls 跨 chunk 聚合、[DONE] 处理）
- `test_agent.py` — 对话主循环（greeting、工具调用、转人工、barge-in、max_turns、状态清理）

## 与旧 TS 版对照

| 能力 | Node.js (`apps/voice-agent/`) | Python (`services/voice-agent/`) |
| ---- | ---------------------------- | -------------------------------- |
| VAD | ❌ 无 | ✅ WebRTC VAD 前置门控 + 预缓冲 |
| TTS | ❌ stub | ✅ Qwen-TTS 云端 / CosyVoice 本地可切换 |
| NestJS tasks 端点 | ❌ 仅用 metadata | ✅ GET/PATCH/POST 完整闭环 |
| barge-in | ✅ AbortController | ✅ asyncio.Task.cancel |
| 工具调用循环 | ✅ | ✅ 同构复刻 |
| RAG 检索 | ✅ | ✅ 同构复刻 |

旧 TS 版保留作对照参考，不删除。
