# 部署 / 上线运维手册

> 面向：把 ai-call 从「本地手动裸进程」推到「PM2 常驻守护」的生产部署。
> 关联文档：`CLAUDE.md`（命令总览）、`docs/backlog.md`（A6 死信落盘）、`docs/architecture-v2.md`（架构总览）、`docs/knowledge-base-microfrontend.md`（知识库微前端设计）、`docs/authz-go-live-checklist.md`（统一权限上线清单）。
> 本文档只讲**部署动作与运维铁律**，不讲功能设计。

---

## 0. 铁律（先记住这条，再往下看）

> **绝不能在编译版进程运行期间执行 `nest build` / `pnpm build`。**

`apps/api/nest-cli.json` 开了 `deleteOutDir: true`，`nest build` 第一步就是 `rimraf dist`——如果 API 或任一 worker 正跑着 `node dist/xxx.js`，这一下会直接删掉它正在执行的文件，进程随即崩溃或行为未定义。

正确顺序永远是：

```
pm2 stop ecosystem.config.js   # 1. 先停
pnpm --filter @ai-call/api build   # 2. 再 build（或 pnpm build 走全量）
pm2 start ecosystem.config.js  # 3. 再启
```

同理，dashboard 的 `next build` 也不能在 `next start` 跑着的时候执行（会覆盖 `.next` 产物，行为同样未定义），一律先 `pm2 stop dashboard`。

---

## 1. 为什么 worker 必须跑编译产物，不能用 tsx

`apps/api/package.json` 里 `dev:outbox` / `dev:scheduler` / `dev:freeswitch-events` 用的是 `tsx src/xxx.main.ts`，这在本地开发很方便（不用等 build），但**不能带进生产**：

- `tsx` 底层用 `esbuild` 做 transpile-only 转译，不跑完整的 TypeScript 类型检查/装饰器降级流程。
- NestJS 的依赖注入依赖 `emitDecoratorMetadata` 在装饰器上补全参数类型元数据；esbuild 对这个特性的支持不完整（尤其是接口类型、循环引用、部分泛型场景），会导致某些构造函数参数的类型元数据丢失。
- 后果不是报错，而是**静默**：受影响的构造函数参数在运行期被注入为 `undefined`，服务表面上启动成功、日志正常，但内部某个依赖是 `undefined`，直到第一次调用到它才报 `Cannot read properties of undefined`，或者更隐蔽——直接吞掉某个分支，表现为「worker 启动了但什么都不做」。
- `nest build`（`tsc` 完整编译）没有这个问题，装饰器元数据是完整的。

**结论**：本地开发用 `pnpm dev:outbox` 等 tsx 脚本没问题；生产 / 任何长期运行的环境，一律 `nest build` 之后跑 `node dist/*.main.js`（`ecosystem.config.js` 已经这样配置）。

---

## 2. 构建顺序

```bash
# 1. 安装依赖
pnpm install

# 2. 构建共享包（apps/api、apps/dashboard 都从它的编译产物导入类型/DTO）
pnpm --filter @ai-call/shared build

# 3. 生成 Prisma Client（schema 有变更时必做；输出到 apps/api/src/generated/prisma）
pnpm --filter @ai-call/api prisma:generate

# 4. 应用数据库迁移 —— 生产环境永远用 migrate deploy，绝不用 migrate dev
#    （migrate dev 会在检测到 schema 漂移时提示重置数据库，生产库绝不能承受这个）
pnpm --filter @ai-call/api prisma migrate deploy

# 5. 编译 API + 三个 worker（共用同一份 dist，nest build 会连 *.main.ts 一起编译）
pnpm --filter @ai-call/api build

# 6. 编译 dashboard（生产模式，若要用 next start）
pnpm --filter @ai-call/dashboard build
```

Python 两个服务（voice-agent、funasr-server）不需要编译，直接用各自 `.venv` 里的解释器跑源码即可，见第 6 节。

---

## 3. 启动依赖顺序

进程之间有依赖关系，冷启动按下面顺序拉起（PM2 本身不做依赖编排，需要人工按序 `pm2 start`，或接受短暂的启动期报错自愈——各服务对下游未就绪都有重试/重连逻辑，顺序错了通常只是多等几次重试，不是致命的）：

