"""The ingest endpoint.

This runs inside the user's Claude Code session. It must **always** answer
HTTP 200 and must never raise: a broken dashboard must never break the
session.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import replace
from typing import Any, Deque, Dict, List, Optional, Set

from fastapi import APIRouter, Request

from .. import notify
from ..bridge.events import AgentEvent, SessionEvent
from ..bridge.normalizer import normalize
from . import auth

log = logging.getLogger("agentpool.ingest")

# How many delivery ids are remembered. A retried delivery arrives within
# seconds, so a short memory is enough; the cap keeps the memory from
# growing for the whole session.
SEEN_ID_CAP = 1000

# The payload keys that may carry the id of the delivery. A payload
# without one cannot be told from its twin, so it is applied every time
# it arrives: skipping it would lose a real event.
ID_KEYS = ("event_id", "delivery_id")


class _SeenIds:
    """The ids of the deliveries that were already applied.

    The memory is bounded: when it is full the oldest id is dropped. A
    delivery that is retried very much later is applied again, and that
    is the safe mistake — a repeated effect is better than a lost event.
    """

    def __init__(self, cap: int = SEEN_ID_CAP) -> None:
        self._cap = max(1, cap)
        self._ids: Deque[str] = deque()
        self._set: Set[str] = set()

    def __contains__(self, event_id: str) -> bool:
        return event_id in self._set

    def __len__(self) -> int:
        return len(self._ids)

    def remember(self, event_id: str) -> None:
        """Note an id. The oldest one is dropped when the cap is reached."""
        if event_id in self._set:
            return
        self._ids.append(event_id)
        self._set.add(event_id)
        while len(self._ids) > self._cap:
            self._set.discard(self._ids.popleft())


def _delivery_id(payload: Any) -> Optional[str]:
    """The id of the delivery, when the payload carries one.

    Claude Code does not put a delivery id in the hook payload, so the id
    is derived from the fields that identify the event: the tool use id
    is unique for one tool call, and the agent id is unique for one
    subagent. The event name is part of the key, because the same tool
    call arrives twice — once before and once after it ran.

    A payload that carries neither has no safe key. Applying it again is
    the safe mistake: a repeated effect is better than a lost event.
    """
    if not isinstance(payload, dict):
        return None
    for key in ID_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return f"id:{value.strip()}"
    event = payload.get("hook_event_name")
    event = event.strip() if isinstance(event, str) and event.strip() else "?"
    tool_use_id = payload.get("tool_use_id")
    if isinstance(tool_use_id, str) and tool_use_id.strip():
        return f"tool:{event}:{tool_use_id.strip()}"
    agent_id = payload.get("agent_id")
    if isinstance(agent_id, str) and agent_id.strip():
        return f"agent:{event}:{agent_id.strip()}"
    return None


def _event_key(delivery_id: Optional[str], index: int) -> Optional[str]:
    """The key that tells one event of a delivery from another.

    A delivery may carry several events, so the index keeps them apart.
    Without a delivery id there is no key at all: such an event cannot
    be told from its twin and is applied every time it arrives.
    """
    if delivery_id is None:
        return None
    return f"{delivery_id}#{index}"


def create_ingest_router(
    registry, broker, scene, journal, counters=None, settings=None
) -> APIRouter:
    router = APIRouter()
    # One delivery, one effect: the ids that were already applied.
    seen = _SeenIds(SEEN_ID_CAP)

    @router.post("/hooks/{event}")
    async def ingest(event: str, request: Request) -> Dict[str, Any]:
        # A page in the browser may post to this port without asking. A
        # browser always says where it comes from, so the check is only
        # made when there is an origin to check: the hook itself does not
        # send one and must not be turned away.
        if counters is not None:
            counters.delivery()
        origin = request.headers.get("origin")
        if origin is not None:
            if not auth.origin_is_allowed(origin):
                log.warning("refused a delivery from %s", origin)
                if counters is not None:
                    counters.refuse(f"a delivery from {origin}")
                return {"ok": True, "accepted": 0, "duplicates": 0}
            if not auth.content_type_is_allowed(request.headers.get("content-type")):
                log.warning(
                    "refused a delivery with the content type %s",
                    request.headers.get("content-type"),
                )
                if counters is not None:
                    counters.refuse("a delivery with the wrong content type")
                return {"ok": True, "accepted": 0, "duplicates": 0}

        try:
            payload = await request.json()
        except Exception:
            return {"ok": True, "accepted": 0, "duplicates": 0}

        try:
            events = normalize(payload)
        except Exception:
            log.exception("normalisation failed")
            return {"ok": True, "accepted": 0, "duplicates": 0}

        delivery_id = _delivery_id(payload)
        accepted = 0
        duplicates = 0
        for index, item in enumerate(events):
            key = _event_key(delivery_id, index)
            try:
                if key is not None:
                    if key in seen:
                        # The very same delivery came twice. It is already
                        # in the journal, in the registry and in the scene,
                        # so it is skipped whole.
                        duplicates += 1
                        continue
                    # The id is remembered before the event is applied, so
                    # a delivery that arrives twice is never applied twice,
                    # not even if the first attempt failed halfway.
                    seen.remember(key)
                    item = replace(item, event_id=key)
                journal.append(item)
                if isinstance(item, AgentEvent):
                    changed = registry.apply(item)
                    await _dispatch(registry, broker, scene, item, changed, settings)
                elif isinstance(item, SessionEvent):
                    await scene.on_session_event(item)
                    broker.publish({"type": "session_event", "event": _session_dict(item)})
                accepted += 1
            except Exception as error:
                log.exception("failed to apply event")
                if counters is not None:
                    counters.fail(str(error))

        if counters is not None:
            counters.accepted_events(accepted)
            counters.duplicate_events(duplicates)
        return {"ok": True, "accepted": accepted, "duplicates": duplicates}

    return router


async def _announce(state, settings, name: str) -> None:
    """Tell the user that an agent that took a long time is done.

    The pool is a window on a desk. When it is not the thing you are
    looking at, a quiet pool is no use: the agent finishes and nobody
    notices. The notification goes to the desktop, and it is skipped when
    the run was short or when it is switched off.
    """
    if settings is not None and not getattr(settings, "notify", True):
        return
    started = getattr(state, "started_at", None)
    if not started:
        return
    finished = getattr(state, "finished_at", None) or time.time()
    seconds = finished - started
    try:
        await asyncio.to_thread(notify.notify_finished, name or state.id, seconds)
    except Exception:  # pragma: no cover - a notification never breaks a hook
        log.debug("the notification failed", exc_info=True)


async def _dispatch(registry, broker, scene, item: AgentEvent, changed, settings=None) -> None:
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
            # The notification is a courtesy: it must not break the event
            # that tells the browser the agent is done.
            try:
                await _announce(state, settings, registry.payload(state)["name"])
            except Exception:  # pragma: no cover - the pool does not break
                log.debug("the announcement failed", exc_info=True)
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
        payload = registry.payload(state)
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
