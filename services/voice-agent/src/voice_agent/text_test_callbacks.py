from __future__ import annotations

import json
import logging
from typing import Any

from .types import ToolCall, ToolResult

logger = logging.getLogger(__name__)


class TextTestCallbacks:
    """文本调试通道 callbacks — 将 Agent 事件通过 WebSocket 推送给前端。

    用于 /text-test 路径，配合 VoiceAgent.dry_run=True 模式：
    - on_agent_speech → {type: 'agent_speech', text}
    - on_node_enter → {type: 'node_enter', nodeId, nodeName}
    - on_action → {type: 'action', actionType, config, note}
    - on_escalate → 转换为 action 事件（actionType: 'transfer'）
    - on_end → {type: 'end', reason}
    - on_audio_output → 空实现（文字调试不播放音频）
    """

    def __init__(self, ws: Any, call_id: str) -> None:
        self._ws = ws
        self._call_id = call_id
        self._current_node_id = ""
        self._current_node_name = ""

    async def on_agent_speech(self, text: str) -> None:
        logger.info("[TextTest] 🤖 %s", text)
        await self._send(self._with_node({"type": "agent_speech", "text": text}))

    async def on_caller_speech(self, text: str) -> None:
        logger.info("[TextTest] 👤 %s", text)
        await self._send({"type": "caller_speech", "text": text})

    async def on_tool_call(self, call: ToolCall, result: ToolResult) -> None:
        logger.info("[TextTest] 🔧 %s → %s", call.name, result.result)
        await self._send({
            "type": "tool_call",
            "name": call.name,
            "arguments": call.arguments,
            "result": str(result.result),
        } | self._node_payload())

    async def on_escalate(self, reason: str, extension: str | None = None) -> None:
        logger.info("[TextTest] ⚠️ 转人工: %s", reason)
        config: dict[str, Any] = {"reason": reason}
        if extension:
            config["extension"] = extension
        await self._send({
            "type": "action",
            "actionType": "transfer",
            "config": config,
            "note": "调试模式未真实执行",
        } | self._node_payload())

    async def on_audio_output(self, audio: bytes) -> None:
        pass

    async def on_audio_output_complete(self) -> None:
        pass

    async def on_node_enter(self, node_id: str, node_name: str) -> None:
        logger.info("[TextTest] → 节点: %s (%s)", node_name, node_id)
        self._current_node_id = node_id
        self._current_node_name = node_name
        await self._send({"type": "node_enter", "nodeId": node_id, "nodeName": node_name})

    async def on_action(self, action_type: str, config: dict) -> None:
        logger.info("[TextTest] ⚡ 动作: %s %s", action_type, config)
        await self._send({
            "type": "action",
            "actionType": action_type,
            "config": config,
            "note": "调试模式未真实执行",
        } | self._node_payload())

    async def on_end(self, reason: str) -> None:
        logger.info("[TextTest] 📞 结束: %s", reason)
        await self._send({"type": "end", "reason": reason})

    async def _send(self, obj: dict[str, Any]) -> None:
        try:
            if self._is_open():
                await self._ws.send(json.dumps(obj, ensure_ascii=False))
        except Exception as err:
            logger.warning("[TextTestCallbacks] send failed: %s", err)

    def _with_node(self, obj: dict[str, Any]) -> dict[str, Any]:
        return obj | self._node_payload()

    def _node_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if self._current_node_id:
            payload["nodeId"] = self._current_node_id
        if self._current_node_name:
            payload["nodeName"] = self._current_node_name
        return payload

    def _is_open(self) -> bool:
        ws = self._ws
        if hasattr(ws, "open"):
            return bool(ws.open)
        from websockets.protocol import State
        return getattr(ws, "state", None) == State.OPEN
