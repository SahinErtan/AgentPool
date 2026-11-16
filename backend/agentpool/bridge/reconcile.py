"""Reconciliation: rebuild the live agent set from what Claude Code has on disk.

This runs on boot and then periodically. It **merges** into the registry and
never deletes live hook-derived state, so a missed hook self-corrects instead
of wiping the pool.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any, List, Optional

from .events import AgentEvent, AgentKind, AgentStatus
from .registry import AgentRegistry, AgentState
from .sources import read_agents_cli, read_sessions, read_subagents
from .transcript import read_agent_calls

log = logging.getLogger("agentpool.reconcile")


def reconcile(
    registry: AgentRegistry,
    claude_dir: Path,
    *,
    now: Optional[float] = None,
    use_cli: bool = True,
) -> List[AgentState]:
    """Merge the on-disk state into the registry.

    Returns the agents it changed. The merge never goes backwards: a hook
    that arrived after the file was written knows more than the file, so the
    file does not get to undo it.
    """
    now = now if now is not None else time.time()
    changed: List[AgentState] = []

    def apply(event: AgentEvent, disk_ts: float) -> None:
        """Apply an event, unless the hooks know more than the disk."""
        state = registry.get(event.agent_id)
        if state is not None and state.last_event_at >= disk_ts:
            return
        changed.extend(registry.apply(event))

    for session in read_sessions(claude_dir):
        session_id = session["session_id"]
        agent_id = f"session:{session_id}"
        working = session.get("status") == "busy"
        disk_ts = float(session.get("updated_at") or 0.0)
        apply(
            AgentEvent.new(
                type="spawned",
                agent_id=agent_id,
                kind=AgentKind.SESSION,
                session_id=session_id,
                parent_id=None,
                status=AgentStatus.WORKING if working else AgentStatus.IDLE,
                label=session.get("name"),
                detail=session.get("cwd"),
                cwd=session.get("cwd"),
                source="reconcile",
                ts=now,
            ),
            disk_ts,
        )
        if working:
            apply(
                AgentEvent.new(
                    type="started",
                    agent_id=agent_id,
                    kind=AgentKind.SESSION,
                    session_id=session_id,
                    parent_id=None,
                    status=AgentStatus.WORKING,
                    label=session.get("name"),
                    detail=session.get("cwd"),
                    cwd=session.get("cwd"),
                    source="reconcile",
                    ts=now,
                ),
                disk_ts,
            )

    live_session_ids = {item["session_id"] for item in read_sessions(claude_dir)}
    now_wall = time.time()

    # The parent transcript knows the description of every subagent, even
    # when the metadata file does not. It is read once per session.
    calls_by_session: dict[str, dict[str, Any]] = {}

    def calls_for(session_id: str) -> dict[str, Any]:
        if session_id not in calls_by_session:
            calls_by_session[session_id] = {
                call["tool_use_id"]: call
                for call in read_agent_calls(claude_dir, session_id)
            }
        return calls_by_session[session_id]
    for subagent in read_subagents(claude_dir):
        agent_id = f"sub:{subagent['agent_id']}"
        finished = subagent.get("finished")
        if finished:
            # A finished subagent is history, and Claude Code keeps the
            # transcripts for thirty days. It only matters when the stop
            # hook never arrived: then the agent is still swimming in the
            # pool and the file says it is done.
            known = registry.get(agent_id)
            if known is None or known.status is AgentStatus.FINISHED:
                continue
            apply(
                AgentEvent.new(
                    type="finished",
                    agent_id=agent_id,
                    kind=AgentKind.SUBAGENT,
                    session_id=subagent.get("session_id") or "",
                    parent_id=(
                        f"session:{subagent['session_id']}"
                        if subagent.get("session_id")
                        else None
                    ),
                    status=AgentStatus.FINISHED,
                    label=subagent.get("agent_type"),
                    detail=subagent.get("description"),
                    description=subagent.get("description"),
                    tool_use_id=subagent.get("tool_use_id"),
                    subagent_type=subagent.get("agent_type"),
                    source="reconcile",
                    ts=now,
                ),
                float(subagent.get("modified") or 0.0),
            )
            continue
        belongs_to_live_session = subagent.get("session_id") in live_session_ids
        touched_recently = (now_wall - float(subagent.get("modified") or 0)) < 7200
        if not (belongs_to_live_session or touched_recently):
            continue
        session_id = subagent.get("session_id") or ""
        call = calls_for(session_id).get(subagent.get("tool_use_id") or "")
        description = subagent.get("description") or (call or {}).get("description")
        agent_type = subagent.get("agent_type") or (call or {}).get("subagent_type")
        apply(
            AgentEvent.new(
                type="spawned",
                agent_id=agent_id,
                kind=AgentKind.SUBAGENT,
                session_id=subagent.get("session_id") or "",
                parent_id=(
                    f"session:{subagent['session_id']}"
                    if subagent.get("session_id")
                    else None
                ),
                status=AgentStatus.FINISHED if finished else AgentStatus.WORKING,
                label=agent_type,
                detail=description,
                description=description,
                tool_use_id=subagent.get("tool_use_id"),
                subagent_type=agent_type,
                source="reconcile",
                ts=now,
            ),
            float(subagent.get("modified") or 0.0),
        )

    if use_cli:
        for item in read_agents_cli() or []:
            if item.get("kind") != "background":
                continue
            task_id = item.get("id") or item.get("sessionId")
            if not task_id:
                continue
            state = item.get("state") or "working"
            status = {
                "working": AgentStatus.WORKING,
                "blocked": AgentStatus.WORKING,
                "done": AgentStatus.FINISHED,
                "failed": AgentStatus.FINISHED,
                "stopped": AgentStatus.FINISHED,
            }.get(state, AgentStatus.WORKING)
            apply(
                AgentEvent.new(
                    type="spawned",
                    agent_id=f"wf:{task_id}",
                    kind=AgentKind.WORKFLOW,
                    session_id=item.get("sessionId") or "",
                    parent_id=None,
                    status=status,
                    label=item.get("name"),
                    detail=item.get("cwd"),
                    description=item.get("description"),
                    cwd=item.get("cwd"),
                    source="reconcile",
                    ts=now,
                ),
                now,
            )

    return changed


# -- what is gone ----------------------------------------------------


def known_ids(
    claude_dir: Path,
    *,
    use_cli: bool = True,
    now: Optional[float] = None,
) -> Optional[set[str]]:
    """The agents the disk knows about, by id.

    ``None`` means the disk could not be read for the background tasks: the
    caller must not conclude that every workflow is gone.
    """
    now = time.time() if now is None else now
    known: set[str] = set()

    sessions = read_sessions(claude_dir)
    for session in sessions:
        known.add(f"session:{session['session_id']}")
    live_sessions = {session["session_id"] for session in sessions}

    for subagent in read_subagents(claude_dir):
        if subagent.get("finished"):
            # A subagent that is done is history: it belongs in the journal,
            # not in the pool.
            continue
        belongs_to_live_session = subagent.get("session_id") in live_sessions
        touched_recently = (now - float(subagent.get("modified") or 0)) < 7200
        if belongs_to_live_session or touched_recently:
            known.add(f"sub:{subagent['agent_id']}")

    if use_cli:
        items = read_agents_cli()
        if items is None:
            return None
        for item in items:
            if item.get("kind") != "background":
                continue
            task_id = item.get("id") or item.get("sessionId")
            if task_id:
                known.add(f"wf:{task_id}")

    return known


def gone_agents(
    registry: AgentRegistry,
    claude_dir: Path,
    *,
    use_cli: bool = True,
    now: Optional[float] = None,
) -> List[str]:
    """The agents that are not on the disk any more.

    The reconciler merges what the disk has into the registry. It has to
    take out what the disk does not have as well: a background task of
    another session that has been over for a day is still in the pool
    otherwise, lying on a lounger for ever.

    An agent that is on its way out is left alone: the sweeper collects it.
    An MCP server is left alone too: there is no file on the disk that says
    whether it is still there.
    """
    known = known_ids(claude_dir, use_cli=use_cli, now=now)
    if known is None:
        # The disk could not be read: nothing is known, so nothing goes.
        return []

    gone: List[str] = []
    for state in registry.snapshot():
        if state.kind is AgentKind.MCP:
            continue
        if state.status in (
            AgentStatus.FINISHED,
            AgentStatus.LEAVING,
            AgentStatus.REMOVED,
        ):
            continue
        if state.id in known:
            continue
        gone.append(state.id)
    return gone


def mark_gone(registry: AgentRegistry, agent_ids: List[str]) -> List[AgentState]:
    """Tell the registry that these agents have left.

    The agent goes to the gate and waits there until the scene says its
    character has walked out, or until the grace period is over.
    """
    changed: List[AgentState] = []
    for agent_id in agent_ids:
        state = registry.get(agent_id)
        if state is None:
            continue
        changed.extend(
            registry.apply(
                AgentEvent.new(
                    type="removed",
                    agent_id=state.id,
                    kind=state.kind,
                    session_id=state.session_id,
                    parent_id=state.parent_id,
                    status=AgentStatus.LEAVING,
                    label=state.label,
                    detail=state.detail,
                    source="reconcile",
                )
            )
        )
    return changed
