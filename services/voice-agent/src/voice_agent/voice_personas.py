"""音色人设：把所选 TTS 音色对应的人设注入 LLM system prompt。

话术文本与音色本是两条独立链路（LLM 生成文本、TTS 负责发声），此模块
在会话启动时把音色人设/身份/沟通风格拼进 system prompt，使生成的话术
语气与所选音色匹配。
"""

from __future__ import annotations

from .types import ScenarioConfig

# 内置音色的默认人设，与 apps/dashboard/lib/tts-voices.ts 的注册表保持同步。
# 仅作兜底：dashboard 保存场景时会把人设写入 ttsConfig.voicePersona，
# 历史数据没有该字段时按音色名回退到这里。
BUILTIN_VOICE_PERSONAS: dict[str, str] = {
    "Cherry": "年轻女性声线，吐字清晰、语气自然干练，表达直接利落，适度使用礼貌用语。",
    "Serena": "成熟女性声线，语气温柔耐心、节奏舒缓，多用安抚性和商量式的措辞。",
    "Ethan": "成熟男性声线，语气沉稳可靠、用词严谨专业，给人值得信赖的感觉。",
    "Chelsie": "年轻女性声线，语气明快有活力、亲切热情，措辞轻松但不失分寸。",
}


def resolve_voice_persona(scenario: ScenarioConfig) -> str:
    """取音色人设：优先场景 ttsConfig.voicePersona，缺失时按音色名回退内置表。"""
    tts_config = scenario.tts_config or {}
    persona = str(tts_config.get("voicePersona") or "").strip()
    if persona:
        return persona
    voice = str(tts_config.get("voice") or "").strip()
    return BUILTIN_VOICE_PERSONAS.get(voice, "")


def build_voice_style_prompt(scenario: ScenarioConfig) -> str:
    """组装追加到 system prompt 末尾的语气/人设段落；无任何设定时返回空串。"""
    parts: list[str] = []
    persona = resolve_voice_persona(scenario)
    if persona:
        parts.append(f"你的声音人设：{persona}")
    identity = (scenario.agent_identity or "").strip()
    if identity:
        parts.append(f"你的身份：{identity}")
    style = (scenario.communication_style_prompt or scenario.communication_style or "").strip()
    if style:
        parts.append(f"沟通风格：{style}")
    if not parts:
        return ""
    lines = "\n".join(f"- {part}" for part in parts)
    return (
        "\n\n【语气与人设】你说出的每一句话都会以上述音色朗读给客户，"
        "措辞和语气必须符合以下设定：\n" + lines
    )
