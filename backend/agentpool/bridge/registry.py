"""The agent registry: a lifecycle state machine over normalised events."""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Optional

from .events import AgentEvent, AgentKind, AgentStatus


@dataclass
class AgentState:
    """Everything the backend knows about one agent."""

    id: str
    kind: AgentKind
    status: AgentStatus
    label: str
    session_id: Optional[str] = None
    parent_id: Optional[str] = None
    tool_use_id: Optional[str] = None
    subagent_type: Optional[str] = None
    tool_name: Optional[str] = None
    detail: Optional[str] = None
    cwd: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    last_event_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    event_count: int = 0
    leaving_deadline: Optional[float] = None
    last_events: Deque[Dict[str, Any]] = field(
        default_factory=lambda: deque(maxlen=50)
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind.value,
            "status": self.status.value,
            "label": self.label,
            "session_id": self.session_id,
            "parent_id": self.parent_id,
            "tool_use_id": self.tool_use_id,
            "subagent_type": self.subagent_type,
            "tool_name": self.tool_name,
            "detail": self.detail,
            "cwd": self.cwd,
            "created_at": self.created_at,
            "last_event_at": self.last_event_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "event_count": self.event_count,
            "leaving_deadline": self.leaving_deadline,
            # The last few things that happened to this agent, so the
            # inspector can show what it is doing and not only what it is.
            "events": list(self.last_events),
        }


class AgentRegistry:
    """Applies events to agents and keeps their lifecycle state.

    Identity joins are handled here:

    * a subagent is created by ``SubagentStart`` (which carries ``agent_id``);
    * the ``Agent`` tool's *result* carries the same id, and the tool call
      carries the description — the two are joined through the tool use id;
    * the description therefore arrives *after* the agent exists and is merged
      in late.
    """

    def __init__(
        self,
        *,
        idle_ttl_s: float = 90.0,
        session_ttl_s: float = 900.0,
        exit_grace_s: float = 15.0,
        clock=time.time,
    ) -> None:
        self._agents: Dict[str, AgentState] = {}
        self._pending_by_tool_use: Dict[str, Dict[str, Any]] = {}
        self._idle_ttl_s = idle_ttl_s
        self._session_ttl_s = session_ttl_s
        self._exit_grace_s = exit_grace_s
        self._clock = clock

    # -- queries -----------------------------------------------------

    def snapshot(self) -> List[AgentState]:
        return list(self._agents.values())

    def get(self, agent_id: str) -> Optional[AgentState]:
        return self._agents.get(agent_id)

    def __len__(self) -> int:
        return len(self._agents)

    # -- mutation ----------------------------------------------------

    def apply(self, event: AgentEvent) -> List[AgentState]:
        """Apply one event and return the agents it changed."""
        now = self._clock()
        kind = event.type

        if kind == "spawn_hint":
            # The Agent tool was called: remember the description until the
            # result tells us which agent it produced.
            if event.tool_use_id:
                self._pending_by_tool_use[event.tool_use_id] = {
                    "detail": event.detail,
                    "subagent_type": event.subagent_type,
                    "label": event.label,
                }
            return []

        if kind == "spawn_bind":
            hint = self._pending_by_tool_use.pop(event.tool_use_id or "", {})
            state = self._upsert(event, now)
            if hint.get("detail"):
                state.detail = hint["detail"]
            if hint.get("subagent_type"):
                state.subagent_type = hint["subagent_type"]
                state.label = hint.get("label") or hint["subagent_type"]
            if event.tool_use_id:
                state.tool_use_id = event.tool_use_id
            return [state]

        if kind == "spawned":
            state = self._upsert(event, now)
            state.status = event.status
            if event.status is AgentStatus.WORKING and state.started_at is None:
                state.started_at = now
            return [state]

        if kind == "started":
            state = self._upsert(event, now)
            if state.status is not AgentStatus.LEAVING:
                state.status = AgentStatus.WORKING
            if state.started_at is None:
                state.started_at = now
            state.finished_at = None
            state.leaving_deadline = None
            if event.tool_name:
                state.tool_name = event.tool_name
            if event.detail:
                state.detail = event.detail
            return [state]

        if kind == "finished":
            state = self._upsert(event, now)
            state.status = AgentStatus.FINISHED
            state.finished_at = now
            state.leaving_deadline = None
            if event.detail:
                state.detail = event.detail
            if event.tool_name:
                state.tool_name = event.tool_name
            return [state]

        if kind == "removed":
            state = self._upsert(event, now)
            # The character walks out through the gate, so the record is kept
            # until the scene acknowledges the exit or the grace period ends.
            state.status = AgentStatus.LEAVING
            state.leaving_deadline = now + self._exit_grace_s
            if event.detail:
                state.detail = event.detail
            return [state]

        if kind == "note":
            state = self._upsert(event, now)
            if event.tool_name:
                state.tool_name = event.tool_name
            if event.detail:
                state.detail = event.detail
            if state.status is AgentStatus.IDLE and event.status is AgentStatus.WORKING:
                state.status = AgentStatus.WORKING
                if state.started_at is None:
                    state.started_at = now
            return [state]

        return []

    def _upsert(self, event: AgentEvent, now: float) -> AgentState:
        state = self._agents.get(event.agent_id)
        if state is None:
            state = AgentState(
                id=event.agent_id,
                kind=event.kind,
                status=event.status,
                label=event.label,
                session_id=event.session_id,
                parent_id=event.parent_id,
                tool_use_id=event.tool_use_id,
                subagent_type=event.subagent_type,
                tool_name=event.tool_name,
                detail=event.detail,
                created_at=now,
                last_event_at=now,
            )
            self._agents[event.agent_id] = state
        state.kind = event.kind
        state.label = event.label or state.label
        state.session_id = event.session_id or state.session_id
        state.parent_id = event.parent_id or state.parent_id
        if event.subagent_type:
            state.subagent_type = event.subagent_type
        if event.tool_use_id:
            state.tool_use_id = event.tool_use_id
        state.last_event_at = now
        state.event_count += 1
        state.last_events.append(
            {
                "ts": now,
                "type": event.type,
                "tool": event.tool_name,
                "detail": event.detail,
            }
        )
        return state

    # -- expiry ------------------------------------------------------

    def sweep(self, now: Optional[float] = None) -> List[AgentState]:
        """Expire stale agents. Returns the agents that changed."""
        now = now if now is not None else self._clock()
        changed: List[AgentState] = []

        for agent_id, state in list(self._agents.items()):
            idle_for = now - state.last_event_at

            if state.status is AgentStatus.LEAVING:
                if state.leaving_deadline is not None and now >= state.leaving_deadline:
                    del self._agents[agent_id]
                    changed.append(state)
                continue

            if state.status is AgentStatus.WORKING and idle_for > self._idle_ttl_s:
                state.status = AgentStatus.IDLE
                state.detail = "stalled?"
                changed.append(state)
                continue

            if (
                state.status is AgentStatus.IDLE
                and state.kind is AgentKind.SESSION
                and idle_for > self._session_ttl_s
            ):
                state.status = AgentStatus.LEAVING
                state.leaving_deadline = now + self._exit_grace_s
                changed.append(state)

        return changed

    def acknowledge_exit(self, agent_id: str) -> bool:
        """Drop an agent that has walked out of the scene.

        Only an agent that is on its way out may be dropped: a character
        that waits at the gate is still part of the scene.
        """
        state = self._agents.get(agent_id)
        if state is None:
            return False
        if state.status is not AgentStatus.LEAVING:
            return False
        return self._agents.pop(agent_id, None) is not None
