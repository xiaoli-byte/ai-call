r"""FunASR WebSocket STT 客户端。

复刻自 packages/providers/src/stt/funasr.ts。

关键协议（参考 FunASR 官方 funasr_wss_server.py）：
- 服务器强制 subprotocols=["binary"]
- 客户端连上后先发 JSON 配置：mode/chunk_size/chunk_interval/wav_name/is_speaking/hotwords/itn
- 持续推送二进制 PCM 16-bit 16kHz mono
- 发送 {is_speaking:false} 触发 offline 整句识别
- 响应：2pass-online → partial；2pass-offline / is_final:true → final
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Awaitable, Callable, Literal, Optional
from uuid import uuid4

import websockets

from .types import STTEvent

logger = logging.getLogger(__name__)

STTMode = Literal["online", "offline", "2pass"]


class FunASRClient:
    """FunASR 流式 ASR 客户端。

    生命周期：connect() → send_audio() * N → end_speech() → close()
    """

    def __init__(
        self,
        server_url: str,
        call_id: str,
        mode: STTMode = "2pass",
        hotwords: str = "",
        on_event: Optional[Callable[[STTEvent], Awaitable[None]]] = None,
    ) -> None:
        self._server_url = server_url
        self._call_id = call_id
        self._mode = mode
        self._hotwords = hotwords
        self._on_event = on_event

        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._ready = asyncio.Event()
        self._closed = False
        self._recv_task: Optional[asyncio.Task[None]] = None
        # 连接建立前缓冲的音频帧
        self._pending_audio: list[bytes] = []
        self._speaking = True

    @property
    def call_id(self) -> str:
        return self._call_id

    @property
    def ready(self) -> bool:
        return self._ready.is_set() and self._ws is not None and not self._closed

    async def connect(self) -> None:
        """建立 WebSocket 连接并发送初始配置。"""
        if self._closed:
            return

        try:
            self._ws = await websockets.connect(
                self._server_url,
                subprotocols=["binary"],  # FunASR 服务器强制要求
                max_size=None,  # 允许较大音频帧
                ping_interval=20,
                ping_timeout=20,
            )
        except Exception as err:
            logger.error("[FunASR] call_id=%s 连接失败: %s", self._call_id, err)
            self._closed = True
            raise

        # 发送初始配置
        config = {
            "mode": self._mode,
            "chunk_size": [5, 10, 5],
            "chunk_interval": 10,
            "wav_name": f"call_{self._call_id}",
            "is_speaking": True,
            "hotwords": self._hotwords,
            "itn": True,
        }
        await self._ws.send(json.dumps(config))
        self._ready.set()

        # flush 连接前缓冲的音频
        if self._pending_audio:
            for buf in self._pending_audio:
                await self._ws.send(buf)
            self._pending_audio.clear()

        # 启动接收循环
        self._recv_task = asyncio.create_task(self._recv_loop())
        logger.info("[FunASR] call_id=%s connected", self._call_id)

    async def send_audio(self, pcm: bytes) -> None:
        """发送一段 PCM 16-bit 16kHz mono 音频。"""
        if self._closed:
            return
        if self._ws is None or not self._ready.is_set():
            self._pending_audio.append(pcm)
            return
        try:
            if not self._speaking:
                await self._ws.send(json.dumps({"is_speaking": True}))
                self._speaking = True
            await self._ws.send(pcm)
        except Exception as err:
            logger.warning(
                "[FunASR] call_id=%s send_audio failed: %s, buffering", self._call_id, err
            )
            self._pending_audio.append(pcm)

    async def end_speech(self) -> None:
        """通知服务器用户已停止说话，触发 offline 整句识别。"""
        if self._closed or self._ws is None:
            return
        if not self._speaking:
            return
        try:
            await self._ws.send(json.dumps({"is_speaking": False}))
            self._speaking = False
        except Exception as err:
            logger.warning("[FunASR] call_id=%s end_speech failed: %s", self._call_id, err)

    async def close(self) -> None:
        """关闭连接。"""
        if self._closed:
            return
        self._closed = True

        if self._recv_task and not self._recv_task.done():
            self._recv_task.cancel()
            try:
                await self._recv_task
            except (asyncio.CancelledError, Exception):
                pass

        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

        self._ready.clear()

    async def _recv_loop(self) -> None:
        """接收 FunASR 识别结果并回调。"""
        if self._ws is None:
            return
        try:
            async for raw in self._ws:
                if self._closed:
                    break
                try:
                    msg = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    continue

                text = msg.get("text", "")
                if not text:
                    continue

                mode = msg.get("mode", "")
                is_offline = "offline" in mode or msg.get("is_final") is True
                event = STTEvent(type="final" if is_offline else "partial", text=text)

                if self._on_event is not None:
                    try:
                        await self._on_event(event)
                    except Exception as err:
                        logger.exception(
                            "[FunASR] call_id=%s on_event callback error: %s",
                            self._call_id,
                            err,
                        )
        except asyncio.CancelledError:
            pass
        except Exception as err:
            if not self._closed:
                logger.warning("[FunASR] call_id=%s recv loop ended: %s", self._call_id, err)


class DashScopeFunASRClient:
    """阿里云百炼 Fun-ASR 实时语音识别客户端。

    与 FunASRClient 同接口（鸭子类型），可被 create_stt_client 工厂互换。
    Fun-ASR 是本地 FunASR 的云端托管版，走 DashScope 实时语音 WebSocket 协议。

    协议（参考 Fun-ASR 实时识别 WebSocket API；一条 WS 连接内按 run-task/finish-task
    循环复用，一句用户话语对应一个 task，而非整通电话一个 task）：
    - connect(): 仅连 wss、起接收循环；run-task 延迟到首帧真实音频再发（见 send_audio）
    - send_audio(pcm): 首帧触发 run-task + 等 task-started，此后推二进制 PCM 帧
    - end_speech(): 本地合成 final 上报 + 结束当前 task（发 finish-task）并重置
      （新 task_id/_run_task_sent=False），下一句从全新 task 开始识别，避免服务端
      识别缓冲跨句累加（DashScope 没有句内边界重置原语，只能靠结束/新建 task）
    - close(): 若仍有活跃 task，发 finish-task 收尾；取消接收循环并关连接
    - 接收：result-generated 事件 → sentence_end=False 视为 partial、True 视为 final；
      task-finished/task-failed 只结束当前 task，不中断整条连接（等下一句新 task）

    音频要求：PCM 16-bit 16kHz 单声道（与 mod_audio_fork "mono 16k" 一致，无需重采样）。
    """

    _DEFAULT_WS_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/"

    def __init__(
        self,
        *,
        call_id: str,
        api_key: str,
        model: str = "fun-asr-realtime",
        sample_rate: int = 16000,
        hotwords: str = "",
        on_event: Optional[Callable[[STTEvent], Awaitable[None]]] = None,
        ws_url: Optional[str] = None,
        connect_timeout_s: float = 10.0,
    ) -> None:
        self._call_id = call_id
        self._api_key = api_key
        self._model = model
        self._sample_rate = sample_rate
        # 预留：Fun-ASR 定制词/热词需在百炼控制台创建 vocabulary_id 后透传，
        # 与本地 hotwords 字符串机制不同，此处暂不透传（避免非法参数导致 task-failed）。
        self._hotwords = hotwords
        self._on_event = on_event
        self._ws_url = ws_url or self._DEFAULT_WS_URL
        self._connect_timeout_s = connect_timeout_s

        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._task_id = uuid4().hex
        self._started = asyncio.Event()
        self._closed = False
        self._recv_task: Optional[asyncio.Task[None]] = None
        self._pending_audio: list[bytes] = []
        # 最近一次 partial 文本，供 end_speech 在服务端未自判句尾时兜底成 final
        self._current_text = ""
        # run-task 是否已发：延迟到首帧真实音频再发，避免 task 空闲 23s 超时
        self._run_task_sent = False

    @property
    def call_id(self) -> str:
        return self._call_id

    @property
    def ready(self) -> bool:
        return self._started.is_set() and self._ws is not None and not self._closed

    async def connect(self) -> None:
        if self._closed:
            return
        try:
            self._ws = await websockets.connect(
                self._ws_url,
                additional_headers={
                    "Authorization": f"bearer {self._api_key}",
                    "X-DashScope-DataInspection": "enable",
                },
                max_size=None,
                ping_interval=20,
                ping_timeout=20,
            )
        except Exception as err:
            logger.error("[FunASR/Cloud] call_id=%s 连接失败: %s", self._call_id, err)
            self._closed = True
            raise

        # run-task 延迟到首帧真实音频再发：DashScope task 一旦 run-task 便开始 23s 空闲
        # 超时倒计时，而 voice-agent 开场白门控期不发音频，会把 task 空等到超时
        # (task-failed → 后续音频 1007)。WS 靠 ping_interval 保活，task 计时对齐首帧音频。
        self._recv_task = asyncio.create_task(self._recv_loop())
        logger.info(
            "[FunASR/Cloud] call_id=%s connected model=%s (run-task 延迟到首帧音频)",
            self._call_id,
            self._model,
        )

    async def _ensure_task_started(self) -> None:
        """首帧音频前发 run-task 并等 task-started（幂等）。"""
        if self._run_task_sent or self._ws is None:
            return
        self._run_task_sent = True
        run_task = {
            "header": {
                "action": "run-task",
                "task_id": self._task_id,
                "streaming": "duplex",
            },
            "payload": {
                "task_group": "audio",
                "task": "asr",
                "function": "recognition",
                "model": self._model,
                "parameters": {"format": "pcm", "sample_rate": self._sample_rate},
                "input": {},
            },
        }
        await self._ws.send(json.dumps(run_task))
        await asyncio.wait_for(self._started.wait(), timeout=self._connect_timeout_s)
        logger.info("[FunASR/Cloud] call_id=%s task-started", self._call_id)

    async def send_audio(self, pcm: bytes) -> None:
        if self._closed:
            return
        if self._ws is None:
            self._pending_audio.append(pcm)
            return
        # 首帧音频触发 run-task（延迟建 task，避免开场白门控期空闲超时）
        if not self._run_task_sent:
            try:
                await self._ensure_task_started()
            except Exception as err:
                logger.error(
                    "[FunASR/Cloud] call_id=%s run-task 失败: %s", self._call_id, err
                )
                self._pending_audio.append(pcm)
                return
        if not self._started.is_set():
            self._pending_audio.append(pcm)
            return
        try:
            # flush 之前缓冲的帧（含等待 task-started 期间累积的）
            if self._pending_audio:
                for buf in self._pending_audio:
                    await self._ws.send(buf)
                self._pending_audio.clear()
            await self._ws.send(pcm)
        except Exception as err:
            logger.warning(
                "[FunASR/Cloud] call_id=%s send_audio failed: %s, buffering",
                self._call_id,
                err,
            )
            self._pending_audio.append(pcm)

    async def end_speech(self) -> None:
        """voice-agent 的 VAD 判定句尾（speech_end）时调用。

        两件事：
        1) 本地合成 final 上报：voice-agent 门控在句尾会停止向 STT 发送音频（跳过
           静音帧），云端 Fun-ASR 收不到句尾静音、无法自动判 sentence_end，所以用
           最近一次 partial 兜底成 final（与本地 FunASR 的 is_speaking:false →
           offline final 语义一致）。
        2) 结束当前云端 task 并为下一句准备全新 task_id：DashScope 没有"同一个 task
           内重置句子边界"的原语，如果不结束 task，服务端的识别文本缓冲区不会清空——
           下一句话会在上一句文本后面继续拼接（真机复现：第一轮"到了呀"，第二轮
           变成"到了呀，明天下午2点"）。发 finish-task 后立即（不等服务端确认）
           重置本地状态，下一句第一帧音频触发全新 run-task，服务端从零识别。
        """
        if self._closed:
            return
        text = self._current_text
        self._current_text = ""
        if text and self._on_event is not None:
            try:
                await self._on_event(STTEvent(type="final", text=text))
            except Exception as err:
                logger.exception(
                    "[FunASR/Cloud] call_id=%s end_speech final callback error: %s",
                    self._call_id,
                    err,
                )

        if self._run_task_sent and self._ws is not None:
            try:
                finish_task = {
                    "header": {
                        "action": "finish-task",
                        "task_id": self._task_id,
                        "streaming": "duplex",
                    },
                    "payload": {"input": {}},
                }
                await self._ws.send(json.dumps(finish_task))
            except Exception as err:
                logger.warning(
                    "[FunASR/Cloud] call_id=%s end_speech finish-task failed: %s",
                    self._call_id,
                    err,
                )
            # 不等服务端 task-finished 确认：立即重置，下一句第一帧音频即可开新 task。
            # WS 连接保留（DashScope 协议支持单连接多 task 复用），_recv_loop 继续收。
            self._run_task_sent = False
            self._task_id = uuid4().hex
            self._started.clear()

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True

        # 发 finish-task，让服务端把最后一句 flush 成 final 后正常收尾
        # （仅在已发过 run-task 时；否则无 task 可结束）
        if self._ws is not None and self._run_task_sent:
            try:
                finish_task = {
                    "header": {
                        "action": "finish-task",
                        "task_id": self._task_id,
                        "streaming": "duplex",
                    },
                    "payload": {"input": {}},
                }
                await self._ws.send(json.dumps(finish_task))
            except Exception:
                pass

        if self._recv_task and not self._recv_task.done():
            self._recv_task.cancel()
            try:
                await self._recv_task
            except (asyncio.CancelledError, Exception):
                pass

        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

        self._started.clear()

    async def _recv_loop(self) -> None:
        if self._ws is None:
            return
        try:
            async for raw in self._ws:
                if self._closed:
                    break
                try:
                    msg = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    continue

                header = msg.get("header", {}) or {}
                event = header.get("event", "")

                if event == "task-started":
                    self._started.set()
                    continue
                if event == "task-finished":
                    # 一通电话内多个 task 循环（每句一个 task，见 end_speech）：
                    # finished 只代表这一句的 task 结束，连接本身继续收下一个 task 的事件。
                    continue
                if event == "task-failed":
                    logger.error(
                        "[FunASR/Cloud] call_id=%s task-failed code=%s msg=%s",
                        self._call_id,
                        header.get("error_code"),
                        header.get("error_message"),
                    )
                    # 同上：单句 task 失败不终止整条连接，下一句仍可发起新 task。
                    continue
                if event != "result-generated":
                    continue

                output = (msg.get("payload", {}) or {}).get("output", {}) or {}
                sentence = output.get("sentence") or {}
                # 防御性取文本：优先 output.sentence.text，兜底 output.text
                text = ""
                if isinstance(sentence, dict):
                    text = sentence.get("text", "") or ""
                if not text:
                    text = output.get("text", "") or ""
                if not text:
                    continue

                is_final = bool(
                    isinstance(sentence, dict) and sentence.get("sentence_end", False)
                )
                # 记录最近 partial 供 end_speech 兜底；服务端自判句尾则清空避免重复
                self._current_text = "" if is_final else text
                stt_event = STTEvent(
                    type="final" if is_final else "partial", text=text
                )

                if self._on_event is not None:
                    try:
                        await self._on_event(stt_event)
                    except Exception as err:
                        logger.exception(
                            "[FunASR/Cloud] call_id=%s on_event callback error: %s",
                            self._call_id,
                            err,
                        )
        except asyncio.CancelledError:
            pass
        except Exception as err:
            if not self._closed:
                logger.warning(
                    "[FunASR/Cloud] call_id=%s recv loop ended: %s", self._call_id, err
                )


def create_stt_client(
    *,
    call_id: str,
    ws_url: str,
    mode: STTMode,
    hotwords: str,
    on_event: Optional[Callable[[STTEvent], Awaitable[None]]],
):
    """按 STT_PROVIDER 环境变量创建 STT 客户端（统一鸭子接口：connect/send_audio/end_speech/close）。

    - funasr-local（默认）：本地 FunASR WebSocket 服务（FunASRClient），行为与现状一致
    - funasr-cloud / dashscope：阿里云百炼 Fun-ASR 实时识别（DashScopeFunASRClient）
      需 DASHSCOPE_API_KEY；缺失时告警并回退本地，避免配置疏漏中断通话。
    """
    provider = os.getenv("STT_PROVIDER", "funasr-local").strip().lower()
    if provider in ("funasr-cloud", "dashscope", "cloud"):
        api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
        model = os.getenv("FUNASR_CLOUD_MODEL", "").strip() or "fun-asr-realtime"
        if not api_key:
            logger.error(
                "[STT] STT_PROVIDER=%s 但 DASHSCOPE_API_KEY 未配置，回退本地 FunASR",
                provider,
            )
            return FunASRClient(
                ws_url, call_id, mode=mode, hotwords=hotwords, on_event=on_event
            )
        return DashScopeFunASRClient(
            call_id=call_id,
            api_key=api_key,
            model=model,
            hotwords=hotwords,
            on_event=on_event,
        )
    return FunASRClient(
        ws_url, call_id, mode=mode, hotwords=hotwords, on_event=on_event
    )
