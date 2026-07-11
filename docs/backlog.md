# 项目待办 Backlog

外呼可靠性(microsip 真实外呼 review)、VAD/打断优化、意图识别、上线准备四条线的**剩余未完成项**。
已完成项见文末「已交付」清单与对应提交。

> 相关设计契约:
> - `docs/superpowers/specs/2026-07-10-microsip-real-outbound-design.md`(外呼实现)
> - `docs/superpowers/specs/2026-07-10-vad-barge-in-p0.md`(VAD/打断 P0)
> - `docs/superpowers/specs/2026-07-10-voice-test-call-design.md`(首页浏览器模拟外呼)
> - `docs/superpowers/specs/2026-07-11-tts-paced-delivery.md`(TTS 节拍投递)
> - `docs/superpowers/specs/2026-07-11-intent-embedding-tier.md`(意图 embedding 层)

---

## A. 外呼可靠性 —— review 剩余项

review 的 10 个已确认缺陷(6 CONFIRMED + 4 PLAUSIBLE)已全部修复(见「已交付」)。
剩余为**较大重构**与**极窄残留**,均非阻断性,建议单独立项。

### A1 · [重构] ESL 连接+鉴权握手层去重
- **问题**:`freeswitch-event-worker.service.ts` 重造了 `freeswitch.service.ts` 已有的 ESL socket 建连 + `auth` 握手 + `+OK` 判定 + Content-Type 比较 + host/port/password 解析。握手协议或鉴权语义一旦变更需两处同步,易漂移。
- **做法**:把 socket+auth 握手抽成 `freeswitch.service.ts` 可复用的 helper(如 `connectAndAuthenticate`),事件工人只在其上加 subscribe 两态;host/port/password 配置解析一并集中。
- **影响文件**:`apps/api/src/freeswitch/freeswitch.service.ts`、`freeswitch-event-worker.service.ts`。
- **优先级**:中(维护性)。**估算**:中。

### A2 · [重构] freeswitch/web 双通道抽 ChannelStrategy
- **问题**:通道差异(是否 originate、挂断是远程控制还是本地直接终结、谁置终态)以 `channel==='web'` 布尔散布在 `dispatch`/`hangup`/`resolveContext` 多处。新增第三通道(SIP trunk/PSTN)要多处补 if,易漏。
- **做法**:定义 `ChannelStrategy` 接口(`dispatch`/`hangup`/`terminalPolicy`),按 channel 选实现,调用点不再出现 channel 分支。
- **影响文件**:`apps/api/src/tasks/tasks.service.ts`。
- **优先级**:中(维护性)。**估算**:中-大。

### A3 · [重构] 受管事件集合抽统一事件注册表
- **问题**:「哪些事件受管、各自什么语义」硬编码在三处:worker 的 `SUBSCRIPTIONS` 订阅名单、`isManagedEvent` 的过滤(含 BACKGROUND_JOB 的 origination_uuid 正则特判)、`tasks.service.ts` 的 `isProgress`/`isAnswer`/`isTerminalHangup`/`isRecording` 谓词。新增一类事件要同时改三处,漏一处则收不到或被忽略。
- **做法**:建单一事件类型注册表(`name → {subscribe, kind}`),worker 订阅与 tasks 分派都从它派生。
- **影响文件**:`freeswitch-event-worker.service.ts`、`freeswitch-event-parser.ts`、`tasks.service.ts`。
- **优先级**:中(维护性)。**估算**:中-大。

### ~~A4 · [窄残留] #1 originate 幂等的 bgapi 异步崩溃窗口~~ —— ✅ 已交付(2026-07-11,750511d)
- **现状**:pre-originate 幂等守卫(已提交)挡住了常见重投。残留极窄窗口:`bgapi originate` 成功、providerJobId 提交前进程崩溃、且首通在重投前已挂断 → 可能对同一号码二次真实外呼。
- **做法**:pre-originate 写「派发在途」持久标记(CallAttempt 加 `dispatchStartedAt` 列 + 迁移),重投时标记存在且无 providerJobId → 绝不重拨:有 CallEvent 证据则收口,无证据则死信留人工复核。
- **影响文件**:`prisma/schema.prisma`(迁移)、`outbox.worker.ts`。
- **结果**:CallAttempt.dispatchStartedAt 标记 + 重投守卫②(消歧只认 call.provider_event);取舍:originate 瞬时失败重投也死信(合规优先于重试韧性),死信可人工恢复。outbox spec 13/13。