1. **Docker 基础设施**：`pnpm freeswitch:up`（内含/依赖 postgres、redis，视 compose 配置）—— 确认 Postgres、Redis、FreeSWITCH 都已就绪。
2. **funasr-server**（STT 模型服务，加载模型较慢，最先起）—— **仅在本地 STT/embedding 时需要**；若 `STT_PROVIDER=dashscope` 且 `INTENT_EMBED_PROVIDER=dashscope`（全云化），整条跳过，见第 8 节
3. **api**（控制面，其余组件都要调它的 HTTP 接口）
4. **freeswitch-event-worker**（订阅 FreeSWITCH ESL 事件，依赖 api 可写状态）
5. **voice-agent**（依赖 api 拿 flow 快照/任务上下文，依赖 funasr-server 做 STT）
6. **outbox-worker / scheduler-worker**（可与上面并行，二者之间无先后依赖）

用 PM2 一次性拉起全部（不保证顺序，见上文关于重试自愈的说明）：

```bash
pnpm pm2:start
```

需要严格顺序时手动分批：

```bash
pm2 start ecosystem.config.js --only funasr-server
pm2 start ecosystem.config.js --only api
pm2 start ecosystem.config.js --only freeswitch-event-worker
pm2 start ecosystem.config.js --only voice-agent
pm2 start ecosystem.config.js --only outbox-worker,scheduler-worker
```

---

## 4. 健康检查端点清单

以下路径均在代码中 grep 确认过（非推测）：

| 服务 | 地址 | 路径 | 依据 |
|---|---|---|---|
| freeswitch-event-worker | `FREESWITCH_EVENT_HEALTH_HOST:FREESWITCH_EVENT_HEALTH_PORT`（默认 `127.0.0.1:3012`） | `GET /health`、`/health/live`、`/health/ready` | `apps/api/src/freeswitch/freeswitch-event-worker-health.controller.ts`（无 `/api` 前缀，独立 Nest 应用，见 `freeswitch-event-worker.main.ts`） |
| voice-agent | `VOICE_AGENT_WS_HOST:VOICE_AGENT_WS_PORT`（默认 `127.0.0.1:8090`） | `GET /health`、`/health/live`、`/health/ready` | `services/voice-agent/src/voice_agent/server.py`（与 WebSocket 同端口，走 HTTP upgrade 前的 `process_request` 拦截） |
| funasr-server | `FUNASR_SERVER_HOST:FUNASR_SERVER_PORT`（默认端口 `10095`） | `GET /health` | `services/funasr-server/src/funasr_server/api/health.py` |
| api（主控制面，`:3001`） | — | `GET /api/health` | `apps/api/src/health/health.controller.ts`（`@Public()`，无需登录、无需 `X-Service-Token`；内部对 Prisma 做 `SELECT 1`，2s 超时，DB 不通时回 503 + `db:'down'`，正常回 200 + `{status:'ok',db:'up',uptime_s}`） |

D8 已交付：探活脚本/负载均衡器应改用 `curl -sf http://127.0.0.1:3001/api/health`（HTTP 状态码即语义健康态，不再是单纯「进程活着」的代理）。`GET /api/internal/metrics`（`@Public()` + `ServiceAuthGuard`）仍然存在，可继续用于取指标快照，但不建议再当健康检查用。

outbox-worker / scheduler-worker 是 `NestFactory.createApplicationContext`（无 HTTP 监听），**没有健康检查端点**，只能靠 PM2 的进程存活状态（`pm2 status` / `pm2 describe <name>`）判断。

---

## 5. 上线前配置检查清单

对照 `.env` / `.env.example` 逐项确认，dev 默认值**不能带进生产**：

