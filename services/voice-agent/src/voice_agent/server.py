"""FreeSWITCH mod_audio_fork WebSocket 服务端。

复刻自 apps/voice-agent/src/websocket-server.ts。

协议（参见 freeswitch/conf/autoload_configs/audio_fork.conf.xml）：
- 监听路径：/audio-stream（与 TS 版同端口同路径，零配置迁移）
- 第一帧：JSON metadata { dialog_id, caller_id, callee_id?, scenario?, ...dynamic_vars }
- 后续帧：二进制 PCM 16-bit 16kHz mono
- 双向：服务端 ws.send(bytes) 推回 TTS 音频给 FreeSWITCH 播放

会话生命周期：
1. FreeSWITCH 建连 → 第一帧 JSON 解析出 call_id
2. asyncio.create_task(agent.start_session(...)) 异步启动对话循环（不阻塞音频接收）
3. 后续二进制帧 → agent.receive_audio(call_id, msg)
4. 连接断开 → cancel session_task + agent.end_session(call_id)
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import secrets
import time
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

import websockets
from websockets.datastructures import Headers
from websockets.http11 import Response

from websockets.protocol import State

from .agent import VoiceAgent
from .scenarios import (
    DEFAULT_VARIABLES,
    extract_template_vars,
    get_scenario,
    scenario_from_contract,
)
from .tasks import TaskClient
from .text_test_callbacks import TextTestCallbacks
from .types import ToolCall, ToolResult
from uuid import uuid4

logger = logging.getLogger(__name__)

# 所有合法的 WebSocket 路径
_VALID_PATHS = {"/audio-stream", "/asr-stream", "/tts-stream", "/text-test"}
_HEALTH_PATHS = {"/health", "/health/live", "/health/ready"}


def _ws_is_open(ws: Any) -> bool:
    """检查 WebSocket 连接是否打开（兼容 websockets < 11 和 >= 11）。"""
    if hasattr(ws, "open"):
        return bool(ws.open)  # websockets < 11
    return getattr(ws, "state", None) == State.OPEN  # websockets >= 11


class VoiceAgentServer:
    """FreeSWITCH mod_audio_fork WebSocket 服务端 + Demo 端点路由。"""

    def __init__(
        self,
        host: str,
        port: int,
        path: str,
        agent: VoiceAgent,
        tasks: Optional[TaskClient] = None,
        demo_server: Optional[Any] = None,
    ) -> None:
        self._host = host
        self._port = port
        self._path = path
        self._agent = agent
        # 复用 agent 内部的 TaskClient，避免重复创建 httpx 连接池
        self._tasks = tasks or TaskClient()
        self._demo = demo_server

    async def start(self) -> None:
        """启动 WebSocket 服务端，永久运行。"""
        try:
            await _get_shared_esl_client()
            logger.info("[ESL] persistent control connection ready")
        except Exception as err:
            logger.warning("[ESL] preconnect failed, will retry on playback: %s", err)
        async with websockets.serve(
            self._handle,
            self._host,
            self._port,
            process_request=self._check_path,
        ):
            display_host = self._host if self._host else "*"
            logger.info(
                "[VoiceAgentServer] listening on ws://%s:%s (paths: %s)",
                display_host,
                self._port,
                ", ".join(sorted(_VALID_PATHS)),
            )
            logger.info(
                "[VoiceAgentServer] waiting for FreeSWITCH mod_audio_fork connections..."
            )
            await asyncio.Future()  # run forever

    @property
    def _esl_ready(self) -> bool:
        """实时判定 ESL 控制连接是否就绪（不依赖 start() 时写入的静态标志）。

        - 共享 ESL 客户端已创建：以其 is_open 为准，断线会立即反映。
        - 客户端尚未创建：若配置了 ESL host/port 环境变量，则视为未就绪
          （等待 start() 的预连接或首次播放触发的懒连接）；纯 web 模式下
          （未配置 ESL）不应因此拦截 /health/ready。
        """
        if _shared_esl_client is not None:
            return _shared_esl_client.is_open
        esl_configured = bool(os.getenv("FREESWITCH_ESL_HOST")) or bool(
            os.getenv("FREESWITCH_ESL_PORT")
        )
        return not esl_configured

    def _check_path(
        self, connection: Any, request: Any
    ) -> Optional[Response]:
        """websockets 库的 process_request 钩子：路径不符返回 404。

        websockets >= 11 的 process_request 签名为 (connection, request)，
        路径从 request.path 获取。
        """
        path = getattr(request, "path", "") or ""
        pathname = urlparse(path).path if path else path
        if pathname in _HEALTH_PATHS:
            return self._health_response(pathname)
        if pathname not in _VALID_PATHS:
            logger.warning("[VoiceAgentServer] rejected connection: path=%s", path)
            return Response(
                404,
                "Not Found",
                Headers([("Content-Type", "text/plain")]),
                b"Not Found\n",
            )
        expected_token = os.getenv("VOICE_AGENT_WS_TOKEN", "")
        if expected_token and pathname in {"/asr-stream", "/tts-stream"}:
            provided = parse_qs(urlparse(path).query).get("token", [""])[0]
            if not secrets.compare_digest(provided, expected_token):
                return Response(
                    401,
                    "Unauthorized",
                    Headers([("Content-Type", "text/plain")]),
                    b"Unauthorized\n",
                )
        return None  # 放行

    def _health_response(self, pathname: str) -> Response:
        """Return a secret-free HTTP health response on the WebSocket port."""
        tts = getattr(self._agent, "_tts", None)
        tts_name = str(getattr(tts, "name", "unconfigured"))
        tts_ready = bool(tts) and tts_name.strip().lower() not in {
            "mock",
            "mock-tts",
            "unconfigured",
        }
        real_call_mode = os.getenv(
            "OUTBOUND_REAL_CALL_MODE", "false"
        ).strip().lower() in {"1", "true", "yes", "on"}
        ready = self._esl_ready and (tts_ready or not real_call_mode)
        live_only = pathname == "/health/live"
        status = 200 if live_only or ready else 503
        payload = json.dumps(
            {
                "status": "ok" if ready else "degraded",
                "live": True,
                "ready": ready,
                "esl_ready": self._esl_ready,
                "tts_provider": tts_name,
                "tts_ready": tts_ready,
                "real_call_mode": real_call_mode,
            },
            ensure_ascii=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return Response(
            status,
            "OK" if status == 200 else "Service Unavailable",
            Headers(
                [
                    ("Content-Type", "application/json"),
                    ("Cache-Control", "no-store"),
                    ("Content-Length", str(len(payload))),
                ]
            ),
            payload,
        )

    async def _handle(self, ws: Any) -> None:
        """处理单个 WebSocket 连接 — 按 path 路由分发。"""
        # websockets >= 11：路径在 ws.request.path（ServerConnection.request）
        request = getattr(ws, "request", None)
        raw_path = getattr(request, "path", self._path) if request else self._path
        pathname = urlparse(raw_path).path if raw_path else raw_path

        if pathname == "/asr-stream" and self._demo is not None:
            await self._demo.handle_asr(ws)
            return
        if pathname == "/tts-stream" and self._demo is not None:
            await self._demo.handle_tts(ws)
            return

        if pathname == "/text-test":
            await self._handle_text_test(ws)
            return

        # 默认：/audio-stream 走 FreeSWITCH Agent 链路
        await self._handle_audio_stream(ws)

    async def _handle_text_test(self, ws: Any) -> None:
        """处理 /text-test 连接 — 文本调试会话。

        协议：
        - 第一帧 JSON: {type: 'start', flowId, variables?}
        - 后续帧: {type: 'user_input', text} 或 {type: 'hangup'}
        - 服务端推送: connected / node_enter / agent_speech / action / end / error
        """
        call_id: Optional[str] = None
        session_task: Optional[asyncio.Task[None]] = None

        logger.info("[VoiceAgentServer] new /text-test connection")
        try:
            first_msg = await ws.recv() if _ws_is_open(ws) else None
            if not first_msg:
                return

            try:
                start_data = json.loads(first_msg)
            except (json.JSONDecodeError, TypeError) as err:
                logger.error("[VoiceAgentServer] parse start frame failed: %s", err)
                return

            if start_data.get("type") != "start":
                logger.warning("[VoiceAgentServer] expected start frame, got: %s", start_data.get("type"))
                return

            flow_id = str(start_data.get("flowId", ""))
            if not flow_id:
                await self._send_json(ws, {"type": "error", "message": "flowId is required"})
                return

            # 从 DB 拉取流程（前端已在发送前自动保存）
            flow = await self._tasks.get_task_flow(flow_id)
            if not flow:
                await self._send_json(ws, {"type": "error", "message": f"flow not found: {flow_id}"})
                return

            # 构造调试 session
            call_id = f"test-{uuid4().hex[:12]}"
            await self._send_json(ws, {"type": "connected", "sessionId": call_id})

            scenario_config = get_scenario("ecommerce")
            variables: dict[str, str] = dict(DEFAULT_VARIABLES)
            variables.update(start_data.get("variables") or {})

            callbacks = TextTestCallbacks(ws, call_id)

            # 异步启动 agent 会话（dry_run=True）
            session_task = asyncio.create_task(
                self._agent.start_session(
                    call_id,
                    scenario_config,
                    variables,
                    callbacks,
                    flow_version=flow,
                    dry_run=True,
                )
            )

            # 循环接收前端消息
            async for msg in ws:
                try:
                    data = json.loads(msg)
                except (json.JSONDecodeError, TypeError):
                    continue

                msg_type = data.get("type")
                if msg_type == "user_input":
                    text = str(data.get("text", ""))
                    if text and call_id:
                        await self._agent.inject_user_text(call_id, text)
                elif msg_type == "hangup":
                    if call_id:
                        await self._agent.end_session(call_id)
                    break

        except Exception as err:
            logger.exception("[VoiceAgentServer] /text-test error: %s", err)
        finally:
            if session_task and not session_task.done():
                session_task.cancel()
                try:
                    await session_task
                except (asyncio.CancelledError, Exception):
                    pass
            if call_id:
                await self._agent.end_session(call_id)
                logger.info("[VoiceAgentServer] text-test callId=%s disconnected", call_id)

    async def _send_json(self, ws: Any, obj: dict[str, Any]) -> None:
        try:
            if _ws_is_open(ws):
                await ws.send(json.dumps(obj, ensure_ascii=False))
        except Exception as err:
            logger.warning("[VoiceAgentServer] send_json failed: %s", err)

    async def _handle_audio_stream(self, ws: Any) -> None:
        """处理 FreeSWITCH /audio-stream 连接。"""
        call_id: Optional[str] = None
        metadata: Optional[dict[str, Any]] = None
        session_task: Optional[asyncio.Task[None]] = None
        inbound_chunks = 0
        inbound_bytes = 0

        logger.info("[VoiceAgentServer] new /audio-stream connection")
        try:
            async for msg in ws:
                if metadata is None:
                    # 第一帧 JSON metadata
                    try:
                        raw_metadata = (
                            msg.decode("utf-8") if isinstance(msg, bytes) else msg
                        )
                        if raw_metadata.startswith("base64:"):
                            raw_metadata = base64.b64decode(
                                raw_metadata.removeprefix("base64:")
                            ).decode("utf-8")
                        metadata = json.loads(raw_metadata)
                    except (
                        ValueError,
                        UnicodeDecodeError,
                        json.JSONDecodeError,
                        TypeError,
                    ) as err:
                        logger.error(
                            "[VoiceAgentServer] parse metadata failed: %s", err
                        )
                        return

                    call_id = metadata.get("dialog_id", f"call-{time.time()}")
                    expected_token = os.getenv("VOICE_AGENT_WS_TOKEN", "")
                    provided_token = str(metadata.get("token", ""))
                    if expected_token and not secrets.compare_digest(
                        provided_token, expected_token
                    ):
                        logger.warning("[VoiceAgentServer] rejected unauthorized call stream")
                        await ws.close(code=1008, reason="Unauthorized")
                        return
                    logger.info(
                        "[VoiceAgentServer] callId=%s caller=%s",
                        call_id,
                        metadata.get("caller_id", "unknown"),
                    )

                    # 异步启动 agent 会话（不阻塞音频接收循环）
                    session_task = asyncio.create_task(
                        self._start_agent_session(ws, call_id, metadata)
                    )
                else:
                    # 后续二进制 PCM 帧
                    if isinstance(msg, bytes) and call_id:
                        inbound_chunks += 1
                        inbound_bytes += len(msg)
                        if inbound_chunks == 1:
                            logger.info(
                                "[MediaIn] callId=%s first PCM chunk bytes=%d",
                                call_id,
                                len(msg),
                            )
                        await self._agent.receive_audio(call_id, msg)
        except Exception as err:
            logger.exception("[VoiceAgentServer] connection error: %s", err)
        finally:
            # session_finalized=True 表示 _start_agent_session 正常跑完
            # （agent.start_session 内部已 set_outcome，任务已到终态）。
            session_finalized = False
            if session_task:
                if session_task.done():
                    session_finalized = (
                        not session_task.cancelled()
                        and session_task.exception() is None
                        and bool(session_task.result())
                    )
                else:
                    session_task.cancel()
                    try:
                        await session_task
                    except (asyncio.CancelledError, Exception):
                        pass
            if call_id:
                logger.info(
                    "[MediaIn] callId=%s complete chunks=%d bytes=%d",
                    call_id,
                    inbound_chunks,
                    inbound_bytes,
                )
                await self._agent.end_session(call_id)
                if (
                    metadata is not None
                    and metadata.get("channel") == "web"
                    and not session_finalized
                ):
                    # web 通道终态兜底：浏览器中途断线（挂断/关页面）时会话被
                    # cancel，agent.start_session 尾部的 set_outcome 不会执行，
                    # 任务会卡在 IN_CALL。调用既有 hangup 端点推到终态；
                    # 任务已是终态时 API 报错由 quiet 模式吞掉（debug 日志）。
                    logger.info(
                        "[VoiceAgentServer] callId=%s web channel closed before "
                        "session end, hangup fallback",
                        call_id,
                    )
                    await self._tasks.hangup(call_id, quiet=True)
                logger.info("[VoiceAgentServer] callId=%s disconnected", call_id)

    async def _start_agent_session(
        self, ws: Any, call_id: str, metadata: dict[str, Any]
    ) -> bool:
        """启动 Agent 会话。

        1) GET /api/tasks/{call_id} 拉真实 scenario + variables（失败 fallback 到 metadata）
        2) 构造 WebSocketCallbacks（ws.send 音频 + 上报 transcript）
        3) await agent.start_session(...)（阻塞式，内部跑完整个对话循环）

        返回 True 表示会话正常收尾（agent 内部已 set_outcome）；返回 False
        表示会话异常终止，任务可能未到终态（web 通道据此触发 hangup 兜底）。
        """
        # 1) 拉任务上下文
        scenario_str = metadata.get("scenario", "ecommerce")
        variables: dict[str, str] = {}
        flow_version: Optional[dict[str, Any]] = None
        scenario_contract: Optional[dict[str, Any]] = None
        tenant_id = str(metadata.get("tenantId", "") or "") or None
        user_id = str(metadata.get("userId", "") or "") or None

        task = await self._tasks.get_task(call_id)
        if task:
            scenario_str = task.get("scenario", scenario_str)
            variables = dict(task.get("variables", {}))
            flow_version = task.get("flowVersion")
            scenario_contract = task.get("scenarioConfig") or (
                flow_version or {}
            ).get("scenarioConfig")
            tenant_id = task.get("tenantId") or tenant_id
            user_id = task.get("ownerId") or user_id
            logger.info(
                "[VoiceAgentServer] callId=%s loaded task context: scenario=%s",
                call_id,
                scenario_str,
            )
            await self._tasks.update_status(call_id, "in_call")
        else:
            logger.info(
                "[VoiceAgentServer] callId=%s no task context, fallback to metadata",
                call_id,
            )

        scenario_config = (
            scenario_from_contract(scenario_contract)
            if scenario_contract
            else get_scenario(scenario_str)
        )

        # 提取场景模板中用到的所有变量
        template_vars = set(extract_template_vars(scenario_config.greeting)) | set(
            extract_template_vars(scenario_config.system_prompt)
        )
        for var in template_vars:
            if var not in variables:
                variables[var] = metadata.get(var, DEFAULT_VARIABLES.get(var, ""))

        # 3) 构造 callbacks 并启动会话
        channel = str(metadata.get("channel", "freeswitch") or "freeswitch")
        callbacks = WebSocketCallbacks(
            ws,
            call_id,
            self._tasks,
            audio_response_format=str(
                metadata.get("audio_response_format", "raw-pcm")
            ),
            channel=channel,
        )
        try:
            await self._agent.start_session(
                call_id,
                scenario_config,
                variables,
                callbacks,
                flow_version=flow_version,
                tenant_id=tenant_id,
                user_id=user_id,
                channel=channel,
            )
        except asyncio.CancelledError:
            # 正常路径是连接关闭后媒体 finally 取消会话任务；但取消也可能来自
            # 其他调用链，这里只陈述事实，不猜原因（曾误导过僵尸会话排障）
            logger.info(
                "[VoiceAgentServer] callId=%s session task cancelled",
                call_id,
            )
            raise
        except Exception as err:
            logger.exception(
                "[VoiceAgentServer] callId=%s session failed: %s", call_id, err
            )
            if channel == "web":
                await self._send_json(ws, {"type": "error", "message": str(err)})
            return False
        finally:
            # 会话拆除兜底：无论正常结束/取消/异常，都终结可能残留的节拍泵，
            # 防止挂断/异常路径泵泄漏（正常路径此时 stream 已为 None，no-op）。
            await callbacks.cancel_playback()
        return True


# 音频恒为 16kHz/16bit/mono → 32 字节 = 1ms，32000 字节 = 1s。
# 节拍泵用它把"按字节计的已投递量"换算成"按实时计的应发时刻"。
_AUDIO_BYTES_PER_SEC = 32000


def _env_int(name: str, default: int) -> int:
    """安全解析整型环境变量：空/非数字时回退默认值，不让构造炸。"""
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


@dataclass
class _PacedStream:
    """一次 utterance 的节拍投递状态（每次 TTS 合成一个，打断/结束即弃）。

    queue 里放 TTS 原始块，None 为终止哨兵；pump 是单消费者协程任务；
    t0 在"第一次实际发送前"取样，作为字节钟原点；sent_bytes 记已投递字节数
    （既是节流基准，也是 utterance 结束时等待电话真实播完的依据）。
    """

    queue: "asyncio.Queue[Optional[bytes]]"
    pump: "Optional[asyncio.Task[None]]" = None
    t0: Optional[float] = None
    sent_bytes: int = 0


class WebSocketCallbacks:
    """WebSocket 传输层 callbacks 实现。

    - on_audio_output: ws.send(bytes) 推回 FreeSWITCH 播放
    - on_agent_speech / on_caller_speech: fire-and-forget 上报 transcript；
      channel=="web" 时额外向同一 WS 发文本帧字幕（浏览器按 text/binary 区分）
    - on_escalate: fire-and-forget POST /api/tasks/{id}/transfer
    """

    def __init__(
        self,
        ws: Any,
        call_id: str,
        tasks: TaskClient,
        audio_response_format: str = "raw-pcm",
        channel: str = "freeswitch",
    ) -> None:
        self._ws = ws
        self._call_id = call_id
        self._tasks = tasks
        # web 通道 = 浏览器直连：文本帧当字幕/事件用；FreeSWITCH 通道禁止发文本帧
        self._web_channel = channel == "web"
        if audio_response_format not in {"raw-pcm", "base64-json", "esl-file"}:
            raise ValueError(
                f"Unsupported audio response format: {audio_response_format}"
            )
        self._audio_response_format = audio_response_format
        self._output_chunks = 0
        self._output_bytes = 0
        self._playback_sequence = 0
        self._playback_esl: Optional[_ESLClient] = None
        self._playback_started_at = time.monotonic()
        self._playback_buffer = bytearray()
        playback_chunk_ms = int(os.getenv("FREESWITCH_PLAYBACK_CHUNK_MS", "960"))
        self._playback_chunk_bytes = max(3200, playback_chunk_ms * 32)
        # 节拍投递（paced delivery）：让投递按实时节拍走，Python 侧始终握着
        # 未投递音频，长播报期打断只需杀在途 → _speaking 语义回归"电话还在放"。
        # 回退开关关闭时完全走旧的逐块立即投递路径（逐行为等价）。
        self._paced_enabled = (
            os.getenv("TTS_PACED_DELIVERY_ENABLED", "true").lower() != "false"
        )
        self._paced_lead_ms = _env_int("TTS_PACED_LEAD_MS", 1200)
        self._paced_tail_margin_ms = _env_int("TTS_PACED_TAIL_MARGIN_MS", 200)
        self._stream: Optional[_PacedStream] = None

    async def on_agent_speech(self, text: str) -> None:
        logger.info("[Agent] 🤖 %s", text)
        if self._web_channel:
            # web 通道：浏览器需要实时字幕，文本帧与二进制音频帧互不干扰
            await self._send_json({"type": "agent_speech", "text": text})
        # FreeSWITCH 通道不通过 WS 发送 JSON 字幕：STREAM_PLAYBACK=true 时
        # JSON 会被当作音频播放产生噪声，仅通过 NestJS API 上报 transcript
        await self._tasks.append_transcript(self._call_id, "agent", text)

    async def on_caller_speech(self, text: str) -> None:
        logger.info("[Caller] 👤 %s", text)
        if self._web_channel:
            # web 通道：浏览器需要实时字幕，文本帧与二进制音频帧互不干扰
            await self._send_json({"type": "caller_speech", "text": text})
        # FreeSWITCH 通道不通过 WS 发送 JSON 字幕：STREAM_PLAYBACK=true 时
        # JSON 会被当作音频播放产生噪声，仅通过 NestJS API 上报 transcript
        await self._tasks.append_transcript(self._call_id, "caller", text)

    async def on_tool_call(self, call: ToolCall, result: ToolResult) -> None:
        logger.info("[Tool] 🔧 %s → %s", call.name, result.result)

    async def on_escalate(self, reason: str, extension: Optional[str] = None) -> None:
        logger.info("[Escalate] ⚠️ %s", reason)
        # fire-and-forget 触发转人工
        await self._tasks.transfer_to_human(self._call_id, extension)

    async def on_audio_output(self, audio: bytes) -> None:
        """把 TTS 合成的 PCM 音频推回给 FreeSWITCH 播放。"""
        self._output_chunks += 1
        self._output_bytes += len(audio)
        if not self._paced_enabled:
            # ===== 旧路径：逐块立即投递（回退开关关闭时逐行为等价） =====
            if self._audio_response_format == "esl-file":
                self._playback_buffer.extend(audio)
                while len(self._playback_buffer) >= self._playback_chunk_bytes:
                    chunk = bytes(self._playback_buffer[: self._playback_chunk_bytes])
                    del self._playback_buffer[: self._playback_chunk_bytes]
                    await self._play_audio_chunk(chunk)
                return
            if self._output_chunks == 1 or self._output_chunks % 50 == 0:
                logger.info(
                    "[MediaOut] callId=%s chunks=%d bytes=%d format=%s",
                    self._call_id,
                    self._output_chunks,
                    self._output_bytes,
                    self._audio_response_format,
                )
            if self._audio_response_format == "base64-json":
                await self._send_json(
                    {
                        "type": "streamAudio",
                        "data": {
                            "audioDataType": "raw",
                            "sampleRate": 16000,
                            "audioData": base64.b64encode(audio).decode("ascii"),
                        },
                    }
                )
                return
            await self._send_bytes(audio)
            return

        # ===== 节拍泵路径：只入队，实时节流交给单消费者泵 =====
        # 入口守卫：清理罕见的孤儿泵（上一次 utterance 因非打断异常退出但未清理）。
        if self._stream is not None and (
            self._stream.pump is None or self._stream.pump.done()
        ):
            self._stream = None
        if self._stream is None:
            self._open_stream()
        assert self._stream is not None
        self._stream.queue.put_nowait(audio)
        # 让出一个事件循环 tick，使泵能立即投递 LEAD 窗口内已就绪的块（首包
        # 延迟不劣化）；节流本身由泵按字节钟执行，这里不阻塞 QwenTTS ws 读取。
        await asyncio.sleep(0)

    def _open_stream(self) -> None:
        """为一次 utterance 创建队列并启动节拍泵。"""
        queue: "asyncio.Queue[Optional[bytes]]" = asyncio.Queue()
        stream = _PacedStream(queue=queue)
        stream.pump = asyncio.create_task(self._run_pump(stream))
        self._stream = stream

    async def _run_pump(self, stream: "_PacedStream") -> None:
        """节拍泵：单消费者，按字节钟把音频节流投递给下游。

        为什么要泵：_speaking 的旧语义是"投递指令发完"，而投递远快于实时，
        长播报时电话还在放、Python 已清 _speaking → STT/RMS 打断全失效。让投递
        本身按实时节拍走，utterance 结束时等到电话真实播完才返回，_speaking 的
        清除时刻 ≈ 真实播完时刻，打断全程有效，agent.py 零改动。
        """
        esl_file = self._audio_response_format == "esl-file"
        # esl-file 聚合缓冲：泵私有，打断随泵一起丢弃，故无需清 self._playback_buffer。
        buffer = bytearray()
        while True:
            item = await stream.queue.get()
            if item is None:
                # 终止哨兵：flush esl-file 残余，再等到电话真实播完 + 尾裕量
                if esl_file and buffer:
                    await self._paced_send(stream, bytes(buffer))
                    buffer.clear()
                if stream.t0 is not None:
                    target = (
                        stream.t0
                        + stream.sent_bytes / _AUDIO_BYTES_PER_SEC
                        + self._paced_tail_margin_ms / 1000
                    )
                    delay = target - time.monotonic()
                    if delay > 0:
                        await asyncio.sleep(delay)
                if esl_file:
                    # 保留旧的"stream complete"日志语义（泵退出前打）
                    logger.info(
                        "[Playback] callId=%s stream complete source_chunks=%d files=%d bytes=%d",
                        self._call_id,
                        self._output_chunks,
                        self._playback_sequence,
                        self._output_bytes,
                    )
                return
            if esl_file:
                buffer.extend(item)
                while len(buffer) >= self._playback_chunk_bytes:
                    chunk = bytes(buffer[: self._playback_chunk_bytes])
                    del buffer[: self._playback_chunk_bytes]
                    await self._paced_send(stream, chunk)
            else:
                await self._paced_send(stream, item)

    async def _paced_send(self, stream: "_PacedStream", chunk: bytes) -> None:
        """按字节钟节流后，用现有发送路径投递一个块。"""
        if stream.t0 is not None:
            # 第 k 块应在 t0 + 已投递时长 - LEAD 时刻发出；
            # LEAD 窗口内 delay<=0 立即放行，此后按实时节拍节流。
            target = (
                stream.t0
                + stream.sent_bytes / _AUDIO_BYTES_PER_SEC
                - self._paced_lead_ms / 1000
            )
            delay = target - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
        if self._audio_response_format == "esl-file":
            await self._play_audio_chunk(chunk)
        elif self._audio_response_format == "base64-json":
            await self._send_json(
                {
                    "type": "streamAudio",
                    "data": {
                        "audioDataType": "raw",
                        "sampleRate": 16000,
                        "audioData": base64.b64encode(chunk).decode("ascii"),
                    },
                }
            )
        else:
            await self._send_bytes(chunk)
        stream.sent_bytes += len(chunk)
        if stream.t0 is None:
            # 首块投递完成后再起字节钟原点：把写 WAV + ESL 往返耗时计入，
            # 否则原点偏早、极端下尾部 hold 会提前结束。首包延迟不变（首块已放行）。
            stream.t0 = time.monotonic()

    def _cancel_stream(self) -> None:
        """终结当前节拍泵并丢弃未投递音频（打断/会话拆除共用，同步、不发 uuid_break）。"""
        stream = self._stream
        self._stream = None
        if stream is None:
            return
        if stream.pump is not None and not stream.pump.done():
            stream.pump.cancel()
        while not stream.queue.empty():
            try:
                stream.queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    async def cancel_playback(self) -> None:
        """会话拆除兜底：终结节拍泵，防挂断/异常路径泵泄漏（不发 uuid_break）。"""
        stream = self._stream
        self._cancel_stream()
        if stream is not None and stream.pump is not None:
            try:
                await stream.pump
            except (asyncio.CancelledError, Exception):
                pass

    async def on_audio_output_complete(self) -> None:
        """结束当前流式文件播放批次。"""
        if not self._paced_enabled:
            # ===== 旧路径 =====
            if self._audio_response_format == "esl-file":
                if self._playback_buffer:
                    chunk = bytes(self._playback_buffer)
                    self._playback_buffer.clear()
                    await self._play_audio_chunk(chunk)
                logger.info(
                    "[Playback] callId=%s stream complete source_chunks=%d files=%d bytes=%d",
                    self._call_id,
                    self._output_chunks,
                    self._playback_sequence,
                    self._output_bytes,
                )
            return

        # ===== 节拍泵路径：等泵把最后一块播完（含尾裕量）才返回 =====
        # 这样 _speak() finally 清 _speaking 的时刻 ≈ 电话真实播完时刻。
        stream = self._stream
        if stream is None:
            return
        stream.queue.put_nowait(None)
        try:
            await stream.pump
        except asyncio.CancelledError:
            # 双保险：speak task 被取消时同时终结泵，再向上抛（取消链契约）
            if stream.pump is not None:
                stream.pump.cancel()
            raise
        finally:
            self._stream = None

    async def _play_audio_chunk(self, audio: bytes) -> None:
        """将一个聚合 PCM 分片写为 WAV 并排队到 FreeSWITCH。"""
        self._playback_sequence += 1
        host_dir = Path(
            os.getenv(
                "FREESWITCH_SHARED_RECORDINGS_HOST",
                str(Path(__file__).resolve().parents[4] / "freeswitch" / "recordings"),
            )
        )
        host_dir.mkdir(parents=True, exist_ok=True)
        filename = f"tts-{self._call_id}-{self._playback_sequence}.wav"
        host_path = host_dir / filename
        container_dir = os.getenv(
            "FREESWITCH_SHARED_RECORDINGS_CONTAINER",
            "/var/lib/freeswitch/recordings",
        ).rstrip("/")
        container_path = f"{container_dir}/{filename}"

        def write_wav() -> None:
            with wave.open(str(host_path), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16000)
                wav.writeframes(audio)

        await asyncio.to_thread(write_wav)
        if self._playback_esl is None:
            self._playback_esl = await _get_shared_esl_client()
        response = await self._playback_esl.api(
            f"uuid_broadcast {self._call_id} {container_path} aleg"
        )
        if self._playback_sequence == 1:
            logger.info(
                "[Playback] callId=%s first chunk bytes=%d latency_ms=%d ESL=%s",
                self._call_id,
                len(audio),
                int((time.monotonic() - self._playback_started_at) * 1000),
                response,
            )

    async def on_interrupted(self) -> None:
        """barge-in 打断后清空下游播放队列（agent._interrupt_speaking 触发）。

        - web 通道：向浏览器发 {"type":"clear_audio"} 文本帧，前端清空播放队列
        - FreeSWITCH esl-file 播放：经既有 ESL 控制连接发 uuid_break 停掉
          uuid_broadcast 队列；失败仅 warn 不抛
        - FreeSWITCH raw-pcm 直推：无服务端可清的队列，no-op
        """
        if self._paced_enabled:
            # 打断优先杀在途：未投递音频根本不出 Python（直接弃队列 + 停泵）。
            # 与 on_audio_output_complete 的 CancelledError 分支共同构成取消链双保险：
            # synthesize 中途被打断时 complete 不会被调用 → 泵由这里终结。
            self._cancel_stream()
        if self._web_channel:
            await self._send_json({"type": "clear_audio"})
            logger.info(
                "[Interrupt] callId=%s interrupt_executed clear_audio sent",
                self._call_id,
            )
            return
        if self._audio_response_format == "esl-file":
            # 丢弃尚未落盘排队的 TTS 残余，避免打断后又续播旧内容
            self._playback_buffer.clear()
            try:
                if self._playback_esl is None:
                    self._playback_esl = await _get_shared_esl_client()
                await self._playback_esl.api(f"uuid_break {self._call_id} all")
                logger.info(
                    "[Interrupt] callId=%s interrupt_executed uuid_break ok",
                    self._call_id,
                )
            except Exception as err:
                logger.warning(
                    "[Interrupt] callId=%s interrupt_executed uuid_break failed: %s",
                    self._call_id,
                    err,
                )

    async def on_node_enter(self, node_id: str, node_name: str) -> None:
        pass

    async def on_action(self, action_type: str, config: dict) -> None:
        pass

    async def on_end(self, reason: str) -> None:
        logger.info(
            "[End] 📞 %s media_out_chunks=%d media_out_bytes=%d",
            reason,
            self._output_chunks,
            self._output_bytes,
        )
        if self._web_channel:
            # web 通道：通知浏览器会话结束（FreeSWITCH 通道不发文本帧）
            await self._send_json({"type": "end", "reason": reason})

    async def _send_json(self, obj: dict[str, Any]) -> None:
        try:
            if _ws_is_open(self._ws):
                await self._ws.send(json.dumps(obj, ensure_ascii=False))
        except Exception as err:
            logger.warning("[WebSocketCallbacks] send_json failed: %s", err)

    async def _send_bytes(self, data: bytes) -> None:
        try:
            if _ws_is_open(self._ws):
                await self._ws.send(data)
        except Exception as err:
            logger.warning("[WebSocketCallbacks] send_bytes failed: %s", err)


async def _read_esl_frame(reader: asyncio.StreamReader) -> tuple[dict[str, str], bytes]:
    raw_headers = await reader.readuntil(b"\n\n")
    headers: dict[str, str] = {}
    for raw_line in raw_headers.decode("utf-8", errors="replace").splitlines():
        if ":" in raw_line:
            key, value = raw_line.split(":", 1)
            headers[key.strip().lower()] = value.strip()
    length = int(headers.get("content-length", "0"))
    body = await reader.readexactly(length) if length else b""
    return headers, body


class _ESLClient:
    def __init__(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        self._reader = reader
        self._writer = writer
        self._command_lock = asyncio.Lock()

    @classmethod
    async def connect(cls) -> "_ESLClient":
        host = os.getenv("FREESWITCH_ESL_HOST", "127.0.0.1")
        port = int(os.getenv("FREESWITCH_ESL_PORT", "18021"))
        password = os.getenv("FREESWITCH_ESL_PASSWORD", "ClueCon")
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=5
        )
        headers, _ = await asyncio.wait_for(_read_esl_frame(reader), timeout=5)
        if headers.get("content-type") != "auth/request":
            raise RuntimeError(f"unexpected ESL greeting: {headers}")
        writer.write(f"auth {password}\n\n".encode())
        await writer.drain()
        auth_headers, _ = await asyncio.wait_for(_read_esl_frame(reader), timeout=5)
        if not auth_headers.get("reply-text", "").startswith("+OK"):
            raise RuntimeError("ESL authentication failed")
        return cls(reader, writer)

    async def api(self, command: str) -> str:
        # 共享 ESL 连接：把"锁+写+读"整体放进被 shield 保护的内部协程。
        # 取消（如节拍泵在读处被 cancel）只中断等待者，_exchange 交换后台跑完 →
        # 响应帧不会滞留 socket，连接始终对齐，下一条命令不会错读上一条的响应。
        task = asyncio.ensure_future(self._exchange(command))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            # 等待者被取消：让交换后台跑完保持连接对齐；吞掉其结果/异常
            # 防 "Future exception was never retrieved" 噪声。
            task.add_done_callback(lambda t: t.cancelled() or t.exception())
            raise

    async def _exchange(self, command: str) -> str:
        async with self._command_lock:
            self._writer.write(f"api {command}\n\n".encode())
            await self._writer.drain()
            _, body = await asyncio.wait_for(_read_esl_frame(self._reader), timeout=5)
            response = body.decode("utf-8", errors="replace").strip()
            if response.startswith("-ERR"):
                raise RuntimeError(response)
            return response

    @property
    def is_open(self) -> bool:
        return not self._writer.is_closing()

    async def close(self) -> None:
        self._writer.close()
        await self._writer.wait_closed()


async def _send_esl_api(command: str) -> str:
    client = await _get_shared_esl_client()
    return await client.api(command)


_shared_esl_client: Optional[_ESLClient] = None
_shared_esl_connect_lock: Optional[asyncio.Lock] = None


async def _get_shared_esl_client() -> _ESLClient:
    global _shared_esl_client, _shared_esl_connect_lock
    if _shared_esl_client is not None and _shared_esl_client.is_open:
        return _shared_esl_client
    if _shared_esl_connect_lock is None:
        _shared_esl_connect_lock = asyncio.Lock()
    async with _shared_esl_connect_lock:
        if _shared_esl_client is None or not _shared_esl_client.is_open:
            _shared_esl_client = await _ESLClient.connect()
        return _shared_esl_client
