"""VoiceAgent - 语音对话主循环。

复刻自 apps/voice-agent/src/agent.ts，关键增强：
1. 前置 WebRTC VAD：receive_audio 不再直接推 STT，先过 VAD 状态机
2. 预缓冲：VAD 内部维护 300ms 滚动窗口，silence→speech 时 flush 防丢首字
3. NestJS 任务端点集成：start_session 拉 task 上下文，每轮上报 transcript，escalate 时 transfer
4. barge-in：STT partial → interrupt_speaking（TTS task cancel + LLM cancel）
5. asyncio.Future 替代 TS 版 Promise + callback
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Optional
from uuid import uuid4

from . import audio
from .callbacks import AgentCallbacks, NoopCallbacks
from .llm import LLMAdapter
from .rag import RagService
from .scenarios import SCENARIO_CONFIGS, DEFAULT_VARIABLES, fill_template, get_scenario
from .stt import FunASRClient
from .tasks import TaskClient
from .tools import ToolDispatcher
from .tts import CosyVoiceTTS
from .types import (
    CallOutcome,
    CallSession,
    ChatMessage,
    LLMEvent,
    ScenarioConfig,
    STTEvent,
    TTSChunk,
    ToolCall,
    ToolDefinition,
    ToolResult,
)
from .vad import VoiceActivityDetector

logger = logging.getLogger(__name__)


class VoiceAgent:
    """语音对话主循环 - 与具体传输层解耦。

    生命周期：
        start_session → speak(greeting) → conversation_loop (30 轮) → end_session
        receive_audio 由传输层在通话期间持续调用
    """

    def __init__(
        self,
        stt_provider: Optional[FunASRClient] = None,  # 仅用于配置参数透传，实际按 call 创建
        llm: LLMAdapter | None = None,
        tts: CosyVoiceTTS | None = None,
        rag: Optional[RagService] = None,
        tools: Optional[ToolDispatcher] = None,
        tasks: Optional[TaskClient] = None,
        # 配置参数
        funasr_ws_url: str = "ws://localhost:10095",
        funasr_mode: str = "2pass",
        funasr_hotwords: str = "",
        vad_aggressiveness: int = 3,
        vad_frame_ms: int = 30,
        vad_pre_buffer_ms: int = 300,
        vad_silence_confirm_frames: int = 10,
        vad_speech_confirm_frames: int = 3,
        max_turns: int = 30,
        turn_timeout_s: int = 30,
    ) -> None:
        # AI providers（共享实例）
        self._llm = llm
        self._tts = tts
        self._rag = rag or RagService()
        self._tools = tools or ToolDispatcher()
        self._tasks = tasks or TaskClient()

        # FunASR 配置（按 call 创建独立连接）
        self._funasr_ws_url = funasr_ws_url
        self._funasr_mode = funasr_mode
        self._funasr_hotwords = funasr_hotwords

        # VAD 配置
        self._vad_aggressiveness = vad_aggressiveness
        self._vad_frame_ms = vad_frame_ms
        self._vad_pre_buffer_ms = vad_pre_buffer_ms
        self._vad_silence_confirm = vad_silence_confirm_frames
        self._vad_speech_confirm = vad_speech_confirm_frames

        # 对话循环配置
        self._max_turns = max_turns
        self._turn_timeout_s = turn_timeout_s

        # 会话状态（call_id → ...）
        self._sessions: dict[str, CallSession] = {}
        self._scenario_configs: dict[str, ScenarioConfig] = {}
        self._callbacks: dict[str, AgentCallbacks] = {}
        self._stt_handles: dict[str, FunASRClient] = {}
        self._vads: dict[str, VoiceActivityDetector] = {}
        self._endpoint_waiters: dict[str, asyncio.Future[str]] = {}
        self._injected_text: dict[str, str] = {}
        self._speaking: dict[str, bool] = {}
        self._ended: set[str] = set()
        self._escalated: set[str] = set()  # 标记本次会话是否触发过转人工

    async def start_session(
        self,
        call_id: str,
        scenario: ScenarioConfig,
        variables: dict[str, str],
        callbacks: AgentCallbacks,
        flow_version: Optional[dict[str, Any]] = None,
    ) -> None:
        """启动新通话会话。"""
        # 初始化 session
        system_msg = ChatMessage(
            role="system",
            content=fill_template(scenario.system_prompt, variables),
        )
        session = CallSession(
            call_id=call_id,
            scenario=scenario.scenario.value,
            variables=variables,
            messages=[system_msg],
            tools=self._tools.get_tool_definitions(scenario),
        )
        self._sessions[call_id] = session
        self._scenario_configs[call_id] = scenario
        self._callbacks[call_id] = callbacks

        if flow_version:
            await self._run_flow(call_id, flow_version)
        else:
            # 未绑定流程的兼容模式：按内置场景运行。
            greeting = fill_template(scenario.greeting, variables)
            await self._speak(call_id, greeting)
            await self._conversation_loop(call_id)

        # 会话结束上报
        outcome = (
            CallOutcome.ESCALATED
            if call_id in self._escalated
            else CallOutcome.COMPLETED
        )
        try:
            await self._tasks.set_outcome(call_id, outcome.value)
        except Exception as err:
            logger.warning("[VoiceAgent] set_outcome failed: %s", err)

        await callbacks.on_end("对话结束")

    async def _run_flow(self, call_id: str, flow: dict[str, Any]) -> None:
        """执行发布时锁定的流程快照。

        委托给 FlowExecutor（flow_executor.py），支持 5 节点系统的完整执行：
        - Dialog: script/question/ai 三模式 + retryCount 重试
        - Decision: condition 表达式 + intent LLM 分类
        - Action: transfer/sms/crm/api 四类显式分发
        - End: complete vs hangup
        """
        from .flow_executor import FlowExecutor
        from .flow_types import TaskFlow as TaskFlowModel

        flow_model = TaskFlowModel.from_dict(flow)
        adapter = _FlowExecutorAdapter(self, call_id)
        executor = FlowExecutor(flow_model, adapter)
        await executor.run(call_id)

    async def _conversation_loop(self, call_id: str) -> None:
        """对话主循环 - 最多 max_turns 轮。"""
        for _turn in range(self._max_turns):
            if call_id in self._ended:
                return

            # 1) 等待用户说话
            user_text = await self._wait_for_user_speech(call_id)
            if call_id in self._ended:
                return
            if not user_text.strip():
                continue

            session = self._sessions.get(call_id)
            if not session:
                return

            callbacks = self._callbacks.get(call_id)
            if callbacks:
                await callbacks.on_caller_speech(user_text)
            session.messages.append(ChatMessage(role="user", content=user_text))

            # 2) RAG 检索
            scenario = self._scenario_configs.get(call_id)
            if not scenario:
                break
            rag_ctx = await self._rag.retrieve(scenario, user_text)

            # 3) 生成回复（含工具调用循环）
            messages = self._append_rag_context(session.messages, rag_ctx)
            reply = await self._generate_reply(call_id, messages, session.tools)
            if not reply:
                continue

            session.messages.append(ChatMessage(role="assistant", content=reply))
            await self._speak(call_id, reply)

    async def _generate_reply(
        self,
        call_id: str,
        messages: list[ChatMessage],
        tools: list[ToolDefinition],
    ) -> str:
        """生成单轮回复（含工具调用循环）。"""
        session = self._sessions.get(call_id)
        if not session or self._llm is None:
            return ""

        full_reply = ""
        pending_tool_calls: list[ToolCall] = []

        async def on_event(event: LLMEvent) -> None:
            if event.type == "delta" and event.content:
                nonlocal full_reply
                full_reply += event.content
            elif event.type == "tool_call" and event.tool_call:
                pending_tool_calls.append(event.tool_call)

        await self._llm.chat(messages, tools, on_event)

        # 无工具调用：直接返回回复
        if not pending_tool_calls:
            return full_reply

        # 关键：把 assistant 的 tool_calls 消息加入历史
        # OpenAI API 要求 tool 消息前必须有对应的带 tool_calls 的 assistant 消息
        session.messages.append(
            ChatMessage(
                role="assistant",
                content=full_reply,
                tool_calls=pending_tool_calls,
            )
        )

        # 逐个执行工具
        callbacks = self._callbacks.get(call_id)
        for tc in pending_tool_calls:
            result = await self._tools.dispatch(tc)
            if callbacks:
                await callbacks.on_tool_call(tc, result)
            session.messages.append(
                ChatMessage(
                    role="tool",
                    content=str(result.result),
                    tool_call_id=tc.id,
                    name=tc.name,
                )
            )

            # 工具触发转人工：生成告别话术后结束
            if result.should_escalate:
                if callbacks:
                    await callbacks.on_escalate(f"工具 {tc.name} 触发转人工")
                self._escalated.add(call_id)
                farewell = await self._generate_llm_text(
                    call_id,
                    [
                        *session.messages,
                        ChatMessage(
                            role="user",
                            content="请用一句话告知客户正在为其转接人工专员，请稍候。",
                        ),
                    ],
                    tools,
                )
                self._ended.add(call_id)
                return farewell

        # 让 LLM 基于工具结果生成最终回复
        return await self._generate_llm_text(call_id, session.messages, tools)

    async def _generate_llm_text(
        self,
        call_id: str,
        messages: list[ChatMessage],
        tools: list[ToolDefinition],
    ) -> str:
        """纯文本生成（用于工具结果后续回复、转人工告别）。"""
        if self._llm is None:
            return ""
        reply = ""

        async def on_event(event: LLMEvent) -> None:
            nonlocal reply
            if event.type == "delta" and event.content:
                reply += event.content

        await self._llm.chat(messages, tools, on_event)
        return reply

    def _append_rag_context(
        self, messages: list[ChatMessage], rag_context: str
    ) -> list[ChatMessage]:
        """将 RAG 上下文拼接到 system 消息。"""
        if not rag_context:
            return messages
        result = list(messages)
        for i, m in enumerate(result):
            if m.role == "system":
                result[i] = ChatMessage(role="system", content=m.content + rag_context)
                break
        return result

    async def _wait_for_user_speech(self, call_id: str) -> str:
        """等待用户说完一句话（基于 STT 端点检测 / CLI 注入）。"""
        # 优先消费已缓冲的注入文本
        if call_id in self._injected_text:
            text = self._injected_text.pop(call_id)
            return text

        loop = asyncio.get_event_loop()
        future: asyncio.Future[str] = loop.create_future()
        self._endpoint_waiters[call_id] = future

        try:
            return await asyncio.wait_for(future, timeout=self._turn_timeout_s)
        except asyncio.TimeoutError:
            return ""
        finally:
            self._endpoint_waiters.pop(call_id, None)

    async def _speak(self, call_id: str, text: str) -> None:
        """文本转语音并播放。支持 barge-in。"""
        callbacks = self._callbacks.get(call_id)
        if callbacks:
            await callbacks.on_agent_speech(text)

        if self._tts is None:
            return

        self._speaking[call_id] = True
        try:

            async def on_chunk(chunk: TTSChunk) -> None:
                # barge-in：speaking 标志为 False 时停止推送
                if not self._speaking.get(call_id):
                    return
                if callbacks and chunk.audio:
                    await callbacks.on_audio_output(chunk.audio)

            await self._tts.synthesize(text, on_chunk)
        except asyncio.CancelledError:
            logger.info("[VoiceAgent] call_id=%s TTS cancelled (barge-in)", call_id)
        finally:
            self._speaking.pop(call_id, None)

    def _interrupt_speaking(self, call_id: str) -> None:
        """barge-in：用户开始说话时中断 TTS 和 LLM 生成。"""
        if not self._speaking.get(call_id):
            return
        self._speaking[call_id] = False
        if self._tts is not None:
            self._tts.interrupt()
        if self._llm is not None:
            self._llm.cancel()

    async def receive_audio(self, call_id: str, audio_bytes: bytes) -> None:
        """接收用户音频（FreeSWITCH mod_audio_fork 推送）。

        关键：VAD 状态机门控，只在 speech 状态下推送给 FunASR。
        """
        if call_id in self._ended:
            return

        # 懒初始化 STT handle + VAD
        if call_id not in self._stt_handles:
            stt = FunASRClient(
                self._funasr_ws_url,
                call_id,
                mode=self._funasr_mode,  # type: ignore[arg-type]
                hotwords=self._funasr_hotwords,
                on_event=lambda ev: asyncio.create_task(self._on_stt_event(call_id, ev)),
            )
            try:
                await stt.connect()
            except Exception as err:
                logger.error("[VoiceAgent] call_id=%s STT connect failed: %s", call_id, err)
                return
            self._stt_handles[call_id] = stt

        if call_id not in self._vads:
            self._vads[call_id] = VoiceActivityDetector(
                aggressiveness=self._vad_aggressiveness,
                frame_ms=self._vad_frame_ms,
                sample_rate=16000,
                speech_confirm_frames=self._vad_speech_confirm,
                silence_confirm_frames=self._vad_silence_confirm,
                pre_buffer_ms=self._vad_pre_buffer_ms,
            )

        stt = self._stt_handles[call_id]
        vad = self._vads[call_id]

        # VAD 切片（30ms 帧，frame_ms 决定每帧字节数）
        for frame in audio.split_into_frames(audio_bytes, self._vad_frame_ms, 16000):
            state, frames_to_send = vad.feed(frame)
            for f in frames_to_send:
                await stt.send_audio(f)
            if state == "speech_end":
                await stt.end_speech()

    async def _on_stt_event(self, call_id: str, event: STTEvent) -> None:
        """STT 事件处理。"""
        if event.type == "partial" and event.text:
            # 用户开始说话 → barge-in
            self._interrupt_speaking(call_id)
        elif event.type == "final":
            fut = self._endpoint_waiters.get(call_id)
            if fut and not fut.done():
                fut.set_result(event.text)

    async def inject_user_text(self, call_id: str, text: str) -> None:
        """CLI/测试模式：直接注入用户文本（跳过 STT）。"""
        fut = self._endpoint_waiters.get(call_id)
        if fut and not fut.done():
            fut.set_result(text)
        else:
            # waiter 未就绪（Agent 正在播报 greeting / 处理上一轮）：缓冲文本
            self._injected_text[call_id] = text

    async def end_session(self, call_id: str) -> None:
        """结束会话并清理资源。"""
        self._ended.add(call_id)
        self._interrupt_speaking(call_id)

        stt = self._stt_handles.pop(call_id, None)
        if stt:
            try:
                await stt.close()
            except Exception:
                pass

        fut = self._endpoint_waiters.pop(call_id, None)
        if fut and not fut.done():
            fut.set_result("")

        self._vads.pop(call_id, None)
        self._sessions.pop(call_id, None)
        self._scenario_configs.pop(call_id, None)
        self._callbacks.pop(call_id, None)
        self._injected_text.pop(call_id, None)
        self._speaking.pop(call_id, None)

    async def close(self) -> None:
        """关闭所有共享资源（应用退出时调用）。"""
        await self._rag.close()
        await self._tools.close()
        await self._tasks.close()
        if self._llm:
            await self._llm.close()
        if self._tts:
            await self._tts.close()


class _FlowExecutorAdapter:
    """将 VoiceAgent 方法适配为 FlowExecutorCallbacks 接口。"""

    def __init__(self, agent: "VoiceAgent", call_id: str) -> None:
        self._agent = agent
        self._call_id = call_id

    async def speak(self, call_id: str, text: str) -> None:
        await self._agent._speak(call_id, text)

    async def wait_for_user_speech(self, call_id: str) -> str:
        return await self._agent._wait_for_user_speech(call_id)

    async def generate_reply(
        self, call_id: str, messages: list[ChatMessage], tools: list = None
    ) -> str:
        return await self._agent._generate_reply(call_id, messages, tools or [])

    async def generate_llm_text(
        self, call_id: str, messages: list[ChatMessage], options: dict = None
    ) -> str:
        return await self._agent._generate_llm_text(call_id, messages, [])

    async def on_caller_speech(self, call_id: str, text: str) -> None:
        callbacks = self._agent._callbacks.get(call_id)
        if callbacks:
            await callbacks.on_caller_speech(text)

    async def on_escalate(self, call_id: str, reason: str) -> bool:
        callbacks = self._agent._callbacks.get(call_id)
        if callbacks:
            await callbacks.on_escalate(reason)
        return True

    async def on_tool_call(self, call_id: str, call: ToolCall, result: Any) -> None:
        callbacks = self._agent._callbacks.get(call_id)
        if callbacks:
            await callbacks.on_tool_call(call, result)

    def get_session_messages(self, call_id: str) -> list[ChatMessage]:
        return self._agent._sessions[call_id].messages

    def get_session_variables(self, call_id: str) -> dict[str, str]:
        return self._agent._sessions[call_id].variables

    def get_session_tools(self, call_id: str) -> list:
        return self._agent._sessions[call_id].tools

    def is_ended(self, call_id: str) -> bool:
        return call_id in self._agent._ended

    def mark_ended(self, call_id: str) -> None:
        self._agent._ended.add(call_id)

    def mark_escalated(self, call_id: str) -> None:
        self._agent._escalated.add(call_id)

    async def dispatch_tool(self, call_id: str, call: ToolCall) -> Any:
        return await self._agent._tools.dispatch(call)

    async def dispatch_action(
        self, call_id: str, action_type: str, config: dict[str, Any], idempotency_key: str
    ) -> bool:
        return await self._agent._tasks.execute_action(
            call_id, action_type, config, idempotency_key
        )

    async def hangup_call(self, call_id: str) -> None:
        try:
            await self._agent._tasks.hangup(call_id)
        except Exception as err:
            logger.warning("[FlowExecutor] hangup failed: %s", err)