- [ ] `JWT_SECRET`：改为强随机值（当前 dev 默认 `dev-secret-change-in-production`）。
- [ ] `SERVICE_API_TOKEN`：改为强随机值（当前 dev 默认 `service-token-change-in-production`）；设置后，`freeswitch-event-worker.main.ts` 在 `NODE_ENV=production` 且未配置时会**直接拒绝启动**（已有自检）。
- [ ] `VOICE_AGENT_WS_TOKEN`：生产必须配置（当前 `.env` 为空，语音 WebSocket 无鉴权）。
- [ ] `DEFAULT_ADMIN_PASSWORD`：改掉默认值 `admin123`（seed 脚本用它建初始管理员）。
- [ ] `CORS_ORIGINS`：收紧为生产域名白名单，逗号分隔，**绝不能是 `*`**（当前 dev 值 `http://localhost:3000`）。
- [ ] `FREESWITCH_DIAL_STRING`：从当前本机联调值（`sofia/internal/sip:{to}@192.168.0.104:5062`）换成生产 SIP 中继网关（如 `sofia/gateway/default/{to}`）。
- [ ] 合规外呼时间窗 / 日限：存于数据库单例行 `global_config.outboundRules`（**不是 env 变量**，通过 `PATCH /api/global-config` 或 dashboard「全局配置」页修改；代码默认值见 `packages/shared/src/global-config.ts` 的 `DEFAULT_OUTBOUND_RULES`，已经是 `09:00–18:00` 工作日、`dailyCallLimitPerCallee=3`）。若开发/联调期间为了测试放宽过这个时间窗或日限，上线前务必确认线上这条配置记录已改回或本就是默认值——**不要假设代码默认值生效，要去查库里那条 `default` 记录实际存的是什么**。
- [ ] `FREESWITCH_EVENT_DEAD_LETTER_PATH`：指向持久卷绝对路径（本仓已在 `.env` 设为 `I:\ai-call\.runtime\dead-letters\freeswitch-event-dead-letter.jsonl`；生产环境按实际持久卷路径覆盖，不要用容器/进程的临时目录）。
- [ ] `INTEGRATION_CONNECTOR_ALLOWLIST`：限定为 `mock://` 或白名单 HTTPS 域名。
- [ ] `DASHSCOPE_API_KEY`：若 STT 或 embedding 用云端（`dashscope`），**必须配置**（与 Qwen-LLM/TTS 同一把阿里云百炼密钥）；缺失时 STT 工厂告警并回退本地 funasr、embedding fail-open 落 LLM。D2 轮换密钥时一并处理。
- [ ] `STT_PROVIDER` / `INTENT_EMBED_PROVIDER`：确认与部署形态一致（全云化 = 都 `dashscope` 且**不部署 funasr-server**；本地 = `funasr`）。详见第 8 节。
- [ ] Prisma 迁移：确认生产库已执行 `prisma migrate deploy` 且无待应用迁移（`prisma migrate status`）。

---

## 6. PM2 常用命令

```bash
npm i -g pm2                        # 全局装一次即可

pnpm pm2:start                      # = pm2 start ecosystem.config.js（启动全部 7 个进程）
pnpm pm2:stop                       # = pm2 stop ecosystem.config.js

pm2 status                          # 查看全部进程状态/重启次数
pm2 logs api                        # 实时看某个进程日志（也可直接看 .runtime/pm2-logs/<name>.log）
pm2 restart freeswitch-event-worker # 重启单个进程
pm2 describe voice-agent            # 单进程详情（含最近崩溃原因）

pm2 save                            # 把当前进程列表存为开机自启快照
pm2 startup                         # 生成「开机自动拉起 pm2」的系统服务安装命令（按提示执行）
```

### Linux 路径差异

`ecosystem.config.js` 里的 Python 解释器路径写的是 Windows 形式：

```
services/voice-agent/.venv/Scripts/python.exe
services/funasr-server/.venv/Scripts/python.exe
```

Linux/macOS 下虚拟环境目录结构不同，部署到 Linux 时把这两处改成：

```
services/voice-agent/.venv/bin/python
services/funasr-server/.venv/bin/python
```

其余配置（`cwd`、`interpreter_args: '-m'`、`script` 模块名、`env.PYTHONPATH`）不受平台影响，无需改动。

---

## 7. 已知限制 / 未覆盖

- api 主进程已有 `GET /api/health`（见第 4 节，D8 已交付）；outbox-worker/scheduler-worker 仍是 `NestFactory.createApplicationContext`（无 HTTP 监听），无独立健康检查端点，只能靠 PM2 进程存活判断。
- `ecosystem.config.js` 不做依赖编排，`pm2 start ecosystem.config.js` 会近乎同时拉起全部 7 个进程；若要严格顺序启动，用第 3 节的分批命令。
- dashboard 条目默认包含在 `ecosystem.config.js` 里；如果还没 `next build` 过就整体 `pm2 start`，dashboard 会持续崩溃重启（`max_restarts: 10` 后停止重试）。首次部署记得先 build 或用 `--only` 排除它。

