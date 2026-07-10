# TTS 节拍投递(Paced Delivery)——修复长播报期打断失效

日期:2026-07-11 · 状态:待实施 · 层级:voice-agent 传输层(server.py),agent.py 不改

## 背景与问题

实测(callId=94a5ea21,2026-07-10 20:16):约 8 秒的问候语(256000 字节 ÷ 32 字节/ms),
TTS 合成+投递在 ~0.9 秒内全部完成并塞进 FreeSWITCH 的 uuid_broadcast 队列,`_speak()` 的
finally 随即清掉 `_speaking`。此后 **7 秒的真实播放期内**:

- STT-final 打断路径(agent.py `_on_stt_event`)看到 `_speaking=False` → 不触发 BargeIn,
  用户插话被当成正常轮次;
- RMS 粗检测(`_observe_barge_in_candidate`)同样 gate 在 `_speaking` 上 → 失效;
- 新一轮 TTS 在旧音频未播完时开播 → 叠音(日志:回复 37.6s 开播、告别 38.7s 开播,
  而问候语 38.1s 才真正放完)。

根因:`_speaking` 的语义是"合成+投递指令发完",而打断需要"电话里还在放"。
差值 = 投递速度(≈合成速度,远快于实时)与播放速度(实时)之差。

## 设计:节拍泵

不估算、不改打断机制——**让投递本身按实时节拍走**,Python 侧始终握着未投递音频:

```
QwenTTS ws ──全速──▶ asyncio.Queue ──节拍泵(字节钟节流)──▶ FreeSWITCH/浏览器
  (尽快读完,早释放连接)                  在途 ≤ LEAD_MS          打断只需杀在途
```

- **字节钟**:音频固定 16kHz/16bit/mono → 32 字节 = 1ms。`t0` = 首块投递时刻;
  第 k 块投递前 `await sleep(max(0, t0 + sent_ms/1000 - LEAD_MS/1000 - now))`。
  首块与 LEAD 窗口内的块立即放行 → **首包延迟不变**。
- **`_speaking` 构造上准确**:`on_audio_output_complete()` 等泵播完最后一块
  (即等到 `t0 + total_ms + TAIL_MARGIN_MS`)才返回 → `_speak()` finally 清
  `_speaking` 的时刻 ≈ 电话真实播完时刻 → STT/RMS 打断全程有效,agent.py 零改动。
- **打断锋利**:未投递音频根本没出 Python(直接丢队列);FreeSWITCH 里在途
  ≤ LEAD_MS + 1 chunk(约 2s),`uuid_break all` 一刀切干净;未播 wav 不再写盘。

## 实施细节(server.py `WebSocketCallbacks`)

### 新增状态

```python
self._paced_enabled = os.getenv("TTS_PACED_DELIVERY_ENABLED", "true").lower() != "false"
self._paced_lead_ms = int(os.getenv("TTS_PACED_LEAD_MS", "1200"))
self._paced_tail_margin_ms = int(os.getenv("TTS_PACED_TAIL_MARGIN_MS", "200"))
self._stream: Optional[_PacedStream] = None   # 每个 utterance 一个,dataclass:
# queue: asyncio.Queue[bytes | None](None=终止哨兵), pump: asyncio.Task,
# t0: float | None, sent_bytes: int, total_bytes: int
```

### 数据流(paced 开启时,三种 audio_response_format 统一走泵)

1. `on_audio_output(audio)`:
   - 入口守卫:`self._stream is not None and self._stream.pump.done()` → 置 None(清理罕见孤儿)。
   - `self._stream is None` → 创建 queue + 启动泵 task。
   - `queue.put_nowait(audio)`,**立即返回**(不阻塞 QwenTTS ws 读取)。
2. **泵协程**(单消费者):
   - esl-file:内部聚合到 `_playback_chunk_bytes`(逻辑同现状),每个聚合块按字节钟
     节流后调 `_play_audio_chunk`(写 wav + uuid_broadcast,保持现状);
   - raw-pcm / base64-json(web):TTS 原始块直接按字节钟节流后走现有发送路径;
   - 收到哨兵 `None`:flush 残余 buffer(esl-file)→ 最后 sleep 到
     `t0 + total_ms/1000 + tail_margin` → 退出。
   - `t0` 在**第一次实际发送前**取 `time.monotonic()`。
3. `on_audio_output_complete()`:
   ```python
   queue.put_nowait(None)
   try:
       await stream.pump
   except asyncio.CancelledError:
       stream.pump.cancel()   # 双保险:speak task 被取消时同时终结泵
       raise
   finally:
       self._stream = None
       # esl-file 原有的 "[Playback] stream complete" 日志保留(泵退出后打)
   ```
4. `on_interrupted()`(在现有逻辑**之前**加):cancel 泵 task、清空 queue、
   `self._stream = None`,然后走现有 `_playback_buffer.clear()` + `uuid_break`/`clear_audio`。
5. **会话拆除**:ws 连接 handler 的 finally 中调用新方法
   `callbacks.cancel_playback()`(与 on_interrupted 共用取消逻辑,不发 uuid_break),
   防挂断/异常路径泵泄漏。
6. `TTS_PACED_DELIVERY_ENABLED=false` → 完全走现有旧路径(逐行为等价),回退开关。

### 取消链契约(必须双保险,已确认的现有语义)

`_interrupt_speaking`(agent.py:464,同步)做三件事:`_speaking=False`、
`tts.interrupt()`(令 synthesize 抛 CancelledError)、`create_task(on_interrupted())`。
两条路径都必须终结泵:

- 正常打断:`on_interrupted` task → cancel 泵(路径 4);
- synthesize 中途被打断时 `on_audio_output_complete` 根本不会被调用 →
  泵由 `on_interrupted` 终结;两者间隙泵最多多发 1 块(节拍间隔数百 ms,可接受)。
- 已知良性残留:TTS 非打断异常且通话继续时,孤儿泵由下一次 on_audio_output 的
  入口守卫或会话拆除清理;期间行为退化为旧路径,不会更糟。

## 测试(pytest,tests/ 现有 fake 风格,asyncio_mode=auto,用小参数保证快)

1. **节拍**:fake ESL/ws 记录每次发送时间戳;`FREESWITCH_PLAYBACK_CHUNK_MS=100`、
   `TTS_PACED_LEAD_MS=50`、总音频 ~400ms → 断言各块发送时刻不早于字节钟排程
   (容差 ~30ms),且 `on_audio_output_complete` 耗时 ≥ total_ms − lead。
2. **持有**:complete 返回时刻 ≥ t0 + total + tail_margin(容差)。
3. **打断**:中途调 `on_interrupted()` → 之后零发送、queue 清空、uuid_break 被调、
   `_stream is None`;随后新 utterance 正常工作。
4. **回退**:flag=false → 全部立即发送(complete 快速返回),与现状一致。
5. **web 通道**:raw-pcm 同样被节流;打断仍发 `clear_audio`。

## 验收

- `cd services/voice-agent && .venv/Scripts/python -m pytest tests -q` 全绿(存量 101 + 新增)。
- 真机:长问候语播到一半插话 → 日志出现 `[BargeIn] ... barge_in` + `interrupt_executed uuid_break ok`,
  电话里 ≤1s 内闭嘴;转写/回复正常;无叠音。
- 首包延迟与现状持平(日志 `[Playback] first chunk latency_ms`)。

## 明确不做(本次)

- 不订阅 FreeSWITCH `PLAYBACK_STOP` 拿 ground truth(backlog Phase 2,在途缩到 ~2s 后价值降低);
- 不动话机 AEC(backlog B-P2b);不动 agent.py 打断/门控逻辑。
