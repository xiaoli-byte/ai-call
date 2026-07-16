"""场景级对话修复话术配置。

镜像 packages/shared/src/scenarios.ts 的 DialogRepairConfig：所有字段可选，
未配置时使用内置默认（与历史硬编码文案一致，保证行为零漂移）。运行时把
``{question}`` 占位符替换为当前节点未答的问题话术。

设计约束：
- 本模块只承载「说什么」，不承载「什么时候说」——修复策略（轮次、状态机）
  仍在 flow_executor；话术模板不参与任何语义判定。
- 模板含 ``{question}`` 但当前无问题话术可复读时（节点没有配置提示文本的
  退化场景），回退到内置的无问句变体，避免渲染出残缺句。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, fields
from typing import Any, Mapping

logger = logging.getLogger(__name__)

BRIDGE_NATURAL = "natural"
BRIDGE_TEMPLATE = "template"

ACTION_HANGUP = "hangup"
ACTION_TRANSFER = "transfer"

# python 字段 -> 场景配置（camelCase）键（字符串类字段）
_WIRE_KEYS = {
    "no_input_prompt": "noInputPrompt",
    "no_input_give_up_prompt": "noInputGiveUpPrompt",
    "no_match_prompt": "noMatchPrompt",
    "no_match_give_up_prompt": "noMatchGiveUpPrompt",
    "repeat_ack_prompt": "repeatAckPrompt",
    "hold_ack_prompt": "holdAckPrompt",
    "question_request_ack_prompt": "questionRequestAckPrompt",
    "stt_retry_prompt": "sttRetryPrompt",
    "stt_give_up_prompt": "sttGiveUpPrompt",
    "side_question_fallback_prompt": "sideQuestionFallbackPrompt",
    "side_question_defer_prompt": "sideQuestionDeferPrompt",
    "side_question_bridge": "sideQuestionBridge",
    "side_question_bridge_template": "sideQuestionBridgeTemplate",
    "side_question_resume_prompt": "sideQuestionResumePrompt",
    "silence_prompt": "silencePrompt",
    "silence_action": "silenceAction",
    "silence_transfer_prompt": "silenceTransferPrompt",
}

# python 字段 -> 场景配置键（整数类字段：0 表示未配置、跟随系统默认）+ 合法区间
_INT_WIRE_KEYS = {
    "silence_timeout_ms": ("silenceTimeoutMs", 1000, 600000),
    "max_silence_rounds": ("maxSilenceRounds", 1, 10),
}

# 模板含 {question} 但问题话术为空时的无问句变体（不可配置的退化兜底）。
_BARE_FALLBACKS = {
    "no_input_prompt": "抱歉，我没有听到您的回答，请您再说一次。",
    "no_match_prompt": "抱歉，我还没理解，请您换一种方式再说一次。",
    "repeat_ack_prompt": "好的，请您继续说。",
    "side_question_bridge_template": "",
}


@dataclass(frozen=True, slots=True)
class RepairPhrases:
    """对话修复话术集。字段默认值即内置文案。"""

    no_input_prompt: str = "抱歉，我没有听到您的回答。{question}"
    no_input_give_up_prompt: str = "暂时没有听到您的回答，我们稍后再联系您。"
    no_match_prompt: str = "抱歉，我还没理解您的回答。{question}"
    no_match_give_up_prompt: str = "抱歉，我暂时无法确认您的回答，我们稍后再联系您。"
    repeat_ack_prompt: str = "好的，我再说一遍。{question}"
    hold_ack_prompt: str = "好的，您请说。"
    question_request_ack_prompt: str = "好的，您请说。"
    stt_retry_prompt: str = "语音服务刚才有些延迟，请您再说一次。"
    stt_give_up_prompt: str = "语音服务暂时无法完成识别，我们稍后再联系您。"
    side_question_fallback_prompt: str = "这部分我需要帮您确认后回复。"
    side_question_defer_prompt: str = "这个问题我暂时无法确认，我们先继续刚才的流程。"
    side_question_bridge: str = BRIDGE_NATURAL
    side_question_bridge_template: str = "回到刚才的问题，{question}"
    # natural 模式「插话后回到流程」提示词：AI 答完插话后按此提示带回主流程
    side_question_resume_prompt: str = (
        "回答后，用口语自然地把对话带回主流程中客户尚未回答的问题：「{question}」。"
        "衔接要顺滑，保持该问题的原意，但不要逐字照抄，"
        "也不要使用『回到刚才的问题』这类生硬转折。"
    )
    # ---- 静默配置组 ----
    # 静默追问提示词：静默超时后 AI 按此提示生成追问（LLM 生成，非固定文案）
    silence_prompt: str = "- 复述上一轮对话的内容\n- 保证上下文自然衔接"
    # 静默超时（毫秒）：0 = 跟随系统 TURN_TIMEOUT_S（默认 6 秒），仅显式配置时覆盖
    silence_timeout_ms: int = 0
    # 连续静默轮数上限：0 = 跟随 DIALOG_ROUTER_MAX_NO_INPUT / 节点 retryCount
    max_silence_rounds: int = 0
    # 静默超限动作：hangup=礼貌挂机；transfer=转人工
    silence_action: str = ACTION_HANGUP
    silence_transfer_prompt: str = "请稍等，正在为您转接人工客服。"

    @classmethod
    def from_config(cls, config: Mapping[str, Any] | None) -> "RepairPhrases":
        """从场景配置的 dialogRepair 字段构造；非法值告警并回退默认。"""
        if not config:
            return cls()
        overrides: dict[str, Any] = {}
        for field_name, wire_key in _WIRE_KEYS.items():
            raw = config.get(wire_key)
            if raw is None:
                continue
            if not isinstance(raw, str) or not raw.strip():
                logger.warning(
                    "[RepairPhrases] 忽略非法配置 %s=%r（需非空字符串）", wire_key, raw
                )
                continue
            overrides[field_name] = raw.strip()
        for field_name, (wire_key, minimum, maximum) in _INT_WIRE_KEYS.items():
            raw = config.get(wire_key)
            if raw is None:
                continue
            if (
                isinstance(raw, bool)
                or not isinstance(raw, (int, float))
                or int(raw) != raw
                or not minimum <= int(raw) <= maximum
            ):
                logger.warning(
                    "[RepairPhrases] 忽略非法配置 %s=%r（需 %d-%d 整数）",
                    wire_key,
                    raw,
                    minimum,
                    maximum,
                )
                continue
            overrides[field_name] = int(raw)
        bridge = overrides.get("side_question_bridge")
        if bridge is not None and bridge not in (BRIDGE_NATURAL, BRIDGE_TEMPLATE):
            logger.warning(
                "[RepairPhrases] 忽略非法 sideQuestionBridge=%r（natural|template）",
                bridge,
            )
            overrides.pop("side_question_bridge")
        action = overrides.get("silence_action")
        if action is not None and action not in (ACTION_HANGUP, ACTION_TRANSFER):
            logger.warning(
                "[RepairPhrases] 忽略非法 silenceAction=%r（hangup|transfer）", action
            )
            overrides.pop("silence_action")
        return cls(**overrides)

    def render(self, field_name: str, question: str = "") -> str:
        """渲染指定话术，替换 {question} 占位符。

        问题话术为空而模板依赖占位符时回退到无问句变体，保证输出是完整句子。
        """
        template = getattr(self, field_name)
        if "{question}" not in template:
            return template
        question = question.strip()
        if question:
            return template.replace("{question}", question)
        bare = _BARE_FALLBACKS.get(field_name)
        if bare is not None:
            return bare
        return template.replace("{question}", "").strip()


# 校验 wire 映射与 dataclass 字段一一对应（import 时即失败，防止漂移）
assert {f.name for f in fields(RepairPhrases)} == (
    set(_WIRE_KEYS) | set(_INT_WIRE_KEYS)
), "RepairPhrases 字段与 wire 映射不一致"

__all__ = [
    "ACTION_HANGUP",
    "ACTION_TRANSFER",
    "BRIDGE_NATURAL",
    "BRIDGE_TEMPLATE",
    "RepairPhrases",
]
