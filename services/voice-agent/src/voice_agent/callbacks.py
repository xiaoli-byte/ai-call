"""Agent 回调接口 - 由传输层（WebSocket/CLI）注入。

设计原则：与 TS 版 agent.ts 的 AgentCallbacks 接口同构，
通过 Protocol 解耦传输层与对话主循环。
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from .types import ToolCall, ToolResult


@runtime_checkable
class AgentCallbacks(Protocol):
    """Agent 回调接口。

    所有方法均为 async，由传输层实现：
    - WebSocket 模式：ws.send(audio) + 上报 NestJS transcript
    - CLI 模式：console.log + 上报 NestJS transcript
    """

    async def on_agent_speech(self, text: str) -> None:
        """Agent 说话时回调（文本，用于转写/字幕）。"""
        ...

    async def on_caller_speech(self, text: str) -> None:
        """用户说话时回调（用于转写）。"""
        ...

    async def on_tool_call(self, call: ToolCall, result: ToolResult) -> None:
        """工具调用回调。"""
        ...

    async def on_escalate(self, reason: str) -> None:
        """转人工回调。"""
        ...

    async def on_audio_output(self, audio: bytes) -> None:
        """TTS 音频输出回调 - 把 PCM 音频推回 FreeSWITCH 播放。"""
        ...

    async def on_audio_output_complete(self) -> None:
        """一轮 TTS 音频输出完成。"""
        ...

    async def on_node_enter(self, node_id: str, node_name: str) -> None:
        """节点进入回调（调试用，流程执行到新节点时触发）。"""
        ...

    async def on_action(self, action_type: str, config: dict) -> None:
        """动作节点回调（调试用，dry_run 模式下替代真实动作执行）。"""
        ...

    async def on_end(self, reason: str) -> None:
        """会话结束回调。"""
        ...


class NoopCallbacks:
    """默认 no-op 实现，避免传输层重写所有方法。"""

    async def on_agent_speech(self, text: str) -> None:
        pass

    async def on_caller_speech(self, text: str) -> None:
        pass

    async def on_tool_call(self, call: ToolCall, result: ToolResult) -> None:
        pass

    async def on_escalate(self, reason: str) -> None:
        pass

    async def on_audio_output(self, audio: bytes) -> None:
        pass

    async def on_audio_output_complete(self) -> None:
        pass

    async def on_node_enter(self, node_id: str, node_name: str) -> None:
        pass

    async def on_action(self, action_type: str, config: dict) -> None:
        pass

    async def on_end(self, reason: str) -> None:
        pass