---

## 8. AI Provider：本地模型 vs 阿里云百炼云端

STT 和意图 embedding 都支持「本地模型」或「阿里云百炼（DashScope）云端」两种后端，由 env 切换，复用同一把 `DASHSCOPE_API_KEY`（与 Qwen-LLM/TTS 同一密钥）。**无 GPU 的服务器强烈建议全云化**——本地 FunASR 的 paraformer-large 在 CPU 上延迟高、并发差，还要和 FreeSWITCH/API/PG 抢内存（4核8GB 无 GPU 的机器基本扛不住本地模型）。

| 能力 | 本地 | 云端（阿里云百炼） | 切换 env |
|---|---|---|---|
| STT | funasr-server（GPU 友好） | Fun-ASR 实时（`fun-asr-realtime`） | `STT_PROVIDER=funasr` \| `dashscope` |
| 意图 embedding | funasr-server `/embed`（bge-small） | text-embedding-v4 | `INTENT_EMBED_PROVIDER=funasr` \| `dashscope` |
| LLM | —（本就云端 / 可 mock） | DeepSeek / Qwen | `LLM_PROVIDER` |
| TTS | —（可 mock） | CosyVoice v2 云端 / Qwen-TTS（均阿里云百炼） | `TTS_PROVIDER=cosyvoice` \| `qwen` \| `mock` |

相关模型名 env：`FUNASR_CLOUD_MODEL=fun-asr-realtime`、`INTENT_EMBED_MODEL=text-embedding-v4`（均有默认值，通常无需改）。

TTS 说明：CosyVoice 现走**云端 tts_v2 流式**（非旧的本地 `/inference_sft` 部署），复用 `DASHSCOPE_API_KEY`；生产 CosyVoice 优先（`TTS_PROVIDER=cosyvoice`）。实际每通话的 provider/音色由**场景 `ttsConfig.provider` + `voice`** 决定（选克隆音色时前端按克隆模型写入），`TTS_PROVIDER` 仅作场景未指定时的兜底默认。音色克隆试听经 api → voice-agent `/tts-stream` 代理真合成。相关：`COSYVOICE_MODEL`、`COSYVOICE_CLONE_TARGET_MODEL`、`COSYVOICE_VOICE`；`COSYVOICE_ENABLE_INSTRUCT=false`（cosyvoice-v2 不支持 instruction，带上会 428 无声，务必保持关闭）。

### 全云化（STT + embedding 都 `dashscope`）—— 无 GPU 服务器推荐形态

- **不需要部署 funasr-server**：它是唯一需要 GPU / 重内存的组件，去掉后控制面 + 媒体面（api / voice-agent / workers / FreeSWITCH / PG / Redis）在无 GPU 机器上即可运行。
- 第 3 节启动顺序里**跳过 funasr-server**；`ecosystem.config.js` 移除其条目，或 `pm2 start` 时用 `--only` 排除。
- 必配 `DASHSCOPE_API_KEY`（见第 5 节清单）。
- voice-agent 的 `FUNASR_WS_URL` 此时不再使用（STT 走云端），可忽略。

### 回退到本地

任一 provider 改回 `funasr` 并**重启对应进程**（voice-agent 不热重载，改 env 必须重启）即回到本地模型；此时需重新部署并启动 funasr-server。

### 云端 Fun-ASR 的两个特性（已在代码处理，无需部署侧操作，仅供排障参考）

1. **task 23 秒空闲超时**：DashScope 实时识别 task 一旦 `run-task` 便开始 23 秒空闲倒计时。voice-agent 已把 `run-task` 延迟到「首帧真实音频」、WebSocket 靠 ping 保活——开场白门控期不发音频也不会触发超时。排障日志前缀 `[FunASR/Cloud]`（含 `task-failed` 的 error_message）。
2. **句尾判定**：云端不像本地 FunASR 那样由 `is_speaking:false` 显式触发整句 final；voice-agent 用 VAD 句尾（`end_speech`）把最近 partial 兜底成 final，行为与本地一致。

### 契约字段注意（踩过的坑）

voice-agent 经 `contracts.py` 的 pydantic 契约消费 API 响应，`ContractModel` 配了 `extra="ignore"`——**任何未在 Contract 里声明的字段都会被静默丢弃**。给流程/任务上下文新增字段（如边级 `intentExamples`）后，必须同步在对应 Contract（如 `FlowEdgeContract`）声明，否则字段到不了运行链，且不报错、极难排查。