### A5 · [窄残留] #9 evidence-only COMPLETED 的 duration 缺失
- **现状**:仅凭事件 raw 应答证据(无真实 CHANNEL_ANSWER)判 COMPLETED 时,为避免造假时间戳未回填 `answeredAt`,故该 attempt 的 `duration` 可能为空(状态分类已正确)。
- **做法**:解析 `variable_answer_epoch` 为真实应答时刻回填 duration。依赖 A6 的白名单。
- **影响文件**:`tasks.service.ts`、`freeswitch-event-parser.ts`。
- **优先级**:低。**估算**:小。

### ~~A6 · [运维] 死信 sink 指向持久卷~~ —— ✅ 已交付(2026-07-11,b3f5b35)
- **现状**:死信默认路径 CWD 相对(已加启动日志 + 每次落盘日志暴露绝对路径)。生产需把 `FREESWITCH_EVENT_DEAD_LETTER_PATH` 指向持久卷,否则重启后 replay 文件散落/丢失。
- **做法**:`.env`/`.env.example`/PM2 ecosystem 显式注入该 env + 落盘前确保父目录存在。
- **结果**:mkdir recursive 加固 + .env/.env.example/PM2 ecosystem 显式注入。

### A7 · [文档] freeswitch/local/README.md 密码过时
- **现状**:`freeswitch/local/README.md` 仍写分机密码 `1234`。主 README/docker-compose 已更新为「密码由脚本随机生成」,但该 local 原生启动路径下 1234 仍有效,文档陈旧易误导。
- **做法**:更新该 README,说明密码来源(`.runtime/microsip.env`)。
- **优先级**:低。**估算**:极小。

### A8 · [小 UX 债] 首页已发布流程下拉边界
- **现状**:编辑已发布流程会把状态打回 draft;首页浏览器模拟外呼的流程下拉按 `status==='published'` 过滤,会看不到它。
- **做法**:下拉改为「有已发布版本的流程」,或提示用户重新发布。
- **影响文件**:`apps/dashboard/components/home/WebCallPanel.tsx`。
- **优先级**:低。**估算**:小。

---

## B. VAD / 打断优化 —— P0 已交付,P1/P2 待做

P0(通道分化门控、打断打到底 uuid_break/clear_audio、端点判停放宽、STT final 丢句修复)已交付(见「已交付」)。

### B-P1a · [P1] FunASR 服务端 fsmn-vad 可配置关闭
- **问题**:上游 voice-agent 的 WebRTC VAD 已做门控(只放行语音帧),FunASR 服务端又跑一遍 fsmn-vad 神经网络 VAD,是重复推理,靠 `ws.py` 的 fallback 兜底才不出错;消耗 `CONCURRENT_VAD` 资源、引入整句边界不准风险。
- **做法**:FunASR 服务端 VAD 做成可配置关闭(2pass 整句触发本就靠上游「说完了」信号驱动,不依赖服务端 VAD)。
- **影响文件**:`services/funasr-server/`(config + ws)。
- **优先级**:中(省资源 + 消除边界隐患)。**估算**:中。

### B-P1b · [P1] 语义自适应端点检测
- **问题**:当前端点判停是固定静音窗(默认 560ms)。报数字、犹豫、思考的自然停顿会被一刀切。
- **做法**:识别到的半句文本以数字、「嗯」「就是」等犹豫词结尾时,自动延长等待窗口(语义端点检测简化版)。
- **影响文件**:`services/voice-agent/src/voice_agent/`(agent + vad 协同)。
- **优先级**:中(报号码等场景体验再上一档)。**估算**:中。

