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
import time
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
from .vad import VoiceActivityDetector, make_frame_detector_factory

logger = logging.getLogger(__name__)


def _is_degenerate_transcript(text: str) -> bool:
    """ASR 幻觉过滤。

    话机通道无 AEC 时，TTS 回声/环境噪声常被识别成单 token 高频重复
    （实测如 "the the the the ..."）。此类退化结果不是真实用户话语，
    不应污染转写、驱动 LLM 或触发端点。判定保守，仅命中明显重复，
    避免误伤正常短句（中文无空格短句 token 数为 1，天然不命中）。
    """
    stripped = text.strip()
    if not stripped:
        return True
    tokens = stripped.split()
    if len(tokens) >= 5:
        dominant = max(set(tokens), key=tokens.count)
        if tokens.count(dominant) / len(tokens) >= 0.6:
            return True
    compact = stripped.replace(" ", "")
    if len(compact) >= 8:
        dominant_char = max(set(compact), key=compact.count)
        if compact.count(dominant_char) / len(compact) >= 0.7:
            return True
    return False


# 语义自适应端点检测（B-P1b）的判定表：常量置于模块级便于真机调参。
# 数字结尾（报号码等）：阿拉伯数字 + 常见中文数字。
_SEMANTIC_DIGIT_CHARS = frozenset("0123456789一二三四五六七八九十两零")
# 犹豫/思考词结尾：取 partial 结尾 2 字符窗口做后缀匹配，兼容单字与双字。
_SEMANTIC_HESITATION_WORDS = ("就是", "那个", "然后", "因为", "但是", "嗯", "呃", "啊")


