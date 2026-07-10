# 本机 MicroSIP 真实外呼闭环设计

日期：2026-07-10

状态：设计已确认，待实施计划

首轮验收目标：控制台创建立即执行的外呼任务后，本机 MicroSIP 1001 自动振铃；接听后运行已发布外呼流程并与 AI 双向通话；挂断或失败后任务状态可靠闭环。

## 1. 背景与现状审计

当前代码已经具备外呼主干，但运行态尚未完全打通：

- TasksService.dispatch 会把任务从 PENDING 置为 CALLING，在同一事务中创建 CallAttempt、call.dispatch_requested 事件和 outbox 事件。
- OutboxWorker 会消费 call.dispatch_requested，并调用 FreeSwitchService.originate。
- FreeSwitchService 已通过 ESL 向 FreeSWITCH 发送 bgapi originate，当前本机配置使用 user/{to}，适合拨打已注册的 SIP 分机。
- FreeSWITCH 容器、ESL、internal SIP profile 和 mod_audio_fork 均能启动；API、Dashboard、Voice Agent 与 FunASR 端口也可达。
- 当前 FreeSWITCH registrations 为 0，因此 MicroSIP 1001 尚不能被真实呼叫。
- 当前运行进程中没有 Scheduler、Outbox Worker 和 FreeSWITCH Event Worker。控制台创建的立即任务不会自动完成真实派发。
- FreeSWITCH Event Worker 目前只有桥接骨架，启动入口明确提示 ESL 事件订阅尚未实现。
- OutboxWorker 在 bgapi 返回 +OK 后立即写 ringingAt；该响应只表示后台任务被 FreeSWITCH 接受，不表示终端已经振铃。
- 既有浏览器 web 通道会跳过 FreeSWITCH originate，只能验证任务、流程和浏览器音频链路，不能作为 SIP 真实外呼验收依据。
- 代码级 outbound-business-flow 测试已通过，但其中 FreeSWITCH 是模拟对象，不能证明真实 SIP、RTP 或 MicroSIP 已打通。

因此，当前结论是“业务对象和模拟流程已连通，真实 SIP 拨号、运行编排和电话事件回写尚未闭环”。

## 2. 目标与非目标

### 2.1 本期目标

1. 用户在控制台选择已发布流程并创建立即执行的 1001 外呼任务。
2. Scheduler 自动领取任务，不需要脚本或手工 API 派发。
3. Outbox Worker 可靠执行 ESL originate，并保留租约、幂等和重试能力。
4. 本机 MicroSIP 1001 真实注册、振铃和接听。
5. 接听后 FreeSWITCH 通过 mod_audio_fork 与 Voice Agent 建立双向音频。
6. Voice Agent 按任务锁定的 flowVersionId 执行流程快照，完成 STT、流程推进和 TTS。
7. FreeSWITCH 的振铃、应答、挂断、后台任务错误和录音事件可靠回写。
8. 任务和 CallAttempt 不出现假振铃、假成功或永久停留在 CALLING/IN_CALL。
9. 提供一个本机完整外呼编排入口和可重复的真实验收流程。

### 2.2 非目标

- 本期不拨打 PSTN 手机号，不接入运营商 SIP Trunk。
- 本期不建设多节点 FreeSWITCH 集群、跨机房容灾或大规模并发压测。
- 本期不改变浏览器 web 通道的既有行为。
- 本期不把 Scheduler、Outbox Worker 或 Event Worker 合并进 API 进程。
- 本期不扩展营销活动、名单策略或人工坐席能力，除非它们阻塞 1001 真实外呼。

## 3. 架构与进程边界

完整控制流如下：

控制台创建任务
→ API 保存 PENDING 任务并锁定已发布流程版本
→ Scheduler 领取到期任务
→ TasksService 创建 CallAttempt 与拨号 outbox
→ Outbox Worker 发送 ESL bgapi originate
→ FreeSWITCH internal profile 查找 1001 注册位置
→ MicroSIP 振铃

接听后的媒体流如下：

MicroSIP SIP/RTP
↔ FreeSWITCH
↔ mod_audio_fork WebSocket
↔ Voice Agent
↔ FunASR、流程引擎、LLM/工具和 TTS

状态回程如下：

FreeSWITCH ESL 事件
→ FreeSWITCH Event Worker
→ 服务鉴权的 provider-events API
→ OutboundTask、CallAttempt、CallEvent 和通话历史

各进程职责保持单一：

