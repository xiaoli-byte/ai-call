"""VoiceAgent - 语音对话主循环。

复刻自 apps/voice-agent/src/agent.ts，关键增强：
1. 前置 WebRTC VAD：receive_audio 不再直接推 STT，先过 VAD 状态机
2. 预缓冲：VAD 内部维护 300ms 滚动窗口，silence→speech 时 flush 防丢首字
3. NestJS 任务端点集成：start_session 拉 task 上下文，每轮上报 transcript，escalate 时 transfer
4. barge-in：STT partial → interrupt_speaking（按 call_id 中断 TTS 播放）
5. asyncio.Future 替代 TS 版 Promise + callback
"""

from __future__ import annotations

import asyncio
from difflib import SequenceMatcher
import logging
import os
import re
import time
from typing import Any, Optional
from uuid import uuid4

from . import audio
from .callbacks import AgentCallbacks, NoopCallbacks
from .echo_gate import EchoAnalysis, ReferenceEchoGate
from .llm import LLMAdapter
from .rag import RagService
from .scenarios import SCENARIO_CONFIGS, DEFAULT_VARIABLES, fill_template, get_scenario
from .stt import FunASRClient, create_stt_client
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


_BARGE_IN_COMMANDS = (
    "停一下",
    "等一下",
    "等等",
    "打住",
    "暂停",
    "别说了",
    "先别说",
)
_SHORT_BARGE_IN_ANSWERS = frozenset(
    {
        "收到了",
        "没收到",
        "没有",
        "好的",
        "可以",
        "不可以",
        "方便",
        "不方便",
    }
)


def _trim_context_window(
    messages: list[ChatMessage], max_history_turns: int
) -> list[ChatMessage]:
    """LLM 上下文滑动窗口：保留全部 system 消息 + 最近 N 轮非 system 消息。

    只裁剪送给 LLM 的消息列表，不改动 session.messages 原始记录（完整对话
    仍通过 transcript 上报）。max_history_turns <= 0 表示不限制（旧行为）。
    每轮按 user+assistant 两条估算，窗口即最近 2N 条非 system 消息。
    窗口起点不允许落在 tool 结果上：OpenAI 协议要求 tool 消息前必须有
    对应带 tool_calls 的 assistant 消息，孤儿 tool 消息会被服务端拒绝。
    """
    if max_history_turns <= 0:
        return messages
    limit = max_history_turns * 2
    non_system_indexes = [
        index for index, message in enumerate(messages) if message.role != "system"
    ]
    if len(non_system_indexes) <= limit:
        return messages
    cut = non_system_indexes[-limit]
    while cut < len(messages) and messages[cut].role == "tool":
        cut += 1
    trimmed = [
        message
        for index, message in enumerate(messages)
        if message.role == "system" or index >= cut
    ]
    logger.debug(
        "[ContextWindow] 裁剪 LLM 上下文 %d -> %d 条（窗口 %d 轮）",
        len(messages),
        len(trimmed),
        max_history_turns,
    )
    return trimmed


def _normalize_echo_text(text: str) -> str:
    """Normalize ASR/TTS text for tolerant echo comparison."""
    normalized = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", text.lower())
    # ASR commonly normalizes 您好 to 你好; treating them alike avoids a false
    # mismatch at the beginning of customer-service prompts.
    return normalized.replace("您", "你")


def _max_window_similarity(candidate: str, reference: str) -> float:
    """Return the best similarity against a similarly sized reference window."""
    if not candidate or not reference:
        return 0.0
    if candidate in reference:
        return 1.0
    if reference in candidate:
        return SequenceMatcher(None, candidate, reference).ratio()

    candidate_len = len(candidate)
    best = 0.0
    min_window = max(1, candidate_len - 2)
    max_window = min(len(reference), candidate_len + 2)
    for window_len in range(min_window, max_window + 1):
        for start in range(0, len(reference) - window_len + 1):
            score = SequenceMatcher(
                None, candidate, reference[start : start + window_len]
            ).ratio()
            if score > best:
                best = score
    return best


def _classify_tts_echo(
    transcript: str, reference_text: str, *, is_final: bool
) -> tuple[str, float]:
    """Classify an ASR event during web TTS as echo, distinct, or ambiguous.

    Short partials are deliberately deferred: one or two characters are too weak
    to stop playback. A short final answer such as ``收到了`` remains actionable,
    even when those words also occur in the agent's question.
    """
    candidate = _normalize_echo_text(transcript)
    reference = _normalize_echo_text(reference_text)
    if not candidate or not reference:
        return "ambiguous", 0.0

    if any(command in candidate for command in _BARGE_IN_COMMANDS):
        return "distinct", 0.0

    score = _max_window_similarity(candidate, reference)
    if len(candidate) <= 2:
        return ("echo" if score == 1.0 else "ambiguous"), score

    # A single unstable Latin token (for example FunASR's transient "That") is
    # not enough evidence for barge-in during Chinese TTS.
    if re.fullmatch(r"[a-z0-9]+", candidate):
        return ("echo" if score >= 0.85 else "ambiguous"), score

    if len(candidate) <= 4:
        if is_final and candidate in _SHORT_BARGE_IN_ANSWERS:
            return "distinct", score
        if score == 1.0:
            return "echo", score
        return "distinct", score

    threshold = 0.72 if len(candidate) >= 6 else 0.78
    return ("echo" if score >= threshold else "distinct"), score


_ECHO_PARTIAL_LATCH_MIN_SIMILARITY = 0.90
_ECHO_LATCH_RELEASE_SIMILARITY = 0.55


def _is_explicit_barge_in_candidate(text: str) -> bool:
    """Return whether text is strong enough to override echo hysteresis."""
    candidate = _normalize_echo_text(text)
    return bool(candidate) and (
        any(command in candidate for command in _BARGE_IN_COMMANDS)
        or candidate in _SHORT_BARGE_IN_ANSWERS
    )


