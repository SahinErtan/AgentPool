"""Read-only state endpoints."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request

from ..bridge.events import AgentStatus
from . import auth


def create_state_router(
    registry, scene, started_at: float, journal=None, token: str = ""
) -> APIRouter:
    router = APIRouter()

    def guard(request: Request) -> None:
        """Refuse a request that does not carry the token, when there is one.

        With no token the port is open to the machine, which is the old
        behaviour. With a token it belongs to the person who set it.
        """
        if not token:
            return
        if not auth.token_matches(token, auth.token_from_request(request)):
            raise HTTPException(status_code=401, detail="the token is missing or wrong")

    def agent_view(state) -> Dict[str, Any]:
        payload = state.to_dict()
        payload["scene"] = scene.scene_id
        payload["presentation"] = scene.presentation(state)
        return payload

    @router.get("/api/health")
    async def health() -> Dict[str, Any]:
        return {
            "ok": True,
            "scene": scene.scene_id,
            "uptime": round(time.time() - started_at, 3),
            "agents": len(registry),
        }

    @router.get("/api/state")
    async def state(request: Request) -> Dict[str, Any]:
        guard(request)
        states = list(registry.snapshot())
        agents = [agent_view(item) for item in states]
        # Every status is counted on its own: an agent that has finished is
        # neither working nor idle, and calling it idle is a lie that the
        # panel would repeat.
        working = sum(1 for item in states if item.status is AgentStatus.WORKING)
        idle = sum(1 for item in states if item.status is AgentStatus.IDLE)
        done = sum(1 for item in states if item.status is AgentStatus.FINISHED)
        return {
            "type": "snapshot",
            "scene": scene.scene_id,
            "ts": time.time(),
            "agents": agents,
            "counts": {
                "total": len(agents),
                "working": working,
                "idle": idle,
                "done": done,
            },
            "scene_payload": scene.describe(),
        }

    @router.get("/api/agents")
    async def agents(request: Request) -> List[Dict[str, Any]]:
        guard(request)
        return [agent_view(item) for item in registry.snapshot()]

    @router.get("/api/history")
    async def history(
        request: Request,
        limit: int = Query(100, ge=1, le=1000),
        agent: Optional[str] = Query(None),
    ) -> Dict[str, Any]:
        guard(request)
        """The journal, read back: the most recent events, newest first.

        The journal is what was written, not the state it describes, so
        this is the history of the pool and not a snapshot of it.
        """
        events: List[Dict[str, Any]] = []
        if journal is not None:
            events = journal.recent(limit=limit, agent_id=agent)
        return {
            "type": "history",
            "events": events,
            "count": len(events),
        }

    @router.get("/api/agents/{agent_id:path}")
    async def agent(agent_id: str, request: Request) -> Dict[str, Any]:
        guard(request)
        item = registry.get(agent_id)
        if item is None:
            raise HTTPException(status_code=404, detail="unknown agent")
        payload = agent_view(item)
        payload["events"] = list(item.last_events)
        return payload

    return router


def create_metrics_router(broker, hub, registry, counters=None) -> APIRouter:
    """What the backend has done, in numbers.

    The broker counts the events it drops, the hub counts the messages a
    slow browser missed, and the ingest counts what it refused. None of
    it is a secret and all of it is worth seeing.
    """
    router = APIRouter()

    @router.get("/api/metrics")
    async def metrics() -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "type": "metrics",
            "agents": len(registry),
            "broker": {
                "published": getattr(broker, "published", 0),
                "dropped": getattr(broker, "dropped", 0),
            },
            "hub": hub.metrics() if hasattr(hub, "metrics") else {},
        }
        if counters is not None:
            payload["ingest"] = counters.as_dict()
            payload["background"] = counters.background_as_dict()
        return payload

    return router
