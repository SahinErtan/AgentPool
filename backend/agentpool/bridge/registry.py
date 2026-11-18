"""The agent registry: a lifecycle state machine over normalised events."""

from __future__ import annotations

import re
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from functools import wraps
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

# The names that say nothing about the agent: the kind, or "main" that every
# hook used to write. A real name always wins over one of these, so a session
# that the reconciler called "pool-sprint" keeps that name when a hook calls
# it "main".
PLACEHOLDERS = frozenset({"main", "session", "subagent", "task", ""})

# The name a new agent gets when the event that creates it has none.
_PLACEHOLDER_BY_KIND = {
    AgentKind.SESSION: "main",
    AgentKind.SUBAGENT: "subagent",
    AgentKind.WORKFLOW: "task",
    AgentKind.MCP: "",
}


def _locked(method):
    """Run a method of the registry under its lock.

    The registry is written by two threads — the event loop applies the
    hooks, the reconciler applies what the disk says — and the methods
    that touch the agents are the ones that must not run at the same
    time. The lock is re-entrant, so a method may call another.
    """

    @wraps(method)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)

    return wrapper


def is_placeholder(label: Optional[str]) -> bool:
    """True when a label is missing or only says what kind of agent it is."""
    return (label or "").strip() in PLACEHOLDERS


def _tidy(text: Optional[str]) -> Optional[str]:
    """A name with its whitespace collapsed, or None when nothing is left.

    A name can run over several lines in a prompt or a description; the
    card shows it whole, but it must not break the row it sits in.
    """
    collapsed = " ".join((text or "").split())
    return collapsed or None


