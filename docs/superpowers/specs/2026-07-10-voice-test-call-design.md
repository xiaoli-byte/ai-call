# 网页模拟外呼设计契约(v2:首页拨号 + 浏览器麦克风通话)

日期:2026-07-10。状态:已决策,实施中。
v1(流程调试面板拨 MicroSIP 的轻量测试通道)已被本版取代:需求方明确要求**尽量走真实业务流程(外呼流程 + 外呼任务)**,验收标准改为浏览器内通话体验;MicroSIP 真机拨测留作后续增强,不在本期范围。

## 验收标准(需求方原话)

访问 `http://localhost:3000/`(dashboard 公开首页),点击拨号 icon 后模拟发起外呼,在当前首页完成通话流程:用户通过**麦克风**进行话术流程的体验(听到 agent 播报、说话被识别、按已发布流程推进)。

## 架构

浏览器扮演 FreeSWITCH 的角色,直连 voice-agent 既有的生产端点 `/audio-stream`;任务侧走**真实管线**:`POST /tasks`(锁定已发布 flowVersion)→ `POST /tasks/:id/dispatch`(新增 web 通道:创建 CallAttempt、任务置 CALLING,但**不写 originate outbox**)→ 浏览器以 `dialog_id=attemptId` 连 WS → voice-agent 照常拉 `/tasks/:id/context`、执行流程快照、经既有端点上报 status/transcript/outcome。通话历史、转写、任务状态全部真实落库。

已核实的关键事实(探查报告,勿重查):
- `/audio-stream` 协议:首帧 JSON metadata(`server.py:256,273`),之后双向**裸二进制 PCM(16kHz mono s16le)**;`audio_response_format:"raw-pcm"`(默认值)时服务端直接把音频 bytes 发回同一条 WS(`server.py:506`)。token 放首帧 metadata 字段(非 query,`server.py:290-297`),`VOICE_AGENT_WS_TOKEN` 为空则跳过。
- `dialog_id` 可用 attemptId(`resolveContext` 接受 taskId/attemptId/providerCallId,`tasks.service.ts:859`)。状态机 PENDING→IN_CALL 不允许(`tasks.service.ts:71-79`),**必须先 dispatch 置 CALLING** 再连 WS。
- raw-pcm 模式下服务端**不回 JSON 字幕**(`server.py:457,463`,FreeSWITCH 会把 JSON 当音频播);浏览器要字幕需新增开关。
- dispatch 硬编码 FreeSWITCH:outbox `call.dispatch_requested` → `outbox.worker.ts:131` `freeswitch.originate`。
- 前端已有可复用音频工具:`lib/audio-utils.ts`(16k 降采样 `downsampleBuffer:134`、`floatTo16BitPCM:96`、`pcm16ToFloat32:113`、分帧 `:40`)、`hooks/useAudioRecorder.ts`(AudioWorklet 采集 mono)、`hooks/useTTS.ts:118-144`(PCM 无缝排队播放模式)。现有 `lib/voice-agent-client.ts` 对接的是 demo 端点(/asr-stream、/tts-stream),**不可直接复用**,但可参考其结构。
- 首页 `app/page.tsx` 是公开静态营销页;hero 面板底部 `callControls`(`page.tsx:173`)已有装饰性 `<Phone/>` 图标,是拨号入口的落点。图标库 lucide-react。登录态:httpOnly cookie,浏览器 API 客户端 `lib/api/client.ts` 同源 `/api` + `credentials:'include'`,401 自动 refresh/跳登录。
- seed 已提供 3 个**已发布**流程 + demo 任务(`seed.ts:606-620`),电商场景可直接选用。

## 跨组件契约(三方必须严格一致)

### 1. API:dispatch 增加 web 通道(apps/api)

`POST /api/tasks/:id/dispatch` Body 新增可选字段 `{ channel?: 'freeswitch' | 'web' }`,缺省 `'freeswitch'`(现行为完全不变)。

`channel === 'web'` 时,复用既有 dispatch 事务(乐观锁 claim 成 CALLING + attemptCount+1 + 创建 CallAttempt(providerCallId=attemptId)+ CallEvent `call.dispatch_requested`),差异仅两点:
1. **不写** `call.dispatch_requested` outbox 事件(不经 FreeSWITCH originate);改为在同事务追加 CallEvent `call.dispatch_accepted`(payload 标注 `channel:'web'`),attempt 直接置 CALLING/ringingAt。
2. 响应体(两种 channel 都)返回 `{ taskId, attemptId, status }`——浏览器需要 attemptId 作为 dialog_id。若现有响应已含这些字段则保持兼容扩展。

权限、合规校验(assertOutboundPolicyAllowed)、状态机全部照旧。

### 2. voice-agent:web 通道行为(services/voice-agent)

首帧 metadata 新增可选字段 **`channel: "web"`**(缺省视为 freeswitch,现行为不变)。`channel=="web"` 时:

