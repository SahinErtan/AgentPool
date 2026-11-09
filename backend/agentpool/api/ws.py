"""The WebSocket hub.

The browser receives a snapshot when it connects and deltas afterwards.
The only message the client sends is ``agent_exited``, which tells the server
that a character has finished walking out through the gate.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

log = logging.getLogger("agentpool.ws")


class WsHub:
    """Tracks the connected browsers and forwards the broker's events."""

    def __init__(self, broker, registry, scene) -> None:
        self.broker = broker
        self.registry = registry
        self.scene = scene
        self._clients: Set[WebSocket] = set()
        self._pump: asyncio.Task | None = None

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

        self._pump = asyncio.create_task(pump())

    async def stop(self) -> None:
        if self._pump is not None:
            self._pump.cancel()
            self._pump = None

    async def broadcast(self, message: Dict[str, Any]) -> None:
        dead = []
        for client in list(self._clients):
            try:
                await client.send_json(message)
            except Exception:
                dead.append(client)
        for client in dead:
            self._clients.discard(client)


def create_ws_router(hub: WsHub) -> APIRouter:
    router = APIRouter()

    @router.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        hub._clients.add(websocket)
        try:
            await websocket.send_json(hub.snapshot())
            while True:
                message = await websocket.receive_json()
                await _handle_client_message(websocket, hub, message)
        except WebSocketDisconnect:
            pass
        except Exception:
            log.debug("websocket closed", exc_info=True)
        finally:
            hub._clients.discard(websocket)

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