---

## 9. 前端（dashboard）部署

dashboard 是**带服务端逻辑的 Next.js 应用**（不是静态站点，有 Route Handler 在 server 端转发 API），生产用 `next build` + `next start -p 3000`（`ecosystem.config.js` 已配为 PM2 进程 `dashboard`）。**不能静态导出 / 纯 CDN 托管**。

### 部署步骤

```bash
# 1. 构建（必须在 dashboard 未运行时执行，见第 0 节铁律：next build 会覆盖 .next 产物）
pnpm --filter @ai-call/shared build       # 前端从 shared 的编译产物导入类型/DTO
pnpm --filter @ai-call/dashboard build     # next build → .next 产物

# 2. 启动
pm2 start ecosystem.config.js --only dashboard   # = next start -p 3000
```

### 前端环境变量（`apps/dashboard/.env.local`，模板见 `.env.example`）

分两类，机制不同：

**① `NEXT_PUBLIC_*`（浏览器可见，`next build` 时内联进产物 —— 改了必须重新 build 才生效）：**
- `NEXT_PUBLIC_VOICE_AGENT_WS_URL`：浏览器连 voice-agent 的 WebSocket 基地址（首页浏览器模拟外呼 `/audio-stream`、语音 demo `/asr-stream` + `/tts-stream` 用）。**通常留空**，由 `apps/dashboard/lib/voice-agent-ws.ts` 的 `voiceAgentWsBaseUrl()` 按运行环境派生：
  - 本地（localhost/127.0.0.1）→ 直连 `<ws|wss>://<host>:8090`；
  - **生产域名 → 同源、不带端口 `<ws|wss>://<域名>`**，由 nginx 按路径反代到 voice-agent（见下方「反向代理」）。协议随页面自动 ws/wss，HTTPS 站点绝不会退化成 `ws://`。
  - **仅当** voice-agent 走独立子域或自定义路径前缀时才显式填（如 `wss://voice.example.com` 或 `wss://app.example.com/voice-ws`）；显式值优先级最高。切勿在生产填 `:8090`——那是内网监听端口，不对浏览器暴露。
- `NEXT_PUBLIC_FUNASR_*` / `NEXT_PUBLIC_QWEN_TTS_*` / `NEXT_PUBLIC_TTS_SAMPLE_RATE`：仅前端展示用，实际 STT/TTS 由 Python 后端代理，值不精确也不影响功能。

**② 服务端私有（不暴露浏览器，运行时读取，改了重启即可）：**
- `API_INTERNAL_URL`（默认 `http://localhost:3001/api`）：NestJS API 地址。**浏览器的 `/api/*` 请求从不直连后端**——dev 由 `next.config.js` 的 `rewrites` 同源代理；**prod 由 Route Handler `app/api/[...path]/route.ts` 在 dashboard server 端转发**到这里。因此 dashboard server 必须能访问 `API_INTERNAL_URL`（内网地址即可），前端与后端**可以不同域**，后端也**无需对公网暴露**。
- `KNOWLEDGE_ZONE_URL`（可选，知识库微前端 Multi-Zones）：指向 ai-knowledge web 时 `/knowledge/*` 转发内嵌其原厂 UI；留空回落自带 mock 页。**要求与 ai-knowledge 同域部署**（cookie 共享、鉴权免改造），详见 `docs/knowledge-base-microfrontend.md`。

### 反向代理（生产建议拓扑）

- 对外只暴露 dashboard（:3000）作为站点入口；
- `/api/*` 由 dashboard server 转发到 NestJS（:3001）—— **NestJS 不必开公网**，仅供 dashboard server 内网访问；
- 语音 WebSocket 与站点**同域同源**：nginx 按路径把 `/audio-stream`、`/asr-stream`、`/tts-stream` 反代到 voice-agent :8090（`NEXT_PUBLIC_VOICE_AGENT_WS_URL` 留空即走此形态）。若改走独立子域/前缀，另配并在该变量显式指向。

推荐同源拓扑：`/`→`:3000`（dashboard）、三个语音 WS 路径→`:8090`（voice-agent）、`:8090` 与 `:3001` 均不开公网。三个 WS 路径的 nginx 配置（关键在 `Upgrade`/`Connection` 头与长超时）：

