﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿# AI Agent 外呼机器人

> 基于 FreeSWITCH + WebSocket 直连 + NestJS + Next.js 的复合架构 AI 外呼机器人
>
> 个人开发者求职作品项目 | 三大业务场景 | 混合 AI 栈 | RAG 防幻觉 | Function Calling 业务闭环

> 最新生产化架构、不可变流程版本和数据库迁移说明见 [Architecture v2](docs/architecture-v2.md)。

---

## 目录

- [项目定位](#项目定位)
- [技术选型决策](#技术选型决策)
- [系统架构](#系统架构)
- [项目结构](#项目结构)
- [三大业务场景](#三大业务场景)
- [快速开始](#快速开始)
- [开发工作流](#开发工作流)
- [核心设计](#核心设计)
- [扩展点](#扩展点)
- [求职作品亮点](#求职作品亮点)
- [合规说明](#合规说明)
- [路线图](#路线图)

---

## 项目定位

**目标**：构建一个可演示、可面试讲解、可二次开发的 AI 外呼机器人最小可运行 PoC。

**约束**：
- 个人开发者，NestJS/Next.js 技术栈
- 有 FreeSWITCH 前公司经验（差异化优势）
- 个体工商户身份（无法直接申请 B24 呼叫中心牌照）
- 用自有号码 + Twilio 测试号 + FreeSWITCH mod_audio_fork 做演示
- 求职作品导向，需要展示工程能力和架构判断力

**非目标**：
- 不是商用产品（商用需注册公司 + B24 牌照）
- 不是高并发生产系统（PoC 阶段优先可读性和可演示性）

---

## 技术选型决策

### 整体选型矩阵

| 层级 | 选型 | 理由 |
|---|---|---|
| **Monorepo** | pnpm workspace + turbo | 多包共享依赖、并行构建、缓存优化 |
| **后端** | NestJS 10 | 个人技术栈、装饰器风格、模块化清晰 |
| **前端** | Next.js 14 App Router | 个人技术栈、SSR + RSC、API 路由 |
| **语音框架** | WebSocket + Node.js ws | 直连 FreeSWITCH、协议可控、无第三方依赖 |
| **通信层** | FreeSWITCH + mod_audio_fork | 个人前公司经验、可控、万级并发 |
| **AI 编排** | 自建 Provider 抽象层 | 混合栈切换、面试加分项 |
| **任务队列** | Redis + BullMQ（待接入） | NestJS 生态原生支持 |
| **数据库** | PostgreSQL + Prisma（待接入） | NestJS 标配 |

### AI 供应商混合栈

通过环境变量切换，无需改代码：

| 类型 | 开源本地（推荐） | 国际栈 | 国内栈 | Mock |
|---|---|---|---|---|
| **STT** | **FunASR**（2pass 流式，本地部署） | Deepgram Nova-3（TTFT < 200ms） | 阿里云 ASR（中文优化） | 内置 Mock |
| **LLM** | - | GPT-4o（首 token < 400ms） | DeepSeek V3（性价比高） | 关键词规则引擎 |
| **TTS** | - | Cartesia Sonic-3（首音频 < 70ms） | CosyVoice（中文情感） | 内置 Mock |
| **Embedding** | BGE-M3（中文优化） | OpenAI text-embedding-3-small | - | - |

### 为什么选 FunASR？

| 维度 | FunASR（本项目首选） | Deepgram | 阿里云 ASR |
|---|---|---|---|
| 部署方式 | Docker 本地部署，完全开源 | 云 API | 云 API |
| 成本 | 免费（仅算算力） | 按 minute 计费 | 按 minute 计费 |
| 中文准确率 | 高（达摩院中文模型） | 中 | 高 |
| 流式延迟 | 2pass 模式兼顾低延迟与准确率 | < 200ms | 中等 |
| 隐私合规 | 数据不出服务器 | 数据出海 | 国内云 |
| 热词支持 | ✅ 业务关键词加权 | ✅ | ✅ |
| ITN | ✅ 数字/日期规范化 | ✅ | ✅ |

**结论**：FunASR 开源、免费、中文优化、可本地部署，最契合个人开发者求职作品定位。

### 为什么不用 Vapi/Retell/Bland 等 SaaS？

| 维度 | SaaS 平台 | 本项目自建 |
|---|---|---|
| 上手速度 | 快（<1 周） | 中（2-4 周） |
| 单分钟成本 | $0.07-0.09 | 按 token 计费，更便宜 |
| 架构控制力 | 弱（黑盒） | 强（全链路可控） |
| 求职加分 | 仅会用 API | 体现设计与架构能力 |
| 国内合规 | 不支持 | 可全私有化部署 |

### 为什么不用 LiveKit Agents？

早期方案曾考虑 LiveKit Agents，最终改为 FreeSWITCH 直连：

| 维度 | LiveKit Agents | FreeSWITCH 直连（本项目） |
|---|---|---|
| 依赖复杂度 | 需引入 LiveKit Server + Agents SDK | 仅一个 WebSocket 服务（ws 包） |
| 协议透明度 | LiveKit 内部协议（SFU 抽象） | mod_audio_fork 帧协议（第一帧 JSON 元数据 + 后续 PCM 帧） |
| 与 FreeSWITCH 协作 | 需要 trunk 桥接，链路多一跳 | mod_audio_fork 直接把 RTP fork 给 Agent，零中间层 |
| 个人经验匹配 | 需额外学习 SDK | 复用前公司 FreeSWITCH 经验 |
| 求职叙事 | 依赖第三方 SDK | 体现对协议和通信架构的理解 |
| 性能损耗 | 多一层 SFU 转发 | 端到端 WebSocket，延迟更低 |

**结论**：本项目目标是展示通信架构理解，FreeSWITCH 直连更契合个人经验与求职定位。

### 为什么 FreeSWITCH 而非 Asterisk？

| 维度 | FreeSWITCH | Asterisk |
|---|---|---|
| 并发模型 | 线程池（万级并发） | 一通道一线程 |
| 模块化 | 优秀（mod_audio_fork 等） | 一般 |
| 商业支持 | SignalWire 团队 | Digium（已被收购） |
| 国内采用率 | 合力亿捷/云蝠/青牛等主流 | 较少 |
| 个人经验 | **前公司使用**（关键） | 无 |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│  Next.js Dashboard（:3000）                                     │
│  任务管理 / 通话监控 / 知识库管理 / 场景配置                    │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP
┌────────────────────────────▼────────────────────────────────────┐
│  NestJS 后端（:3001，@ai-call/api）                              │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐  │
│  │ Scenarios    │ Tasks        │ Tools        │ Knowledge    │  │
│  │ 场景配置     │ 外呼任务CRUD │ FC 业务接口  │ RAG 检索     │  │
│  └──────────────┴──────────────┴──────────────┴──────────────┘  │
└───┬──────────────────────────────────────────┬──────────────────┘
    │ HTTP（任务派发 + 工具调用）              │ HTTP（RAG 检索）
    ▼                                          ▼
┌────────────────────────────┐    ┌──────────────────────────────┐
│  Voice Agent                │    │  知识库（向量检索）          │
│  (services/voice-agent)     │    │  Chroma / Qdrant            │
│  ┌────────┐  ┌────────┐    │    │  ┌────────────────────────┐  │
│  │ STT    │  │ LLM    │    │    │  │ 贷后催收政策文档       │  │
│  │ Deepgram│ │ GPT-4o │    │    │  │ 电商退换货规则         │  │
│  │ /阿里云 │ │/DeepSeek│   │    │  │ 4S店试驾流程           │  │
│  └────────┘  └────────┘    │    │  └────────────────────────┘  │
│  ┌────────┐  ┌────────┐    │    └──────────────────────────────┘
│  │ TTS    │  │ RAG    │    │
│  │Cartesia│  │        │    │
│  │/CosyVoi│  │        │    │
│  └────────┘  └────────┘    │
└──────────┬─────────────────┘
           │ WebSocket（音频双向流）
┌──────────▼─────────────────┐
│  FreeSWITCH + mod_audio_fork│
│  - SIP 中继接运营商/Twilio  │
│  - RTP 音频 fork 给 Agent   │
│  - AMD 应答机检测           │
│  - 录音 / CDR 话单          │
└──────────┬─────────────────┘
           │ SIP / RTP
           ▼
        PSTN 电话网
```

### 数据流（单次通话）

```
1. Dashboard 创建任务 → POST /api/tasks
2. Dashboard 派发任务 → POST /api/tasks/:id/dispatch
3. NestJS 通过 ESL 调用 FreeSWITCH originate
4. FreeSWITCH 拨打被叫 → AMD 检测应答
5. mod_audio_fork 把 RTP fork 到 Voice Agent WebSocket（:8080）
   ├─ 第一帧：JSON 元数据（dialog_id/caller_id/scenario/...）
   └─ 后续帧：PCM 16-bit 音频流
6. Voice Agent 启动会话：
   a. STT 接收音频流 → 转写文本
   b. 端点检测 → 用户说完
   c. RAG 检索知识库 → 注入上下文
   d. LLM 流式生成 → 可能触发 tool_call
   e. Tool 通过 HTTP 调 NestJS /api/tools/{name}
   f. TTS 流式合成音频 → 通过同一 WebSocket 推回 FreeSWITCH 播放
7. 通话结束 → Voice Agent 上报转写 + 意向分级
8. Dashboard 展示通话历史 + 转写回放
```

---

## 项目结构

```
ai-call/
├── apps/
│   ├── api/                          # NestJS 后端（:3001）
│   │   └── src/
│   │       ├── scenarios/            # 场景配置 API
│   │       ├── tasks/                # 外呼任务 CRUD + 派发
│   │       ├── tools/                # Function Calling 业务接口（11 个工具）
│   │       ├── knowledge-base/       # RAG 知识库检索
│   │       ├── app.module.ts
│   │       └── main.ts
│   ├── voice-agent/                  # WebSocket Voice Agent（FreeSWITCH 直连）
│   │   └── src/
│   │       ├── agent.ts              # STT→LLM→TTS 对话主循环 + AgentCallbacks
│   │       ├── websocket-server.ts   # 接收 mod_audio_fork 连接的 WS 服务
│   │       ├── rag.ts                # RAG 检索 + 防幻觉注入
│   │       ├── tools.ts              # 11 个工具签名 + HTTP 分发
│   │       └── index.ts             # CLI 模式 + WebSocket 模式
│   └── dashboard/                    # Next.js 管理面板（:3000）
│       └── app/
│           ├── page.tsx              # 概览 + 架构图
│           ├── tasks/                # 任务管理 + 新建
│           ├── calls/                # 通话历史
│           ├── scenarios/            # 场景配置查看
│           └── knowledge/            # 知识库管理
├── packages/
│   ├── shared/                       # 共享类型
│   │   └── src/
│   │       ├── scenarios.ts          # 3 个场景定义 + 系统提示词
│   │       ├── tasks.ts             # 任务状态机 + DTO
│   │       └── providers.ts         # Provider 接口类型
│   └── providers/                    # AI Provider 抽象层
│       └── src/
│           ├── stt/                  # Deepgram/阿里云/Mock
│           ├── llm/                  # GPT-4o/DeepSeek/Mock
│           ├── tts/                  # Cartesia/ElevenLabs/CosyVoice/Mock
│           └── index.ts             # ProviderFactory（env 切换）
├── freeswitch/
│   ├── docker-compose.yml
│   └── conf/
│       ├── dialplan/default.xml      # AMD + audio_fork + 转人工
│       └── autoload_configs/
│           ├── audio_fork.conf.xml
│           ├── event_socket.conf.xml
│           └── modules.conf.xml
├── .env.example                      # 环境变量模板
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

---

## 三大业务场景

### 1. 贷后催收（Collection）

| 项 | 内容 |
|---|---|
| **用途** | 信用卡/贷款还款提醒、逾期催收 |
| **工具** | query_repayment_info, calculate_penalty, create_extension_request, transfer_to_human |
| **转人工规则** | 客户情绪激动 / 提减免罚息延期 / 连续 2 次未理解 |
| **系统提示词要点** | 专业平和、不威胁、不评论信用状况、困难情况转人工 |
| **问候语** | 您好，我是{company}的还款提醒助理，关于您{product}的还款事项... |

### 2. 电商售后（Ecommerce）

| 项 | 内容 |
|---|---|
| **用途** | 订单售后回访、退款进度查询、退换货预约 |
| **工具** | query_order, query_refund_status, create_pickup_appointment, create_after_sale_ticket, transfer_to_human |
| **转人工规则** | 投诉质量问题 / 要求直接退款 / 连续 2 次表达不满 |
| **系统提示词要点** | 亲切耐心、不乱承诺退款、数字必须查知识库 |
| **问候语** | 您好，我是{company}的售后助理，关于您订单{orderNo}的售后事项... |

### 3. 售前邀约（Presale）

| 项 | 内容 |
|---|---|
| **用途** | 4S店试驾、产品体验、活动邀约 |
| **工具** | query_car_model, query_activity, create_test_drive_appointment, transfer_to_human |
| **转人工规则** | 明确表示无兴趣 / 询问具体价格 |
| **系统提示词要点** | 热情专业、不催促、价格转线下 |
| **问候语** | 您好，我是{company}的邀约助理，最近我们有{activity}活动... |

---

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 9
- Docker（可选，用于 FreeSWITCH + FunASR）

### 启动步骤

```bash
# 1. 安装依赖
cd i:\ai-call
pnpm install

# 2. 配置环境变量（默认全 Mock，无需任何 API Key）
copy .env.example .env

# 3. （可选）启动 FunASR STT 服务（推荐，开源免费）
docker run -d --name funasr -p 10095:10095 \
  registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-online-cpu-0.1.12
# 然后在 .env 设置 STT_PROVIDER=funasr

# 4. （可选）启动 FreeSWITCH
docker compose -f freeswitch/docker-compose.yml up -d

# 5. 启动全部服务（API + Voice Agent + Dashboard）
pnpm dev
```

服务地址：
- Dashboard: http://localhost:3000
- API: http://localhost:3001/api
- Voice Agent WebSocket: ws://localhost:8080/audio-stream
- Voice Agent CLI 模式：终端交互

### 单独调试 Voice Agent（推荐先跑通）

```bash
pnpm dev:agent -- --cli
```

CLI 模式无需任何 API Key 和电话号码，直接在终端模拟对话，验证：
- Provider 抽象层是否工作
- RAG 检索是否正确
- Function Calling 是否能闭环
- 多场景话术是否切换正确

### 接入真实 AI Provider

修改 `.env`：

```bash
# 推荐组合：开源 STT + 国内 LLM（成本最低）
STT_PROVIDER=funasr
LLM_PROVIDER=deepseek
TTS_PROVIDER=mock   # 待接入 CosyVoice

FUNASR_WS_URL=ws://localhost:10095
DEEPSEEK_API_KEY=your_key

# 或国际栈组合
# STT_PROVIDER=deepgram
# LLM_PROVIDER=openai
# TTS_PROVIDER=cartesia
# DEEPGRAM_API_KEY=your_key
# OPENAI_API_KEY=your_key
# CARTESIA_API_KEY=your_key
```

**FunASR** 是即用型实现（`packages/providers/src/stt/funasr.ts`），启动 Docker 后即可工作。
**Deepgram/阿里云/Cartesia** 等是骨架代码，需在 `packages/providers/src/{stt,llm,tts}/adapters.ts` 取消 TODO 注释填入 API 调用。

---

## 开发工作流

### 推荐启动顺序

| 步骤 | 命令 | 作用 |
|---|---|---|
| 1 | `pnpm dev:api` | 启动 NestJS 后端 :3001 |
| 2 | `pnpm dev:agent -- --cli` | CLI 模拟对话验证主循环 |
| 3 | `pnpm dev:dashboard` | 启动 Next.js 面板 :3000 |
| 4 | `pnpm dev` | 一键启动全部 |

### 验证清单

- [ ] CLI 模式能跑通完整对话（问候 → 用户输入 → Agent 回复 → 工具调用）
- [ ] Dashboard 能创建任务并看到任务列表
- [ ] 三大场景话术切换正确
- [ ] 工具调用 HTTP 链路通畅（curl 测试 `/api/tools/query_order`）
- [ ] 知识库检索返回相关文档（curl 测试 `/api/knowledge-base/:id/retrieve`）

---

## 核心设计

### 1. Provider 抽象层（混合栈核心）

**位置**：`packages/providers/src/index.ts`

```typescript
// 通过 .env 配置：
//   STT_PROVIDER=deepgram | aliyun | mock
//   LLM_PROVIDER=openai | deepseek | mock
//   TTS_PROVIDER=cartesia | elevenlabs | aliyun | mock

export class ProviderFactory {
  static createSTT(): STTProvider { /* env 切换 */ }
  static createLLM(): LLMProvider { /* env 切换 */ }
  static createTTS(): TTSProvider { /* env 切换 */ }
}
```

**设计要点**：
- 接口与实现分离：`STTProvider`/`LLMProvider`/`TTSProvider` 是接口，具体实现可插拔
- Mock 优先：无 API Key 也能跑通主循环，降低开发门槛
- 适配器骨架：Deepgram/OpenAI/Cartesia 等适配器留有 TODO 注释，明确接入路径

### 2. RAG 防幻觉三件套

**位置**：`apps/voice-agent/src/rag.ts` + `packages/shared/src/scenarios.ts`

```
用户问题 → RAG 检索 → 拼接 system prompt → LLM 约束回答
                                          ↓
                            涉及数字/政策未在知识库 → "帮您确认后回复"
                                          ↓
                            关键诉求（减免/退款/价格）→ 转人工兜底
```

**三道防线**：
1. **检索注入**：每轮对话检索知识库，把相关文档片段拼到 system prompt
2. **Prompt 约束**：System Prompt 显式要求"涉及金额/日期必须基于知识库回答"
3. **工具兜底**：超出能力范围（如减免罚息）→ Function Calling → 转人工

### 3. Function Calling 业务闭环

**位置**：`apps/api/src/tools/` + `apps/voice-agent/src/tools.ts`

```
LLM 决策 → tool_call → Voice Agent HTTP 调用 → NestJS Tools Controller → 业务系统
                                                                        ↓
LLM 续答 ← tool_result ← Voice Agent 收到响应 ← NestJS 返回结果 ←──────┘
```

**11 个内置工具**：

| 场景 | 工具 | 触发转人工 |
|---|---|---|
| 催收 | query_repayment_info | - |
| 催收 | calculate_penalty | - |
| 催收 | create_extension_request | ✅ |
| 电商 | query_order | - |
| 电商 | query_refund_status | - |
| 电商 | create_pickup_appointment | - |
| 电商 | create_after_sale_ticket | ✅ |
| 售前 | query_car_model | - |
| 售前 | query_activity | - |
| 售前 | create_test_drive_appointment | - |
| 通用 | transfer_to_human | ✅ |

**设计原则**：
- 工具即 HTTP 接口：每个工具对应一个 POST endpoint，可独立测试、可被其他系统复用
- 工具签名集中定义：`apps/voice-agent/src/tools.ts` 中的 `TOOL_DEFS` 与后端路由一一对应
- 转人工标记：工具返回 `shouldEscalate: true` 时立即结束通话转人工

### 4. 转人工兜底机制

**位置**：`packages/shared/src/scenarios.ts` 的 `escalationRules`

每个场景配置三类转人工触发条件：
- **关键词触发**：客户提到"减免/延期/直接退款/多少钱"等
- **情绪触发**：STT/LLM 检测到 angry/distressed 情绪
- **连续未理解**：连续 N 次未理解客户意图

### 5. 任务状态机

```
PENDING  ──派发──▶  CALLING  ──接通──▶  IN_CALL  ──结束──▶  COMPLETED
   │                   │                    │
   │                   │                    └──失败──▶  FAILED
   │                   └──无人接听──▶  NO_ANSWER
   └──取消──▶  CANCELLED
```

---

### 6. VAD 分层架构

**位置**：`services/voice-agent/src/voice_agent/vad.py`（生产链路）+ `apps/dashboard/hooks/useAudioRecorder.ts`（仅 Demo）

VAD 放在 **Python Voice Agent 层**（FreeSWITCH 后、FunASR 前），不放前端、不塞 NestJS：

- **生产链路**：`FreeSWITCH → server.py → agent.receive_audio → vad.feed → stt.send_audio → FunASR`
- **NestJS**：完全不参与音频处理，只做任务管理/状态机/业务接口
- **前端 Demo VAD**：仅服务 `/voice-demo` 浏览器麦克风 Demo，不参与生产外呼

VAD 算法采用 WebRTC VAD + 滞后确认（speech_confirm=3, silence_confirm=10）+ 300ms 预缓冲防丢首字。100–1000 并发场景的 audio-gateway 拆分预案已记录。

详见 [`docs/vad-architecture.md`](docs/vad-architecture.md)。

---

## 扩展点

骨架已留好接入点，按需打开注释即可：

| 扩展项 | 位置 | 操作 |
|---|---|---|
| 接 FunASR STT（推荐，即用） | `.env` 设 `STT_PROVIDER=funasr` + Docker 启动 | 无需改代码 |
| 接 Deepgram/阿里云 STT | `packages/providers/src/stt/adapters.ts` | 取消 TODO 注释 + 填 API Key |
| 接 LLM/TTS 真实供应商 | `packages/providers/src/{llm,tts}/adapters.ts` | 取消 TODO 注释 + 填 API Key |
| 接 FreeSWITCH 真实外呼 | `apps/api/src/tasks/tasks.service.ts` `dispatch()` | 调用 `modesl` 发起 originate |
| 接真实向量库 | `apps/api/src/knowledge-base/knowledge-base.service.ts` | 接入 Chroma + LangChain.js |
| 接 PostgreSQL | `apps/api/src/tasks/tasks.service.ts` | Map 替换为 Prisma |
| 接 Redis 任务队列 | `apps/api/src/tasks/tasks.service.ts` | BullMQ 异步派发 |
| 自定义音频元数据 | `apps/voice-agent/src/websocket-server.ts` `Metadata` 接口 | 扩展第一帧 JSON 字段 |
| 配置 FunASR 热词 | `.env` 设 `FUNASR_HOTWORDS="还款 50 逾期 50"` | 提升业务关键词识别准确率 |

---

## 求职作品亮点

骨架代码中已体现的工程能力（面试可讲）：

### 1. 架构判断力
- **混合栈设计**：Provider 抽象层让国际/国内栈无缝切换，体现对供应商绑定的规避
- **分层清晰**：通信层（FreeSWITCH）/ AI 编排层（Voice Agent）/ 业务层（NestJS）/ 展示层（Next.js）各司其职
- **工具即接口**：Function Calling 通过 HTTP 暴露，业务逻辑独立于 Voice Agent

### 2. 工程素养
- **Mock 优先**：无 API Key 也能跑通主循环，降低开发门槛
- **CLI 模式**：无需电话即可验证对话流程，体现测试驱动思维
- **类型安全**：共享类型包（`@ai-call/shared`）跨应用复用

### 3. 业务理解
- **三大场景**：覆盖催收/电商/售前三大典型外呼业务
- **防幻觉设计**：RAG + Prompt 约束 + 工具兜底三道防线
- **转人工规则**：每场景独立配置，体现业务安全意识

### 4. 复合背景
- **FreeSWITCH 经验**：前公司经验直接复用，无需学习成本
- **NestJS/Next.js 技能**：直接复用，无需切换语言
- **AI 应用开发**：Provider 抽象 + RAG + Function Calling 完整闭环

### 面试可讲的细节

| 问题 | 可讲内容 |
|---|---|
| 为什么 FreeSWITCH 直连而非 LiveKit Agents？ | 协议透明、零中间层、复用前公司经验、求职加分 |
| 为什么选 FunASR 而非 Deepgram？ | 开源免费、本地部署、中文优化、数据不出服务器 |
| 为什么不用 Vapi/Retell？ | 架构控制力、成本、求职加分 |
| 如何防幻觉？ | RAG 三道防线（检索注入 + Prompt 约束 + 工具兜底） |
| 如何处理转人工？ | 场景化 escalationRules + Function Calling 标记 |
| 如何做延迟优化？ | 流式 STT/LLM/TTS + 端点检测 + 打断处理 |
| FunASR 2pass 模式什么意思？ | online 先给低延迟结果，offline 再给整句修正，兼顾延迟和准确率 |
| Provider 抽象的好处？ | 切换供应商不改代码 + 国际国内栈兼容 |
| FreeSWITCH 在哪一层？ | 通信层，与 AI 编排层解耦 |
| mod_audio_fork 协议如何工作？ | 第一帧 JSON 元数据 + 后续 PCM 帧 |

---

## 合规说明

### 个体工商户限制

⚠️ **个体工商户无法直接申请 B24 呼叫中心业务许可证**（要求公司法人 + 注册资本 1000 万 + 跨省经营许可）。

### 本项目合规边界

| 用途 | 是否合规 |
|---|---|
| 个人学习/求职作品 Demo | ✅ 合规 |
| 用自有号码 + Twilio 测试号 | ✅ 合规（国外号码） |
| 内部测试不外呼真实客户 | ✅ 合规 |
| 商用外呼真实客户 | ❌ 需注册公司 + B24 牌照 |
| 国内 PSTN 大规模外呼 | ❌ 需运营商 700 号段正规渠道 |

### 商用化路径

如未来要商用：
1. 注册公司（建议有限公司，注册资本 1000 万+）
2. 申请 B24 呼叫中心业务经营许可证
3. 接入运营商 700 号段正规中继
4. 完成等保三级认证
5. 接入工信部外呼号码备案系统

---

## 路线图

### Phase 1：骨架（已完成 ✅）
- [x] Monorepo 搭建
- [x] Provider 抽象层 + Mock 实现
- [x] NestJS 后端（场景/任务/工具/知识库）
- [x] Voice Agent 主循环 + CLI 模式
- [x] Next.js Dashboard
- [x] FreeSWITCH Docker 配置

### Phase 2：真实接入（待开发）
- [ ] 接入 OpenAI GPT-4o
- [ ] 接入 Deepgram STT
- [ ] 接入 Cartesia TTS
- [ ] 接入 Chroma 向量库
- [ ] 接入 FreeSWITCH ESL 真实外呼
- [ ] WebSocket 服务接入 mod_audio_fork 真实音频流

### Phase 3：生产化（待开发）
- [ ] PostgreSQL + Prisma 持久化
- [ ] Redis + BullMQ 任务队列
- [ ] OpenTelemetry 全链路追踪
- [ ] 通话录音 + 转写存储
- [ ] 意向分级算法

### Phase 4：求职作品打磨（待开发）
- [ ] 录制 3-5 分钟 Demo 视频
- [ ] 部署在线 Demo（Fly.io / Railway）
- [ ] 性能数据（延迟、接通率、转化率）
- [ ] GitHub README 完善

---

## 技术栈版本

| 依赖 | 版本 |
|---|---|
| Node.js | >= 18 |
| pnpm | 9.12.0 |
| TypeScript | 5.5 |
| NestJS | 10.3 |
| Next.js | 14.2 |
| React | 18.3 |
| ws（WebSocket 服务端） | 8.18 |
| FreeSWITCH | 1.10.11 |
| Turbo | 2.1 |
| Python | >= 3.10 |
| FunASR | >= 1.1（ModelScope 模型） |
| FastAPI | >= 0.110（uvicorn[standard]） |
| PyTorch | >= 2.0（默认 CUDA 12.1，无 GPU 自动降级 CPU） |

---

## 联系方式

个人开发者项目，求职作品展示用途。

如需查看完整代码或讨论技术细节，欢迎交流。

---

*文档版本：v0.1.0 | 更新时间：2026-06-26*