- API：任务、流程、状态机和持久化控制面。
- Scheduler：只领取到期任务并调用既有 dispatch。
- Outbox Worker：可靠执行拨号及其他副作用。
- FreeSWITCH Event Worker：维护持久 ESL 订阅、解析事件、断线重连、健康心跳和事件投递。
- FreeSWITCH：SIP 信令、RTP、通话控制和媒体分流。
- Voice Agent：按已锁定流程版本执行实时语音会话。
- MicroSIP：本机 1001 被叫终端。

本机一键入口只编排这些独立进程，不改变生产进程边界。

## 4. 任务状态与事件归属

### 4.1 状态推进规则

状态只能单向推进，终态不会被迟到事件倒退：

1. 创建任务：PENDING。
2. Scheduler 成功领取：CALLING；创建 CallAttempt，startedAt 使用数据库创建时间。
3. ESL 接受 bgapi：仍为 CALLING，只记录 call.dispatch_accepted，不写 ringingAt。
4. CHANNEL_PROGRESS 或 CHANNEL_PROGRESS_MEDIA：写 ringingAt；任务仍为 CALLING。
5. CHANNEL_ANSWER：任务和 attempt 进入 IN_CALL，并写 calledAt/answeredAt。
6. CHANNEL_HANGUP_COMPLETE：
   - 已接听且通话正常结束：COMPLETED。
   - 未接听、忙线、拒接、无人响应：NO_ANSWER。
   - 未注册、无路由、网络、协议或媒体错误：FAILED。
7. RECORD_STOP 等事件只补充录音信息，不改变已经确定的终态。

Voice Agent 在音频 WebSocket 建立后仍可幂等上报 IN_CALL，但 FreeSWITCH CHANNEL_ANSWER 是电话应答时间的权威来源。

### 4.2 后台任务结果

bgapi 的 command/reply +OK 只代表后台 Job 已被接受。FreeSWITCH 会在该响应中生成并返回 Job UUID；FreeSwitchService 必须解析该值，OutboxWorker 将其保存到对应 CallAttempt.providerJobId。origination_uuid 继续使用 attemptId。Event Worker 订阅 BACKGROUND_JOB，并按以下顺序关联 attempt：

1. 从 Job-Command-Arg 中提取受校验的 origination_uuid。
2. 如果命令参数未携带该值，则按 CallAttempt.providerJobId 查询。
3. 如果 command/reply 与 BACKGROUND_JOB 发生极短竞态、Job UUID 尚未落库，则对 provider event 做有界重试，不丢弃事件。

- BACKGROUND_JOB 返回成功：记录后台任务完成，不提前判定振铃或接听。
- BACKGROUND_JOB 返回 USER_NOT_REGISTERED、NO_ROUTE_DESTINATION 等确定性错误：对应 attempt 立即进入 FAILED。
- BACKGROUND_JOB 返回其他错误：当前 attempt 进入 FAILED；已经接受的 bgapi 不重新投递同一个 outbox。若以后启用任务级重拨，必须创建新的 CallAttempt，而不是复用本次 attempt。
- 如果随后还收到同一 attempt 的 HANGUP 事件，幂等键保证只执行一次终态副作用。

### 4.3 挂断规则

AI 流程主动结束时：

1. API 记录 call.hangup_requested。
2. API 调用 uuid_kill。
3. API 不把 ESL 命令确认误当作通话已经结束。
4. CHANNEL_HANGUP_COMPLETE 负责写最终状态、结束时间、时长和原因。

MicroSIP 主动挂断时直接由 CHANNEL_HANGUP_COMPLETE 进入同一终态处理路径。

为防止 Event Worker 短时故障造成卡单，系统定期取得 FreeSWITCH 活动 channel 快照，并与超过宽限期的 CALLING/IN_CALL attempts 对账：

- 连续两个快照均不存在、且从未接听的 attempt：FAILED，原因 EVENT_LOSS_RECONCILED。
- 连续两个快照均不存在、且已经接听的 attempt：COMPLETED，并记录 EVENT_LOSS_RECONCILED 作为补偿原因。
- 宽限期和快照间隔可配置，默认宽限期 60 秒、快照间隔 10 秒。

对账接口边界固定如下：Event Worker 每 10 秒执行 ESL api show channels as json，提取活动 channel UUID，并通过服务鉴权调用新增的 POST /tasks/provider-active-snapshots。API 在数据库内完成 active attempts 对比和连续缺失计数；Event Worker 不直接访问业务数据库。

