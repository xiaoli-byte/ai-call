# VAD/打断优化 P0 设计契约

日期:2026-07-10。状态:已决策(用户确认 P0 范围),实施中。
背景评审结论见会话记录;现状事实:默认配置下 TTS 播报期间 ASR 门控丢弃全部上行(agent.py:444-506),`BARGE_IN_DURING_TTS_ENABLED=false`,打断后无 `uuid_break`/浏览器清队列,端点判停 200ms 过急,无最小语音时长。

## P0 目标

1. **通道分化门控**:web 通道(浏览器自带 AEC)播报期间不再丢弃上行,STT partial 即可触发语义级打断;FreeSWITCH 通道保留门控,能量粗检测打断默认启用。
2. **打断打到底**:打断时 FreeSWITCH 通道发 ESL `uuid_break <uuid> all`;web 通道向浏览器发 `{"type":"clear_audio"}` 文本帧,前端清空播放队列。
3. **端点判停放宽**:静音确认窗默认 200ms→560ms;新增最小语音时长(短促噪声不送识别)。
4. 修 dead code 日志、统一帧长默认值、补结构化观测日志。

## 跨组件契约

### 新/改环境变量(根 .env.example,voice-agent 读取)

| 变量 | 旧默认 | 新默认 | 说明 |
|---|---|---|---|
| `VAD_SILENCE_CONFIRM_FRAMES` | 10 | 28 | ≈560ms @20ms 帧;端点判停窗口 |
| `VAD_MIN_SPEECH_MS` | (新增) | 200 | 语音候选累计不足此时长即判噪声丢弃,不送 FunASR |
| `BARGE_IN_DURING_TTS_ENABLED` | false | true | FreeSWITCH 通道播报期间能量粗检测打断 |
| `ASR_TTS_GATE_WEB_ENABLED` | (新增) | false | web 通道播报期间是否仍启用 ASR 门控;默认关(信任浏览器 AEC),回声异常时可开回退 |

`vad.py` 构造默认 `frame_ms` 30→20,与 env 默认一致。

### VAD 状态机(vad.py)

- 新增一次性状态 **`speech_start`**:silence→speech 确认瞬间返回一次(随 frames_to_send 一并 flush 预缓冲),之后持续返回 `speech`。agent.py:542 的日志分支因此复活。
- 新增 **pending(语音候选)阶段**:起说确认后进入候选,帧先入候选缓冲**不下发**;候选期累计语音时长 ≥ `min_speech_ms` 才晋升为 `speech_start` 并 flush(预缓冲+候选帧);若晋升前静音确认先到,整段丢弃、回到 silence(返回状态仍为 `silence`,不产生 speech_end)。对外 API 不变:`feed(frame) -> (state, frames_to_send)`。
- `speech_end` 携带语义不变(触发 stt.end_speech)。

### 打断回调(agent → callbacks)

- `_interrupt_speaking`(agent.py:431)在现有动作(停推流/tts.interrupt/llm.cancel)之外,调用 callbacks 新增的**可选**方法 `on_interrupted()`(不存在则跳过,TextTestCallbacks 不实现)。
- `WebSocketCallbacks.on_interrupted()`:
  - `channel=="web"`:向 WS 发文本帧 `{"type":"clear_audio"}`。
  - FreeSWITCH 通道(esl-file 播放模式):经既有 ESL 控制连接发 `uuid_break <call_uuid> all`,停掉 uuid_broadcast 队列;失败仅 warn。

### 门控分化(agent.py)

- 会话须知晓 channel(来自首帧 metadata,server 建会话时传入)。
- `_is_asr_suppressed`:web 通道且 `ASR_TTS_GATE_WEB_ENABLED=false` 时,播报期间**不**抑制(尾音保护窗同样跳过);FreeSWITCH 通道行为不变。
- web 通道播报期间的打断路径 = 正常 VAD→FunASR partial→`_interrupt_speaking`(语义级);FreeSWITCH 通道 = RMS 粗检测(默认启用)。

### contracts/voice-websocket.schema.json

SessionEvent 的 `type` enum 增加 `clear_audio`(无附加字段)。

### dashboard(apps/dashboard)

- `web-call-client.ts`:解析 `{"type":"clear_audio"}` 事件并透传。
- `useWebCall.ts`:收到 clear_audio → `stopPlayback()`(停所有音源、`nextPlayTime` 归零),**不**关闭 AudioContext、不改通话状态——后续新音频照常排队。
- 温和收尾(finishCallAfterPlayback)逻辑不受影响:clear_audio 后 nextPlayTime 已归零,若随后 end 帧到达,剩余时长为 0,立即收尾,语义正确。

### 观测日志(voice-agent,INFO 级结构化)

- `speech_start`(含预缓冲/候选时长)、`speech_end`(含本段语音时长)、`utterance_discarded`(短于 min_speech)、`barge_in`(来源:stt_partial|rms,通道)、`interrupt_executed`(uuid_break 成功/失败、clear_audio 已发)。

## 验证

1. pytest:VAD 候选/丢弃/speech_start 状态机;web 通道门控关闭時 partial 触发打断且 on_interrupted 发 clear_audio;FreeSWITCH 通道门控与 uuid_break;短语音丢弃不调 end_speech。既有用例全绿(端点参数变化需同步既有断言)。
2. vitest:clear_audio → 播放队列清空、状态不变、后续音频可继续播。
3. `pnpm check` 全绿。
4. 人工:web 通话中打断 AI(说"停一下")→ AI 立即住口且不重复;报订单号带停顿不被抢话。
