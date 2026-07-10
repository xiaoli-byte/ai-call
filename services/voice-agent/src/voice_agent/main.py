"""Voice Agent 入口 - WebSocket 模式（默认）/ CLI 模式（--cli 参数）。

WebSocket 模式：监听 ws://0.0.0.0:8090/audio-stream，接收 FreeSWITCH mod_audio_fork 连接
CLI 模式：终端模拟对话，跳过 STT/TTS，直接注入文本到对话循环

环境变量见项目根 .env。LLM_API_KEY / COSYVOICE_BASE_URL 为空时自动降级到 Mock provider。
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from .agent import VoiceAgent
from .llm import create_llm
from .rag import RagService
from .scenarios import DEFAULT_VARIABLES, SCENARIO_CONFIGS
from .server import VoiceAgentServer
from .tasks import TaskClient
from .tools import ToolDispatcher
from .tts_factory import create_tts
from .types import Scenario, ToolCall, ToolResult

logger = logging.getLogger(__name__)


def _load_env() -> None:
    """从项目根目录加载 .env 并配置日志。"""
    project_root = Path(__file__).resolve().parents[4]
    load_dotenv(project_root / '.env')
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


def _env_bool(name: str, default: bool = False) -> bool:
    """读取布尔环境变量。"""
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _build_agent() -> tuple[VoiceAgent, TaskClient, Any]:
    """根据环境变量构造 VoiceAgent 实例。

    返回 (agent, tasks, demo) 元组：
    - tasks 复用给 server.py 避免重复创建 httpx 连接池
    - demo 为 DemoServer 实例（/asr-stream + /tts-stream），共享 agent 的 VAD/STT/TTS 配置
    """
    api_base_url = os.getenv("API_BASE_URL", "http://localhost:3001/api")

    # LLM：根据 LLM_PROVIDER 环境变量选择适配器（deepseek/qwen/mock/legacy）
    llm: Any = create_llm()
    logger.info("LLM provider: %s", llm.name)

    # TTS：根据 TTS_PROVIDER 环境变量选择（qwen/cosyvoice/mock）
    tts: Any = create_tts()
    logger.info("TTS provider: %s", tts.name)

    # 共享的 TaskClient（server.py 与 agent.py 复用同一实例）
    tasks = TaskClient(api_base_url)

    funasr_ws_url = os.getenv("FUNASR_WS_URL", "ws://localhost:10095")
    funasr_mode = os.getenv("FUNASR_MODE", "2pass")
    funasr_hotwords = os.getenv("FUNASR_HOTWORDS", "")
    vad_aggressiveness = int(os.getenv("VAD_AGGRESSIVENESS", "3"))
    vad_frame_ms = int(os.getenv("VAD_FRAME_MS", "20"))
    vad_pre_buffer_ms = int(os.getenv("VAD_PRE_BUFFER_MS", "300"))
    vad_silence_confirm = int(os.getenv("VAD_SILENCE_CONFIRM_FRAMES", "28"))
    vad_speech_confirm = int(os.getenv("VAD_SPEECH_CONFIRM_FRAMES", "3"))
    vad_min_speech_ms = int(os.getenv("VAD_MIN_SPEECH_MS", "200"))
    asr_tts_gate_enabled = _env_bool("ASR_TTS_GATE_ENABLED", True)
    asr_tts_gate_web_enabled = _env_bool("ASR_TTS_GATE_WEB_ENABLED", False)
    asr_tts_tail_guard_ms = int(os.getenv("ASR_TTS_TAIL_GUARD_MS", "500"))
    barge_in_during_tts_enabled = _env_bool("BARGE_IN_DURING_TTS_ENABLED", True)
    barge_in_min_ms = int(os.getenv("BARGE_IN_MIN_MS", "500"))
    barge_in_rms_threshold = float(os.getenv("BARGE_IN_RMS_THRESHOLD", "0.08"))

    agent = VoiceAgent(
        llm=llm,
        tts=tts,
        rag=RagService(api_base_url),
        tools=ToolDispatcher(api_base_url),
        tasks=tasks,
        funasr_ws_url=funasr_ws_url,
        funasr_mode=funasr_mode,
        funasr_hotwords=funasr_hotwords,
        vad_aggressiveness=vad_aggressiveness,
        vad_frame_ms=vad_frame_ms,
        vad_pre_buffer_ms=vad_pre_buffer_ms,
        vad_silence_confirm_frames=vad_silence_confirm,
        vad_speech_confirm_frames=vad_speech_confirm,
        vad_min_speech_ms=vad_min_speech_ms,
        max_turns=int(os.getenv("MAX_TURNS", "30")),
        turn_timeout_s=int(os.getenv("TURN_TIMEOUT_S", "30")),
        asr_tts_gate_enabled=asr_tts_gate_enabled,
        asr_tts_gate_web_enabled=asr_tts_gate_web_enabled,
        asr_tts_tail_guard_ms=asr_tts_tail_guard_ms,
        barge_in_during_tts_enabled=barge_in_during_tts_enabled,
        barge_in_min_ms=barge_in_min_ms,
        barge_in_rms_threshold=barge_in_rms_threshold,
    )

    # 构造 DemoServer（/asr-stream + /tts-stream），共享 agent 的 VAD/STT/TTS 配置
    from .demo_server import DemoServer

    demo: Any = DemoServer(
        funasr_ws_url=funasr_ws_url,
        funasr_mode=funasr_mode,
        funasr_hotwords=funasr_hotwords,
        vad_aggressiveness=vad_aggressiveness,
        vad_frame_ms=vad_frame_ms,
        vad_pre_buffer_ms=vad_pre_buffer_ms,
        vad_silence_confirm_frames=vad_silence_confirm,
        vad_speech_confirm_frames=vad_speech_confirm,
        tts=tts,
    )

    return agent, tasks, demo


async def ws_main() -> None:
    """WebSocket 模式 - 接收 FreeSWITCH mod_audio_fork 连接 + Demo 端点。"""
    agent, tasks, demo = _build_agent()
    # 空字符串/未设置 → None（asyncio 绑定所有接口，IPv4 + IPv6 双栈）
    host = os.getenv("VOICE_AGENT_WS_HOST") or None
    port = int(os.getenv("VOICE_AGENT_WS_PORT", "8080"))
    path = os.getenv("VOICE_AGENT_WS_PATH", "/audio-stream")

    server = VoiceAgentServer(host, port, path, agent, tasks, demo_server=demo)
    logger.info("Voice Agent 启动（WebSocket 模式，含 Demo 端点）")
    try:
        await server.start()
    finally:
        await agent.close()


async def cli_main() -> None:
    """CLI 模式 - 终端模拟对话，跳过 STT/TTS 音频播放。"""
    agent, _tasks, _demo = _build_agent()

    # 1) 选场景
    print("\n===== Python Voice Agent CLI =====")
    print("\n可选场景：")
    scenarios = list(Scenario)
    for i, s in enumerate(scenarios):
        cfg = SCENARIO_CONFIGS[s]
        print(f"  {i + 1}. {cfg.name} - {cfg.description}")
    choice = input("\n选择场景 [1-3，默认 2]: ").strip() or "2"
    try:
        scenario_enum = scenarios[int(choice) - 1]
    except (ValueError, IndexError):
        scenario_enum = Scenario.ECOMMERCE

    scenario_config = SCENARIO_CONFIGS[scenario_enum]
    variables = dict(DEFAULT_VARIABLES)

    call_id = f"cli-{int(time.time())}"
    callbacks = CLICallbacks()

    print(f"\n启动 CLI 会话 call_id={call_id}")
    print("输入 'quit' 或 'exit' 退出\n")

    # 2) 后台启动 agent 会话（greeting → 对话循环）
    session_task = asyncio.create_task(
        agent.start_session(call_id, scenario_config, variables, callbacks)
    )

    # 3) 主输入循环
    loop = asyncio.get_event_loop()
    try:
        while not session_task.done():
            try:
                # 把阻塞的 input() 转为可 await，不阻塞事件循环
                user_input = await loop.run_in_executor(None, input, "你> ")
            except EOFError:
                break
            if user_input.strip().lower() in ("quit", "exit"):
                break
            if user_input.strip():
                await agent.inject_user_text(call_id, user_input)
    finally:
        await agent.end_session(call_id)
        if not session_task.done():
            session_task.cancel()
            try:
                await session_task
            except (asyncio.CancelledError, Exception):
                pass
        await agent.close()
        print("\n会话已结束")


class CLICallbacks:
    """CLI 模式 callbacks - 打印到终端，不上报 transcript。"""

    async def on_agent_speech(self, text: str) -> None:
        print(f"\n🤖 {text}")

    async def on_caller_speech(self, text: str) -> None:
        print(f"👤 {text}")

    async def on_tool_call(self, call: ToolCall, result: ToolResult) -> None:
        print(f"🔧 {call.name} → {result.result}")

    async def on_escalate(self, reason: str, extension: str | None = None) -> None:
        target = f" -> {extension}" if extension else ""
        print(f"⚠️ 转人工{target}: {reason}")

    async def on_audio_output(self, audio: bytes) -> None:
        pass  # CLI 不播放音频

    async def on_audio_output_complete(self) -> None:
        pass

    async def on_node_enter(self, node_id: str, node_name: str) -> None:
        print(f"[Node] → {node_name} ({node_id})")

    async def on_action(self, action_type: str, config: dict) -> None:
        print(f"[Action] {action_type}: {config} (调试模式未真实执行)")

    async def on_end(self, reason: str) -> None:
        print(f"\n📞 {reason}")


def main() -> None:
    """入口 - 默认 WebSocket 模式，--cli 切换 CLI 模式。"""
    _load_env()
    parser = argparse.ArgumentParser(description="Python Voice Agent")
    parser.add_argument(
        "--cli", action="store_true", help="CLI 模式（终端对话，跳过 STT/TTS）"
    )
    args = parser.parse_args()

    if args.cli:
        asyncio.run(cli_main())
    else:
        asyncio.run(ws_main())


def cli_main_entry() -> None:
    """pyproject.toml console script 入口：voice-agent-cli。"""
    _load_env()
    asyncio.run(cli_main())


if __name__ == "__main__":
    main()