def _semantic_extend_ms(
    text: str, digit_ms: int, hesitation_ms: int
) -> tuple[int, str]:
    """按最近 partial 的结尾判定语义延长量，返回 (延长毫秒, 原因)。

    优先级：数字结尾 > 犹豫词结尾 > 其它（0）。犹豫词取结尾 2 字符窗口后缀匹配，
    使单字（嗯/呃/啊）与双字（就是/那个…）用同一套规则命中。
    """
    stripped = text.strip()
    if not stripped:
        return 0, "none"
    if stripped[-1] in _SEMANTIC_DIGIT_CHARS:
        return max(0, digit_ms), "digit"
    tail2 = stripped[-2:]
    for word in _SEMANTIC_HESITATION_WORDS:
        if tail2.endswith(word):
            return max(0, hesitation_ms), "hesitation"
    return 0, "none"


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
        vad_frame_ms: int = 20,
        vad_pre_buffer_ms: int = 300,
        vad_silence_confirm_frames: int = 10,
        vad_speech_confirm_frames: int = 3,
        vad_min_speech_ms: int = 200,
        vad_provider: str = "webrtc",
        vad_silero_threshold: float = 0.5,
        max_turns: int = 30,
        turn_timeout_s: int = 30,
        asr_tts_gate_enabled: bool = True,
        asr_tts_gate_web_enabled: bool = False,
        asr_tts_tail_guard_ms: int = 500,
        barge_in_during_tts_enabled: bool = False,
        barge_in_min_ms: int = 500,
        barge_in_rms_threshold: float = 0.08,
        barge_in_hangover_ms: int = 240,
        vad_semantic_endpoint_enabled: bool = True,
        vad_semantic_extend_digit_ms: int = 600,
        vad_semantic_extend_hesitation_ms: int = 400,
        vad_semantic_max_total_ms: int = 1600,
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
        self._vad_min_speech_ms = max(0, vad_min_speech_ms)

        # 帧级检测器工厂（B-P2a）：VAD_PROVIDER=webrtc|silero。启动时解析一次
        # （silero 探针加载模型 / 不可用即回退 webrtc 并打日志），每通电话调用
        # 工厂产出一个新实例（Silero 有逐句内部状态，不跨通话复用）。
        # 工厂返回 None → VoiceActivityDetector 走内建 webrtc（默认，零改动）。
        self._vad_detector_factory = make_frame_detector_factory(
            vad_provider,
            aggressiveness=vad_aggressiveness,
            sample_rate=16000,
            silero_threshold=vad_silero_threshold,
        )

        # 语义自适应端点检测（B-P1b）：partial 结尾为数字/犹豫词时延长静音窗，
        # 让报号码/犹豫思考的自然停顿不被固定静音窗一刀切成整句结束。
        # enabled=False 时 provider 恒返回 0 → 与固定静音窗零差异。
        self._vad_semantic_enabled = vad_semantic_endpoint_enabled
        self._vad_semantic_extend_digit_ms = max(0, vad_semantic_extend_digit_ms)
        self._vad_semantic_extend_hesitation_ms = max(0, vad_semantic_extend_hesitation_ms)
        self._vad_semantic_max_total_ms = max(0, vad_semantic_max_total_ms)

        # 对话循环配置
        self._max_turns = max_turns
        self._turn_timeout_s = turn_timeout_s

        # TTS 播放期间的 ASR 门控：
        # FreeSWITCH 当前回传音频可能包含 AI 自己的 TTS/扬声器回声。
        # 默认在 Agent 播放 TTS 时暂停向 ASR 送音频，并在 TTS 结束后保留一小段
        # 尾音保护窗口，避免把自己的声音识别成用户输入。
        # web 通道（浏览器自带 AEC）默认跳过该门控（asr_tts_gate_web_enabled=False），
        # 播报期间照常送 ASR，STT partial 即可语义级打断。
        self._asr_tts_gate_enabled = asr_tts_gate_enabled
        self._asr_tts_gate_web_enabled = asr_tts_gate_web_enabled
        self._asr_tts_tail_guard_ms = max(0, asr_tts_tail_guard_ms)
        self._barge_in_during_tts_enabled = barge_in_during_tts_enabled
        self._barge_in_min_ms = max(0, barge_in_min_ms)
        self._barge_in_rms_threshold = max(0.0, barge_in_rms_threshold)
        # 挂起容差：自然语音音节间存在短暂能量低谷，容差内不清零已累计的
        # "有效发声"时长，避免连续语音永远攒不够 barge_in_min_ms。
        self._barge_in_hangover_ms = max(0, barge_in_hangover_ms)

        # 会话状态（call_id → ...）
        self._sessions: dict[str, CallSession] = {}
        self._scenario_configs: dict[str, ScenarioConfig] = {}
        self._callbacks: dict[str, AgentCallbacks] = {}
        self._stt_handles: dict[str, FunASRClient] = {}
        self._vads: dict[str, VoiceActivityDetector] = {}
        self._endpoint_waiters: dict[str, asyncio.Future[str]] = {}
        self._injected_text: dict[str, str] = {}
        # 语义端点检测：每通话最近一次 ASR partial 文本（provider 据此计算延长量）。
        self._recent_partial: dict[str, str] = {}
        # 语义延长日志去重：provider 每帧被查询，仅在本 utterance 首次生效时打一行。
        self._semantic_extend_logged: set[str] = set()
        self._speaking: dict[str, bool] = {}
        self._channels: dict[str, str] = {}  # call_id → 会话通道（freeswitch|web）
        self._asr_suppressed_until: dict[str, float] = {}
        self._asr_gate_logged: set[str] = set()
        self._barge_in_voice_ms: dict[str, int] = {}
        self._barge_in_low_ms: dict[str, int] = {}  # 挂起容差内的连续低能量累计（call_id → ms）
        self._barge_in_probe: dict[str, tuple[float, float]] = {}  # call_id → (窗口起始, 窗口内 max_rms)，仅用于日志探针
        self._ended: set[str] = set()
        self._escalated: set[str] = set()  # 标记本次会话是否触发过转人工
        self._dry_run: dict[str, bool] = {}  # 调试模式标记（按 call_id）

    async def start_session(
        self,
        call_id: str,
        scenario: ScenarioConfig,
        variables: dict[str, str],
        callbacks: AgentCallbacks,
        flow_version: Optional[dict[str, Any]] = None,
        dry_run: bool = False,
        tenant_id: Optional[str] = None,
        user_id: Optional[str] = None,
        channel: str = "freeswitch",
    ) -> None:
        """启动新通话会话。channel 来自首帧 metadata（freeswitch|web），决定门控策略。"""
        # 初始化 session
        system_msg = ChatMessage(
            role="system",
            content=fill_template(scenario.system_prompt, variables),
        )
        session = CallSession(
            call_id=call_id,
            scenario=scenario.scenario.value if hasattr(scenario.scenario, "value") else str(scenario.scenario),
            variables=variables,
            messages=[system_msg],
            tenant_id=tenant_id,
            user_id=user_id,
            tools=self._tools.get_tool_definitions(scenario),
        )
        self._sessions[call_id] = session
        self._scenario_configs[call_id] = scenario
        self._callbacks[call_id] = callbacks
        self._channels[call_id] = channel or "freeswitch"
        if dry_run:
            self._dry_run[call_id] = True

        if flow_version:
            await self._run_flow(call_id, flow_version)
        else:
            # 未绑定流程的兼容模式：按内置场景运行。
            greeting = fill_template(scenario.greeting, variables)
            await self._speak(call_id, greeting)
            await self._conversation_loop(call_id)

        # 会话结束上报
        if not self._dry_run.get(call_id):
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
        adapter = _FlowExecutorAdapter(self, call_id, dry_run=self._dry_run.get(call_id, False))
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
            rag_ctx = await self._rag.retrieve(
                scenario,
                user_text,
                tenant_id=session.tenant_id,
                user_id=session.user_id,
            )

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
            timeout = None if self._dry_run.get(call_id) else self._turn_timeout_s
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            return ""
        finally:
            self._endpoint_waiters.pop(call_id, None)

    async def _speak(self, call_id: str, text: str) -> None:
        """文本转语音并播放。支持 barge-in。"""
        callbacks = self._callbacks.get(call_id)
        if callbacks:
            await callbacks.on_agent_speech(text)

        if self._dry_run.get(call_id):
            return

        if self._tts is None:
            return

        self._speaking[call_id] = True
        self._asr_suppressed_until.pop(call_id, None)
        self._barge_in_voice_ms.pop(call_id, None)
        self._barge_in_low_ms.pop(call_id, None)
        self._barge_in_probe.pop(call_id, None)
        try:
            tts_chunks = 0
            tts_bytes = 0

            async def on_chunk(chunk: TTSChunk) -> None:
                nonlocal tts_chunks, tts_bytes
                # barge-in：speaking 标志为 False 时停止推送
                if not self._speaking.get(call_id):
                    return
                if callbacks and chunk.audio:
                    tts_chunks += 1
                    tts_bytes += len(chunk.audio)
                    await callbacks.on_audio_output(chunk.audio)

            scenario = self._scenario_configs.get(call_id)
            tts_config = scenario.tts_config if scenario else {}
            speaker = tts_config.get("voice")
            instruct_text = (
                tts_config.get("stylePrompt")
                or tts_config.get("style_prompt")
                or (scenario.communication_style_prompt if scenario else None)
            )
            await self._tts.synthesize(
                text,
                on_chunk,
                speaker=str(speaker) if speaker else None,
                instruct_text=str(instruct_text) if instruct_text else None,
            )
            if callbacks:
                await callbacks.on_audio_output_complete()
            logger.info(
                "[VoiceAgent] call_id=%s TTS delivered chunks=%d bytes=%d",
                call_id,
                tts_chunks,
                tts_bytes,
            )
        except asyncio.CancelledError:
            task = asyncio.current_task()
            if task is not None and task.cancelling():
                # 外部任务取消（挂断/会话拆除时 session_task.cancel()）：必须向上
                # 传播，否则 CancelledError 被吞、会话继续僵尸运行。
                raise
            # tts.interrupt() 自抛的 CancelledError = barge-in，按原设计吞掉
            logger.info("[VoiceAgent] call_id=%s TTS cancelled (barge-in)", call_id)
        finally:
            was_interrupted = not self._speaking.get(call_id, False)
            if self._asr_tts_gate_enabled:
                if was_interrupted or self._asr_tts_tail_guard_ms <= 0:
                    self._asr_suppressed_until.pop(call_id, None)
                else:
                    self._asr_suppressed_until[call_id] = (
                        time.monotonic() + self._asr_tts_tail_guard_ms / 1000
                    )
                self._barge_in_voice_ms.pop(call_id, None)
                self._barge_in_low_ms.pop(call_id, None)
                self._barge_in_probe.pop(call_id, None)
            self._speaking.pop(call_id, None)

    def _interrupt_speaking(self, call_id: str) -> None:
        """barge-in：用户开始说话时中断 TTS 和 LLM 生成。"""
        if not self._speaking.get(call_id):
            return
        self._speaking[call_id] = False
        # 打断 = 新用户回合开始：复位语义端点缓存（随后 partial 会写入本句最新文本）。
        self._reset_semantic_partial(call_id)
        if self._tts is not None:
            self._tts.interrupt()
        if self._llm is not None:
            self._llm.cancel()
        logger.info(
            "[BargeIn] call_id=%s channel=%s interrupt_executed",
            call_id,
            self._channels.get(call_id, "freeswitch"),
        )
        # 通知传输层清空下游播放队列（可选回调：WebSocketCallbacks 实现，
        # TextTestCallbacks/CLI 不实现则跳过）
        callbacks = self._callbacks.get(call_id)
        on_interrupted = getattr(callbacks, "on_interrupted", None)
        if callable(on_interrupted):
            try:
                asyncio.get_running_loop().create_task(on_interrupted())
            except RuntimeError:
                logger.warning(
                    "[BargeIn] call_id=%s no running loop, skip on_interrupted", call_id
                )

    def _is_asr_suppressed(self, call_id: str) -> tuple[bool, str]:
        """当前是否应暂停把入站音频送入 ASR。

        web 通道（浏览器自带 AEC）且未显式开启 web 门控时，播报期间不抑制、
        尾音保护窗同样跳过 —— 打断依赖正常 VAD→FunASR partial 的语义级路径。
        FreeSWITCH 通道行为不变。
        """
        if not self._asr_tts_gate_enabled:
            return False, ""
        if (
            self._channels.get(call_id) == "web"
            and not self._asr_tts_gate_web_enabled
        ):
            return False, ""
        if self._speaking.get(call_id):
            return True, "tts_playing"
        suppressed_until = self._asr_suppressed_until.get(call_id)
        if suppressed_until is None:
            return False, ""
        if time.monotonic() < suppressed_until:
            return True, "tts_tail_guard"
        self._asr_suppressed_until.pop(call_id, None)
        self._asr_gate_logged.discard(call_id)
        return False, ""

    def _reset_vad(self, call_id: str) -> None:
        """丢弃 TTS/回声音频后，重置 VAD 状态，避免脏状态跨到用户回合。"""
        vad = self._vads.get(call_id)
        if vad is not None:
            vad.reset()

    def _reset_semantic_partial(self, call_id: str) -> None:
        """复位语义端点的 partial 缓存与日志去重（utterance 结束/打断/新 speech_start）。

        不复位会把上一句结尾状态（如报号码的数字尾）带进下一句，误延长下一句端点。
        """
        self._recent_partial.pop(call_id, None)
        self._semantic_extend_logged.discard(call_id)

    def _semantic_extra_silence_frames(self, call_id: str) -> int:
        """VAD 的 extra_silence_frames_provider：按最近 partial 结尾计算延长帧数。

        - 关闭 / 无 partial / 结尾非数字非犹豫词 → 0（与固定静音窗零差异）。
        - 数字/犹豫词结尾 → 对应延长毫秒，再以 VAD_SEMANTIC_MAX_TOTAL_MS 封顶
          「基础窗 + 延长」的总窗，防止病态 partial 让端点永不判停。
        provider 每帧被查询；仅在本 utterance 首次生效时打一行结构化日志（去重）。
        """
        if not self._vad_semantic_enabled:
            return 0
        text = self._recent_partial.get(call_id)
        if not text:
            return 0
        extend_ms, reason = _semantic_extend_ms(
            text,
            self._vad_semantic_extend_digit_ms,
            self._vad_semantic_extend_hesitation_ms,
        )
        if extend_ms <= 0:
            return 0
        frame_ms = self._vad_frame_ms or 20
        base_ms = self._vad_silence_confirm * frame_ms
        # 总窗封顶：延长量不得让「基础 + 延长」超过 max_total。
        max_extra_ms = self._vad_semantic_max_total_ms - base_ms
        if max_extra_ms <= 0:
            return 0
        extend_ms = min(extend_ms, max_extra_ms)
        frames = extend_ms // frame_ms
        if frames <= 0:
            return 0
        if call_id not in self._semantic_extend_logged:
            self._semantic_extend_logged.add(call_id)
            logger.info(
                "[VAD/Semantic] call_id=%s extend_ms=%d reason=%s tail=%s",
                call_id,
                frames * frame_ms,
                reason,
                text[-4:],
            )
        return frames

    def _observe_barge_in_candidate(self, call_id: str, audio_bytes: bytes) -> bool:
        """TTS 播放时的轻量 barge-in 候选检测。

        默认关闭。开启后只基于持续高能量做粗检测；达到阈值时中断 TTS，
        但不会把当前这段可能包含回声的音频送入 ASR，后续音频再正常识别。

        挂起容差（hangover）：自然语音音节间存在短暂能量低谷，若一帧低于
        阈值就把已累计的"有效发声"时长清零，连续说话也永远攒不够
        barge_in_min_ms，检测形同虚设。改为低谷在容差内先只累计低谷自身
        时长、不清零已累计的发声时长；只有低谷本身持续达到容差才判定为
        真正的停顿，此时才清零重新开始计数。
        """
        if not self._barge_in_during_tts_enabled or not self._speaking.get(call_id):
            return False
        triggered = False
        for frame in audio.split_into_frames(audio_bytes, self._vad_frame_ms, 16000):
            rms = audio.compute_rms(frame)

            # 探针日志：每约 1 秒输出一次窗口内峰值 RMS，用于真机通话时校准阈值。
            now = time.monotonic()
            window_start, window_max_rms = self._barge_in_probe.get(call_id, (now, 0.0))
            window_max_rms = max(window_max_rms, rms)
            if now - window_start >= 1.0:
                logger.info(
                    "[BargeIn/Probe] call_id=%s max_rms=%.4f threshold=%.4f voice_ms=%d",
                    call_id,
                    window_max_rms,
                    self._barge_in_rms_threshold,
                    self._barge_in_voice_ms.get(call_id, 0),
                )
                self._barge_in_probe[call_id] = (now, 0.0)
            else:
                self._barge_in_probe[call_id] = (window_start, window_max_rms)

            if rms >= self._barge_in_rms_threshold:
                self._barge_in_voice_ms[call_id] = (
                    self._barge_in_voice_ms.get(call_id, 0) + self._vad_frame_ms
                )
                self._barge_in_low_ms[call_id] = 0
            else:
                low_ms = self._barge_in_low_ms.get(call_id, 0) + self._vad_frame_ms
                self._barge_in_low_ms[call_id] = low_ms
                if low_ms >= self._barge_in_hangover_ms:
                    self._barge_in_voice_ms[call_id] = 0
            if self._barge_in_voice_ms.get(call_id, 0) >= self._barge_in_min_ms:
                triggered = True
                break
        if triggered:
            logger.info(
                "[BargeIn] call_id=%s channel=%s source=rms barge_in during TTS",
                call_id,
                self._channels.get(call_id, "freeswitch"),
            )
            self._barge_in_voice_ms.pop(call_id, None)
            self._barge_in_low_ms.pop(call_id, None)
            self._barge_in_probe.pop(call_id, None)
            self._interrupt_speaking(call_id)
        return triggered

    async def receive_audio(self, call_id: str, audio_bytes: bytes) -> None:
        """接收用户音频（FreeSWITCH mod_audio_fork 推送）。

        关键：VAD 状态机门控，只在 speech 状态下推送给 FunASR。
        """
        if call_id in self._ended:
            return

        suppressed, reason = self._is_asr_suppressed(call_id)
        if suppressed:
            self._observe_barge_in_candidate(call_id, audio_bytes)
            self._reset_vad(call_id)
            if call_id not in self._asr_gate_logged:
                logger.info("[ASR/Gate] call_id=%s suppress inbound audio: %s", call_id, reason)
                self._asr_gate_logged.add(call_id)
            return

        self._asr_gate_logged.discard(call_id)

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
                min_speech_ms=self._vad_min_speech_ms,
                extra_silence_frames_provider=(
                    lambda cid=call_id: self._semantic_extra_silence_frames(cid)
                ),
                detector=self._vad_detector_factory(),
            )

        stt = self._stt_handles[call_id]
        vad = self._vads[call_id]

        # VAD 切片（frame_ms 决定每帧字节数）
        for frame in audio.split_into_frames(audio_bytes, self._vad_frame_ms, 16000):
            state, frames_to_send = vad.feed(frame)
            if state == "speech_start":
                # 新 utterance 起说：复位上一句遗留的 partial 结尾状态。
                self._reset_semantic_partial(call_id)
                logger.info(
                    "[VAD] call_id=%s speech_start flush_ms=%d",
                    call_id,
                    getattr(vad, "last_flush_ms", 0),
                )
            elif state == "speech_end":
                # utterance 结束：清掉本句 partial，避免带进下一句端点判定。
                self._reset_semantic_partial(call_id)
                logger.info(
                    "[VAD] call_id=%s speech_end segment_ms=%d",
                    call_id,
                    getattr(vad, "last_segment_ms", 0),
                )
            else:
                pop_discarded = getattr(vad, "pop_discarded_ms", None)
                discarded_ms = pop_discarded() if callable(pop_discarded) else None
                if discarded_ms is not None:
                    logger.info(
                        "[VAD] call_id=%s utterance_discarded speech_ms=%d "
                        "min_speech_ms=%d",
                        call_id,
                        discarded_ms,
                        self._vad_min_speech_ms,
                    )
            for f in frames_to_send:
                await stt.send_audio(f)
            if state == "speech_end":
                await stt.end_speech()

    async def _on_stt_event(self, call_id: str, event: STTEvent) -> None:
        """STT 事件处理。"""
        logger.info(
            "[ASR] call_id=%s type=%s text=%s", call_id, event.type, event.text
        )
        if event.type == "partial" and event.text:
            # 用户开始说话 → barge-in
            if self._speaking.get(call_id):
                logger.info(
                    "[BargeIn] call_id=%s channel=%s source=stt_partial barge_in",
                    call_id,
                    self._channels.get(call_id, "freeswitch"),
                )
            self._interrupt_speaking(call_id)
            # 记录本句最新 partial，供语义端点延长静音窗。必须在打断复位之后写，
            # 否则触发 barge-in 的这条 partial 会被 _interrupt_speaking 的复位清掉。
            self._recent_partial[call_id] = event.text
        elif event.type == "final":
            if event.text and _is_degenerate_transcript(event.text):
                # 退化识别（回声/噪声幻觉）：既不落转写也不驱动对话，
                # 更不触发端点/打断，防止 agent 被自己的回声带偏。
                logger.info(
                    "[ASR] call_id=%s dropped degenerate final text=%s",
                    call_id,
                    event.text,
                )
                return
            fut = self._endpoint_waiters.get(call_id)
            if fut and not fut.done():
                fut.set_result(event.text)
            elif event.text:
                # final 落在 waiter 窗口外（agent 正在播报，或上一轮收尾、
                # waiter 尚未建立）。丢弃会让"用户说完了、agent 还在等"，
                # 体感为打不断 + 响应极慢：短语打断往往只出 final 不出
                # online partial（2pass 在线块 ~600ms）。缓冲进 _injected_text
                # 供下一次 _wait_for_user_speech 立即消费，播报中则一并打断。
                if self._speaking.get(call_id):
                    logger.info(
                        "[BargeIn] call_id=%s channel=%s source=stt_final barge_in",
                        call_id,
                        self._channels.get(call_id, "freeswitch"),
                    )
                buffered = self._injected_text.get(call_id)
                self._injected_text[call_id] = (
                    f"{buffered} {event.text}" if buffered else event.text
                )
                self._interrupt_speaking(call_id)

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
        self._recent_partial.pop(call_id, None)
        self._semantic_extend_logged.discard(call_id)
        self._sessions.pop(call_id, None)
        self._scenario_configs.pop(call_id, None)
        self._callbacks.pop(call_id, None)
        self._injected_text.pop(call_id, None)
        self._speaking.pop(call_id, None)
        self._channels.pop(call_id, None)
        self._asr_suppressed_until.pop(call_id, None)
        self._asr_gate_logged.discard(call_id)
        self._barge_in_voice_ms.pop(call_id, None)
        self._barge_in_low_ms.pop(call_id, None)
        self._barge_in_probe.pop(call_id, None)
        self._dry_run.pop(call_id, None)

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

    def __init__(self, agent: "VoiceAgent", call_id: str, dry_run: bool = False) -> None:
        self._agent = agent
        self._call_id = call_id
        self._dry_run = dry_run

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

    async def on_escalate(
        self, call_id: str, reason: str, extension: Optional[str] = None
    ) -> bool:
        callbacks = self._agent._callbacks.get(call_id)
        if callbacks:
            await callbacks.on_escalate(reason, extension)
        return True

    async def on_tool_call(self, call_id: str, call: ToolCall, result: Any) -> None:
        callbacks = self._agent._callbacks.get(call_id)
        if callbacks:
            await callbacks.on_tool_call(call, result)

    async def on_node_enter(self, call_id: str, node_id: str, node_name: str) -> None:
        callbacks = self._agent._callbacks.get(call_id)
        if callbacks:
            await callbacks.on_node_enter(node_id, node_name)

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
        if self._dry_run:
            callbacks = self._agent._callbacks.get(call_id)
            if callbacks:
                await callbacks.on_action(action_type, dict(config))
            return True
        if action_type not in {"sms", "api", "crm"}:
            return False
        return await self._agent._tasks.execute_action(
            call_id, action_type, config, idempotency_key
        )

    async def hangup_call(self, call_id: str) -> None:
        if self._dry_run:
            return
        try:
            await self._agent._tasks.hangup(call_id)
        except Exception as err:
            logger.warning("[FlowExecutor] hangup failed: %s", err)