### B-P2a · [P2] Silero VAD 替换 webrtcvad
- **问题**:webrtcvad 是 2016 年的 GMM 模型,抗噪弱。
- **做法**:用 Silero VAD(神经网络,CPU 毫秒级,抗噪远好)替换,做成 provider 可切换 + 保底回退到 webrtcvad。
- **影响文件**:`services/voice-agent/src/voice_agent/vad.py`(provider 化)。
- **优先级**:低(演进)。**估算**:中。

### B-P2b · [P2] FreeSWITCH 话机通道真 AEC
- **问题**:web 通道靠浏览器 AEC 已能语义级打断;FreeSWITCH 话机通道无 AEC,只能靠门控 + 能量粗检测打断,体验弱于 web。
- **做法**:话机通道引入真正的回声消除(把 TTS 参考信号从上行减掉),让话机侧也能语义级打断。
- **影响文件**:`services/voice-agent/`、可能 FreeSWITCH 侧。
- **优先级**:低(演进)。**估算**:大。

---

## C. 意图识别 —— P0 + Phase 2 已交付,剩演进项

四层级联(keyword 最长优先/否定守卫 → embedding 例句相似度 → LLM 带"其他"逃生口 → fallback 兜底边)已全部真机验证(见「已交付」)。

### C1 · [演进] 编辑器例句一键采集
- **问题**:例句目前靠运营手工输入;历史转写里现成的真实说法没有利用。
- **做法**:流程编辑器判断节点提供「从历史转写采集」:按意图列出该节点近期分类结果(`[Intent]` 日志/转写),勾选入例句。
- **优先级**:低(运营效率)。**估算**:中。

### ~~C2 · [演进] A+ 意图分类合并进主回复 LLM 调用~~（界定后暂缓）
- **界定结论(2026-07-11)**:流程模式下 decision 分类发生在路由前、下一节点 prompt 依赖分类结果,无合并空间;仅适用于无流程的 scenario 兼容模式。暂缓。

---

## D. 上线准备(2026-07-11 盘点)

### D1 · [阻断] 合规配置还原
外呼时间窗还原 `09:00-18:00 仅工作日`(现 00:00-23:59)、单被叫日呼上限还原 `3`(现 99)。为验收临时放开的,上线漏还原即骚扰电话违规。

### D2 · [阻断] 安全配置收严
`JWT_SECRET`/`SERVICE_API_TOKEN` 换随机长串;`VOICE_AGENT_WS_TOKEN` 必须设置(现为空 = 语音 WS 无鉴权);`DEFAULT_ADMIN_PASSWORD`/`CORS_ORIGINS` 按生产收;DeepSeek/DashScope key 轮换并入密钥管理。

### D3 · [阻断] 拨号链路生产化
`FREESWITCH_DIAL_STRING` 现硬编码直投 MicroSIP 主机 IP(绕 Docker NAT 的单机权宜)。生产换 SIP trunk(`sofia/gateway/...`)并在网关侧配好 NAT contact 改写——这是"到点不拨号"的根因,换环境必复发。

### ~~D4 · [阻断] 进程部署方式~~ —— ✅ 已交付(2026-07-11,d3bf447)
PM2 守护(全部编译产物 + 自动重启)+ `docs/deployment.md`(构建顺序、"运行时禁止 nest build"铁律、启动依赖顺序、健康检查清单)。

### D5 · [建议] 观测性
结构化日志收集 + 核心指标告警(外呼成功率、死信数、ASR 降级丢弃率、打断延迟、LLM/TTS 首包延迟)。`[Intent]`/`[BargeIn]` 日志已结构化,接采集即可用。

### D6 · [建议] 并发容量验证
voice-agent 单进程多路通话未压测;做一次 5-10 路并发 smoke,确认无共享状态踩踏(ESL 共享连接已 shield 但未在并发下验证)。

### D7 · [建议] 录音/转写数据合规
面向真实客户前确认:通话录音告知义务、转写保留期限、租户数据隔离(RAG tenantId 过滤已做)。

### D8 · [建议] API 补真正的健康检查端点
2026-07-11 部署文档梳理时发现::3001 的 API 没有自身健康端点(platform/health-checks.service.ts 只是反向探测其它服务的聚合器);event-worker/voice-agent/funasr 都有 /health 而主 API 没有。临时用 `@Public()` 的 `/api/internal/metrics` 作存活代理(已写进 docs/deployment.md);建议补 `/api/health`(含 DB ping)。outbox/scheduler worker 无 HTTP 监听,只能靠 PM2 进程态,可选加同款轻量健康端口。

