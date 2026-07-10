# 项目待办 Backlog

外呼可靠性(microsip 真实外呼 review)与 VAD/打断优化两条线的**剩余未完成项**。
已完成项见文末「已交付」清单与对应提交。

> 相关设计契约:
> - `docs/superpowers/specs/2026-07-10-microsip-real-outbound-design.md`(外呼实现)
> - `docs/superpowers/specs/2026-07-10-vad-barge-in-p0.md`(VAD/打断 P0)
> - `docs/superpowers/specs/2026-07-10-voice-test-call-design.md`(首页浏览器模拟外呼)

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

### A4 · [窄残留] #1 originate 幂等的 bgapi 异步崩溃窗口
- **现状**:pre-originate 幂等守卫(已提交)挡住了常见重投。残留极窄窗口:`bgapi originate` 成功、providerJobId 提交前进程崩溃、且首通在重投前已挂断 → 可能对同一号码二次真实外呼。
- **做法**:pre-originate 写一条「派发在途」持久标记(需给 CallAttempt 加列 + 迁移),重投前检查;或让 originate 以 attemptId 为幂等键在 FreeSWITCH 侧同步去重。
- **影响文件**:`prisma/schema.prisma`(迁移)、`outbox.worker.ts`。
- **优先级**:低(概率极低,但属外呼合规)。**估算**:小-中(含迁移)。

### A5 · [窄残留] #9 evidence-only COMPLETED 的 duration 缺失
- **现状**:仅凭事件 raw 应答证据(无真实 CHANNEL_ANSWER)判 COMPLETED 时,为避免造假时间戳未回填 `answeredAt`,故该 attempt 的 `duration` 可能为空(状态分类已正确)。
- **做法**:解析 `variable_answer_epoch` 为真实应答时刻回填 duration。依赖 A6 的白名单。
- **影响文件**:`tasks.service.ts`、`freeswitch-event-parser.ts`。
- **优先级**:低。**估算**:小。

### A6 · [运维] 死信 sink 指向持久卷
- **现状**:死信默认路径 CWD 相对(已加启动日志 + 每次落盘日志暴露绝对路径)。生产需把 `FREESWITCH_EVENT_DEAD_LETTER_PATH` 指向持久卷,并在 `*-worker.main.ts` 注入该 env,否则重启后 replay 文件散落/丢失。
- **影响文件**:`apps/api/src/freeswitch-event-worker.main.ts`、部署配置。
- **优先级**:中(生产上线前)。**估算**:小。

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

---

## 运维提醒(非代码,验收后需还原)

- **全局配置临时放宽**(为首页外呼验收改的,须还原):外呼时间窗改回 `09:00-18:00 仅工作日`(现全天)、单被叫日呼上限改回 `3`(现 99)。
- 另有 ai-call↔ai-knowledge 统一权限 backlog(CALL-08 暂缓、CALL-12 配置对齐),见 `docs/authz-implementation-backlog.md`。
