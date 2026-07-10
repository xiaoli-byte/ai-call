"""共享 ESL 连接的取消对齐测试。

契约:_ESLClient.api 把"锁+写+读"整体放进被 asyncio.shield 保护的内部协程,
等待者被取消时交换后台跑完 → 响应帧不滞留 socket、连接不错位,下一条命令
拿到属于自己的响应(而非上一条被取消命令的响应)。
"""

from __future__ import annotations

import asyncio

import pytest

from voice_agent.server import _ESLClient


class FakeWriter:
    def __init__(self) -> None:
        self.written: list[bytes] = []

    def write(self, data: bytes) -> None:
        self.written.append(data)

    async def drain(self) -> None:
        pass

    def is_closing(self) -> bool:
        return False


def _make_frame(body: str) -> bytes:
    payload = body.encode()
    header = f"Content-Type: api/response\nContent-Length: {len(payload)}\n\n"
    return header.encode() + payload


async def test_cancelled_waiter_does_not_desync_shared_connection() -> None:
    reader = asyncio.StreamReader()
    writer = FakeWriter()
    client = _ESLClient(reader, writer)  # type: ignore[arg-type]

    # 第一条命令:等待者在"读"处被取消(此时尚无响应帧喂入)。
    task1 = asyncio.create_task(client.api("cmd-one"))
    await asyncio.sleep(0.02)  # 让 _exchange 拿锁、写命令、阻塞在 readuntil
    task1.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task1

    # 现在两帧到达:被 shield 的 exchange1 应吃掉第一帧并释放锁,
    # exchange2 才拿到第二帧。
    reader.feed_data(_make_frame("RESP-ONE") + _make_frame("RESP-TWO"))

    resp = await client.api("cmd-two")
    assert resp == "RESP-TWO"  # 关键:第二条命令拿到第二帧,连接未错位
    # 两条命令都真正写出去了(顺序无误)
    assert writer.written == [b"api cmd-one\n\n", b"api cmd-two\n\n"]
