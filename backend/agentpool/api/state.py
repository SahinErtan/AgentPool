"""Read-only state endpoints."""

from __future__ import annotations

import time
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from ..bridge.events import AgentStatus


def create_state_router(registry, scene, started_at: float) -> APIRouter:
    router = APIRouter()

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
    async def state() -> Dict[str, Any]:
        agents = [agent_view(item) for item in registry.snapshot()]
        working = sum(1 for item in registry.snapshot() if item.status is AgentStatus.WORKING)
        return {
            "type": "snapshot",
            "scene": scene.scene_id,
            "ts": time.time(),
            "agents": agents,
            "counts": {
                "total": len(agents),
                "working": working,
                "idle": len(agents) - working,
            },
            "scene_payload": scene.describe(),
        }

    @router.get("/api/agents")
    async def agents() -> List[Dict[str, Any]]:
        return [agent_view(item) for item in registry.snapshot()]

    @router.get("/api/agents/{agent_id:path}")
    async def agent(agent_id: str) -> Dict[str, Any]:
        item = registry.get(agent_id)
        if item is None:
            raise HTTPException(status_code=404, detail="unknown agent")
        payload = agent_view(item)
        payload["events"] = list(item.last_events)
        return payload

    return router
