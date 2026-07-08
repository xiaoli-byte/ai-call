# AI Agent 外呼机器人

> 基于 FreeSWITCH + WebSocket 直连 + NestJS + Next.js + Python 语音代理的复合架构 AI 外呼机器人
>
> 个人开发者求职作品项目 | 三大业务场景 | 混合 AI 栈 | RAG 防幻觉 | Function Calling 业务闭环 | 不可变流程编排

> 生产化架构、不可变流程版本和数据库迁移说明见 [Architecture v2](docs/architecture-v2.md)。

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
- [数据模型](#数据模型)
- [安全与鉴权](#安全与鉴权)
- [求职作品亮点](#求职作品亮点)
- [合规说明](#合规说明)
- [路线图](#路线图)
- [技术栈版本](#技术栈版本)

---

## 项目定位

**目标**：构建一个可演示、可面试讲解、可二次开发的 AI 外呼机器人，覆盖从任务派发、实时语音对话到质检/转人工/合规的完整运营闭环。

**约束**：
- 个人开发者，NestJS/Next.js 技术栈 + Python 语音处理
- 有 FreeSWITCH 前公司经验（差异化优势）
- 个体工商户身份（无法直接申请 B24 呼叫中心牌照）
- 用自有号码 + Twilio 测试号 + FreeSWITCH mod_audio_fork 做演示
- 求职作品导向，需要展示工程能力和架构判断力

**非目标**：
- 不是商用产品（商用需注册公司 + B24 牌照）
- 不追求极限并发（当前面向可演示 + 可讲解，已预留 audio-gateway 拆分与多租户地基）

---

## 技术选型决策

### 整体选型矩阵

| 层级 | 选型 | 说明 |
|---|---|---|
| **Monorepo** | pnpm workspace + turbo | 多包共享依赖、并行构建、缓存优化 |
| **控制面/后端** | NestJS 10（`apps/api`，:3001） | 装饰器风格、模块化清晰、全局 RBAC 守卫 |
| **前端** | Next.js 14 App Router（`apps/dashboard`，:3000） | SSR + RSC、公开落地页 + 受保护工作台 |
| **实时语音代理** | Python 3.11（`services/voice-agent`） | 直连 FreeSWITCH、asyncio 编排 STT/VAD/LLM/TTS |
| **STT 模型服务** | 自建 FunASR FastAPI（`services/funasr-server`，:10095） | 可独立扩缩容的中文流式 ASR |
| **通信层** | FreeSWITCH + mod_audio_fork | 前公司经验、ESL 直连、万级并发潜力 |
| **数据库** | PostgreSQL + Prisma 7 | 34 张表，覆盖任务/通话/流程/计费全生命周期 |
| **可靠投递** | 事务性 Outbox + 独立 worker | 派单/动作至少一次 + 去重，指数退避重试 |
| **AI 编排** | 自建 Provider 抽象层（Python 侧） | 混合栈按 env 切换，Mock 优先 |

### AI 供应商混合栈（按 env 切换，无需改代码）

| 类型 | 本地/开源（推荐） | 云端可选 | Mock 默认 |
|---|---|---|---|
| **STT** | **FunASR**（自建 FastAPI，2pass 流式，中文优化） | — | FunASR 未连时由 Voice Agent 侧降级 |
| **LLM** | — | **DeepSeek**（deepseek-chat）/ **Qwen**（qwen-plus，DashScope）/ legacy httpx | `MockLLM` 回声 |
| **TTS** | **CosyVoice**（本地部署，中文情感） | **Qwen-TTS**（qwen3-tts-flash-realtime，DashScope） | `MockTTS` |
| **Embedding/RAG** | 由 NestJS 知识库模块提供（可接外部检索服务） | — | 内置 mock 检索 |

> 环境变量：`LLM_PROVIDER=deepseek|qwen|mock|legacy`、`TTS_PROVIDER=qwen|cosyvoice|mock`。默认全 `mock`，**无需任何 API Key 即可跑通完整对话主循环**。

### 为什么选 FunASR？

| 维度 | FunASR（本项目首选） | 云 ASR（Deepgram/阿里云等） |
|---|---|---|
| 部署方式 | Docker/本地 FastAPI，完全开源 | 云 API |
| 成本 | 免费（仅算力） | 按 minute 计费 |
| 中文准确率 | 高（达摩院模型，支持热词/ITN） | 中—高 |
| 流式延迟 | 2pass 模式：online 低延迟 + offline 整句修正 | 视厂商 |
| 隐私合规 | 数据不出服务器 | 数据出海/上云 |

本项目没有直接用 FunASR 官方 Docker，而是**自建了一体化 FastAPI 服务**（`services/funasr-server`），同时暴露 WebSocket（2pass 流式）、HTTP（同步文件识别）、SSE 三种接口，并加载 5 个模型（离线 ASR / 在线流式 ASR / FSMN-VAD / 标点 / 声纹），修复了官方脚本的硬编码模型 bug。

### 为什么 FreeSWITCH 直连而非 LiveKit Agents / SaaS？

| 维度 | LiveKit Agents | Vapi/Retell 等 SaaS | FreeSWITCH 直连（本项目） |
|---|---|---|---|
| 依赖复杂度 | LiveKit Server + SDK | 黑盒平台 | 一个 Python WS 服务 + ESL |
| 协议透明度 | SFU 抽象 | 不可见 | mod_audio_fork 帧协议（首帧 JSON + PCM 帧）完全可控 |
| 架构控制力 | 中 | 弱 | 强（全链路可控、可私有化） |
| 个人经验匹配 | 需学 SDK | 仅会用 API | 复用前公司 FreeSWITCH 经验 |
| 求职叙事 | 依赖第三方 | 仅调 API | 体现对协议与通信架构的理解 |

### 为什么 FreeSWITCH 而非 Asterisk？

并发模型（线程池 vs 一通道一线程）、模块化（mod_audio_fork）、国内主流采用率、以及**前公司实际使用经验**——最后一点是关键差异化优势。

---

## 系统架构

三个平面：**NestJS 是控制面和业务事实来源；Python Voice Agent 是实时执行面；FunASR 是可独立扩缩容的模型服务**。

```
┌─────────────────────────────────────────────────────────────────────┐
│  Next.js Dashboard（:3000）                                          │
│  公开落地首页 / 登录 / 外呼活动·任务·流程编辑器 / 质检·转人工       │
│  知识库 / 场景配置 / 音色克隆 / 全局配置 / 语音演示 / 系统管理       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP（Cookie JWT，同源 /api 代理）
┌──────────────────────────────▼──────────────────────────────────────┐
│  NestJS 控制面（:3001，@ai-call/api，全局前缀 /api）                 │
│  全局守卫：JwtAuthGuard + PermissionsGuard（RBAC）                   │
│  ┌────────────┬────────────┬────────────┬────────────┬───────────┐  │
│  │ tasks      │ task-flows │ scenarios  │ knowledge  │ tools(FC) │  │
│  │ campaigns  │ calls      │ quality    │ handoffs   │ compliance│  │
│  │ analytics  │ voice-clones│ tenants   │ integrations│ platform │  │
│  └────────────┴────────────┴────────────┴────────────┴───────────┘  │
│      │ 事务写入                                                       │
│      ▼                                                                │
│  PostgreSQL（Prisma，34 表） + outbox_events                         │
└───┬──────────────────────────────────────────┬──────────────────────┘
    │ 独立 worker 进程                          │ service-token（X-Service-Token）
    ▼                                          ▼
┌─────────────────────────┐    ┌───────────────────────────────────────┐
│ outbox-worker           │    │  Python Voice Agent（WS :8090）        │
│ scheduler-worker        │    │  services/voice-agent                  │
│ freeswitch-event-worker │    │  ┌─────────┐ WebRTC VAD 前置门控       │
└──────────┬──────────────┘    │  ├─────────┤ FunASR STT（2pass）      │
           │ ESL originate      │  ├─────────┤ RAG 检索（调 NestJS）     │
           ▼                    │  ├─────────┤ LLM（DeepSeek/Qwen，SSE） │
┌─────────────────────────┐    │  ├─────────┤ 工具调用（HTTP 调 /tools）│
│ FreeSWITCH + mod_audio_ │◄──►│  ├─────────┤ TTS（Qwen/CosyVoice）    │
│ fork                    │ WS │  └─────────┘ barge-in 打断             │
│ - SIP 中继/Twilio       │PCM └────────────────┬──────────────────────┘
│ - 录音 / CDR            │                     │ WebSocket
└──────────┬──────────────┘    ┌────────────────▼──────────────────────┐
           │ SIP/RTP            │  FunASR Server（FastAPI，:10095）      │
           ▼                    │  services/funasr-server（5 模型）      │
        PSTN 电话网              └───────────────────────────────────────┘
```

### 数据流（单次外呼）

```
1. Dashboard 创建任务       → POST /api/tasks
2. 派发（或调度器到点自动派发）→ POST /api/tasks/:id/dispatch
   └─ 同事务写入 outbox_events（call.dispatch_requested）
3. outbox-worker 领取事件   → FreeSwitchService.originate（ESL）
4. FreeSWITCH 拨打被叫 → 应答 → 启动 uuid_audio_fork
5. mod_audio_fork 把音频 fork 到 Voice Agent WebSocket（:8090/audio-stream）
   ├─ 第一帧：JSON 元数据（dialog_id / caller_id / scenario / token / 动态变量）
   └─ 后续帧：PCM 16-bit 16kHz mono
6. Voice Agent 拉取上下文   → GET /api/tasks/:id/context（含不可变流程快照）
7. 每轮对话：
   a. WebRTC VAD 前置门控 → 只把语音帧送 FunASR
   b. FunASR 2pass 流式转写（partial→final）
   c. RAG 检索 → POST /api/knowledge-base/:id/retrieve
   d. LLM 流式生成，可能触发 tool_call
   e. 工具 → POST /api/tools/{name}（service token）→ NestJS 业务逻辑
   f. TTS 流式合成 → 经同一 WebSocket 推回 FreeSWITCH 播放
   g. 用户抢话 → STT partial 触发 barge-in，取消 TTS/LLM
   ｜绑定流程时改由 FlowExecutor 执行发布时锁定的节点图
8. 逐轮上报转写（PATCH /transcript，Idempotency-Key 去重）
9. 通话结束 → 上报 outcome / 状态；可触发转人工、SMS/API/CRM 动作（经 outbox）
10. 通话后 AI 质检分析 → 生成转人工工单 / 数据洞察
```

---

## 项目结构

```
ai-call/
├── apps/
│   ├── api/                          # NestJS 控制面（:3001，@ai-call/api，ESM）
│   │   ├── prisma/
│   │   │   ├── schema.prisma          # 34 个 model
│   │   │   ├── migrations/            # 14 个迁移
│   │   │   └── seed.ts                # 权限/角色/管理员/场景/流程/demo 任务
│   │   └── src/
│   │       ├── main.ts                # 全局前缀 /api、CORS、Cookie、ValidationPipe
│   │       ├── app.module.ts          # 22 个业务模块 + 全局 JWT/权限守卫
│   │       ├── auth/ system/          # 认证（Cookie JWT + 刷新会话）+ RBAC 用户/角色/权限
│   │       ├── tasks/                 # 外呼任务 + 派发 + Outbox worker + 调度器
│   │       ├── task-flows/            # 流程草稿/发布/不可变版本
│   │       ├── scenarios/ scenario-tests/  # 场景配置 + 回归测试
│   │       ├── tools/                 # 11 个 Function Calling 端点
│   │       ├── knowledge-base/        # RAG 检索 + 文档上传
│   │       ├── campaigns/             # 外呼活动 + 名单 + 策略仿真
│   │       ├── calls/ quality/ handoffs/   # 通话记录 / AI 质检 / 转人工工单
│   │       ├── compliance/ analytics/ # 合规策略审计 / 数据分析
│   │       ├── integrations/          # 外部连接器（webhook/crm/sms）
│   │       ├── voice-clones/          # 声音克隆
│   │       ├── global-config/         # 全局变量/插件/外呼规则
│   │       ├── tenants/ platform/     # 多租户·计费·配额 / 平台运营聚合视图
│   │       ├── freeswitch/            # ESL 客户端（originate/hangup/transfer）+ 事件桥接
│   │       ├── llm/                   # 后端 LLM 网关（LangChain）
│   │       ├── outbox-worker.main.ts        # ↓ 三个独立 worker 进程入口
│   │       ├── scheduler-worker.main.ts
│   │       └── freeswitch-event-worker.main.ts
│   └── dashboard/                    # Next.js 14 App Router（:3000，@ai-call/dashboard）
│       ├── middleware.ts              # 公开首页/登录放行，其余 JWT 保护
│       ├── app/
│       │   ├── page.tsx               # 公开落地首页（WebGL 渐变 Hero）
│       │   ├── login/                 # 登录
│       │   ├── campaigns/ tasks/ task-flows/   # 活动 / 任务 / 流程编辑器（xyflow）
│       │   ├── scenarios/ knowledge/ voice-clones/ global-config/  # 配置组
│       │   ├── quality/ handoffs/ analytics/   # 运营组
│       │   ├── observability/ costs/ insights/ datasets/ templates/ organizations/ demo-guide/  # 平台组
│       │   ├── compliance/ integrations/ voice-demo/  # 合规 / 集成 / 实时语音演示
│       │   ├── system/                # 用户 / 角色权限管理
│       │   └── api/[...path]/         # 生产 BFF 反向代理（透传 Cookie/SSE）
│       ├── components/flow-builder/   # React Flow 流程编辑器 + zustand store
│       └── lib/api/                   # client/server 双实例 API 层（SWR）
├── services/
│   ├── voice-agent/                  # Python 实时语音代理（asyncio）
│   │   └── src/voice_agent/
│   │       ├── server.py demo_server.py   # WS 路由：/audio-stream /asr-stream /tts-stream /text-test
│   │       ├── agent.py               # STT→VAD→LLM→工具→TTS 对话主循环 + barge-in
│   │       ├── vad.py                 # WebRTC VAD 前置门控（滞后确认 + 300ms 预缓冲）
│   │       ├── stt.py                 # FunASR WebSocket 客户端（2pass）
│   │       ├── llm/                   # DeepSeek/Qwen/legacy/mock（LangChain 适配）
│   │       ├── tts*.py tts_factory.py # Qwen-TTS / CosyVoice / mock
│   │       ├── flow_executor.py flow_types.py  # 不可变流程快照执行引擎
│   │       ├── tools.py tasks.py      # 工具分发 + 任务生命周期上报（service token）
│   │       └── main.py                # WS 模式 / --cli 模式入口
│   └── funasr-server/                # 自建 FunASR FastAPI 服务（:10095）
│       └── src/funasr_server/         # WS/HTTP/SSE + 5 模型 + 热词 + 声纹
├── packages/
│   └── shared/                       # @ai-call/shared 跨端类型/DTO/场景定义/流程模板
├── contracts/                        # 跨语言 JSON Schema 契约
│   ├── task-api.schema.json           # 任务上下文 + 不可变流程快照
│   └── voice-websocket.schema.json    # 语音 WebSocket 消息契约
├── freeswitch/                       # Docker + dialplan + mod_audio_fork 配置 + 本地联调脚本
├── docs/                             # architecture-v2 / vad-architecture / 测试清单 等
├── scripts/                          # 备份/恢复/冒烟检查（PowerShell）
├── .github/workflows/ci.yml          # TS 与 Python 两条独立 CI
├── package.json / pnpm-workspace.yaml / turbo.json / tsconfig.base.json
```

> ⚠️ 早期版本曾把语音代理放在 `apps/voice-agent`（TypeScript）并有 `packages/providers` 包——现已迁移为 **Python `services/voice-agent`**，Provider 抽象层随之下沉到 Python 侧。以本结构为准。

---

## 三大业务场景

场景枚举 `collection | ecommerce | presale`，定义在 `packages/shared/src/scenarios.ts`，由 `seed.ts` 落库为 `OutboundScenario`，并各自绑定一个默认发布流程。

### 1. 贷后催收（collection）

| 项 | 内容 |
|---|---|
| **用途** | 信用卡/贷款还款提醒、逾期催收 |
| **工具** | query_repayment_info, calculate_penalty, create_extension_request, transfer_to_human |
| **转人工规则** | 情绪激动（angry/distressed）/ 提减免·延期·协商·困难 / 连续 2 次未理解 |
| **约束** | 专业平和、不威胁、不承诺减免、不评论信用状况、困难情况转人工 |
| **问候语** | 您好，我是{company}的还款提醒助理，关于您{product}的还款事项… |

### 2. 电商售后（ecommerce）

| 项 | 内容 |
|---|---|
| **用途** | 订单售后回访、退款进度查询、退换货预约 |
| **工具** | query_order, query_refund_status, create_pickup_appointment, create_after_sale_ticket, transfer_to_human |
| **转人工规则** | 投诉质量/假货 / 要求直接退款 / 情绪 angry |
| **约束** | 亲切耐心、不乱承诺退款、数字必须查知识库 |
| **问候语** | 您好，我是{company}的售后助理，关于您订单{orderNo}的售后事项… |

### 3. 售前邀约（presale）

| 项 | 内容 |
|---|---|
| **用途** | 4S 店试驾、产品体验、活动邀约 |
| **工具** | query_car_model, query_activity, create_test_drive_appointment, transfer_to_human |
| **转人工规则** | 明确无兴趣（不需要/没兴趣/别打了）/ 询价（多少钱/价格/优惠） |
| **约束** | 热情专业、不催促、不报价、价格转线下、不评竞品 |
| **问候语** | 您好，我是{company}的邀约助理，最近我们有{activity}活动… |

---

## 快速开始

### 环境要求

- Node.js >= 18（CI 用 22）、pnpm 9.12
- PostgreSQL（可本地或 Docker）
- Python >= 3.11（voice-agent）/ >= 3.10（funasr-server）
- Docker（可选，用于 FreeSWITCH + FunASR）

### 启动步骤

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量（默认全 Mock，无需任何 API Key）
cp .env.example .env      # 至少设置 DATABASE_URL 与 JWT_SECRET

# 3. 初始化数据库（生成 client → 迁移 → 种子）
pnpm --filter @ai-call/api prisma:generate
pnpm --filter @ai-call/api prisma:migrate
pnpm demo:init            # == prisma:seed，建权限/角色/管理员/场景/流程/demo 任务

# 4. 启动全部 TS 服务（API + Dashboard）
pnpm dev
```

服务地址：
- Dashboard: http://localhost:3000 （公开首页 `/`，登录 `/login`）
- API: http://localhost:3001/api
- Voice Agent WebSocket: ws://localhost:8090/audio-stream
- FunASR Server: http://localhost:10095

默认管理员：`DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD`（开发默认 `admin@ai-call.local` / `admin123`，见 `apps/api/prisma/seed.ts`）。

### 单独调试 Voice Agent（推荐先跑通）

```bash
pnpm dev:agent-py:cli
```

CLI 模式无需电话号码、无需 API Key，直接在终端模拟对话，验证：Provider 抽象、RAG 检索、Function Calling 闭环、多场景话术切换、流程执行。

### （可选）启动 FunASR 与 FreeSWITCH

```bash
pnpm dev:funasr                                # 本地 FunASR FastAPI（需先装 Python 依赖）
docker compose -f freeswitch/docker-compose.yml up -d   # FreeSWITCH（含 mod_audio_fork）
# 或 Windows 本地：pnpm freeswitch:local:start
```

### 接入真实 AI Provider

修改 `.env`（成本最低组合：FunASR STT + DeepSeek LLM）：

```bash
LLM_PROVIDER=deepseek
TTS_PROVIDER=cosyvoice          # 或 qwen
FUNASR_WS_URL=ws://localhost:10095
LLM_DEEPSEEK_API_KEY=your_key
# TTS_PROVIDER=qwen 时：DASHSCOPE_API_KEY=your_key
```

---

## 开发工作流

### 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | turbo 并行启动 API + Dashboard |
| `pnpm dev:api` / `dev:dashboard` | 单独启动 |
| `pnpm dev:agent-py` / `dev:agent-py:cli` | Python 语音代理（WS / CLI） |
| `pnpm dev:funasr` | FunASR 模型服务 |
| `pnpm build` | turbo 构建全部 |
| `pnpm lint` | **注意：`lint` 实为 `tsc --noEmit` 类型检查，不是 ESLint** |
| `pnpm test` | TS 测试（api + dashboard） |
| `pnpm check` | 完整门槛：shared 构建 + prisma 生成 + 类型检查 + 全部 TS/Python 测试 |
| `pnpm test:python:voice` / `test:python:funasr` | Python 测试 |

后台 worker（生产按需各起一个进程）：`dev:outbox` / `dev:scheduler` / `dev:freeswitch-events`。

### 数据库

```bash
pnpm --filter @ai-call/api prisma:generate   # 改 schema 后必跑，生成到 src/generated/prisma
pnpm --filter @ai-call/api prisma:migrate     # 本地开发迁移（生产用 migrate deploy）
pnpm --filter @ai-call/api db:studio          # Prisma Studio
```

变更活动/知识库/转人工/集成/场景测试/迁移时，按 [`docs/testing/operations-loop-regression.md`](docs/testing/operations-loop-regression.md) 回归。

### 验证清单

- [ ] CLI 模式跑通完整对话（问候 → 输入 → 回复 → 工具调用 → 转人工兜底）
- [ ] 登录后 Dashboard 能创建活动/任务并派发
- [ ] 三大场景话术切换正确
- [ ] `curl` 测试 `/api/tools/query_order`（带 X-Service-Token）
- [ ] 流程编辑器发布校验通过并生成不可变版本

---

## 核心设计

### 1. Provider 抽象层（混合栈核心，位于 Python 侧）

`services/voice-agent/src/voice_agent/` 下 `llm/`、`tts_factory.py`、`stt.py` 按 env 工厂化：

- **LLM**：`LLM_PROVIDER=deepseek|qwen|legacy|mock`，统一 `LLMAdapter` 协议（`chat/cancel/close`），基于 LangChain 流式 SSE + tool_call 聚合，**缺 key 自动降级 MockLLM**。
- **TTS**：`TTS_PROVIDER=qwen|cosyvoice|mock`，统一接口支持 `synthesize/interrupt`，均可被 barge-in 取消。
- **STT**：FunASR WebSocket 客户端，2pass 模式（online partial + offline final），支持热词/ITN。

Mock 优先：无任何凭证即可跑通主循环，降低开发门槛。

### 2. RAG 防幻觉三道防线

```
用户问题 → RAG 检索（调 NestJS 知识库）→ 拼接 system prompt → LLM 约束回答
   ① 检索注入：每轮把相关文档片段拼进 system prompt
   ② Prompt 约束：显式要求"涉及金额/日期必须基于知识库"
   ③ 工具兜底：超出能力（减免/退款/报价）→ Function Calling → 转人工
```

低置信检索会记录 `KnowledgeRetrievalLog`，供数据洞察分析。

### 3. Function Calling 业务闭环（工具即 HTTP 接口）

```
LLM tool_call → Voice Agent HTTP（service token）→ NestJS POST /api/tools/{name}
             ← tool_result（{ result, shouldEscalate? }）←──────────────────┘
```

11 个工具（催收 3 / 电商 4 / 售前 3 / 通用 1），**Python 侧 `TOOL_DEFS` 与后端 `tools.controller.ts` 路由一一对应**，按场景 `allowedTools` 过滤；任一工具失败或返回 `shouldEscalate` 即触发转人工。

### 4. 不可变流程编排（Architecture v2 核心不变量）

流程被版本化且不可变：编辑已发布 `TaskFlow` 会回到 `draft`；发布生成 `TaskFlowVersion` 快照（含 `scenarioSnapshot`）。任务创建时锁定 `flowVersionId`，**通话期间永远执行该快照**，编辑流程不影响在飞任务。发布前经 `validateFlowDefinition` 校验（唯一 start、可达 end、无悬空边、决策分支覆盖）。Voice Agent 的 `FlowExecutor` 执行 5 类节点：start / dialog（script·question·ai）/ decision（condition·intent）/ action（transfer·sms·api·crm）/ end。

### 5. 事务性 Outbox + 独立 worker

状态迁移与副作用解耦：`outbox_events` 与任务状态**同事务写入**，`outbox-worker` 用租约锁领取、指数退避重试（默认最多 5 次），派发 `call.dispatch_requested`（ESL originate）与 `action.sms/api/crm`。另有 `scheduler-worker`（到点自动派发）与 `freeswitch-event-worker`（回写呼叫事件，ESL 订阅循环目前为骨架 TODO）。

### 6. 转人工兜底

每场景配置三类触发（`escalationRules`）：关键词、情绪（angry/distressed）、连续未理解。质检分析可生成 `HandoffTicket` 工单并派生回拨任务。

### 7. 任务状态机

```
pending ──派发──▶ calling ──接通──▶ in_call ──结束──▶ completed
   │                │                  │
   │                │                  └──失败──▶ failed
   │                └──无人接听──▶ no_answer
   └──取消──▶ cancelled
```

### 8. VAD 分层

生产链路 VAD 放在 **Python Voice Agent 层**（FreeSWITCH 后、FunASR 前）：WebRTC VAD 粗筛门控（aggressiveness=3，滞后确认 speech_confirm=3 / silence_confirm=10，300ms 预缓冲防丢首字）。FunASR Server 内部另有 FSMN-VAD 做整句切分。前端 `/voice-demo` 的浏览器 VAD 仅服务 Demo，不参与生产。详见 [`docs/vad-architecture.md`](docs/vad-architecture.md)。

---

## 数据模型

Prisma schema 共 **34 个 model**（`apps/api/prisma/schema.prisma`，PostgreSQL），按领域：

- **场景/配置**：`OutboundScenario`、`GlobalConfig`
- **任务/通话生命周期**：`OutboundTask`（锁定 `flowVersionId`）、`CallAttempt`、`TranscriptTurn`、`CallEvent`、`CallAnalysis`
- **流程版本**：`TaskFlow`（草稿）、`TaskFlowVersion`（不可变快照）
- **外呼活动**：`Campaign`、`LeadImportBatch`、`CampaignLead`、`ContactAttemptHistory`
- **知识库**：`KnowledgeDocument`、`KnowledgeRetrievalLog`
- **语音克隆**：`VoiceClone`
- **集成**：`IntegrationConnector`、`ToolCallLog`
- **质检/转人工/合规/测试**：`HandoffTicket`、`ComplianceAuditLog`、`ScenarioTestRun`
- **可靠性**：`OutboxEvent`（去重键 + 租约锁）
- **多租户/计费**：`Tenant`、`TenantProviderConfig`、`TenantQuotaPolicy`、`UsageEvent`、`UsageAggregate`、`BillingAccount`
- **认证/RBAC**：`User`、`Role`、`Permission`、`RolePermission`、`UserRole`、`UserSession`

**关键不变量**：不可变 `TaskFlowVersion`（外键 Restrict）、`OutboxEvent` 去重键、`UsageEvent` 幂等键、`TranscriptTurn`/`CallAttempt` 唯一约束。

> 多租户现状：`tenantId` 仅贯穿计费/配额/用量相关表，**核心业务表尚未做行级租户隔离**——当前是"计费/配额地基已就绪，业务数据物理隔离待接入"。

---

## 安全与鉴权

- **用户鉴权**：登录后 NestJS 下发 httpOnly Cookie（`access_token` + `refresh_token`）。`JwtStrategy` 从 Cookie 取 JWT；`JwtAuthGuard` 与 `PermissionsGuard` **全局注册**，默认所有路由需认证 + 权限（`@Public()` 显式豁免）。refresh token bcrypt 存 `UserSession`，刷新时轮换。
- **RBAC**：权限码分组 `task:* / call:read / flow:* / scenario:* / knowledge:* / system:*`；内置角色 `admin / operator / viewer`（`packages/shared/src/auth.ts`）。
- **服务间鉴权**：Voice Agent / FreeSWITCH 桥接调用内部端点走 `X-Service-Token`（`SERVICE_API_TOKEN`，常量时间比较）；可选 HMAC 防重放（`SERVICE_API_REQUIRE_SIGNATURE` + 时间戳容忍窗口）。语音 WebSocket 可用 `VOICE_AGENT_WS_TOKEN`。
- **网络边界**：`CORS_ORIGINS` 逗号分隔明确来源（生产勿用 `*`）；集成连接器目标受 `ACTION_WEBHOOK_ALLOWLIST` 白名单限制；集成响应绝不回传 `authConfig`。

---

## 求职作品亮点

### 1. 架构判断力
- **三平面解耦**：控制面（NestJS）/ 执行面（Python Agent）/ 模型服务（FunASR）各自扩缩容
- **混合栈 + Mock 优先**：Provider 按 env 切换，无 key 也能跑通
- **不可变流程版本**：通话期间话术稳定，体现对"运行时一致性"的理解
- **事务性 Outbox**：派单副作用至少一次 + 去重 + 退避重试

### 2. 工程素养
- **CLI 模式**：无需电话即可验证对话，测试驱动
- **契约先行**：`contracts/*.json` 约束 TS/Python 边界，Python 侧 Pydantic 校验
- **全局 RBAC + service token**：认证/授权/服务间鉴权成体系
- **CI 双轨**：TypeScript 与 Python 各自验证（FunASR CI 用 mock，不下模型权重）

### 3. 业务理解
- **完整运营闭环**：活动 → 任务 → 通话 → 质检 → 转人工 → 数据洞察
- **三大场景 + 防幻觉三道防线 + 场景化转人工规则**

### 4. 复合背景
- **FreeSWITCH 经验**：ESL originate/audio_fork 直连，复用前公司经验
- **NestJS/Next.js + Python 语音处理**：全栈 + 实时音频

### 面试可讲的细节

| 问题 | 可讲内容 |
|---|---|
| 为什么 FreeSWITCH 直连而非 LiveKit/SaaS？ | 协议透明、零中间层、可私有化、复用经验 |
| 为什么自建 FunASR 服务？ | 开源免费、本地部署、中文优化、修官方硬编码 bug、一体化 WS/HTTP/SSE |
| 如何防幻觉？ | RAG 三道防线（检索注入 + Prompt 约束 + 工具兜底） |
| 如何保证通话中话术不变？ | 发布锁定不可变 TaskFlowVersion 快照 |
| 派单如何做到可靠？ | 事务 Outbox + 租约锁 + 去重键 + 指数退避 |
| 如何做延迟优化？ | 流式 STT/LLM/TTS + VAD 前置门控 + barge-in 打断 |
| FunASR 2pass 是什么？ | online 先给低延迟结果，offline 再给整句修正 |
| 鉴权体系？ | Cookie JWT + 全局权限守卫 + service token/HMAC |

---

## 合规说明

### 个体工商户限制

⚠️ **个体工商户无法直接申请 B24 呼叫中心业务许可证**（要求公司法人 + 注册资本 1000 万 + 跨省经营许可）。

### 合规边界

| 用途 | 是否合规 |
|---|---|
| 个人学习/求职作品 Demo | ✅ |
| 自有号码 + Twilio 测试号 | ✅ |
| 内部测试不外呼真实客户 | ✅ |
| 商用外呼真实客户 | ❌ 需注册公司 + B24 牌照 |
| 国内 PSTN 大规模外呼 | ❌ 需运营商 700 号段正规渠道 |

### 商用化路径

注册公司 → 申请 B24 牌照 → 接入运营商 700 号段中继 → 等保三级 → 工信部外呼号码备案。

---

## 路线图

### Phase 1 — 骨架 ✅
- [x] Monorepo + Provider 抽象 + Mock
- [x] NestJS 后端（场景/任务/工具/知识库）
- [x] Voice Agent 主循环 + CLI 模式
- [x] Next.js Dashboard + FreeSWITCH 配置

### Phase 2 — 生产化架构 ✅（Architecture v2）
- [x] PostgreSQL + Prisma 持久化（34 表）
- [x] 不可变流程版本 + 流程编辑器（xyflow）
- [x] 事务 Outbox + 独立 worker（派单/调度/事件桥接）
- [x] FreeSWITCH ESL 真实 originate + mod_audio_fork 音频流
- [x] Python Voice Agent（FunASR 2pass + WebRTC VAD + barge-in）
- [x] 自建 FunASR FastAPI 服务（WS/HTTP/SSE + 5 模型）
- [x] Cookie JWT + 全局 RBAC + service token

### Phase 3 — 运营闭环 & 产品化 ✅（进行中打磨）
- [x] 外呼活动 + 名单导入 + 策略仿真
- [x] 通话质检分析 + 转人工工单 + 回拨
- [x] 合规策略/审计 + 联系频控
- [x] 外部集成连接器 + 场景回归测试
- [x] 声音克隆（Qwen/CosyVoice）
- [x] 多租户/计费/配额地基 + 平台运营视图
- [ ] 核心业务表按租户行级隔离
- [ ] FreeSWITCH ESL 事件订阅循环（当前为骨架 TODO）

### Phase 4 — 求职作品打磨
- [ ] 录制 Demo 视频 + 在线部署
- [ ] 性能数据（延迟、接通率、转化率）

---

## 技术栈版本

| 依赖 | 版本 |
|---|---|
| Node.js | >= 18（CI 22） |
| pnpm | 9.12.0 |
| TypeScript | 5.5 |
| NestJS | 10.3 |
| Prisma | 7.8（PostgreSQL） |
| Next.js | 14.2（App Router） |
| React | 18.3 |
| SWR / zustand / react-hook-form / zod | 数据·状态·表单 |
| @xyflow/react | 12（流程编辑器） |
| Python（voice-agent / funasr-server） | >= 3.11 / >= 3.10 |
| FunASR / FastAPI / PyTorch | >= 1.1 / >= 0.110 / >= 2.0 |
| websockets / webrtcvad / LangChain | 语音代理核心 |
| FreeSWITCH | 1.10（drachtio mrf 镜像，含 mod_audio_fork） |
| Turbo | 2.1 |

---

*文档以实际代码为准，与 [`docs/architecture-v2.md`](docs/architecture-v2.md) 保持一致。*