## 5. FreeSWITCH Event Worker

Event Worker 建立独立、长连接的 ESL 会话，并完成认证后订阅以下 plain 事件：

- BACKGROUND_JOB
- CHANNEL_PROGRESS
- CHANNEL_PROGRESS_MEDIA
- CHANNEL_ANSWER
- CHANNEL_HANGUP_COMPLETE
- RECORD_STOP

实现要求：

- 按 ESL Content-Length 正确处理拆包、粘包和单次读取中的多个帧。
- 连接断开后使用带抖动的指数退避重连，恢复后重新认证和订阅。
- 只有认证与订阅均成功时才上报 ready。
- Event Worker 在宿主机回环地址提供独立健康端口，默认 127.0.0.1:3012；health/live 表示进程存活，health/ready 只有在 ESL 已认证、事件已订阅且最近一次心跳正常时才返回成功。
- 每个事件提取 Event-UUID、Job-UUID、Unique-ID、Channel-Call-UUID、Hangup-Cause、事件时间、录音路径和原始白名单字段。
- providerEventId 优先使用 Event-UUID；若上游帧缺失该字段，则使用 Core-UUID、事件名、Job-UUID、channel UUID、事件时间和正文的稳定哈希，保证重投仍使用同一幂等键。
- Event Worker 继续通过现有 FreeSwitchEventBridgeService 调用 provider-events API，不直接绕过 API 修改数据库。
- 请求继续使用 X-Service-Token；启用签名时保留时间戳和 HMAC 防重放。
- 日志包含 attemptId、taskId、providerEventId 和 jobId，但不打印服务 token、ESL 密码或 SIP 密码。

## 6. API 与数据模型调整

ProviderCallEvent 增加 providerEventId，并允许携带 jobId、backgroundJobResult 和经过裁剪的 raw 字段。CallAttempt 增加可空且唯一的 providerJobId，用于关联 FreeSWITCH 后台任务结果。语音或媒体致命错误发生时，API 先把标准化失败原因写入 CallAttempt.hangupCause；后续 CHANNEL_HANGUP_COMPLETE 必须优先使用该已记录原因，将任务终结为 FAILED。

CallEvent 增加可空的 provider 和 providerEventId 字段，并建立 provider + providerEventId 唯一约束。普通业务事件两列为空，不受约束影响。provider-events 在同一数据库事务中完成：

1. 按唯一键领取事件。
2. 若已存在则返回当前任务，不重复状态更新、联系历史或事件记录。
3. 若为新事件则执行状态迁移、attempt 更新、通话历史和 CallEvent 写入。

FreeSwitchService.originate 返回结构化的 accepted/jobId 信息。OutboxWorker 在 command/reply 成功后：

- 把 outbox 标记为 processed。
- 写 call.dispatch_accepted。
- 不写 CallAttempt.ringingAt。

provider-events 统一负责真实的 ringingAt、answeredAt、endedAt、duration、hangupCause 和 recordingUrl。

## 7. 本机 FreeSWITCH 与 MicroSIP

### 7.1 FreeSWITCH

本机验收使用：

- ESL：127.0.0.1:18021，仅绑定宿主机回环地址。
- SIP：宿主机 5060/UDP；internal profile。
- RTP：16384-16394/UDP。
- 拨号串：user/{to}。
- 主叫分机：1000。
- 被叫分机：1001。
- 音频模块：mod_audio_fork。
- 音频目标：ws://host.docker.internal:8090/audio-stream。
- 音频：16 kHz、单声道、双向。

scripts/dev-outbound.ps1 动态识别有效宿主机 IPv4，并生成被 .gitignore 排除的 .runtime/freeswitch/vars.xml；Docker Compose 将该文件覆盖挂载到容器内的 vars.xml。不把特定机器的 192.168.x.x 地址固化为新的共享配置。启动前必须验证 SIP/SDP advertised IP 与当前宿主机地址一致。

### 7.2 MicroSIP

提供幂等的 scripts/microsip-local-setup.ps1，行为如下：