```nginx
# 站点入口（HTTPS 终止在 nginx）
server {
    listen 443 ssl;
    server_name app.example.com;
    # ... ssl_certificate 等 ...

    # 语音 WebSocket：同源按路径反代到 voice-agent（内网 :8090）
    location ~ ^/(audio-stream|asr-stream|tts-stream)$ {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;   # 通话是长连接，别用默认 60s
        proxy_send_timeout 3600s;
    }

    # 站点其余流量 → dashboard（:3000，含 /api/* 由 dashboard server 端转发）
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;   # Next.js HMR / 潜在 WS
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> 注意：`VOICE_AGENT_WS_TOKEN` 配置后，`/audio-stream` 的 metadata 与 demo WS query 必须携带 token（见第 5 节清单）；此鉴权在 voice-agent 侧校验，nginx 只需透传。
> api → voice-agent 的**服务端调用**（音色克隆试听经 `/tts-stream` 代理合成）走内网直连 `VOICE_AGENT_WS_URL`/`127.0.0.1:8090`，不经过上面的浏览器同源反代，无需额外配置。

---

## 10. 知识库（ai-knowledge）生产部署 —— 微前端 + RAG 检索链路

> 设计与鉴权原理见 `docs/knowledge-base-microfrontend.md`（本节只讲部署动作）；完整安全项逐条核对见 `docs/authz-go-live-checklist.md`。
> ai-knowledge 是**独立仓库**（`https://github.com/xiaoli-byte/yixiu-ai-kb.git`，Next.js 15 web + NestJS API + 自己的 Postgres），与 ai-call **必须部署在同一域名下**（cookie 共享是联合登录的前提），同一台机器最省事。
> 截至本节写入时（2026-07-14），代码与本地联调均已完成（ai-knowledge 侧含 commit `f5c53ee` 的联合登录支持），**生产尚未部署**——本节即生产首次上线步骤。

两条链路，可分开上线、分开验证：

| 链路 | 作用 | 依赖 |
|---|---|---|
| **A. RAG 检索**（voice-agent → ai-call → ai-knowledge `/search/retrieve`） | 通话中知识库检索 | 只需 ai-knowledge **API** 起来 + 三个 service token 对齐；与前端无关 |
| **B. 微前端管理界面**（dashboard `/knowledge/*` 内嵌 ai-knowledge web） | 建库/传文档/浏览 | 需 ai-knowledge **web** 以 zone 模式构建 + nginx 分流 + JWT 密钥统一 |

### 10.1 端口与拓扑约定

| 进程 | 端口 | 暴露 |
|---|---|---|
| ai-knowledge API（NestJS） | `:9999` | 仅内网（nginx 反代） |
| ai-knowledge web（Next.js） | `:8888` | 仅内网（nginx 反代） |

nginx 在现有站点 server 块（第 9 节）内按路径分流：`/knowledge/api/*` → `:9999`（剥 `/knowledge` 前缀）、`/knowledge/*` → `:8888`（保留前缀）、其余不变。

### 10.2 ai-knowledge 侧：环境变量 + 构建 + 启动

在 ai-knowledge 仓库目录内操作（构建命令以该仓库自己的 README/脚本为准，通常 `pnpm install && pnpm build`）：

1. **API 侧 env**（运行时读取，改后重启即可）：
   - `SERVICE_API_TOKEN=<强随机值>` —— 必须与 ai-call 的 `KNOWLEDGE_SERVICE_API_TOKEN` **完全一致**（检索链路第二跳鉴权，以及 CALL-13 身份同步）。生产缺失会拒绝服务调用。
   - **KB-10 联邦 JWT（生产必须 RS256）**：`JWT_ACCESS_ALGORITHM=RS256`，为 ai-knowledge 自身配置 `JWT_ACCESS_PRIVATE_KEY`、`JWT_ACCESS_PUBLIC_KEY`、`JWT_ACCESS_KEY_ID=ai-knowledge-v1`；再将 ai-call 的**公钥**配置为 `FEDERATED_JWT_ACCESS_PUBLIC_KEY`，并设 `FEDERATED_JWT_ACCESS_KEY_ID=ai-call-v1`。不得配置或保存 ai-call 私钥。`JWT_ACCESS_SECRET` 仍应为强随机值，用于本系统既有 access-token 配置兼容；它不再作为联邦 token 验签密钥。
   - `FEDERATED_TENANT_ALLOWLIST=<逗号分隔的租户 id>` —— 生产建议设置，限制哪些 ai-call 租户可 JIT 开通联合身份；未设时仅要求租户已存在于 ai-knowledge `tenants` 表且 active（租户开通永远是显式运维动作，JIT 只到用户级）。
