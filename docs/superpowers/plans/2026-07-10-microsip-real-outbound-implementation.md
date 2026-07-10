# 本机 MicroSIP 真实外呼闭环实施计划

日期：2026-07-10

依据：docs/superpowers/specs/2026-07-10-microsip-real-outbound-design.md

目标：在保留 Scheduler、Outbox Worker、FreeSWITCH Event Worker 独立进程边界的前提下，实现“控制台创建立即任务 → 自动派发 → 本机 MicroSIP 1001 振铃 → 接听后执行已发布流程并双向 AI 语音 → 真实电话事件回写终态”的完整闭环。

技术栈：NestJS、Prisma 7、PostgreSQL、Node net.Socket、FreeSWITCH 1.10.1、Python Voice Agent、PowerShell、Docker Desktop、MicroSIP 3.22.10。

实施原则：

- 先建立协议和数据库兼容层，再启用真实事件生产者。
- 每个阶段先写聚焦测试，再改实现。
- web 通道保持兼容，不能因 FreeSWITCH 终态语义变化而卡住。
- 事件 raw、日志和异常不得泄露 token、SIP 密码或 api_on_answer metadata。
- bgapi +OK 不是振铃；只有真实 progress 事件可以写 ringingAt。
- ESL 不可回放，不宣称严格 exactly-once；使用幂等、重投和快照对账收敛。

---

## Task 1：建立 Buffer 级 ESL 协议底座

文件：

- 新增 apps/api/src/freeswitch/esl-frame-parser.ts
- 新增 apps/api/src/freeswitch/esl-frame-parser.spec.ts

- [ ] 实现增量 Buffer 解码器，识别 LF/CRLF header 边界。
- [ ] Content-Length 按字节读取，不使用 JavaScript 字符串长度。
- [ ] 支持 header-only、带 body、拆包、粘包和一次读取多个帧。
- [ ] 支持重复 header，并设置可配置的最大 header/body 限制。
- [ ] 提供 parsePlainEventPayload，解析 text/event-plain 内层 headers 和正文。
- [ ] 对 percent 编码做安全 decodeURIComponent；畸形值保留原文，不把加号替换为空格。
- [ ] 增加逐字节拆包、UTF-8 多字节、超长/负数长度、半帧断连测试。

聚焦验证：

pnpm --filter @ai-call/api exec tsx --test src/freeswitch/esl-frame-parser.spec.ts

建议提交：

test/fix(freeswitch): add byte-safe ESL frame parsing

---

## Task 2：扩展数据模型、迁移和共享契约

文件：

- 修改 apps/api/prisma/schema.prisma
- 新增 apps/api/prisma/migrations/20260710150000_real_outbound_event_idempotency/migration.sql
- 修改 packages/shared/src/tasks.ts
- 修改 apps/api/src/tasks/dto/provider-call-event.dto.ts
- 新增 apps/api/src/tasks/dto/provider-active-snapshot.dto.ts
- 修改 apps/api/src/tasks/task-payloads.ts

CallAttempt 新增：

- channel，默认 freeswitch。
- providerJobId，可空且唯一。
- lastProviderEventAt。
- lastProviderSnapshotId。
- lastProviderSnapshotAt。
- missingProviderSnapshotCount，默认 0。

CallEvent 新增：

- provider，可空。
- providerEventId，可空。
- provider + providerEventId 复合唯一约束。

迁移要求：

- 历史普通 CallEvent 不回填 provider 字段。
- 按既有 call.dispatch_accepted payload 中 channel=web 回填历史 web attempts。
- providerJobId 和 providerEventId 保持可空，避免破坏历史数据。
- 迁移后运行 Prisma generate，不手改 generated 目录。

DTO 要求：

- providerEventId、provider、eventType 有长度限制。
- jobId、backgroundJobResult 可选并有限长。
- provider event 至少有 attemptId、providerCallId 或 jobId 之一；taskId 不能单独作为电话事件关联依据。
- snapshot 包含 provider、snapshotId、observedAt、activeChannelIds；限制数组大小并逐项验证 UUID。

聚焦验证：

pnpm --filter @ai-call/api prisma:generate

pnpm --filter @ai-call/api exec prisma validate

