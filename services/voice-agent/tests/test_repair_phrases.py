"""场景级修复话术配置（repair_phrases）单测。"""

from voice_agent.repair_phrases import (
    BRIDGE_NATURAL,
    BRIDGE_TEMPLATE,
    RepairPhrases,
)


def test_defaults_match_legacy_wording() -> None:
    """未配置时默认文案与历史硬编码一致（行为零漂移）。"""
    phrases = RepairPhrases()
    assert phrases.render("no_input_prompt", "您方便吗？") == (
        "抱歉，我没有听到您的回答。您方便吗？"
    )
    assert phrases.render("no_input_prompt") == "抱歉，我没有听到您的回答，请您再说一次。"
    assert phrases.render("no_match_prompt") == "抱歉，我还没理解，请您换一种方式再说一次。"
    assert phrases.render("repeat_ack_prompt", "哪天方便？") == "好的，我再说一遍。哪天方便？"
    assert phrases.render("repeat_ack_prompt") == "好的，请您继续说。"
    assert phrases.render("hold_ack_prompt") == "好的，您请说。"
    assert phrases.side_question_bridge == BRIDGE_NATURAL


def test_from_config_overrides_and_placeholder() -> None:
    phrases = RepairPhrases.from_config(
        {
            "noInputPrompt": "没听清呢，{question}",
            "sideQuestionBridge": "template",
            "sideQuestionBridgeTemplate": "咱们继续：{question}",
        }
    )
    assert phrases.render("no_input_prompt", "哪天方便？") == "没听清呢，哪天方便？"
    assert phrases.side_question_bridge == BRIDGE_TEMPLATE
    assert phrases.render("side_question_bridge_template", "哪天方便？") == (
        "咱们继续：哪天方便？"
    )
    # 未覆盖字段保持默认
    assert phrases.render("hold_ack_prompt") == "好的，您请说。"


def test_from_config_rejects_invalid_values() -> None:
    """非法值忽略并回退默认，不抛异常（配置错误不能打断通话）。"""
    phrases = RepairPhrases.from_config(
        {
            "noInputPrompt": "   ",
            "holdAckPrompt": 123,
            "sideQuestionBridge": "magic",
        }
    )
    assert phrases == RepairPhrases()


def test_from_config_none_and_empty() -> None:
    assert RepairPhrases.from_config(None) == RepairPhrases()
    assert RepairPhrases.from_config({}) == RepairPhrases()


def test_silence_config_parsing() -> None:
    phrases = RepairPhrases.from_config(
        {
            "silencePrompt": "- 提醒客户还在线\n- 重复问题",
            "silenceTimeoutMs": 8000,
            "maxSilenceRounds": 3,
            "silenceAction": "transfer",
            "silenceTransferPrompt": "马上为您转人工。",
        }
    )
    assert phrases.silence_prompt == "- 提醒客户还在线\n- 重复问题"
    assert phrases.silence_timeout_ms == 8000
    assert phrases.max_silence_rounds == 3
    assert phrases.silence_action == "transfer"
    assert phrases.render("silence_transfer_prompt") == "马上为您转人工。"


def test_silence_config_defaults_keep_two_behaviors() -> None:
    """未配置时默认提示词仍要求复述上一轮 + 自然衔接。"""
    phrases = RepairPhrases()
    assert "复述上一轮" in phrases.silence_prompt
    assert "自然衔接" in phrases.silence_prompt
    assert phrases.silence_timeout_ms == 0  # 0 = 跟随系统 TURN_TIMEOUT_S（默认 6 秒）
    assert phrases.max_silence_rounds == 0
    assert phrases.silence_action == "hangup"


def test_side_question_resume_prompt_configurable() -> None:
    """natural 承接提示词可配置，默认禁止生硬转折并携带问题原文。"""
    default = RepairPhrases()
    rendered = default.render("side_question_resume_prompt", "哪天方便安装？")
    assert "哪天方便安装？" in rendered
    assert "回到刚才的问题" in rendered  # 默认提示词里作为反例提及
    custom = RepairPhrases.from_config(
        {"sideQuestionResumePrompt": "简短回答后提醒客户：{question}"}
    )
    assert custom.render("side_question_resume_prompt", "哪天方便？") == (
        "简短回答后提醒客户：哪天方便？"
    )


def test_side_question_ack_three_states() -> None:
    """插话应答过渡语三态：键不存在=默认 / 有值=生效 / 键存在且空串=显式禁用。"""
    # 键不存在：使用内置默认过渡语
    assert RepairPhrases.from_config({}).render("side_question_ack") == (
        "好的，稍等哈，我帮您看一下。"
    )
    # 有值：按场景配置生效
    custom = RepairPhrases.from_config({"sideQuestionAck": "稍等，我马上帮您查。"})
    assert custom.render("side_question_ack") == "稍等，我马上帮您查。"
    # 键存在且为空串（strip 后空）：显式禁用，保留 ""（插话时不播过渡语）
    disabled = RepairPhrases.from_config({"sideQuestionAck": ""})
    assert disabled.render("side_question_ack") == ""
    blank = RepairPhrases.from_config({"sideQuestionAck": "   "})
    assert blank.render("side_question_ack") == ""
    # 非字符串仍属非法值：回退默认而非禁用
    invalid = RepairPhrases.from_config({"sideQuestionAck": 123})
    assert invalid.render("side_question_ack") == "好的，稍等哈，我帮您看一下。"
    # 禁用语义只对 sideQuestionAck 开特例，其他字段空白仍回退默认
    others = RepairPhrases.from_config({"holdAckPrompt": "   "})
    assert others.render("hold_ack_prompt") == "好的，您请说。"


def test_silence_config_rejects_invalid_values() -> None:
    """越界数字、非整数、非法枚举一律回退默认。"""
    phrases = RepairPhrases.from_config(
        {
            "silenceTimeoutMs": 500,        # < 1000 越界
            "maxSilenceRounds": 99,         # > 10 越界
            "silenceAction": "explode",     # 非法枚举
        }
    )
    assert phrases.silence_timeout_ms == 0
    assert phrases.max_silence_rounds == 0
    assert phrases.silence_action == "hangup"
    boolish = RepairPhrases.from_config({"silenceTimeoutMs": True, "maxSilenceRounds": 2.5})
    assert boolish.silence_timeout_ms == 0
    assert boolish.max_silence_rounds == 0
