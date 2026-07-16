"""LLM 上下文滑动窗口（_trim_context_window）单测。"""

from voice_agent.agent import _trim_context_window
from voice_agent.types import ChatMessage, ToolCall


def _dialog(turns: int) -> list[ChatMessage]:
    """构造 system + turns 轮 user/assistant 交替历史。"""
    messages = [ChatMessage(role="system", content="系统人设")]
    for index in range(turns):
        messages.append(ChatMessage(role="user", content=f"用户第{index}句"))
        messages.append(ChatMessage(role="assistant", content=f"回复第{index}句"))
    return messages


def test_under_window_returns_unchanged() -> None:
    messages = _dialog(5)
    assert _trim_context_window(messages, 20) is messages


def test_zero_disables_trimming() -> None:
    messages = _dialog(50)
    assert _trim_context_window(messages, 0) is messages


def test_trims_to_recent_turns_and_keeps_system() -> None:
    messages = _dialog(30)
    trimmed = _trim_context_window(messages, 20)
    # system + 最近 20 轮（40 条）
    assert len(trimmed) == 41
    assert trimmed[0].role == "system"
    assert trimmed[1].content == "用户第10句"
    assert trimmed[-1].content == "回复第29句"


def test_keeps_all_system_messages_wherever_they_are() -> None:
    """插问/AI 节点会在历史末尾追加临时 system 指令，裁剪不得丢失。"""
    messages = _dialog(30)
    messages.append(ChatMessage(role="system", content="临时指令"))
    messages.append(ChatMessage(role="user", content="插问内容"))
    trimmed = _trim_context_window(messages, 20)
    system_contents = [m.content for m in trimmed if m.role == "system"]
    assert system_contents == ["系统人设", "临时指令"]
    assert trimmed[-1].content == "插问内容"


def test_window_start_skips_orphan_tool_message() -> None:
    """窗口起点落在 tool 消息上时前移：孤儿 tool 消息会被 OpenAI 协议拒绝。"""
    messages = [ChatMessage(role="system", content="系统人设")]
    for index in range(3):
        messages.append(ChatMessage(role="user", content=f"用户{index}"))
        messages.append(
            ChatMessage(
                role="assistant",
                content="",
                tool_calls=[ToolCall(id=f"tc{index}", name="query", arguments={})],
            )
        )
        messages.append(
            ChatMessage(
                role="tool", content="结果", tool_call_id=f"tc{index}", name="query"
            )
        )
        messages.append(ChatMessage(role="assistant", content=f"回复{index}"))

    # 12 条非 system；窗口 2 轮 = 4 条，起点恰为最后一组的 tool 消息 → 前移跳过
    trimmed = _trim_context_window(messages, 2)
    assert trimmed[0].role == "system"
    assert trimmed[1].role != "tool"
    roles = [m.role for m in trimmed]
    assert "tool" not in roles or roles[roles.index("tool") - 1] == "assistant"