---

## 已交付(供追溯,勿重做)

### 外呼可靠性 review —— 10 缺陷全修 + 收尾
| 提交 | 内容 |
|---|---|
| `20cbe37` | 批次1:originate 幂等守卫 + 健康检查实时化 + esl-parser O(n) |
| `869321a` | R-A:投递死信(401/403 改可重试)+ 健康度语义 + 退避收敛 |
| `91eb343` | R-B:任务状态机单一转换通道(乐观锁)+ hangup 终态兜底 + 快照 grace + NORMAL_CLEARING |
| `f6d2009` | M:PSM1 fs_cli 输出抗污染(缺陷 #10) |
| `538dd41` | D8 死信路径可见化 + A2 outbox 终态防覆盖 |
| `13f131e` | B3:hangup-cause 单一权威分类表,消除两文件漂移 + 删正则兜底 |

被 review 驳回(非真问题):坏帧断链、providerJobId 无写入点、契约收紧 taskId-only;rawHeaders 白名单收窄为有意脱敏。

### VAD/打断 P0
| 提交 | 内容 |
|---|---|
| `2dfde27` | P0:通道分化门控 + uuid_break/clear_audio 打断打到底 + 端点判停 200→560ms |
| `8f96bbc` | 修复:STT final 落在 waiter 窗口外时缓冲并打断,不再丢句 |

### 首页浏览器模拟外呼
| 提交 | 内容 |
|---|---|
| `260aa0d` | 前端:首页拨号入口 + 麦克风通话客户端 + 字幕 |
| (后端随 `8467e12`) | dispatch web 通道 + voice-agent web 通道字幕 |

### 外呼闭环打通 + TTS 节拍投递(2026-07-11,真机验证)
| 提交 | 内容 |
|---|---|
| `f6518e6` | 修复 scheduler/outbox worker 无法启动导致到点不拨号(worker 必须编译跑) |
| `ee0f616` | CallOutcome 增加 completed 中性终态,修复 set_outcome 契约漂移 |
| `6cc85fe` | outbox BadRequestException 配置类永久错误首败即死信 |
| `ae9b459` | TTS 节拍泵根治长播报期打断失效 + ESL shield/task.cancelling()/RMS 挂起容差四项加固 |

### 意图识别级联 P0 + Phase 2(2026-07-11,真机验证)
| 提交 | 内容 |
|---|---|
| `8bcd073` | P0:keyword 最长优先+否定守卫、LLM"其他"逃生口+强健解析、永不炸兜底、边选择精确优先、[Intent] 日志 |
| `21c9560` | 发布校验:intent 模式判断节点强制兜底边(missing_intent_fallback) |
| `3c5681e` | intentExamples 数据模型 + 编辑器例句配置 |
| `8248b97` | funasr-server POST /embed 句向量端点(懒加载/L2 归一化/mock 可测) |
| `e359329` | voice-agent embedding 层接入(默认 off/fail-open/双门槛/探针日志) |
| `46b2e58` | /embed 改 transformers 直载,修 modelscope pipeline 与 transformers 4.48 不兼容 |

---

## 运维提醒(非代码,验收后需还原)

- **全局配置临时放宽**(为首页外呼验收改的,须还原,已列入 D1):外呼时间窗改回 `09:00-18:00 仅工作日`(现全天)、单被叫日呼上限改回 `3`(现 99)。
- **dev 拨号串权宜**(已列入 D3):`.env` 的 `FREESWITCH_DIAL_STRING` 硬编码主机 LAN IP 直投 MicroSIP,生产必须换 SIP trunk。
- 意图 embedding 层现已在 dev 启用(`INTENT_EMBED_PROVIDER=funasr`,阈值 0.72/0.05 实测合适);电商回访模板 v8 两个判断节点已配例句。
- 另有 ai-call↔ai-knowledge 统一权限 backlog(CALL-08 暂缓、CALL-12 配置对齐),见 `docs/authz-implementation-backlog.md`。