2. **web 侧 env**（⚠️ 含**构建期**变量，改了必须重新 `next build`）：
   - `WEB_BASE_PATH=/knowledge` —— 页面与 `_next` 资源全部挂到 `/knowledge` 前缀（zone 模式）。
   - `NEXT_PUBLIC_API_URL=/knowledge/api` —— **构建期内联**！忘改的现象：内嵌页面的 API 请求打到裸 `/api/*`，被 ai-call 的 API 接住报 404/401。
3. **数据库**：ai-knowledge 用自己的 Postgres 库，按其仓库文档执行生产迁移（等价于 `prisma migrate deploy`，同样绝不用 `migrate dev`）。本次必须包含 `0012_federated_user_lifecycle`：为 `users` 增加 `status`，停用/删除的联合账号仍保留以维持文档 owner 与审计归属。目标租户需**预先存在**于其 `tenants` 表且 active（JIT 不建租户）。
4. **构建并用 PM2 拉起**两个进程（web 构建必须在 env 设置**之后**；进程停止期间构建，同第 0 节铁律）：

```bash
# 在 ai-knowledge 仓库根目录
pnpm install && pnpm build          # 以其仓库实际脚本为准
pm2 start <其 API 入口> --name ai-kb-api     # 监听 :9999
pm2 start <其 web 入口> --name ai-kb-web     # next start -p 8888
pm2 save
```

### 10.3 ai-call 侧：环境变量（链路 A 的开关）

`apps/api` 的生产 `.env` 中（模板见根 `.env.example` 42–44 行）：

- `KNOWLEDGE_SERVICE_BASE_URL=http://127.0.0.1:9999/api` —— **含 `/api` 后缀**；为空 = 走 mock，RAG 不接真库。
- `KNOWLEDGE_SERVICE_API_TOKEN=<同 ai-knowledge 的 SERVICE_API_TOKEN>`。
- `KNOWLEDGE_SERVICE_TIMEOUT_MS=5000`（默认即可）。
- `KNOWLEDGE_SERVICE_FALLBACK_USER_ID`（默认 `system`）：`ownerId=null` 的系统/历史任务将以此身份仅检索租户公开语料（`COMPANY/PUBLIC`），确认符合预期。
- 复核第 5 节已有项：ai-call 入站 `SERVICE_API_TOKEN`（voice-agent 打 ai-call 用）与本节的 `KNOWLEDGE_SERVICE_API_TOKEN` 是**两个不同 token**，别配成同一个变量漏配另一个。

改完重启 api 进程（`pm2 restart api`）。启动日志确认：无 `KNOWLEDGE_SERVICE_BASE_URL is set but ... token is empty` 类自检拒绝，且已进入外部知识库模式。

> **CALL-13 身份同步**：不需要新增 token；创建、改角色、停用、删除用户复用上述出站 token，调用 ai-knowledge 的内部 `/api/federation/users/*`。两服务部署并健康后，使用具备 `system:user:update` 的 ai-call 管理员凭证执行一次 `POST /api/system/users/sync-knowledge`，幂等回填本次发布前已存在的账号。若返回 409，表示知识库内有同租户同邮箱但不同 id 的本地账号；必须人工迁移/清理，绝不能自动合并。

> **KB-10 切换顺序**：ai-call 同时设 `JWT_ACCESS_ALGORITHM=RS256`、自身 `JWT_ACCESS_PRIVATE_KEY` / `JWT_ACCESS_PUBLIC_KEY` 与 `JWT_ACCESS_KEY_ID=ai-call-v1`，再将它的公钥提供给上面的 ai-knowledge 联邦配置。选低峰期重启两侧，等待旧 HS256 access token 自然过期；切换后验证 ai-knowledge 仅接受带 `kid=ai-call-v1` 的 RS256 联邦 token。

dashboard 侧 `KNOWLEDGE_ZONE_URL` 在**有 nginx 分流的生产形态下可不设**（`/knowledge/*` 根本到不了 dashboard）；设了也无害（nginx 优先）。