pnpm --filter @ai-call/shared build

建议提交：

feat(api): persist provider event and job identities

---

## Task 3：重构 FreeSwitchService 命令连接

文件：

- 修改 apps/api/src/freeswitch/freeswitch.service.ts
- 修改 apps/api/src/freeswitch/freeswitch.service.spec.ts
- 必要时新增 apps/api/src/freeswitch/freeswitch-errors.ts

- [ ] 所有 ESL 命令使用 Task 1 的帧解析器。
- [ ] 严格验证 auth/request、认证 command/reply 和目标响应 Content-Type。
- [ ] originate 接口改为接收 to、attemptId、taskId。
- [ ] channel variables 增加 attempt_id、task_id 和 ai_call_managed=true。
- [ ] originate 返回 accepted、jobId、replyText；兼容独立 Job-UUID header 与 Reply-Text fallback。
- [ ] +OK 但没有 Job UUID 时视为失败。
- [ ] 增加 listActiveChannelIds，调用 api show channels as json 并只返回 UUID 集合。
- [ ] hangup 和 transfer 对 UUID/分机做输入校验，避免 ESL 命令注入。
- [ ] typed error 标明 retryable；错误消息只包含操作名和安全错误码。
- [ ] timeout、日志和异常禁止包含完整 originate 命令、base64 metadata、密码或 token。

聚焦测试：

- 分片认证和响应。
- 两种 Job UUID 返回格式。
- 缺失 Job UUID、认证失败、提前断连和超时。
- 0/多活动 channel JSON。
- 敏感字符串不会出现在错误或日志参数中。

聚焦验证：

pnpm --filter @ai-call/api exec tsx --test src/freeswitch/freeswitch.service.spec.ts

建议提交：

feat(freeswitch): return originate jobs safely

---

## Task 4：实现安全的 FreeSWITCH 事件语义解析

文件：

- 修改 apps/api/src/freeswitch/freeswitch-event-parser.ts
- 修改 apps/api/src/freeswitch/freeswitch-event-parser.spec.ts

- [ ] parser 输入改为 ESL plain event 的 headers + body。
- [ ] 支持 HEARTBEAT、BACKGROUND_JOB、PROGRESS、PROGRESS_MEDIA、ANSWER、HANGUP_COMPLETE 和 RECORD_STOP。
- [ ] BACKGROUND_JOB 解析 +OK/-ERR 正文、Job UUID 和标准化失败原因。
- [ ] 仅在严格 UUID 校验通过后，从内存中的 Job-Command-Arg 提取 origination_uuid。
- [ ] providerEventId 优先 Event-UUID；缺失时对 Core-UUID、Event-Sequence、事件名、job/channel UUID、时间和正文生成稳定 SHA-256。
- [ ] raw 只允许明确白名单字段。
- [ ] 明确排除 Job-Command-Arg、variable_api_on_answer、SIP/鉴权字段和 base64 metadata。

真实 1.10.1 fixture 必须覆盖：

- percent 编码的时间和字段。
- 没有 Event-UUID、只有 Core-UUID + Event-Sequence。
- BACKGROUND_JOB USER_NOT_REGISTERED/NO_ROUTE。
- 畸形 percent 编码。
- Event-Sequence 改变时 fallback ID 不碰撞。

聚焦验证：

pnpm --filter @ai-call/api exec tsx --test src/freeswitch/freeswitch-event-parser.spec.ts

建议提交：

feat(freeswitch): map safe provider events

---

## Task 5：实现 provider event 幂等状态机与快照对账

文件：

- 修改 apps/api/src/tasks/tasks.service.ts
- 修改 apps/api/src/tasks/tasks.service.spec.ts
- 修改 apps/api/src/tasks/tasks.controller.ts
- 修改 apps/api/src/internal-endpoints.spec.ts
- 修改 apps/api/src/tasks/outbound-business-flow.spec.ts

Provider event 上下文规则：

- attemptId、providerCallId、jobId 分别精确查询。
- 多个标识必须全部指向同一 attempt/task；冲突直接拒绝。
- 禁止冲突后退回 taskId 最新 attempt。
- 禁止仅凭 taskId 接受电话 provider event。

