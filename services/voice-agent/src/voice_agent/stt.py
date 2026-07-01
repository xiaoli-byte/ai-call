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
from typing import Awaitable, Callable, Literal, Optional

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
        try:
            await self._ws.send(json.dumps({"is_speaking": False}))
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
