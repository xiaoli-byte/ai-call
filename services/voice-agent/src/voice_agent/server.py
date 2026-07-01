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
import json
import logging
import os
import secrets
import time
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
from .types import ToolCall, ToolResult

logger = logging.getLogger(__name__)

# 所有合法的 WebSocket 路径
_VALID_PATHS = {"/audio-stream", "/asr-stream", "/tts-stream"}


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
        async with websockets.serve(
            self._handle,
            self._host,
            self._port,
            process_request=self._check_path,
        ):
            logger.info(
                "[VoiceAgentServer] listening on ws://%s:%s (paths: %s)",
                self._host,
                self._port,
                ", ".join(sorted(_VALID_PATHS)),
            )
            logger.info(
                "[VoiceAgentServer] waiting for FreeSWITCH mod_audio_fork connections..."
            )
            await asyncio.Future()  # run forever

    def _check_path(
        self, connection: Any, request: Any
    ) -> Optional[Response]:
        """websockets 库的 process_request 钩子：路径不符返回 404。

        websockets >= 11 的 process_request 签名为 (connection, request)，
        路径从 request.path 获取。
        """
        path = getattr(request, "path", "") or ""
        pathname = urlparse(path).path if path else path
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

        # 默认：/audio-stream 走 FreeSWITCH Agent 链路
        await self._handle_audio_stream(ws)

    async def _handle_audio_stream(self, ws: Any) -> None:
        """处理 FreeSWITCH /audio-stream 连接。"""
        call_id: Optional[str] = None
        metadata: Optional[dict[str, Any]] = None
        session_task: Optional[asyncio.Task[None]] = None

        logger.info("[VoiceAgentServer] new /audio-stream connection")
        try:
            async for msg in ws:
                if metadata is None:
                    # 第一帧 JSON metadata
                    try:
                        metadata = json.loads(msg)
                    except (json.JSONDecodeError, TypeError) as err:
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
                        await self._agent.receive_audio(call_id, msg)
        except Exception as err:
            logger.exception("[VoiceAgentServer] connection error: %s", err)
        finally:
            if session_task and not session_task.done():
                session_task.cancel()
                try:
                    await session_task
                except (asyncio.CancelledError, Exception):
                    pass
            if call_id:
                await self._agent.end_session(call_id)
                logger.info("[VoiceAgentServer] callId=%s disconnected", call_id)

    async def _start_agent_session(
        self, ws: Any, call_id: str, metadata: dict[str, Any]
    ) -> None:
        """启动 Agent 会话。

        1) GET /api/tasks/{call_id} 拉真实 scenario + variables（失败 fallback 到 metadata）
        2) 构造 WebSocketCallbacks（ws.send 音频 + 上报 transcript）
        3) await agent.start_session(...)（阻塞式，内部跑完整个对话循环）
        """
        # 1) 拉任务上下文
        scenario_str = metadata.get("scenario", "ecommerce")
        variables: dict[str, str] = {}
        flow_version: Optional[dict[str, Any]] = None
        scenario_contract: Optional[dict[str, Any]] = None

        task = await self._tasks.get_task(call_id)
        if task:
            scenario_str = task.get("scenario", scenario_str)
            variables = dict(task.get("variables", {}))
            flow_version = task.get("flowVersion")
            scenario_contract = task.get("scenarioConfig")
            logger.info(
                "[VoiceAgentServer] callId=%s loaded task context: scenario=%s",
                call_id,
                scenario_str,
            )
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

        # 2) 合并 variables：task < metadata < DEFAULT_VARIABLES
        # 提取场景模板中用到的所有变量
        template_vars = set(extract_template_vars(scenario_config.greeting)) | set(
            extract_template_vars(scenario_config.system_prompt)
        )
        for var in template_vars:
            if var not in variables:
                variables[var] = metadata.get(var, DEFAULT_VARIABLES.get(var, ""))

        # 3) 构造 callbacks 并启动会话
        callbacks = WebSocketCallbacks(ws, call_id, self._tasks)
        try:
            await self._agent.start_session(
                call_id,
                scenario_config,
                variables,
                callbacks,
                flow_version=flow_version,
            )
        except asyncio.CancelledError:
            logger.info(
                "[VoiceAgentServer] callId=%s session cancelled (connection closed)",
                call_id,
            )
            raise
        except Exception as err:
            logger.exception(
                "[VoiceAgentServer] callId=%s session failed: %s", call_id, err
            )


class WebSocketCallbacks:
    """WebSocket 传输层 callbacks 实现。

    - on_audio_output: ws.send(bytes) 推回 FreeSWITCH 播放
    - on_agent_speech / on_caller_speech: ws.send(json 字幕) + fire-and-forget 上报 transcript
    - on_escalate: fire-and-forget POST /api/tasks/{id}/transfer
    """

    def __init__(self, ws: Any, call_id: str, tasks: TaskClient) -> None:
        self._ws = ws
        self._call_id = call_id
        self._tasks = tasks

    async def on_agent_speech(self, text: str) -> None:
        logger.info("[Agent] 🤖 %s", text)
        await self._send_json({"type": "agent_speech", "text": text})
        # fire-and-forget 上报 transcript
        await self._tasks.append_transcript(self._call_id, "agent", text)

    async def on_caller_speech(self, text: str) -> None:
        logger.info("[Caller] 👤 %s", text)
        await self._send_json({"type": "caller_speech", "text": text})
        await self._tasks.append_transcript(self._call_id, "caller", text)

    async def on_tool_call(self, call: ToolCall, result: ToolResult) -> None:
        logger.info("[Tool] 🔧 %s → %s", call.name, result.result)

    async def on_escalate(self, reason: str) -> None:
        logger.info("[Escalate] ⚠️ %s", reason)
        # fire-and-forget 触发转人工
        await self._tasks.transfer_to_human(self._call_id)

    async def on_audio_output(self, audio: bytes) -> None:
        """把 TTS 合成的 PCM 音频推回给 FreeSWITCH 播放。"""
        await self._send_bytes(audio)

    async def on_end(self, reason: str) -> None:
        logger.info("[End] 📞 %s", reason)

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