事务规则：

- provider 统一小写。
- 使用 Serializable 事务和有限 P2034 重试，或等价的固定顺序行锁。
- 在同一事务内检查 provider + providerEventId、推进状态、写历史和 CallEvent。
- 唯一约束作为最后防线；只把对应唯一键的 P2002 视为重复事件。
- 只有最新 attempt 可以更新 OutboundTask；旧 attempt 迟到事件只更新自身。

状态规则：

- PROGRESS/PROGRESS_MEDIA：只写最早 ringingAt。
- ANSWER：活动 attempt/task 进入 IN_CALL；终态不倒退。
- BACKGROUND_JOB +OK：只记录。
- BACKGROUND_JOB -ERR：attempt 进入 FAILED，保存标准原因，不重投原 outbox。
- HANGUP_COMPLETE：已有致命 hangupCause 优先；answered 且无致命错误才 COMPLETED。
- 未接听 busy/reject/no-response/cancel/normal clearing：NO_ANSWER。
- USER_NOT_REGISTERED、NO_ROUTE、UNALLOCATED_NUMBER、网络/协议/媒体错误：FAILED。
- RECORD_STOP：只补录音。
- CHANNEL_HANGUP 只记诊断，不负责终态。

hangup 兼容：

- freeswitch attempt：写 hangup_requested，执行 uuid_kill，等待 HANGUP_COMPLETE。
- web attempt：保留同步 COMPLETED。
- 命令失败写 hangup_request_failed，由真实事件或快照对账收敛。

新增 POST /tasks/provider-active-snapshots：

- Public + ServiceAuthGuard。
- snapshotId 重投或乱序不重复计数。
- 活动 channel 清零缺失计数。
- 超过 grace 后第一次缺失计 1；第二个更新快照仍缺失才终结。
- 未接听缺失为 FAILED；已接听缺失为 COMPLETED；原因 EVENT_LOSS_RECONCILED。

聚焦测试：

- 重复/并发同 providerEventId 只有一次副作用。
- ANSWER 晚于 HANGUP 不倒退。
- 旧 attempt 不覆盖新 attempt。
- 标识不一致被拒绝。
- 所有终态映射。
- web/freeswitch hangup 分化。
- snapshot 首次/二次缺失、重投、乱序、grace 和中间真实事件清零。

聚焦验证：

pnpm --filter @ai-call/api exec tsx --test src/tasks/tasks.service.spec.ts src/internal-endpoints.spec.ts src/tasks/outbound-business-flow.spec.ts

建议提交：

feat(tasks): make provider call events authoritative

---

## Task 6：实现持久 ESL Event Worker 与健康端口

文件：

- 修改 apps/api/src/freeswitch/freeswitch-event-bridge.service.ts
- 修改 apps/api/src/freeswitch/freeswitch-event-bridge.service.spec.ts
- 新增 apps/api/src/freeswitch/freeswitch-event-worker.service.ts
- 新增 apps/api/src/freeswitch/freeswitch-event-worker.service.spec.ts
- 新增 apps/api/src/freeswitch/freeswitch-event-worker-health.controller.ts
- 修改 apps/api/src/freeswitch-event-worker.module.ts
- 修改 apps/api/src/freeswitch-event-worker.main.ts
- 修改 .env.example

连接状态机：

- connect → auth → event plain subscribe。
- 订阅 HEARTBEAT、BACKGROUND_JOB、CHANNEL_PROGRESS、CHANNEL_PROGRESS_MEDIA、CHANNEL_ANSWER、CHANNEL_HANGUP_COMPLETE、RECORD_STOP。
- HEARTBEAT 只更新健康，不投 API。
- 断线使用带抖动指数退避，只允许一个重连 timer。
- shutdown 关闭 socket、timer 和投递队列。

投递规则：

- 有界 FIFO 保持事件顺序。
- bridge 单次请求；worker 对 timeout、429、5xx 和 BJOB 关联竞态做有界重投。
- 每次重投复用相同 providerEventId 和 body。
- 401/403/验证错误不可重试并使 ready 降级。
- 队列溢出、持续投递失败或心跳过期时 ready=false。

健康端口：