1. **字幕直推**:`WebSocketCallbacks` 的 `on_agent_speech`/`on_caller_speech` 除照常上报 NestJS 外,**同时**向同一条 WS 发送**文本帧**(JSON 字符串;浏览器按 text/binary 区分字幕与音频):
   - `{"type":"agent_speech","text":"..."}`
   - `{"type":"caller_speech","text":"..."}`
   - 会话结束:`{"type":"end","reason":"<completed|hangup|error 等>"}`
   - 错误:`{"type":"error","message":"..."}`
2. **终态兜底**:WS 断开(用户点挂断/关页面)时的会话清理里,若任务尚未到终态,调用既有 `tasks.hangup(call_id)`(实施者先核实 `agent.end_session`/现有清理是否已保证终态,缺则仅对 web 通道补上,不改 FreeSWITCH 路径行为)。
3. 音频回程仍走 `audio_response_format:"raw-pcm"` 既有分支,零改动。

同步更新 `contracts/voice-websocket.schema.json`:CallMetadata 增加 `channel`(enum freeswitch|web)与 `audio_response_format`;新增 SessionEvent 消息(`type: end|error`)。

### 3. 浏览器首帧 metadata(dashboard → voice-agent)

```json
{
  "dialog_id": "<attemptId>",
  "caller_id": "<任务 from 号码,可省>",
  "channel": "web",
  "audio_response_format": "raw-pcm",
  "token": "<NEXT_PUBLIC_VOICE_AGENT_WS_TOKEN,未配置则省略>"
}
```

之后:上行**二进制** PCM 16kHz mono s16le,20ms 帧(640 字节)聚批 ≤200ms 发送(对齐 useASR 现有节奏);下行二进制帧=音频(16k s16le,排队播放),文本帧=上述 JSON 字幕/事件。

### 4. dashboard(apps/dashboard)

**新通话客户端**(如 `lib/web-call-client.ts`):管理 WS 生命周期(首帧 metadata → 推流 → 收音频/字幕 → close);麦克风采集与播放复用 `audio-utils.ts` + `useAudioRecorder` 采集链、参照 `useTTS.ts:118-144` 的排队播放实现;对外暴露状态机(idle/preparing/dialing/in-call/ended/error)+ 字幕事件 + hangup()。

**首页接线**(`app/page.tsx` hero 面板,`:131-181` demoPanel/callControls):
- 拨号 `<Phone/>` 改为可点(需抽成 client component,server component 首页引入)。
- 未登录(AuthProvider user 为空或首个 API 调用 401)→ 跳 `/login?redirect=/`。
- 已登录 → 展开通话面板:已发布流程下拉(客户端拉流程列表按 status==='published' 过滤,默认选电商 demo 流程)、被叫号输入(默认 `1001`,仅作任务记录)→「发起模拟外呼」:
  1. `POST /tasks` `{ to, scenario: <流程的 scenario>, flowId }`(真实建单,锁定已发布版本);
  2. `POST /tasks/:id/dispatch` `{ channel: 'web' }` → 拿 `attemptId`;
  3. 申请麦克风权限 → 连 `${NEXT_PUBLIC_VOICE_AGENT_WS_URL}/audio-stream` → 通话中:实时字幕列表 + 状态徽标 +「挂断」(关 WS)。
- 通话结束显示任务号并附「在控制台查看任务」链接(`/tasks`),体现真实管线落库。
- 422/400/401/权限不足按面板错误态展示;拨号 icon 样式沿用 hero 现有 class。

## 环境与运行前提(端到端验收时)

- `NEXT_PUBLIC_VOICE_AGENT_WS_URL` 指向 voice-agent(.env.example 已有,与 VOICE_AGENT_WS_PORT 一致)。
- 可听可说的真实体验:`TTS_PROVIDER=qwen|cosyvoice`(mock TTS 是空音频)+ FunASR 服务(`pnpm dev:funasr`)运行;LLM 可 mock(纯话术流程 dialog 节点不依赖 LLM)。
- 需运行:API、dashboard、voice-agent;**无需** FreeSWITCH/outbox-worker(web 通道不经它们)。
- 数据:`prisma:seed` 的已发布电商流程。

## 验证

1. API spec 测试:web dispatch 不写 outbox、创建 attempt、任务 CALLING、响应含 attemptId;channel 缺省时行为与现有完全一致(仍写 outbox)。
2. voice-agent pytest:channel=web 时字幕文本帧发出、freeswitch 通道不发;断线终态兜底。
3. dashboard vitest:拨号流程调用顺序(create→dispatch→WS)、字幕渲染、未登录跳转。
4. `pnpm check` 全绿。
5. 人工验收:首页点拨号 → 选流程 → 发起 → 麦克风对话 → 挂断 → /tasks 里能看到该任务(COMPLETED/相应终态)与转写记录。
