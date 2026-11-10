"""The WebSocket hub.

The browser receives a snapshot when it connects and deltas afterwards.
The only message the client sends is ``agent_exited``, which tells the server
that a character has finished walking out through the gate.

Every client has a queue of its own. A browser that has stopped reading —
a laptop that went to sleep, a tab in the background — must not hold the
whole pool up, so its queue is bounded and the oldest message in it is
dropped rather than letting the memory grow. The number of dropped
messages is counted, because a number nobody can read is a number that
does not exist.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from . import auth

log = logging.getLogger("agentpool.ws")

# How many messages a client may be behind before the oldest is dropped.
CLIENT_QUEUE_SIZE = 64

# How often the server says something, so that an idle pool still proves
# the socket is alive. A client that watches for the traffic can tell a
# dead socket from a quiet pool.
HEARTBEAT_S = 15.0


class Client:
    """One connected browser and the queue that waits for it."""

    def __init__(self, websocket: WebSocket, size: int = CLIENT_QUEUE_SIZE) -> None:
        self.websocket = websocket
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=max(1, size))
        self.dropped = 0
        self.task: Optional[asyncio.Task] = None

    def offer(self, message: Dict[str, Any]) -> None:
        """Put a message in the queue, without ever blocking the sender."""
        try:
            self.queue.put_nowait(message)
            return
        except asyncio.QueueFull:
            pass
        # The client is behind. The oldest message is the one it cares
        # least about, so it goes and the newest one waits.
        try:
            self.queue.get_nowait()
            self.queue.put_nowait(message)
            self.dropped += 1
        except asyncio.QueueEmpty:  # pragma: no cover - a race, not a path
            self.queue.put_nowait(message)

    async def run(self) -> None:
        """Send the queued messages, one at a time."""
        while True:
            message = await self.queue.get()
            try:
                await self.websocket.send_json(message)
            except Exception:
                # The browser is gone. The task ends and the client is
                # taken off the list by whoever notices.
                raise


class WsHub:
    """Tracks the connected browsers and forwards the broker's events."""

    def __init__(self, broker, registry, scene) -> None:
        self.broker = broker
        self.registry = registry
        self.scene = scene
        self._clients: Set[Client] = set()
        self._pump: asyncio.Task | None = None
        self._heartbeat: asyncio.Task | None = None
        self._sent = 0

    def agent_view(self, state) -> Dict[str, Any]:
        payload = state.to_dict()
        payload["scene"] = self.scene.scene_id
        payload["presentation"] = self.scene.presentation(state)
        return payload

    def snapshot(self) -> Dict[str, Any]:
        agents = [self.agent_view(item) for item in self.registry.snapshot()]
        return {
            "type": "snapshot",
            "scene": self.scene.scene_id,
            "ts": time.time(),
            "agents": agents,
            "scene_payload": self.scene.describe(),
        }

    async def start(self) -> None:
        """Start forwarding broker events to every connected client."""
        if self._pump is not None:
            return

        async def pump() -> None:
            queue = self.broker.subscribe()
            try:
                while True:
                    message = await queue.get()
                    await self.broadcast(message)
            except asyncio.CancelledError:
                raise
            finally:
                self.broker.unsubscribe(queue)

        async def heartbeat() -> None:
            while True:
                await asyncio.sleep(HEARTBEAT_S)
                try:
                    await self.broadcast({"type": "heartbeat", "ts": time.time()})
                except asyncio.CancelledError:
                    raise
                except Exception:  # pragma: no cover - defensive
                    log.debug("the heartbeat failed", exc_info=True)

        self._pump = asyncio.create_task(pump())
        self._heartbeat = asyncio.create_task(heartbeat())

    async def stop(self) -> None:
        for task in (self._pump, self._heartbeat):
            if task is not None:
                task.cancel()
        self._pump = None
        self._heartbeat = None
        for client in list(self._clients):
            await self._drop(client)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        """Hand a message to every client, without waiting for any of them."""
        for client in list(self._clients):
            client.offer(message)
            self._sent += 1

    def metrics(self) -> Dict[str, Any]:
        """What the hub has done, for the metrics endpoint."""
        return {
            "clients": len(self._clients),
            "sent": self._sent,
            "dropped": sum(client.dropped for client in self._clients),
        }

    async def add(self, websocket: WebSocket) -> Client:
        """Take a browser on, and give it the snapshot as its first message.

        The snapshot goes through the queue like everything else, so the
        client always sees the whole pool before it sees a change.
        """
        client = Client(websocket)
        self._clients.add(client)
        client.offer(self.snapshot())
        client.task = asyncio.create_task(self._run_client(client))
        return client

    async def _run_client(self, client: Client) -> None:
        try:
            await client.run()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.debug("a client went away", exc_info=True)
        finally:
            await self._drop(client)

    async def _drop(self, client: Client) -> None:
        self._clients.discard(client)
        task = client.task
        if task is not None and not task.done() and task is not asyncio.current_task():
            task.cancel()


def create_ws_router(hub: WsHub, token: str = "") -> APIRouter:
    router = APIRouter()

    @router.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        # A browser cannot put a header on a WebSocket, so the token comes
        # in the address. Without it the socket is closed before it opens.
        if token and not auth.token_matches(token, websocket.query_params.get("token")):
            await websocket.close(code=4401)
            return
        await websocket.accept()
        client = await hub.add(websocket)
        try:
            while True:
                message = await websocket.receive_json()
                await _handle_client_message(websocket, hub, message)
        except WebSocketDisconnect:
            pass
        except Exception:
            log.debug("websocket closed", exc_info=True)
        finally:
            await hub._drop(client)

    return router


async def _handle_client_message(websocket: WebSocket, hub: WsHub, message: Any) -> None:
    if not isinstance(message, dict):
        return
    kind = message.get("type")
    if kind == "agent_exited":
        agent_id = message.get("agent_id")
        if isinstance(agent_id, str) and hub.registry.acknowledge_exit(agent_id):
            await hub.broadcast({"type": "agent_remove", "agent_id": agent_id})
    elif kind == "ping":
        await websocket.send_json({"type": "pong", "ts": time.time()})
