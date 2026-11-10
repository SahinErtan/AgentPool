"""The WebSocket hub: every client gets its own queue."""

from __future__ import annotations

import asyncio

import pytest

from agentpool.api.ws import CLIENT_QUEUE_SIZE, Client, WsHub


class FakeSocket:
    """A browser that can be slow, or quick, or gone."""

    def __init__(self, delay: float = 0.0, fail: bool = False) -> None:
        self.delay = delay
        self.fail = fail
        self.sent = []

    async def send_json(self, message):
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise ConnectionError("the browser is gone")
        self.sent.append(message)


class FakeScene:
    scene_id = "pool"

    def presentation(self, state):
        return {"mode": "swim"}

    def describe(self):
        return {"lanes": 4}


class FakeRegistry:
    def snapshot(self):
        return []


def test_a_full_queue_drops_the_oldest_and_not_the_newest():
    client = Client(FakeSocket(), size=4)
    for index in range(10):
        client.offer({"n": index})
    assert client.queue.qsize() == 4
    assert client.dropped == 6
    kept = []
    while not client.queue.empty():
        kept.append(client.queue.get_nowait()["n"])
    assert kept == [6, 7, 8, 9]


def test_a_slow_browser_does_not_hold_the_others_up():
    hub = WsHub(None, FakeRegistry(), FakeScene())
    slow = Client(FakeSocket(delay=0.5))
    quick = Client(FakeSocket())
    hub._clients.add(slow)
    hub._clients.add(quick)

    async def scenario():
        await hub.broadcast({"type": "agent_upsert"})
        # The broadcast hands the message over and returns; it does not
        # wait for the slow browser.
        assert quick.queue.qsize() == 1
        assert slow.queue.qsize() == 1
        # The quick browser can be served while the slow one is still busy.
        message = await quick.queue.get()
        assert message["type"] == "agent_upsert"

    asyncio.run(scenario())


def test_the_snapshot_is_the_first_message_a_client_gets():
    hub = WsHub(None, FakeRegistry(), FakeScene())
    socket = FakeSocket()

    async def scenario():
        await hub.add(socket)
        # Let the writer task pick the message up and send it.
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    asyncio.run(scenario())
    assert socket.sent, "the client was given nothing"
    assert socket.sent[0]["type"] == "snapshot"
    assert "agents" in socket.sent[0]


def test_the_hub_counts_what_it_dropped():
    hub = WsHub(None, FakeRegistry(), FakeScene())
    client = Client(FakeSocket(), size=2)
    hub._clients.add(client)

    async def scenario():
        for index in range(5):
            await hub.broadcast({"n": index})

    asyncio.run(scenario())
    metrics = hub.metrics()
    assert metrics["clients"] == 1
    assert metrics["dropped"] == 3
    assert metrics["sent"] == 5


def test_the_queue_is_not_huge():
    assert 0 < CLIENT_QUEUE_SIZE <= 256