- 找到 MicroSIP 可执行文件和当前用户的 MicroSIP.ini。
- 每次修改前创建带时间戳的备份。
- 只创建或更新专用测试账号 1001，保留其他账号。
- server 与 domain 使用本次启动解析出的宿主机地址，服务器端口 5060。
- username/authID 为 1001，transport 为 UDP，本地 sourcePort 为 5062。
- 本机链路关闭 STUN 与 ICE，避免不必要的公网候选。
- SIP 密码从被 .gitignore 排除的 .runtime/microsip.env 读取并同时写入生成的 FreeSWITCH 配置与 MicroSIP；首次缺失时生成随机强密码。脚本只报告是否匹配，不输出明文。
- 配置发生变化时安全重启 MicroSIP；未变化时不打断正在运行的客户端。
- 最终以 FreeSWITCH 的 sofia registration 结果为成功依据，而不是仅检查 MicroSIP 进程存在。

本机测试账号不得作为生产默认凭据。生产环境必须使用随机、独立的强密码，并通过防火墙或 ACL 限制 SIP 来源。

## 8. 一键启动与就绪门禁

根目录新增 pnpm dev:outbound，调用 scripts/dev-outbound.ps1。编排器负责：

1. 检查 Docker、PostgreSQL 和必要的本机运行时。
2. 启动或复用 ai-call-freeswitch。
3. 启动 API、Dashboard、Voice Agent、FunASR、Scheduler、Outbox Worker 和 Event Worker。
4. 等待数据库、API、WebSocket、FunASR、ESL 与 SIP profile 就绪。
5. 验证 mod_audio_fork 已加载。
6. 验证 Event Worker 已认证并完成订阅。
7. 启动或刷新 MicroSIP 专用账号并等待 1001 出现在 registrations。
8. 最终输出统一的 ready 摘要；任一强依赖失败则退出非零并给出修复动作。

实际启动顺序中 Scheduler 必须最后启动。已有进程占用目标端口时，编排器只能复用通过身份和健康检查的本项目进程；否则报告冲突并退出，不能再启动一个重复实例。

就绪门禁顺序为：

基础设施
→ API/语音服务
→ FreeSWITCH ESL 与媒体模块
→ Event Worker 订阅
→ MicroSIP 注册
→ Scheduler 允许派发

这样可避免任务先被领取、电话已经接通后才发现事件或媒体服务未启动。

编排器只终止自己启动的子进程；不会删除数据库、覆盖其他 MicroSIP 账号，也不会静默停止无关 Docker 容器。

## 9. 错误分类与恢复

### 9.1 可重试错误

- ESL 连接被拒绝、超时或暂时断开。
- FreeSWITCH 暂时不可用。
- provider-events API 暂时不可用。
- 短时网络错误。

ESL 连接或命令在 bgapi 被接受之前失败时，使用现有 outbox 租约和指数退避机制，达到最大次数后进入 FAILED 并保存最后错误。provider-events API 暂时不可用时，由 Event Worker 对同一 providerEventId 做有界重投；API 幂等约束保证不会重复执行副作用。bgapi 一旦被接受，后续 BACKGROUND_JOB 错误不重新投递原 outbox。

### 9.2 不重试错误

- USER_NOT_REGISTERED。
- NO_ROUTE_DESTINATION。
- 无效号码或拨号串。
- 认证失败或配置错误。
- 不支持的音频模块。

这些错误立即结束对应 attempt，避免重复拨打和无意义等待。

### 9.3 媒体与语音故障

Voice Agent、FunASR 或有效 TTS 未就绪时，就绪门禁阻止新任务派发。接听后发生 audio fork、ASR 或 TTS 致命错误时：

- 记录明确的 media/voice failure 事件。
- 主动结束 channel。
- 任务进入 FAILED，而不是把静音通话标记为 COMPLETED。

## 10. 可观测性与安全

必须提供或扩展以下信号：

- scheduler tick、领取数量与失败数。
- outbox backlog、处理、重试与终态失败。
- ESL subscriber connected、authenticated、subscribed、reconnect count 和 lastEventAt。
- 当前 SIP registrations 数量。
- active CALLING/IN_CALL attempts 与 FreeSWITCH active channels 的差异。
- originate 到振铃、振铃到接听、接听到首个 TTS、挂断到终态的时延。

健康检查应区分 live 与 ready。Event Worker 进程存活但未订阅 ESL 时，live 可以为真，ready 必须为假。

安全约束：

- ESL 继续只发布到 127.0.0.1。
- 服务间端点继续使用 token，并支持 HMAC 与时间窗口。
- SIP、ESL 和服务密码不得进入日志、CallEvent payload 或前端响应。
- MicroSIP 配置备份留在用户本机并限制为当前用户可读。
- provider event 的 raw 字段只保存状态诊断所需白名单，不持久化任意 SIP 头。

