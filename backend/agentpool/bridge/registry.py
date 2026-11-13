"""The agent registry: a lifecycle state machine over normalised events."""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Deque, Dict, List, Optional

from .events import AgentEvent, AgentKind, AgentStatus

# The registry never holds more than this many agents.
#
# The pool can show a couple of dozen characters at a time (four lanes,
# twelve loungers, four places at the edge). A very busy machine may spawn
# a few dozen subagents in a day, so a few hundred is already far above
# anything that can be seen — but it is a ceiling, not a suggestion: a hook
# that fires in a loop must not grow the backend for ever. The oldest and
# the idlest go first, and the scene is told about every one of them.
MAX_AGENTS = 300


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
    # When a finished agent has to be gone: it stays in the scene long
    # enough to climb out of the water, and after that it is reaped even
    # when no dashboard is open to say goodbye.
    finished_deadline: Optional[float] = None
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
            "finished_deadline": self.finished_deadline,
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
        max_agents: int = MAX_AGENTS,
        clock=time.time,
    ) -> None:
        self._agents: Dict[str, AgentState] = {}
        self._pending_by_tool_use: Dict[str, Dict[str, Any]] = {}
        self._idle_ttl_s = idle_ttl_s
        self._session_ttl_s = session_ttl_s
        self._exit_grace_s = exit_grace_s
        self._max_agents = max_agents
        self._clock = clock
        # Called with the id of an agent that leaves the registry because
        # the scene acknowledged its exit, so the scene can give its place
        # back. The sweeper does not use it: it talks to the scene itself.
        self._exit_hook: Optional[Callable[[str], None]] = None

    def set_exit_hook(self, hook: Callable[[str], None]) -> None:
        """Register the callback for the agents that leave the registry.

        The browser drops an agent when the character has walked out of
        the gate, and the registry has to tell the scene about it: or the
        agent keeps a lane, a lounger or a place at the edge that nobody
        will ever use.
        """
        self._exit_hook = hook

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
            state.finished_at = None
            state.finished_deadline = None
            if event.status is AgentStatus.WORKING and state.started_at is None:
                state.started_at = now
            if event.status is AgentStatus.FINISHED:
                # An agent that is already finished when it appears still
                # gets its grace period, so it can climb out of the water.
                state.finished_at = now
                state.finished_deadline = now + self._exit_grace_s
            return [state]

        if kind == "started":
            state = self._upsert(event, now)
            if state.status is not AgentStatus.LEAVING:
                state.status = AgentStatus.WORKING
            if state.started_at is None:
                state.started_at = now
            state.finished_at = None
            state.finished_deadline = None
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
            state.finished_deadline = now + self._exit_grace_s
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
            state.finished_deadline = None
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

            if state.status is AgentStatus.FINISHED:
                # A finished agent is reaped after its grace period, with
                # or without a browser: the pool must not keep a character
                # that nobody is going to see leave. The deadline is
                # measured from the moment it finished, so an agent that
                # was restored from the journal and finished long ago is
                # reaped at once.
                base = state.finished_at if state.finished_at is not None else state.last_event_at
                deadline = base + self._exit_grace_s
                state.finished_deadline = deadline
                if now >= deadline:
                    del self._agents[agent_id]
                    changed.append(state)
                continue

            if state.status is AgentStatus.WORKING and idle_for > self._idle_ttl_s:
                state.status = AgentStatus.IDLE
                # The description of the agent is left alone: it is what
                # tells two agents of the same kind apart, and "stalled?"
                # in every row of the list says nothing.
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

        self._enforce_ceiling(changed)
        return changed

    def _enforce_ceiling(self, changed: List[AgentState]) -> None:
        """Keep the registry under its ceiling.

        The oldest and the idlest go first, and a working agent is only
        dropped when there is nothing else to drop: a swimmer that is
        doing its job is worth more than a record.
        """
        overflow = len(self._agents) - self._max_agents
        if overflow <= 0:
            return

        candidates = sorted(
            self._agents.values(),
            key=lambda state: (state.status is AgentStatus.WORKING, state.last_event_at),
        )
        for state in candidates:
            if overflow <= 0:
                break
            if self._agents.pop(state.id, None) is not None:
                changed.append(state)
                overflow -= 1

    def acknowledge_exit(self, agent_id: str) -> bool:
        """Drop an agent that has walked out of the scene.

        Only an agent that is on its way out may be dropped: a character
        that waits at the gate is still part of the scene. An agent that
        has finished counts as on its way out — its character climbs out
        of the water and leaves through the gate like everybody else.
        """
        state = self._agents.get(agent_id)
        if state is None:
            return False
        if state.status not in (AgentStatus.LEAVING, AgentStatus.FINISHED):
            return False
        if self._agents.pop(agent_id, None) is None:
            return False
        self._notify_exit(agent_id)
        return True

    def _notify_exit(self, agent_id: str) -> None:
        """Tell the scene that an agent has left the registry."""
        hook = self._exit_hook
        if hook is None:
            return
        try:
            hook(agent_id)
        except Exception:
            # The scene must never break the registry.
            return