- 只监听 127.0.0.1:3012。
- /health/live 表示进程存活。
- /health/ready 仅在 ESL 已认证、订阅完成且心跳未过期时成功。
- 启动后的第一个 heartbeat 周期使用明确 grace。

活动快照：

- 默认每 10 秒调用 listActiveChannelIds。
- 生成 snapshotId，并通过 bridge 调用 provider-active-snapshots。
- 同一轮重试复用 snapshotId。

聚焦测试：

- 分片 greeting/auth/subscription。
- ready 503 → 200。
- HEARTBEAT 不投 API。
- 事件顺序、重投、404 竞态。
- 断线重连和重新订阅。
- 队列溢出与优雅关闭。

聚焦验证：

pnpm --filter @ai-call/api exec tsx --test src/freeswitch/freeswitch-event-bridge.service.spec.ts src/freeswitch/freeswitch-event-worker.service.spec.ts

建议提交：

feat(freeswitch): run persistent event worker

---

## Task 7：修正 Outbox 拨号接受语义

文件：

- 修改 apps/api/src/tasks/outbox.worker.ts
- 修改 apps/api/src/tasks/outbox.worker.spec.ts

- [ ] 调用 originate 时传 taskId。
- [ ] command/reply 成功后，在同一 DB 事务写 providerJobId、call.dispatch_accepted 和 outbox processed。
- [ ] dispatch_accepted payload 包含 channel=freeswitch、provider 和 providerJobId。
- [ ] 完全移除 FreeSWITCH 分支对 ringingAt 的提前写入。
- [ ] processEvent 不得再次重复标记已由 dispatch 事务处理的 outbox。
- [ ] bgapi 接受前的瞬时连接错误沿用指数退避。
- [ ] 确定性本地校验/认证错误立即失败。
- [ ] bgapi 接受后的 BACKGROUND_JOB 错误只走 provider event。
- [ ] terminal outbox failure 只允许更新仍属于该最新 attempt 的活动任务。
- [ ] 重试前用 origination_uuid/活动 channel 检查降低“已接受但 Job ID 未落库”窗口的重复拨号风险。

聚焦验证：

pnpm --filter @ai-call/api exec tsx --test src/tasks/outbox.worker.spec.ts

pnpm test:outbound-flow

建议提交：

fix(outbox): wait for real FreeSWITCH progress

---

## Task 8：增加 Voice Agent 与本机运行就绪门禁

文件：

- 修改 services/voice-agent/src/voice_agent/server.py
- 新增或修改 services/voice-agent/tests 中的 health 测试
- 修改 apps/api/src/platform/health-checks.service.ts
- 修改 .env.example

- [ ] Voice Agent 同端口增加只读 HTTP /health。
- [ ] health 区分 live/ready，并报告 FunASR、有效 TTS 配置和 ESL 控制连接状态，不输出密钥。
- [ ] TTS_PROVIDER=mock 在真实外呼模式下不得 ready。
- [ ] FunASR 必须检查 /health JSON 的 status=ok 和 models_loaded=true。
- [ ] API 平台健康检查增加 Event Worker ready 与 MicroSIP registration 信号。

聚焦验证：

pnpm test:python:voice

pnpm --filter @ai-call/api exec tsx --test src/platform/health-checks.service.spec.ts

建议提交：

feat(runtime): expose outbound voice readiness

---

## Task 9：实现安全的本机 FreeSWITCH/MicroSIP 编排

文件：

- 新增 scripts/lib/OutboundLocal.psm1
- 新增 scripts/microsip-local-setup.ps1
- 新增 scripts/dev-outbound.ps1
- 新增 scripts/dev-outbound-stop.ps1
- 新增 scripts/tests/OutboundLocal.Tests.ps1
- 修改 scripts/outbound-runtime-check.ps1
- 修改 freeswitch/docker-compose.yml
- 修改 freeswitch/conf/vars.xml
- 修改 package.json
- 修改 .gitignore 与 .env.example

公共模块：

