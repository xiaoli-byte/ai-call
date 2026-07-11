# 部署 / 上线运维手册

> 面向：把 ai-call 从「本地手动裸进程」推到「PM2 常驻守护」的生产部署。
> 关联文档：`CLAUDE.md`（命令总览）、`docs/backlog.md`（A6 死信落盘）、`docs/architecture-v2.md`（架构总览）。
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
2. **funasr-server**（STT 模型服务，加载模型较慢，最先起）
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