## 11. 测试策略

### 11.1 单元测试

- ESL 帧拆包、粘包、多帧和 Content-Length。
- BACKGROUND_JOB 成功与错误解析。
- CHANNEL_PROGRESS、ANSWER、HANGUP_COMPLETE 和 RECORD_STOP 映射。
- 状态单向推进、终态保护、重复与乱序事件。
- providerEventId 幂等与并发唯一约束。
- 可重试和不可重试 originate 错误分类。
- MicroSIP 配置合并只修改专用账号并保留其他账号。
- 编排器健康门禁和失败退出码。

### 11.2 集成测试

- 使用假 ESL 服务验证认证、订阅、事件投递、断线与重连。
- 使用真实 FreeSWITCH 验证 bgapi Job UUID、user/1001 路由和真实事件序列。
- 验证 OutboxWorker 不再把 command/reply 当作 ringing。
- 验证 provider-events API 对真实事件序列的任务与 attempt 更新。
- 验证活动 channel 快照对账只处理超过宽限期且连续缺失的 attempt。

依赖真实 FreeSWITCH 或 MicroSIP 的测试使用显式环境开关运行，不进入无 SIP 终端的默认 CI；默认 CI 仍执行协议、状态机和假 ESL 集成测试。

### 11.3 回归测试

- 运行 pnpm check。
- 运行现有 outbound-business-flow、task、outbox 和 FreeSWITCH 测试。
- 保证 web dispatch 仍跳过 FreeSWITCH，浏览器语音调试链路不受影响。

## 12. 真实 MicroSIP 验收

1. 执行 pnpm dev:outbound。
2. 所有强依赖显示 ready，FreeSWITCH registrations 中存在 1001。
3. 在控制台选择已发布流程，创建立即执行的 1001 外呼任务。
4. 不调用脚本或手工 API，MicroSIP 在 10 秒内真实振铃。
5. 振铃前任务为 CALLING，只有收到真实 progress 事件后 ringingAt 才存在。
6. 接听后任务在 5 秒内进入 IN_CALL。
7. 接听后 15 秒内听到 AI 首次播报。
8. 对 MicroSIP 说话后生成 caller transcript，并按锁定流程继续回复。
9. MicroSIP 主动挂断后，任务在 5 秒内进入正确终态。
10. 任务详情包含 CallAttempt、振铃/接听/结束时间、时长、挂断原因和对话记录。
11. 分别验证未注册、拒接、忙线及语音服务故障，得到明确状态和原因。
12. 重启 Event Worker 后自动恢复订阅，新建任务仍可完整执行。

验收脚本必须等待真实 progress/answer/provider event，不得再以 outbox processed 或 bgapi +OK 作为“拨号成功”。

## 13. 兼容性与落地顺序

- dispatch 默认 channel 仍为 freeswitch；web channel 的请求和响应保持兼容。
- 数据库迁移先增加可空字段和唯一约束，再部署生产者与消费者，避免旧进程立刻失效。
- 先完成 ESL 订阅与事件幂等，再移除 OutboxWorker 对 ringingAt 的提前写入。
- Event Worker ready 之前不启用 Scheduler，避免迁移窗口丢失真实电话事件。
- 本机 MicroSIP 和 FreeSWITCH 配置完成后，先验证纯 SIP 振铃/接听，再启用 audio fork 验证双向 AI 音频。
- 最后运行完整回归和人工真实验收。

## 14. 完成定义

只有同时满足以下条件，才能宣告“外呼任务和外呼流程完全打通到本机 MicroSIP”：

- 控制台创建任务即可自动触发真实 SIP 呼叫。
- MicroSIP 1001 能稳定注册、振铃和接听。
- AI 能按已发布流程双向听说。
- 电话真实事件驱动任务状态和时间字段。
- 失败原因可解释且任务不会永久卡住。
- 一键启动、自动化测试和真实人工验收均通过。

## 15. 协议依据

- FreeSWITCH 官方 Event Socket 手册：https://developer.signalwire.com/freeswitch/integration/event-socket/
- FreeSWITCH 官方事件目录：https://developer.signalwire.com/freeswitch/programming/events-catalog/

官方协议说明 bgapi 会立即返回 FreeSWITCH 生成的 Job-UUID，并在命令完成后发送携带同一 Job-UUID 和命令结果的 BACKGROUND_JOB 事件。本设计因此保存返回的 Job UUID，而不假设客户端可以预设该值。
