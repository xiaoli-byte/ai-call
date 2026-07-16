"""Qwen-TTS 正常关闭帧日志过滤器测试。

背景：dashscope SDK 与 websocket-client 把每次合成结束的正常关闭帧
（opcode=8, 关闭码 1000）当 ERROR 记录，err.log 每次合成刷两条：
    [ERROR] dashscope: websocket error: fin=1 opcode=8 data=b'\\x03\\xe8Bye'
    [ERROR] websocket: fin=1 opcode=8 data=b'\\x03\\xe8Bye' - goodbye
过滤器只丢弃这类正常关闭帧记录，真实错误必须原样放行。
"""

from __future__ import annotations

import logging

from voice_agent.tts_qwen import (
    NormalCloseFrameFilter,
    install_normal_close_log_filter,
)


def _make_record(logger_name: str, msg: str, level: int = logging.ERROR) -> logging.LogRecord:
    """构造一条与库产出等价的 LogRecord（无格式化参数，纯文本消息）。"""
    return logging.LogRecord(
        name=logger_name,
        level=level,
        pathname=__file__,
        lineno=0,
        msg=msg,
        args=(),
        exc_info=None,
    )


def test_过滤实测噪音_dashscope正常关闭帧被丢弃():
    """与 err.log 实测一模一样的 dashscope 噪音记录必须被过滤。"""
    filt = NormalCloseFrameFilter()
    record = _make_record(
        "dashscope", "websocket error: fin=1 opcode=8 data=b'\\x03\\xe8Bye'"
    )
    assert filt.filter(record) is False


def test_过滤实测噪音_websocket正常关闭帧被丢弃():
    """与 err.log 实测一模一样的 websocket 噪音记录必须被过滤。"""
    filt = NormalCloseFrameFilter()
    record = _make_record(
        "websocket", "fin=1 opcode=8 data=b'\\x03\\xe8Bye' - goodbye"
    )
    assert filt.filter(record) is False


def test_真实错误_连接丢失被放行():
    """连接丢失属真实错误，必须放行。"""
    filt = NormalCloseFrameFilter()
    record = _make_record(
        "websocket", "websocket error: Connection to remote host was lost."
    )
    assert filt.filter(record) is True


def test_真实错误_非1000关闭码被放行():
    """非 1000 关闭码（如 1001 going away = \\x03\\xe9）属异常关闭，必须放行。"""
    filt = NormalCloseFrameFilter()
    record = _make_record(
        "dashscope", "websocket error: fin=1 opcode=8 data=b'\\x03\\xe9server going away'"
    )
    assert filt.filter(record) is True


def test_真实错误_服务端错误消息被放行():
    """普通 ERROR 文本（无关闭帧特征）必须放行。"""
    filt = NormalCloseFrameFilter()
    record = _make_record("dashscope", "request timeout after 30s")
    assert filt.filter(record) is True


def test_挂载函数_过滤器已挂到目标logger且幂等():
    """install 后 dashscope / websocket 两个 logger 的 filters 里必须有过滤器；
    重复调用不重复挂载。"""
    install_normal_close_log_filter()
    install_normal_close_log_filter()  # 幂等验证
    for name in ("dashscope", "websocket"):
        target = logging.getLogger(name)
        matched = [f for f in target.filters if isinstance(f, NormalCloseFrameFilter)]
        assert len(matched) == 1, f"logger {name!r} 应恰好挂载一个过滤器"


def test_挂载后端到端_噪音不出现在handler():
    """端到端：挂载后经 logger 记录噪音消息，handler 收不到；真实错误收得到。"""
    install_normal_close_log_filter()

    captured: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record.getMessage())

    target = logging.getLogger("dashscope")
    handler = _Capture()
    old_propagate = target.propagate
    target.addHandler(handler)
    target.propagate = False
    try:
        target.error("websocket error: fin=1 opcode=8 data=b'\\x03\\xe8Bye'")
        target.error("websocket error: Connection to remote host was lost.")
    finally:
        target.removeHandler(handler)
        target.propagate = old_propagate

    assert captured == ["websocket error: Connection to remote host was lost."]
