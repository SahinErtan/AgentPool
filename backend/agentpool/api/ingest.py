"""The ingest endpoint.

This runs inside the user's Claude Code session. It must **always** answer
HTTP 200 and must never raise: a broken dashboard must never break the
session.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Request

from ..bridge.events import AgentEvent, SessionEvent
from ..bridge.normalizer import normalize

log = logging.getLogger("agentpool.ingest")


def create_ingest_router(registry, broker, scene, journal) -> APIRouter:
    router = APIRouter()

    @router.post("/hooks/{event}")
    async def ingest(event: str, request: Request) -> Dict[str, Any]:
        try:
            payload = await request.json()
        except Exception:
            return {"ok": True, "accepted": 0}

        try:
            events = normalize(payload)
        except Exception:
            log.exception("normalisation failed")
            return {"ok": True, "accepted": 0}

        accepted = 0
        for item in events:
            try:
                journal.append(item)
                if isinstance(item, AgentEvent):
                    changed = registry.apply(item)
                    await _dispatch(registry, broker, scene, item, changed)
                elif isinstance(item, SessionEvent):
                    await scene.on_session_event(item)
                    broker.publish({"type": "session_event", "event": _session_dict(item)})
                accepted += 1
            except Exception:
                log.exception("failed to apply event")

        return {"ok": True, "accepted": accepted}

    return router


async def _dispatch(registry, broker, scene, item: AgentEvent, changed) -> None:
    """Let the scene react, then publish the resulting agent states."""
    if item.type == "spawned":
        for state in changed:
            await scene.on_agent_spawned(state)
    elif item.type == "started":
        for state in changed:
            await scene.on_agent_started(state)
    elif item.type == "finished":
        for state in changed:
            await scene.on_agent_finished(state)
    elif item.type == "removed":
        for state in changed:
            await scene.on_agent_removed(state.id)

    # The scene may move an agent on its own, for instance when a lounger
    # becomes free and somebody who was waiting takes it.
    seen = {state.id for state in changed}
    for agent_id in scene.take_dirty():
        if agent_id in seen:
            continue
        state = registry.get(agent_id)
        if state is not None:
            changed = list(changed) + [state]
            seen.add(agent_id)

    upserts: List[Dict] = []
    for state in changed:
        payload = state.to_dict()
        payload["scene"] = scene.scene_id
        payload["presentation"] = scene.presentation(state)
        upserts.append(payload)

    if upserts:
        # The scene description travels with the agents: the pool may have
        # grown, and the frontend has to know.
        broker.publish(
            {
                "type": "agent_upsert",
                "agents": upserts,
                "scene_payload": scene.describe(),
            }
        )


def _session_dict(event: SessionEvent) -> Dict[str, Any]:
    return {
        "event_id": event.event_id,
        "ts": event.ts,
        "type": event.type,
        "session_id": event.session_id,
        "detail": event.detail,
        "source": event.source,
    }