### 10.4 nginx：在现有 server 块中加两条 location

插入到第 9 节现有 `server { ... }` 内。**必须用 `^~`**（现有语音 WS 是 regex location，不加 `^~` 会被 regex 抢走）；`/knowledge/api/` 比 `/knowledge/` 更长，最长前缀优先，天然先匹配：

```nginx
# /knowledge 无斜杠时补斜杠
location = /knowledge { return 308 /knowledge/; }

# ① 知识库 API：剥掉 /knowledge 前缀（/knowledge/api/x → /api/x）
location ^~ /knowledge/api/ {
    rewrite ^/knowledge(/api/.*)$ $1 break;
    proxy_pass http://127.0.0.1:9999;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ② 知识库前端（含 /knowledge/_next 资源）：保留完整路径（与 basePath 一致）
location ^~ /knowledge/ {
    proxy_pass http://127.0.0.1:8888;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`nginx -t` 通过后 reload。注意：nginx 直接分流后，ai-call middleware 对 `/knowledge/*` 的未登录边缘重定向**不再生效**（请求不经过 dashboard）——未登录访客由 ai-knowledge web 客户端守卫整页跳 ai-call `/login?redirect=…`，属预期行为，见微前端文档「会话生命周期」。

### 10.5 上线验证（按顺序，全部通过才算上线）

1. **链路 A（RAG 检索）**：按 `docs/testing/call-10-cross-tenant-retrieval.md` 播种两租户各一篇 COMPANY 文档，脚本 env 指向**生产**，跑 `node scripts/call-10-cross-tenant-retrieval.mjs` —— 全部【必过】断言通过（含缺/错 `X-Service-Token` → 401，生产配了 token 后 dev 里 skip 的 2.1/2.2 应转为通过）。验证完**按脚本文档的 SQL 清理生产测试 fixtures**。
2. **链路 B（界面 + 联合登录）**：浏览器登录 ai-call → 访问 `https://<域名>/knowledge` → 应看到 **ai-knowledge 原厂知识库界面**（不是 ai-call 的 mock 页），且**不用二次登录**即可拉出列表、上传文档（上传成功 = JIT 开通 + owner 归属正常；若报 `Foreign key constraint violated` 说明 JIT 未生效，查 JWT 密钥是否两侧一致）。
3. **登出闭环**：在 `/knowledge` 内点退出 → 应作废 cookie 并回到登录页；重进 `/knowledge` 不应被自动拉起会话。
4. **回归**：`/knowledge` 之外的 dashboard 页面、通话检索、「检索测试」按钮均不受影响；语音 WS 三路径仍正常。
5. **CALL-12 按库过滤（场景多库配置）**：在 ai-call“场景管理 → 关联知识库”中勾选一个或多个 ai-knowledge 的目标 **folder**。保存后 `knowledgeBaseIds` 会持久化，运行时逐库检索并按全局相关度取 TopK；兼容字段 `knowledgeBaseId` 保存首项。用 CALL-10 脚本场景 4（`KB_ID`/`KB_ID_OTHER` 设为两个文档不同的真实 folder id）验证单库隔离，再用场景测试确认多库可命中任一已选库。id 不对齐仍会优雅兜底为租户级全库，所以**不验证就等于没开**。
6. **CALL-13 生命周期**：回填后任选一个非默认管理员账号，依次验证角色修改、停用、删除：ai-knowledge 的同 id 用户应同步角色/状态；停用或删除后，即使持有此前签发但未过期的 ai-call access token，访问知识库 API 也应立即 401。删除后确认其 `users` 行仍存在且状态为 `deleted`，已有文档的 owner 不变。

### 10.6 回滚

纯配置回滚，无代码操作：

- 只回滚界面（链路 B）：删除 10.4 的两条 location + reload nginx → `/knowledge` 回落 dashboard 自带 mock 页（ai-knowledge 进程可留着不动）。
- 只回滚检索（链路 A）：清空 ai-call 的 `KNOWLEDGE_SERVICE_BASE_URL` + `pm2 restart api` → 回落 mock 检索。
- ai-knowledge web 恢复独立访问：清空 `WEB_BASE_PATH`、`NEXT_PUBLIC_API_URL` 还原为 `/api` 后**重新 build**。