def _should_hold_echo_latch(text: str, similarity: float) -> bool:
    """Keep a prior high-confidence echo decision across unstable ASR rewrites.

    Streaming ASR can first emit an exact TTS fragment and then rewrite the
    final into a short, slightly different hallucination.  Releasing on that
    single rewrite caused real iPhone speaker echo to interrupt playback.  A
    clear command/known short answer or genuinely low similarity still escapes.
    """
    return (
        similarity >= _ECHO_LATCH_RELEASE_SIMILARITY
        and not _is_explicit_barge_in_candidate(text)
    )


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
        asr_tts_echo_guard_enabled: bool = True,
        asr_tts_tail_guard_ms: int = 500,
        aec_reference_gate_enabled: bool = True,
        aec_reference_window_ms: int = 3000,
        aec_analysis_window_ms: int = 200,
        aec_min_analysis_ms: int = 180,
        aec_echo_correlation_threshold: float = 0.98,
        aec_echo_max_residual_ratio: float = 0.20,
        aec_near_end_min_snr_db: float = 8.0,
        aec_min_rms: float = 0.006,
        aec_double_talk_hangover_ms: int = 800,
        asr_tail_guard_ms: int = 800,
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
        # 按场景 ttsConfig.provider 动态创建的 TTS 实例缓存（provider → 实例）。
        self._tts_overrides: dict[str, Any] = {}
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
        # 场景级静默超时覆盖（秒，按 call_id；来自 dialogRepair.silenceTimeoutMs）
        self._turn_timeout_overrides: dict[str, float] = {}

        # LLM 上下文滑动窗口（轮数，每轮≈user+assistant 两条；0=不限制）。
        # 长通话下全量历史会让 token 成本与生成延迟线性上涨，默认保留最近 20 轮。
        try:
            self._llm_history_window_turns = int(
                os.getenv("LLM_HISTORY_WINDOW_TURNS", "20")
            )
        except ValueError:
            logger.warning("invalid LLM_HISTORY_WINDOW_TURNS; using 20")
            self._llm_history_window_turns = 20

        # TTS 播放期间的 ASR 门控：
        # FreeSWITCH 当前回传音频可能包含 AI 自己的 TTS/扬声器回声。
        # 默认在 Agent 播放 TTS 时暂停向 ASR 送音频，并在 TTS 结束后保留一小段
        # 尾音保护窗口，避免把自己的声音识别成用户输入。
        # web 通道（浏览器自带 AEC）默认跳过该门控（asr_tts_gate_web_enabled=False），
        # 播报期间照常送 ASR，STT partial 即可语义级打断。
        self._asr_tts_gate_enabled = asr_tts_gate_enabled
        self._asr_tts_gate_web_enabled = asr_tts_gate_web_enabled
        self._asr_tts_echo_guard_enabled = asr_tts_echo_guard_enabled
        self._asr_tts_tail_guard_ms = max(0, asr_tts_tail_guard_ms)
        # Web 端原生 AEC 后的第二级残余回声门控。它使用实际下发的 TTS PCM
        # 作为远端参考，只丢弃高置信纯回声；双讲/不确定块始终原样送 VAD/ASR。
        self._aec_reference_gate_enabled = aec_reference_gate_enabled
        self._aec_reference_window_ms = min(10000, max(500, aec_reference_window_ms))
        self._aec_analysis_window_ms = min(
            500, max(80, aec_analysis_window_ms)
        )
        self._aec_min_analysis_ms = min(
            self._aec_analysis_window_ms, max(40, aec_min_analysis_ms)
        )
        self._aec_echo_correlation_threshold = min(
            1.0, max(0.0, aec_echo_correlation_threshold)
        )
        self._aec_echo_max_residual_ratio = max(0.0, aec_echo_max_residual_ratio)
        self._aec_near_end_min_snr_db = max(0.0, aec_near_end_min_snr_db)
        self._aec_min_rms = max(0.0, aec_min_rms)
        self._aec_double_talk_hangover_ms = min(
            5000, max(0, aec_double_talk_hangover_ms)
        )
        # 拖尾保护（TailGuard）兜底窗口：utterance 起始信号缺失时（首个 partial 丢失、
        # 短语只出 final），用「final 到达 - 本轮 speak 起始 < 窗口」判定拖尾。
        # 设 0 关闭兜底（此时仅靠 partial 起始信号判定）。
        self._asr_tail_guard_window_ms = max(0, asr_tail_guard_ms)
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
        # Identity token prevents a late provider callback/finally from an old
        # utterance from clearing state owned by a newer _speak invocation.
        self._speak_tokens: dict[str, object] = {}
        # Web echo guard reference: current TTS text plus a short post-playback
        # validity window, so a delayed ASR final cannot become the next answer.
        self._tts_reference_text: dict[str, str] = {}
        self._tts_reference_until: dict[str, float] = {}
        # Acoustic reference state is deliberately independent from the text
        # echo guard so either layer can be disabled without coupling lifetimes.
        self._echo_gates: dict[str, ReferenceEchoGate] = {}
        self._echo_reference_until: dict[str, float] = {}
        self._echo_reference_generation: dict[str, int] = {}
        self._echo_latest_analysis: dict[str, tuple[float, EchoAnalysis]] = {}
        self._echo_probe_logged: dict[str, tuple[float, str]] = {}
        self._echo_fail_open_until: dict[str, float] = {}
        self._echo_pending_audio: dict[str, bytearray] = {}
        # 拖尾保护：本轮 TTS 开口时刻（_speak 设 _speaking=True 时记）。
        self._speak_started_at: dict[str, float] = {}
        # 拖尾保护：本 ASR utterance 起始时刻（本句首个 partial 到达时记，
        # final/speech_start/speech_end 消费并清除）。缺失时走兜底窗口。
        self._utterance_started_at: dict[str, float] = {}
        # A partial can interrupt TTS before its matching final arrives. Keep
        # that utterance latched so the final cannot interrupt a new TTS turn.
        # The final is still buffered/consumed; only the duplicate transport
        # interruption is suppressed.
        self._partial_barge_in_active: set[str] = set()
        # call_id -> (the TTS reference pinned by a high-confidence echo
        # partial, peak similarity).  It survives speech_end until the matching
        # provider final, because FunASR emits final asynchronously afterwards.
        self._semantic_echo_evidence: dict[str, tuple[str, float]] = {}
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
        # 初始化 session。system prompt 末尾追加音色人设/沟通风格，
        # 主循环与流程 AI 话术节点共用这条 system 消息，话术语气随音色变化。
        from .voice_personas import build_voice_style_prompt

        system_content = fill_template(scenario.system_prompt, variables)
        style_prompt = build_voice_style_prompt(scenario)
        system_content += style_prompt
        if style_prompt:
            logger.info(
                "[VoiceAgent] call_id=%s 注入音色人设/风格段（voice=%s, %d 字）",
                call_id,
                (scenario.tts_config or {}).get("voice"),
                len(style_prompt),
            )
        system_msg = ChatMessage(role="system", content=system_content)
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
        # 场景级静默超时：配置了 silenceTimeoutMs 时覆盖全局 turn_timeout
        from .repair_phrases import RepairPhrases

        repair = RepairPhrases.from_config(getattr(scenario, "dialog_repair", None))
        if repair.silence_timeout_ms > 0:
            self._turn_timeout_overrides[call_id] = repair.silence_timeout_ms / 1000.0
        self._channels[call_id] = channel or "freeswitch"
        # Per-call detector: no model state or noise floor may leak between
        # callers. receive_audio also creates lazily to tolerate startup races.
        if channel == "web" and self._aec_reference_gate_enabled and not dry_run:
            self._get_echo_gate(call_id)
        if dry_run:
            self._dry_run[call_id] = True

        if flow_version:
            await self._run_flow(call_id, flow_version)
        else:
            # 未绑定流程的兼容模式：按内置场景运行。
            greeting = fill_template(scenario.greeting, variables)
            await self._speak(call_id, greeting)
            await self._conversation_loop(call_id)

        # 会话结束上报。用本地参数而非 _dry_run 字典：end_session 清理可能先于
        # 本协程执行到这里，字典条目已被 pop，回读会误把 dry_run 会话当真实通话上报。
        if not dry_run:
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
        - Edge: label + intentExamples 意图路由
        - Action: transfer/sms/crm/api 四类显式分发
        - End: complete vs hangup
        """
        from .flow_executor import FlowExecutor
        from .flow_types import TaskFlow as TaskFlowModel
        from .repair_phrases import RepairPhrases

        flow_model = TaskFlowModel.from_dict(flow)
        adapter = _FlowExecutorAdapter(self, call_id, dry_run=self._dry_run.get(call_id, False))
        # 场景级修复话术随场景配置下发；未配置时 RepairPhrases 用内置默认。
        scenario = self._scenario_configs.get(call_id)
        repair = RepairPhrases.from_config(
            getattr(scenario, "dialog_repair", None) if scenario else None
        )
        executor = FlowExecutor(flow_model, adapter, repair=repair)
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
        transport_error = ""

        async def on_event(event: LLMEvent) -> None:
            nonlocal full_reply, transport_error
            if event.type == "delta" and event.content:
                full_reply += event.content
            elif event.type == "tool_call" and event.tool_call:
                pending_tool_calls.append(event.tool_call)
            elif event.type == "error":
                transport_error = event.content or "provider error"

        await self._llm.chat(
            _trim_context_window(messages, self._llm_history_window_turns),
            tools,
            on_event,
        )
        if transport_error:
            raise RuntimeError(f"LLM generation failed: {transport_error}")

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
        transport_error = ""

        async def on_event(event: LLMEvent) -> None:
            nonlocal reply, transport_error
            if event.type == "delta" and event.content:
                reply += event.content
            elif event.type == "error":
                transport_error = event.content or "provider error"

        await self._llm.chat(
            _trim_context_window(messages, self._llm_history_window_turns),
            tools,
            on_event,
        )
        if transport_error:
            raise RuntimeError(f"LLM generation failed: {transport_error}")
        return reply

    async def _classify_dialog_turn(
        self,
        call_id: str,
        messages: list[ChatMessage],
        schema: dict[str, Any],
    ) -> dict[str, Any] | str:
        """Run the semantic turn router through a constrained tool call.

        Business conversation still uses the regular streaming generation path.
        Routing is different: advancing a flow is a control-plane decision, so
        providers that support function calling receive a strict schema. Text is
        retained only as a compatibility fallback for older providers.
        """
        if self._llm is None:
            return ""

        raw_text = ""
        tool_calls: list[ToolCall] = []
        transport_error = ""
        route_tool = ToolDefinition(
            name="route_dialog_turn",
            description=(
                "Classify the caller's latest utterance for the deterministic "
                "dialogue state machine. Always call this tool exactly once."
            ),
            parameters=schema,
            strict=True,
            required=True,
        )

        try:
            timeout_ms = int(os.getenv("DIALOG_ROUTER_TIMEOUT_MS", "4000"))
        except ValueError:
            timeout_ms = 4000
        timeout_ms = min(10_000, max(250, timeout_ms))

        structured_completion = getattr(self._llm, "complete_structured", None)
        if callable(structured_completion):
            try:
                return await asyncio.wait_for(
                    structured_completion(messages, route_tool),
                    timeout=timeout_ms / 1000,
                )
            except TimeoutError:
                logger.warning(
                    "[TurnRouter] call_id=%s provider=%s timeout_ms=%d",
                    call_id,
                    getattr(self._llm, "name", "unknown"),
                    timeout_ms,
                )
                raise

        async def on_event(event: LLMEvent) -> None:
            nonlocal raw_text, transport_error
            if event.type == "delta" and event.content:
                raw_text += event.content
            elif event.type == "error":
                transport_error = event.content or "provider error"
            elif event.type == "tool_call" and event.tool_call:
                tool_calls.append(event.tool_call)

        try:
            await asyncio.wait_for(
                self._llm.chat(messages, [route_tool], on_event),
                timeout=timeout_ms / 1000,
            )
        except TimeoutError:
            logger.warning(
                "[TurnRouter] call_id=%s provider=%s timeout_ms=%d",
                call_id,
                getattr(self._llm, "name", "unknown"),
                timeout_ms,
            )
            raise
        if transport_error:
            raise RuntimeError(f"dialog router transport failed: {transport_error}")
        if tool_calls:
            if len(tool_calls) == 1:
                call = tool_calls[0]
                if call.name == route_tool.name and isinstance(call.arguments, dict):
                    return dict(call.arguments)
            logger.warning(
                "[TurnRouter] call_id=%s provider=%s invalid_tool_calls=%s",
                call_id,
                getattr(self._llm, "name", "unknown"),
                [call.name for call in tool_calls],
            )
            return ""

        logger.info(
            "[TurnRouter] call_id=%s provider=%s structured_tool_missing "
            "fallback=text",
            call_id,
            getattr(self._llm, "name", "unknown"),
        )
        return raw_text

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
            if self._dry_run.get(call_id):
                timeout = None
            else:
                # 场景级静默超时（dialogRepair.silenceTimeoutMs）优先于全局默认
                timeout = self._turn_timeout_overrides.get(
                    call_id, self._turn_timeout_s
                )
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            return ""
        finally:
            self._endpoint_waiters.pop(call_id, None)

    def _resolve_tts(self, call_id: str, scenario: Optional[ScenarioConfig]) -> Any:
        """按场景 ttsConfig.provider 选择 TTS 实例。

        场景未指定 provider、或与默认实例一致时用默认实例（TTS_PROVIDER 环境变量创建）；
        否则按 provider 惰性创建并缓存。目标 provider 凭证缺失（工厂降级为 mock）时
        回退默认实例，避免真实通话被静默替换成无声 mock。
        """
        default = self._tts
        provider = ""
        if scenario:
            provider = str((scenario.tts_config or {}).get("provider") or "").strip().lower()
        if not provider or default is None:
            return default

        # 实例 name 与 provider 键的对齐（QwenTTS.name == "qwen-tts"）。
        default_provider = {"qwen-tts": "qwen"}.get(
            str(getattr(default, "name", "") or ""), str(getattr(default, "name", "") or "")
        )
        if provider == default_provider:
            return default

        cached = self._tts_overrides.get(provider)
        if cached is not None:
            return cached

        from .tts_factory import create_tts

        instance = create_tts(provider)
        if provider != "mock" and str(getattr(instance, "name", "")) == "mock":
            logger.warning(
                "[VoiceAgent] call_id=%s 场景要求 TTS provider=%s 但配置缺失，回退默认 %s",
                call_id,
                provider,
                default_provider,
            )
            instance = default
        else:
            logger.info(
                "[VoiceAgent] call_id=%s 按场景切换 TTS provider=%s", call_id, provider
            )
        self._tts_overrides[provider] = instance
        return instance

    async def _speak(self, call_id: str, text: str) -> None:
        """文本转语音并播放。支持 barge-in。"""
        callbacks = self._callbacks.get(call_id)
        if callbacks:
            await callbacks.on_agent_speech(text)

        if self._dry_run.get(call_id):
            return

        scenario = self._scenario_configs.get(call_id)
        tts = self._resolve_tts(call_id, scenario)
        if tts is None:
            return

        speak_token = object()
        self._speak_tokens[call_id] = speak_token
        self._speaking[call_id] = True
        echo_generation = self._begin_echo_reference(call_id)
        far_end_observer = None
        transport_supplies_reference = False
        if callbacks is not None and echo_generation is not None:
            set_observer = getattr(callbacks, "set_far_end_observer", None)
            if callable(set_observer):
                def far_end_observer(pcm: bytes) -> None:
                    self._add_echo_reference(
                        call_id, echo_generation, pcm, sample_rate=16000
                    )

                set_observer(far_end_observer)
                transport_supplies_reference = True
        if self._asr_tts_echo_guard_enabled:
            self._tts_reference_text[call_id] = text
            self._tts_reference_until.pop(call_id, None)
        # 拖尾保护：记录本轮开口时刻，用于判定后续 ASR 语音是否开始于开口之前。
        self._speak_started_at[call_id] = time.monotonic()
        self._asr_suppressed_until.pop(call_id, None)
        self._barge_in_voice_ms.pop(call_id, None)
        self._barge_in_low_ms.pop(call_id, None)
        self._barge_in_probe.pop(call_id, None)
        completed = False
        try:
            tts_chunks = 0
            tts_bytes = 0

            async def on_chunk(chunk: TTSChunk) -> None:
                nonlocal tts_chunks, tts_bytes
                # barge-in / overlapping generation: ignore late provider data.
                if (
                    not self._speaking.get(call_id)
                    or self._speak_tokens.get(call_id) is not speak_token
                ):
                    return
                if callbacks and chunk.audio:
                    tts_chunks += 1
                    tts_bytes += len(chunk.audio)
                    # WebSocketCallbacks supplies the reference at the exact
                    # paced-send boundary. Lightweight/test callbacks have no
                    # transport hook, so preserve a safe generation-time fallback.
                    if (
                        echo_generation is not None
                        and not transport_supplies_reference
                    ):
                        self._add_echo_reference(
                            call_id,
                            echo_generation,
                            chunk.audio,
                            sample_rate=chunk.sample_rate,
                        )
                    await callbacks.on_audio_output(chunk.audio)

            tts_config = scenario.tts_config if scenario else {}
            speaker = tts_config.get("voice")
            instruct_text = (
                tts_config.get("stylePrompt")
                or tts_config.get("style_prompt")
                or (scenario.communication_style_prompt if scenario else None)
            )
            await tts.synthesize(
                text,
                on_chunk,
                speaker=str(speaker) if speaker else None,
                instruct_text=str(instruct_text) if instruct_text else None,
            )
            if callbacks:
                await callbacks.on_audio_output_complete()
            completed = True
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
            if far_end_observer is not None and callbacks is not None:
                clear_observer = getattr(callbacks, "clear_far_end_observer", None)
                if callable(clear_observer):
                    clear_observer(far_end_observer)
                elif self._speak_tokens.get(call_id) is speak_token:
                    set_observer = getattr(callbacks, "set_far_end_observer", None)
                    if callable(set_observer):
                        set_observer(None)

            owns_speak_state = self._speak_tokens.get(call_id) is speak_token
            was_interrupted = (
                not completed
                or not self._speaking.get(call_id, False)
                or not owns_speak_state
            )
            if echo_generation is not None:
                if not was_interrupted:
                    self._arm_echo_reference_tail(call_id, echo_generation)
                else:
                    self._clear_echo_reference(
                        call_id,
                        generation=echo_generation,
                        discard_pending=True,
                    )
            if owns_speak_state:
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
                if self._asr_tts_echo_guard_enabled:
                    if was_interrupted:
                        self._tts_reference_text.pop(call_id, None)
                        self._tts_reference_until.pop(call_id, None)
                    else:
                        self._tts_reference_until[call_id] = (
                            time.monotonic() + self._asr_tts_tail_guard_ms / 1000
                        )
                self._speaking.pop(call_id, None)
                self._speak_tokens.pop(call_id, None)
                # 开口时刻随本轮播报结束失效，避免跨轮/跨测试泄漏。
                self._speak_started_at.pop(call_id, None)

    def _interrupt_speaking(self, call_id: str) -> None:
        """barge-in：用户开始说话时中断当前通话的 TTS 播放。

        The current pipeline finishes LLM generation before playback starts.
        Cancelling the shared LLM adapter here could therefore only cancel a
        different concurrent call, not the response being interrupted.
        """
        if not self._speaking.get(call_id):
            return
        self._speaking[call_id] = False
        # A real barge-in starts a near-end utterance. Invalidate the acoustic
        # reference immediately so delayed provider chunks cannot gate its tail.
        self._clear_echo_reference(call_id, discard_pending=True)
        # 打断 = 新用户回合开始：复位语义端点缓存（随后 partial 会写入本句最新文本）。
        self._reset_semantic_partial(call_id)
        if self._tts is not None:
            self._tts.interrupt()
        for override in self._tts_overrides.values():
            if override is not None and override is not self._tts:
                override.interrupt()
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

    def _get_echo_gate(self, call_id: str) -> Optional[ReferenceEchoGate]:
        """Return the per-call web acoustic gate, creating it lazily."""
        if (
            not self._aec_reference_gate_enabled
            or self._channels.get(call_id) != "web"
            or self._dry_run.get(call_id)
        ):
            return None
        gate = self._echo_gates.get(call_id)
        if gate is None:
            gate = ReferenceEchoGate(
                sample_rate=16000,
                reference_window_ms=self._aec_reference_window_ms,
                analysis_window_ms=self._aec_analysis_window_ms,
                min_analysis_ms=self._aec_min_analysis_ms,
                echo_correlation_threshold=self._aec_echo_correlation_threshold,
                echo_max_residual_ratio=self._aec_echo_max_residual_ratio,
                near_end_min_snr_db=self._aec_near_end_min_snr_db,
                min_rms=self._aec_min_rms,
            )
            self._echo_gates[call_id] = gate
        return gate

    def _begin_echo_reference(self, call_id: str) -> Optional[int]:
        """Start a new far-end reference generation for one TTS utterance."""
        gate = self._get_echo_gate(call_id)
        if gate is None:
            return None
        generation = self._echo_reference_generation.get(call_id, 0) + 1
        self._echo_reference_generation[call_id] = generation
        gate.reset_reference()
        self._echo_reference_until.pop(call_id, None)
        self._echo_latest_analysis.pop(call_id, None)
        self._echo_fail_open_until.pop(call_id, None)
        self._echo_pending_audio.pop(call_id, None)
        return generation

    def _add_echo_reference(
        self, call_id: str, generation: int, pcm: bytes, sample_rate: int = 16000
    ) -> None:
        """Append PCM only if it still belongs to the active TTS generation."""
        if self._echo_reference_generation.get(call_id) != generation:
            return
        gate = self._echo_gates.get(call_id)
        if gate is not None:
            gate.add_reference(pcm, sample_rate=sample_rate)

    def _clear_echo_reference(
        self,
        call_id: str,
        *,
        generation: Optional[int] = None,
        discard_pending: bool = False,
    ) -> None:
        """Invalidate late TTS callbacks and clear all active acoustic evidence."""
        current = self._echo_reference_generation.get(call_id, 0)
        if generation is not None and current != generation:
            return
        self._echo_reference_generation[call_id] = current + 1
        gate = self._echo_gates.get(call_id)
        if gate is not None:
            gate.reset_reference()
        self._echo_reference_until.pop(call_id, None)
        self._echo_latest_analysis.pop(call_id, None)
        self._echo_fail_open_until.pop(call_id, None)
        if discard_pending:
            self._echo_pending_audio.pop(call_id, None)

    def _arm_echo_reference_tail(self, call_id: str, generation: int) -> None:
        """Keep the completed TTS PCM briefly for delayed loudspeaker echo."""
        if self._echo_reference_generation.get(call_id) != generation:
            return
        gate = self._echo_gates.get(call_id)
        if (
            gate is None
            or gate.reference_samples <= 0
            or self._asr_tts_tail_guard_ms <= 0
        ):
            self._clear_echo_reference(call_id, generation=generation)
            return
        self._echo_reference_until[call_id] = (
            time.monotonic() + self._asr_tts_tail_guard_ms / 1000
        )

    def _active_echo_reference(self, call_id: str) -> Optional[ReferenceEchoGate]:
        """Return an active far-end PCM reference (during TTS or its tail)."""
        gate = self._echo_gates.get(call_id)
        if gate is None or gate.reference_samples <= 0:
            return None
        if self._speaking.get(call_id):
            return gate
        valid_until = self._echo_reference_until.get(call_id, 0.0)
        if time.monotonic() < valid_until:
            return gate
        self._clear_echo_reference(call_id)
        return None

    def _log_echo_analysis(
        self, call_id: str, analysis: EchoAnalysis, action: str
    ) -> None:
        """Rate-limited, privacy-safe acoustic calibration metrics."""
        now = time.monotonic()
        previous_at, previous_class = self._echo_probe_logged.get(
            call_id, (0.0, "")
        )
        if analysis.classification == previous_class and now - previous_at < 1.0:
            return
        self._echo_probe_logged[call_id] = (now, analysis.classification)
        offset_ms = (
            analysis.reference_offset_ms
            if analysis.reference_offset_ms is not None
            else -1.0
        )
        logger.info(
            "[EchoAcoustic] call_id=%s class=%s action=%s rms=%.4f "
            "noise=%.4f snr_db=%.1f corr=%.3f residual=%.3f "
            "gain=%.3f ref_offset_ms=%.1f window_ms=%.1f",
            call_id,
            analysis.classification,
            action,
            analysis.input_rms,
            analysis.noise_floor_rms,
            analysis.snr_db,
            analysis.correlation,
            analysis.residual_ratio,
            analysis.echo_gain,
            offset_ms,
            analysis.analyzed_ms,
        )

    def _should_drop_acoustic_echo(
        self, call_id: str, analysis: EchoAnalysis
    ) -> tuple[bool, str]:
        """Fuse acoustic classification with a double-talk/VAD fail-open latch."""
        now = time.monotonic()
        if analysis.classification in {"double_talk", "near_end"}:
            self._echo_fail_open_until[call_id] = max(
                self._echo_fail_open_until.get(call_id, 0.0),
                now + self._aec_double_talk_hangover_ms / 1000,
            )
        if not analysis.is_confident_echo:
            return False, "pass"

        vad = self._vads.get(call_id)
        vad_state = getattr(vad, "state", "silence") if vad is not None else "silence"
        if vad_state in {"pending", "speech", "speech_start"}:
            return False, f"pass_vad_{vad_state}"
        if now < self._echo_fail_open_until.get(call_id, 0.0):
            return False, "pass_double_talk_hangover"
        return True, "drop_confident_echo"

    def _reset_semantic_partial(self, call_id: str) -> None:
        """复位语义端点的 partial 缓存与日志去重（utterance 结束/打断/新 speech_start）。

        不复位会把上一句结尾状态（如报号码的数字尾）带进下一句，误延长下一句端点。
        """
        self._recent_partial.pop(call_id, None)
        self._semantic_extend_logged.discard(call_id)

    def _active_tts_reference(self, call_id: str) -> Optional[str]:
        """Return the web TTS text currently eligible for echo comparison."""
        if (
            not self._asr_tts_echo_guard_enabled
            or self._channels.get(call_id) != "web"
        ):
            return None
        reference = self._tts_reference_text.get(call_id)
        if not reference:
            return None
        if self._speaking.get(call_id):
            return reference
        valid_until = self._tts_reference_until.get(call_id, 0.0)
        if time.monotonic() < valid_until:
            return reference
        self._tts_reference_text.pop(call_id, None)
        self._tts_reference_until.pop(call_id, None)
        return None

    def _log_echo_guard(
        self,
        call_id: str,
        event_type: str,
        decision: str,
        similarity: float,
        text: str,
    ) -> None:
        logger.info(
            "[EchoGuard] call_id=%s type=%s decision=%s similarity=%.3f text=%s",
            call_id,
            event_type,
            decision,
            similarity,
            text,
        )

    def _classify_tail(
        self, call_id: str, utterance_started_at: Optional[float], event_time: float
    ) -> tuple[bool, str]:
        """判定当前 ASR 语音是否为「agent 本轮开口之前就已开始」的拖尾。

        仅在 agent 正在播报（_speaking=True）且本轮 speak 起始时刻存在时才可能判为拖尾；
        speak 起始缺失（如单测直接置 _speaking 而未走 _speak）时恒返回 False，保持既有打断语义。

        信号优先级：
          1) 本 utterance 起始时刻（首个 partial 到达时）<= 开口时刻 + epsilon → 拖尾；
             起始时刻晚于开口 = 开口后才开始说 = 真打断，返回 False。
          2) utterance 起始时刻缺失（首个 partial 丢失 / 短语只出 final）→ 兜底窗口：
             event 到达时刻 - 开口时刻 < ASR_TAIL_GUARD_MS 判为拖尾（窗口为 0 时关闭兜底）。
        返回 (is_tail, 判定依据文本，含真正决定判定的那个时间差)。
        """
        speak_at = self._speak_started_at.get(call_id)
        if speak_at is None:
            return False, ""
        epsilon = 0.05  # 50ms 容差：近乎同时开始也算拖尾
        if utterance_started_at is not None:
            if utterance_started_at <= speak_at + epsilon:
                lead_ms = int((speak_at - utterance_started_at) * 1000)
                return True, f"utterance 早于开口 {lead_ms}ms（partial 信号）"
            return False, ""
        # 兜底窗口：无 utterance 起始信号时才启用
        if self._asr_tail_guard_window_ms <= 0:
            return False, ""
        delta_ms = (event_time - speak_at) * 1000
        if delta_ms < self._asr_tail_guard_window_ms:
            return True, (
                f"final 距开口 {int(delta_ms)}ms < {self._asr_tail_guard_window_ms}ms（兜底窗）"
            )
        return False, ""

    def _merge_tail_into_last_user_message(self, call_id: str, text: str) -> None:
        """把拖尾文本合并进 session.messages 里最后一条 user 消息，保对话史完整。

        找不到 user 消息（理论上不该发生，流程会在消费用户语音后追加 user 消息）时，
        保守追加一条新的 user 消息，避免拖尾文本彻底丢失。
        """
        session = self._sessions.get(call_id)
        if not session:
            return
        for msg in reversed(session.messages):
            if msg.role == "user":
                msg.content = f"{msg.content} {text}".strip() if msg.content else text
                return
        session.messages.append(ChatMessage(role="user", content=text))

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
        if len(audio_bytes) % 2:
            logger.warning(
                "[VoiceAgent] call_id=%s drop malformed trailing PCM byte",
                call_id,
            )
            audio_bytes = audio_bytes[:-1]
        if not audio_bytes:
            return

        # Web endpoint AEC is the primary canceller. This reference-aware layer
        # catches only the residual blocks that are still almost completely
        # explained by the actual TTS PCM. All uncertain/double-talk audio is
        # fail-open and continues through the unchanged VAD/ASR path below.
        if (
            self._aec_reference_gate_enabled
            and self._channels.get(call_id) == "web"
        ):
            echo_gate = self._active_echo_reference(call_id)
            if echo_gate is not None:
                now = time.monotonic()
                vad = self._vads.get(call_id)
                vad_state = (
                    getattr(vad, "state", "silence")
                    if vad is not None
                    else "silence"
                )
                fail_open_active = (
                    now < self._echo_fail_open_until.get(call_id, 0.0)
                    or vad_state in {"pending", "speech", "speech_start"}
                )
                pending = self._echo_pending_audio.get(call_id)
                if fail_open_active:
                    if pending:
                        audio_bytes = bytes(pending) + audio_bytes
                        self._echo_pending_audio.pop(call_id, None)
                else:
                    if pending is None:
                        pending = bytearray()
                        self._echo_pending_audio[call_id] = pending
                    pending.extend(audio_bytes)
                    min_analysis_bytes = 16000 * 2 * self._aec_min_analysis_ms // 1000
                    analysis_window_bytes = (
                        16000 * 2 * self._aec_analysis_window_ms // 1000
                    )
                    if len(pending) < min_analysis_bytes:
                        # Hold at most the short acoustic warm-up window. If it
                        # proves to be near-end/double-talk, the complete prefix
                        # is flushed into VAD so no first phoneme is lost.
                        return
                    if (
                        echo_gate.reference_samples
                        < 16000 * self._aec_min_analysis_ms // 1000
                        and len(pending) < analysis_window_bytes
                    ):
                        # A slow/small first TTS chunk is not enough reference
                        # for a safe decision. Wait only to the bounded analysis
                        # window, then fail-open rather than holding indefinitely.
                        return
                    pending_audio = bytes(pending)
                    self._echo_pending_audio.pop(call_id, None)
                    # Never discard audio that was not actually analysed. A
                    # third-party client may send >200ms in one websocket frame;
                    # only the bounded suffix is eligible for echo removal.
                    prefix_audio = pending_audio[:-analysis_window_bytes]
                    analysis_audio = pending_audio[-analysis_window_bytes:]
                    try:
                        echo_analysis = echo_gate.analyze(analysis_audio)
                    except Exception:
                        logger.exception(
                            "[EchoAcoustic] call_id=%s analysis failed; fail-open",
                            call_id,
                        )
                        audio_bytes = pending_audio
                    else:
                        self._echo_latest_analysis[call_id] = (
                            time.monotonic(),
                            echo_analysis,
                        )
                        drop_echo, acoustic_action = self._should_drop_acoustic_echo(
                            call_id, echo_analysis
                        )
                        self._log_echo_analysis(
                            call_id, echo_analysis, acoustic_action
                        )
                        if drop_echo:
                            if not prefix_audio:
                                self._reset_vad(call_id)
                                return
                            audio_bytes = prefix_audio
                        else:
                            audio_bytes = pending_audio
            else:
                pending = self._echo_pending_audio.pop(call_id, None)
                if pending:
                    audio_bytes = bytes(pending) + audio_bytes
                # Learn only outside far-end playback and only while VAD is
                # idle; an asymmetric low-percentile tracker adds a second
                # defence against accidentally learning caller speech as noise.
                gate = self._get_echo_gate(call_id)
                vad = self._vads.get(call_id)
                vad_state = (
                    getattr(vad, "state", "silence")
                    if vad is not None
                    else "silence"
                )
                if gate is not None and vad_state == "silence":
                    try:
                        gate.observe_background(audio_bytes)
                    except Exception:
                        logger.exception(
                            "[EchoAcoustic] call_id=%s noise-floor update failed; "
                            "fail-open",
                            call_id,
                        )

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
            stt = create_stt_client(
                call_id=call_id,
                ws_url=self._funasr_ws_url,
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
                # 新 utterance 起说：复位上一句遗留的 partial 结尾状态与拖尾起始时刻。
                self._reset_semantic_partial(call_id)
                self._utterance_started_at.pop(call_id, None)
                # Bound provider state to one VAD utterance. This also clears
                # stale latches if a provider omitted the preceding final.
                self._partial_barge_in_active.discard(call_id)
                self._semantic_echo_evidence.pop(call_id, None)
                logger.info(
                    "[VAD] call_id=%s speech_start flush_ms=%d",
                    call_id,
                    getattr(vad, "last_flush_ms", 0),
                )
            elif state == "speech_end":
                # utterance 结束：清掉本句 partial 与拖尾起始时刻，避免带进下一句判定。
                self._reset_semantic_partial(call_id)
                self._utterance_started_at.pop(call_id, None)
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
            now = time.monotonic()
            # 记录本 utterance 起始时刻（首个 partial）。供拖尾判定与后续 final 兜底。
            if call_id not in self._utterance_started_at:
                self._utterance_started_at[call_id] = now
            if call_id in self._partial_barge_in_active:
                # This provider utterance already interrupted on an earlier
                # partial. Keep its latest text for semantic endpointing, but
                # never compare it with or interrupt a newly-started TTS turn.
                self._recent_partial[call_id] = event.text
                logger.info(
                    "[BargeIn] call_id=%s source=stt_partial "
                    "duplicate_same_utterance_suppressed",
                    call_id,
                )
                return
            echo_evidence = self._semantic_echo_evidence.get(call_id)
            reference = (
                echo_evidence[0]
                if echo_evidence is not None
                else self._active_tts_reference(call_id)
            )
            if reference:
                decision, similarity = _classify_tts_echo(
                    event.text, reference, is_final=False
                )
                if (
                    decision == "echo"
                    and similarity >= _ECHO_PARTIAL_LATCH_MIN_SIMILARITY
                ):
                    peak = max(
                        similarity,
                        echo_evidence[1] if echo_evidence is not None else 0.0,
                    )
                    self._semantic_echo_evidence[call_id] = (reference, peak)
                    echo_evidence = (reference, peak)
                elif (
                    echo_evidence is not None
                    and decision == "distinct"
                    and _should_hold_echo_latch(event.text, similarity)
                ):
                    decision = "echo_latched"
                self._log_echo_guard(
                    call_id, event.type, decision, similarity, event.text
                )
                if decision != "distinct":
                    return
                self._semantic_echo_evidence.pop(call_id, None)
            # 拖尾保护：agent 正在播报，且本 utterance 起始于开口之前 → 上一轮拖尾，
            # 不是对 agent 的打断。不打断、不写 _recent_partial（不污染下一句端点）。
            if self._speaking.get(call_id):
                is_tail, detail = self._classify_tail(
                    call_id, self._utterance_started_at.get(call_id), now
                )
                if is_tail:
                    logger.info(
                        "[TailGuard] call_id=%s partial 拖尾不打断 %s text=%s",
                        call_id,
                        detail,
                        event.text,
                    )
                    return
                # 用户开始说话 → barge-in
                logger.info(
                    "[BargeIn] call_id=%s channel=%s source=stt_partial barge_in",
                    call_id,
                    self._channels.get(call_id, "freeswitch"),
                )
            was_speaking = bool(self._speaking.get(call_id))
            self._interrupt_speaking(call_id)
            if was_speaking:
                self._partial_barge_in_active.add(call_id)
            # 记录本句最新 partial，供语义端点延长静音窗。必须在打断复位之后写，
            # 否则触发 barge-in 的这条 partial 会被 _interrupt_speaking 的复位清掉。
            self._recent_partial[call_id] = event.text
        elif event.type == "final":
            now = time.monotonic()
            interrupted_by_partial = call_id in self._partial_barge_in_active
            self._partial_barge_in_active.discard(call_id)
            echo_evidence = self._semantic_echo_evidence.pop(call_id, None)
            # 本 utterance 结束：消费并清除其起始时刻（无论是否退化/空，均不残留）。
            utterance_started_at = self._utterance_started_at.pop(call_id, None)
            echo_guard_distinct = False
            reference = (
                None
                if interrupted_by_partial
                else (
                    echo_evidence[0]
                    if echo_evidence is not None
                    else self._active_tts_reference(call_id)
                )
            )
            if event.text and reference:
                decision, similarity = _classify_tts_echo(
                    event.text, reference, is_final=True
                )
                if (
                    echo_evidence is not None
                    and decision == "distinct"
                    and _should_hold_echo_latch(event.text, similarity)
                ):
                    decision = "echo_latched"
                self._log_echo_guard(
                    call_id, event.type, decision, similarity, event.text
                )
                if decision != "distinct":
                    self._reset_semantic_partial(call_id)
                    return
                echo_guard_distinct = True
            if event.text and _is_degenerate_transcript(event.text):
                # 退化识别（回声/噪声幻觉）：既不落转写也不驱动对话，
                # 更不触发端点/打断，防止 agent 被自己的回声带偏。
                logger.info(
                    "[ASR] call_id=%s dropped degenerate final text=%s",
                    call_id,
                    event.text,
                )
                return
            # 拖尾保护：agent 正在播报，且这句语音开始于本轮开口之前 → 上一轮拖尾。
            # 不作为对当前问题的回答（不解析 waiter、不进 _injected_text、不打断），
            # 只合并进上一条 user 消息保对话史完整。须在 waiter 解析之前判定。
            if event.text and self._speaking.get(call_id):
                is_tail, detail = self._classify_tail(
                    call_id, utterance_started_at, now
                )
                # A final-only utterance normally falls back to the time-based
                # tail guard. Text that is positively distinct from current TTS
                # is stronger evidence and must remain eligible for barge-in.
                if interrupted_by_partial or (
                    echo_guard_distinct and utterance_started_at is None
                ):
                    is_tail = False
                if is_tail:
                    self._merge_tail_into_last_user_message(call_id, event.text)
                    logger.info(
                        "[TailGuard] call_id=%s final 拖尾合并入上轮 %s text=%s",
                        call_id,
                        detail,
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
                if self._speaking.get(call_id) and not interrupted_by_partial:
                    logger.info(
                        "[BargeIn] call_id=%s channel=%s source=stt_final barge_in",
                        call_id,
                        self._channels.get(call_id, "freeswitch"),
                    )
                buffered = self._injected_text.get(call_id)
                self._injected_text[call_id] = (
                    f"{buffered} {event.text}" if buffered else event.text
                )
                if interrupted_by_partial:
                    if self._speaking.get(call_id):
                        logger.info(
                            "[BargeIn] call_id=%s source=stt_final "
                            "duplicate_same_utterance_suppressed",
                            call_id,
                        )
                else:
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
        self._speak_tokens.pop(call_id, None)
        self._tts_reference_text.pop(call_id, None)
        self._tts_reference_until.pop(call_id, None)
        self._echo_gates.pop(call_id, None)
        self._echo_reference_until.pop(call_id, None)
        self._echo_reference_generation.pop(call_id, None)
        self._echo_latest_analysis.pop(call_id, None)
        self._echo_probe_logged.pop(call_id, None)
        self._echo_fail_open_until.pop(call_id, None)
        self._echo_pending_audio.pop(call_id, None)
        self._speak_started_at.pop(call_id, None)
        self._utterance_started_at.pop(call_id, None)
        self._partial_barge_in_active.discard(call_id)
        self._semantic_echo_evidence.pop(call_id, None)
        self._channels.pop(call_id, None)
        self._asr_suppressed_until.pop(call_id, None)
        self._asr_gate_logged.discard(call_id)
        self._barge_in_voice_ms.pop(call_id, None)
        self._barge_in_low_ms.pop(call_id, None)
        self._barge_in_probe.pop(call_id, None)
        self._dry_run.pop(call_id, None)
        self._turn_timeout_overrides.pop(call_id, None)

    async def close(self) -> None:
        """关闭所有共享资源（应用退出时调用）。"""
        await self._rag.close()
        await self._tools.close()
        await self._tasks.close()
        if self._llm:
            await self._llm.close()
        if self._tts:
            await self._tts.close()
        for override in self._tts_overrides.values():
            if override is not None and override is not self._tts:
                await override.close()
        self._tts_overrides.clear()


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
        session = self._agent._sessions.get(call_id)
        scenario = self._agent._scenario_configs.get(call_id)
        query = next(
            (
                message.content
                for message in reversed(messages)
                if message.role == "user" and message.content.strip()
            ),
            "",
        )
        if session and scenario and query:
            rag_context = await self._agent._rag.retrieve(
                scenario,
                query,
                tenant_id=session.tenant_id,
                user_id=session.user_id,
            )
            messages = self._agent._append_rag_context(messages, rag_context)
        return await self._agent._generate_reply(call_id, messages, tools or [])

    async def generate_llm_text(
        self, call_id: str, messages: list[ChatMessage], options: dict = None
    ) -> str:
        return await self._agent._generate_llm_text(call_id, messages, [])

    async def classify_dialog_turn(
        self,
        call_id: str,
        messages: list[ChatMessage],
        schema: dict[str, Any],
    ) -> dict[str, Any] | str:
        return await self._agent._classify_dialog_turn(call_id, messages, schema)

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