- HostIPv4 显式覆盖优先。
- 自动解析只接受真实硬件默认路由，排除 loopback、APIPA、Docker、WSL、vEthernet 和 tunnel。
- 多个同优先级候选时失败，不猜测。
- .runtime/microsip.env 首次生成随机 64 位十六进制 SIP 密码。
- 私密文件、备份和 PID 文件限制为当前用户。
- 原子生成 .runtime/freeswitch/vars.xml。

Docker：

- Compose 用 long syntax 把 FREESWITCH_VARS_FILE 覆盖挂载为容器 vars.xml。
- dev-outbound 只启动 freeswitch service，不启动 Docker funasr。
- ESL 保持只绑定宿主机 127.0.0.1:18021。
- 启动后验证 advertised SIP/RTP IP、端口、internal profile 和 mod_audio_fork。

MicroSIP：

- 定位顺序：显式路径 → 运行进程 → 注册表/常见路径。
- 保留 UTF-16 LE、换行、注释、未知键和其他账号。
- 只创建/更新唯一 1001 账号；sourcePort=5062、UDP、STUN/ICE 关闭。
- 修改前备份，内容无变化时不备份、不重启。
- 有活动 1001 channel 时拒绝重启。
- 使用 MicroSIP.exe /exit 安全退出；超时不强杀。
- 重新以可见/托盘方式启动，最终以 FreeSWITCH registration 为成功。

编排顺序：

1. 互斥锁、PID/端口归属与运行时检查。
2. 生成 secret 和 FreeSWITCH runtime vars。
3. 启动 FreeSWITCH。
4. 启动并验证 FunASR。
5. 启动并验证 API、Dashboard、Voice Agent。
6. 启动 Event Worker 并等待 ready。
7. 配置 MicroSIP 并等待 1001 注册。
8. 启动 Outbox Worker。
9. 最后启动 Scheduler。

失败规则：

- Event Worker、语音服务或 registration 未 ready 时绝不启动 Outbox/Scheduler。
- 已占用端口只能复用能证明属于本仓库且健康的进程。
- 不杀陌生 PID，不清数据库，不执行 compose down。
- cleanup 只处理本轮拥有的进程/容器。

runtime check 改为只读：

- 默认仅 readiness。
- ObserveNextTask/TaskId 只观察由 Dashboard 创建的任务。
- 禁止自动创建任务、发布流程或 POST dispatch。
- 禁止内置管理员密码。
- 只以真实 PROGRESS/ANSWER/HANGUP_COMPLETE 和任务字段为验收依据。

聚焦验证：

Invoke-Pester scripts/tests/OutboundLocal.Tests.ps1

docker compose -f freeswitch/docker-compose.yml config

pnpm smoke:outbound-runtime -SkipTask

建议提交：

feat(runtime): orchestrate local MicroSIP outbound calls

---

## Task 10：全量回归、迁移演练与真实验收

- [ ] 对空测试库执行 migrate deploy。
- [ ] 对包含历史 web attempt 和普通 CallEvent 的副本执行迁移并验证回填。
- [ ] 用真实 PostgreSQL 并发提交同一 providerEventId，确认恰好一次副作用。
- [ ] 运行 pnpm check。
- [ ] 运行所有新增聚焦测试。
- [ ] 运行默认 CI 等价命令。
- [ ] 运行 opt-in 真实 FreeSWITCH 协议测试。
- [ ] 执行 pnpm dev:outbound，确认所有门禁通过。
- [ ] 从 Dashboard 创建 1001 立即任务。
- [ ] 记录 taskId、attemptId、providerJobId 和 providerEventId 作为验收证据。
- [ ] 确认 10 秒内真实振铃，接听后 5 秒内 IN_CALL，15 秒内首个 AI 播报。
- [ ] 说话并确认 caller transcript 与流程推进。
- [ ] MicroSIP 挂断后 5 秒内进入正确终态。
- [ ] 验证未注册、拒接/无人接听和语音服务故障。
- [ ] 重启 Event Worker 后验证重连及新任务闭环。

最终交付必须明确报告：

- 自动化测试命令和结果。
- 真实任务与 attempt 标识。
- SIP registration、progress、answer、hangup 的证据。
- 任何未能在本机自动验证的人工步骤。
- 不得把端口可达、outbox processed 或 bgapi +OK 表述为“真实拨号成功”。