def project_of(cwd: Optional[str]) -> Optional[str]:
    """The project an agent works in: the last folder of its working directory.

    Both separators are accepted, because a hook may come from a Windows
    machine on the same network.
    """
    if not cwd:
        return None
    parts = [part for part in re.split(r"[\\/]", cwd) if part]
    return parts[-1] if parts else None


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
    # The task the agent was given. Tool notes never write it: they write
    # ``detail``, which is overwritten by the next tool, and this is not.
    description: Optional[str] = None
    # The last thing the person asked the session. Kept for the card.
    prompt: Optional[str] = None
    # What the agent is doing right now. It is cleared when the agent's
    # turn ends, so a finished agent never shows a tool it no longer runs.
    activity: Optional[str] = None
    # The model the agent runs on ("claude-opus-5-5"). The hooks say which
    # model a session started on, and the transcript says which one it runs
    # on now.
    model: Optional[str] = None
    # The reasoning effort the agent works at ("medium", "high").
    effort: Optional[str] = None
    # The tokens of the last turn: what went in (the context and the
    # cache) and what came out.
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    # The tokens the agent has used in all.
    tokens_total: Optional[int] = None
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

    def _name(self, project: Optional[str], parent: Optional["AgentState"]) -> str:
        """The name the person sees, before the screen tells duplicates apart.

        The screen adds the project or the parent when two agents would
        otherwise carry the same name, so this is only the first choice:
        the task for a subagent, the real name for a session.
        """
        if self.kind is AgentKind.SESSION:
            if not is_placeholder(self.label):
                return _tidy(self.label)
            if project:
                return project
            session_id = self.session_id or self.id.split(":", 1)[-1]
            return f"session {session_id[:4]}" if session_id else "session"
        if self.kind is AgentKind.SUBAGENT:
            return (
                _tidy(self.description)
                or _tidy(self.subagent_type)
                or _tidy(self.label)
                or "subagent"
            )
        if self.kind is AgentKind.WORKFLOW:
            return _tidy(self.description) or _tidy(self.label) or "task"
        return _tidy(self.label) or "mcp"

    def to_dict(self, parent: Optional["AgentState"] = None) -> Dict[str, Any]:
        """The payload the browser and the API get for this agent.

        A subagent or a workflow that has no folder of its own is shown in
        its parent's, so ``parent`` is passed by whoever knows the registry.
        """
        cwd = self.cwd or (parent.cwd if parent is not None else None)
        project = project_of(cwd)
        return {
            "id": self.id,
            "kind": self.kind.value,
            "status": self.status.value,
            "label": self.label,
            "name": self._name(project, parent),
            "description": self.description,
            "prompt": self.prompt,
            "activity": self.activity,
            "model": self.model,
            "effort": self.effort,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "tokens_total": self.tokens_total,
            "session_id": self.session_id,
            "parent_id": self.parent_id,
            "tool_use_id": self.tool_use_id,
            "subagent_type": self.subagent_type,
            "tool_name": self.tool_name,
            "detail": self.detail,
            "cwd": cwd,
            "project": project,
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
        #: The name of every session seen, by session id. It outlives the
        #: session's record (see ``payload``) and is small: one string per
        #: session since the backend started.
        self._session_names: Dict[str, str] = {}
        self._idle_ttl_s = idle_ttl_s
        self._session_ttl_s = session_ttl_s
        self._exit_grace_s = exit_grace_s
        self._max_agents = max_agents
        self._clock = clock
        # The registry is written by two threads: the event loop applies
        # the hooks, and the reconciler applies what the disk says. The
        # lock keeps them from writing over one another: without it, the
        # sweeper can drop an agent that the disk has just brought back.
        self._lock = threading.RLock()
        # Called with the id of an agent that leaves the registry because
        # the scene acknowledged its exit, so the scene can give its place
        # back. The sweeper does not use it: it talks to the scene itself.
        self._exit_hook: Optional[Callable[[str], None]] = None

    @_locked
    def set_exit_hook(self, hook: Callable[[str], None]) -> None:
        """Register the callback for the agents that leave the registry.

        The browser drops an agent when the character has walked out of
        the gate, and the registry has to tell the scene about it: or the
        agent keeps a lane, a lounger or a place at the edge that nobody
        will ever use.
        """
        self._exit_hook = hook

    # -- queries -----------------------------------------------------

    @_locked
    def snapshot(self) -> List[AgentState]:
        return list(self._agents.values())

    @_locked
    def get(self, agent_id: str) -> Optional[AgentState]:
        return self._agents.get(agent_id)

    @_locked
    def payload(self, state: AgentState) -> Dict[str, Any]:
        """The payload of one agent, with what it takes from its parent."""
        parent = self._agents.get(state.parent_id) if state.parent_id else None
        payload = state.to_dict(parent)
        # The name of the session the agent belongs to. It is remembered
        # after the session's own character has gone: a session that ends
        # its turn leaves the pool, while its background subagents swim on,
        # and they still have to say whose they are.
        payload["session_name"] = (
            self._session_names.get(state.session_id) if state.session_id else None
        )
        return payload

    @_locked
    def __len__(self) -> int:
        return len(self._agents)

    # -- mutation ----------------------------------------------------

    @_locked
    def apply(self, event: AgentEvent) -> List[AgentState]:
        """Apply one event and return the agents it changed."""
        # An MCP server is not an agent. Its calls are shown on the session
        # that made them. Old journal records of it are dropped here, so a
        # replay at boot does not put the server back on the screen.
        if event.kind is AgentKind.MCP:
            return []
        now = self._clock()
        kind = event.type

        if kind == "spawn_hint":
            # The Agent tool was called: remember the description until the
            # result tells us which agent it produced.
            if event.tool_use_id:
                self._pending_by_tool_use[event.tool_use_id] = {
                    "description": event.description or event.detail,
                    "subagent_type": event.subagent_type,
                }
            return []

        if kind == "spawn_bind":
            hint = self._pending_by_tool_use.pop(event.tool_use_id or "", {})
            state = self._upsert(event, now)
            if hint.get("description"):
                # The description is the agent's name in the pool. The detail
                # is still set, as it always was, for the views that read it.
                state.description = hint["description"]
                state.detail = hint["description"]
            if hint.get("subagent_type"):
                state.subagent_type = hint["subagent_type"]
                state.label = hint["subagent_type"]
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
            state.activity = None
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
            state.activity = None
            if event.detail:
                state.detail = event.detail
            return [state]

        if kind == "note":
            # A subagent is born from SubagentStart or the disk, never from a
            # tool note: a late PostToolUse after the agent was reaped would
            # otherwise bring a ghost back into the pool.
            if event.kind is AgentKind.SUBAGENT and event.agent_id not in self._agents:
                return []
            state = self._upsert(event, now)
            if event.tool_name:
                state.tool_name = event.tool_name
            if event.detail:
                state.detail = event.detail
            if event.activity is not None:
                state.activity = event.activity
            if state.status is AgentStatus.IDLE and event.status is AgentStatus.WORKING:
                state.status = AgentStatus.WORKING
                if state.started_at is None:
                    state.started_at = now
            return [state]

        return []

    @_locked
    def refresh_facts(
        self,
        agent_id: str,
        *,
        model: Optional[str] = None,
        tokens_in: Optional[int] = None,
        tokens_out: Optional[int] = None,
        tokens_total: Optional[int] = None,
    ) -> Optional[AgentState]:
        """Write the facts the disk knows and the hooks do not carry.

        The model and the token counts are the disk's business: a session
        can change its model while it runs (``/model``), and only its
        transcript knows it. The write is idempotent — a round that finds
        nothing new changes nothing and says nothing — so the browser is
        not woken up for a fact it already has.
        """
        state = self._agents.get(agent_id)
        if state is None:
            return None
        changed = False
        for name, value in (
            ("model", model),
            ("tokens_in", tokens_in),
            ("tokens_out", tokens_out),
            ("tokens_total", tokens_total),
        ):
            if value is None:
                continue
            if getattr(state, name) != value:
                setattr(state, name, value)
                changed = True
        return state if changed else None

    def _upsert(self, event: AgentEvent, now: float) -> AgentState:
        state = self._agents.get(event.agent_id)
        if state is None:
            state = AgentState(
                id=event.agent_id,
                kind=event.kind,
                status=event.status,
                label=event.label or _PLACEHOLDER_BY_KIND.get(event.kind, ""),
                session_id=event.session_id,
                parent_id=event.parent_id,
                tool_use_id=event.tool_use_id,
                subagent_type=event.subagent_type,
                tool_name=event.tool_name,
                detail=event.detail,
                description=event.description,
                prompt=event.prompt,
                activity=event.activity,
                model=event.model,
                effort=event.effort,
                tokens_in=event.tokens_in,
                tokens_out=event.tokens_out,
                tokens_total=event.tokens_total,
                cwd=event.cwd,
                created_at=now,
                last_event_at=now,
            )
            self._agents[event.agent_id] = state
        state.kind = event.kind
        # A placeholder never replaces a real name. The name only changes
        # when the event brings a real one, or when there is no real one yet.
        if event.label and (not is_placeholder(event.label) or is_placeholder(state.label)):
            state.label = event.label
        state.session_id = event.session_id or state.session_id
        state.parent_id = event.parent_id or state.parent_id
        # The folder a hook reports is the shell's current folder, which
        # moves with every `cd`. The project is where the agent started:
        # the first folder seen, unless the disk (the session file, written
        # at launch) says otherwise.
        if event.cwd and (state.cwd is None or event.source == "reconcile"):
            state.cwd = event.cwd
        if event.subagent_type:
            state.subagent_type = event.subagent_type
        if event.description:
            state.description = event.description
        if event.prompt:
            state.prompt = event.prompt
        if event.tool_use_id:
            state.tool_use_id = event.tool_use_id
        # The model and the effort are facts, not states: an event that
        # does not carry one does not take the one the agent has away.
        if event.model:
            state.model = event.model
        if event.effort:
            state.effort = event.effort
        if event.tokens_in is not None:
            state.tokens_in = event.tokens_in
        if event.tokens_out is not None:
            state.tokens_out = event.tokens_out
        if event.tokens_total is not None:
            state.tokens_total = event.tokens_total
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
        if state.kind is AgentKind.SESSION and state.session_id:
            self._session_names[state.session_id] = state._name(project_of(state.cwd), None)
        return state

    # -- expiry ------------------------------------------------------

    @_locked
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

    @_locked
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
