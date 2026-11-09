"""Raw hook payload -> normalised events.

This is a **pure function**: no I/O, no state. The same payload always yields
the same events, which is what makes it testable and what makes the bridge
reusable by a future stadium / office project.
"""

from __future__ import annotations

import re
from typing import List, Optional, Union

from .events import AgentEvent, AgentKind, AgentStatus, SessionEvent
from .raw import RawHook

BridgeEvent = Union[AgentEvent, SessionEvent]

# The Agent tool reports the id of the subagent it spawned in its result.
_AGENT_ID_RE = re.compile(r"agentId:\s*([A-Za-z0-9_-]{6,64})")


def normalise_agent_id(raw: Optional[str]) -> Optional[str]:
    """Strip the optional ``agent-`` prefix so ids compare cleanly."""
    if not raw:
        return None
    return raw[6:] if raw.startswith("agent-") else raw


def _extract_agent_id(tool_response: object) -> Optional[str]:
    """Pull the spawned agent id out of the Agent tool's result."""

    def search(text: str) -> Optional[str]:
        match = _AGENT_ID_RE.search(text)
        return normalise_agent_id(match.group(1)) if match else None

    if isinstance(tool_response, str):
        return search(tool_response)
    if isinstance(tool_response, dict):
        direct = search(str(tool_response.get("content") or ""))
        if direct:
            return direct
        content = tool_response.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    text = block.get("text")
                    if isinstance(text, str):
                        found = search(text)
                        if found:
                            return found
    return None


def _mcp_server(tool_name: Optional[str]) -> Optional[str]:
    """``mcp__server__tool`` -> ``server``."""
    if not tool_name or not tool_name.startswith("mcp__"):
        return None
    parts = tool_name.split("__")
    if len(parts) < 3:
        return None
    return parts[1]


def normalize(payload: dict) -> List[BridgeEvent]:
    """Convert one raw hook payload into zero or more normalised events."""
    raw = RawHook(payload)
    event = raw.event
    session_id = raw.s("session_id", default="") or ""
    cwd = raw.s("cwd")
    agent_id = normalise_agent_id(raw.s("agent_id"))
    agent_type = raw.s("agent_type")

    events: List[BridgeEvent] = []

    if event == "SessionStart":
        events.append(
            AgentEvent.new(
                type="spawned",
                agent_id=f"session:{session_id}",
                kind=AgentKind.SESSION,
                session_id=session_id,
                parent_id=None,
                status=AgentStatus.IDLE,
                label=raw.s("session_title", default="main") or "main",
                detail=raw.s("source"),
                raw=dict(raw.p),
            )
        )
        events.append(
            SessionEvent.new(
                type="session_started",
                session_id=session_id,
                detail=raw.s("source"),
                raw=dict(raw.p),
            )
        )
        return events

    if event == "UserPromptSubmit":
        prompt = raw.s("prompt", default="") or ""
        events.append(
            AgentEvent.new(
                type="started",
                agent_id=f"session:{session_id}",
                kind=AgentKind.SESSION,
                session_id=session_id,
                parent_id=None,
                status=AgentStatus.WORKING,
                label="main",
                detail=prompt[:120],
                raw=dict(raw.p),
            )
        )
        events.append(
            SessionEvent.new(
                type="prompt",
                session_id=session_id,
                detail=prompt[:200],
                raw=dict(raw.p),
            )
        )
        return events

    if event == "SubagentStart":
        if not agent_id:
            return events
        events.append(
            AgentEvent.new(
                type="spawned",
                agent_id=f"sub:{agent_id}",
                kind=AgentKind.SUBAGENT,
                session_id=session_id,
                parent_id=f"session:{session_id}",
                status=AgentStatus.WORKING,
                label=agent_type or "subagent",
                detail=agent_type,
                subagent_type=agent_type,
                raw=dict(raw.p),
            )
        )
        events.append(
            AgentEvent.new(
                type="started",
                agent_id=f"sub:{agent_id}",
                kind=AgentKind.SUBAGENT,
                session_id=session_id,
                parent_id=f"session:{session_id}",
                status=AgentStatus.WORKING,
                label=agent_type or "subagent",
                subagent_type=agent_type,
                raw=dict(raw.p),
            )
        )
        return events

    if event == "SubagentStop":
        if not agent_id:
            return events
        events.append(
            AgentEvent.new(
                type="finished",
                agent_id=f"sub:{agent_id}",
                kind=AgentKind.SUBAGENT,
                session_id=session_id,
                parent_id=f"session:{session_id}",
                status=AgentStatus.FINISHED,
                label=agent_type or "subagent",
                detail=raw.s("last_assistant_message", default="")[:120] or None,
                subagent_type=agent_type,
                raw=dict(raw.p),
            )
        )
        return events

    if event in {"PreToolUse", "PostToolUse"}:
        tool_name = raw.s("tool_name", default="") or ""
        tool_use_id = raw.s("tool_use_id", default="") or ""
        tool_input = raw.o("tool_input") or {}

        if tool_name == "Agent":
            # The description and the subagent type arrive here, but the
            # concrete agent id only arrives with the result. The registry
            # joins the two through the tool use id.
            spawned_id = _extract_agent_id(raw.p.get("tool_response"))
            if event == "PostToolUse" and spawned_id:
                events.append(
                    AgentEvent.new(
                        type="spawn_bind",
                        agent_id=f"sub:{spawned_id}",
                        kind=AgentKind.SUBAGENT,
                        session_id=session_id,
                        parent_id=f"session:{session_id}",
                        status=AgentStatus.WORKING,
                        label=agent_type or "subagent",
                        detail=tool_input.get("description"),
                        tool_use_id=tool_use_id,
                        subagent_type=tool_input.get("subagent_type"),
                        raw=dict(raw.p),
                    )
                )
                return events

            events.append(
                AgentEvent.new(
                    type="spawn_hint",
                    agent_id=f"sub:pending:{tool_use_id}",
                    kind=AgentKind.SUBAGENT,
                    session_id=session_id,
                    parent_id=f"session:{session_id}",
                    status=AgentStatus.IDLE,
                    label=tool_input.get("subagent_type") or "subagent",
                    detail=tool_input.get("description"),
                    tool_use_id=tool_use_id,
                    subagent_type=tool_input.get("subagent_type"),
                    raw=dict(raw.p),
                )
            )
            return events

        server = _mcp_server(tool_name)
        if server:
            events.append(
                AgentEvent.new(
                    type="started" if event == "PreToolUse" else "note",
                    agent_id=f"mcp:{server}",
                    kind=AgentKind.MCP,
                    session_id=session_id,
                    parent_id=f"session:{session_id}",
                    status=AgentStatus.WORKING,
                    label=server,
                    detail=tool_name,
                    tool_name=tool_name,
                    tool_use_id=tool_use_id,
                    raw=dict(raw.p),
                )
            )
            return events

        # Any other tool: the main session is busy with something.
        events.append(
            AgentEvent.new(
                type="note",
                agent_id=f"session:{session_id}",
                kind=AgentKind.SESSION,
                session_id=session_id,
                parent_id=None,
                status=AgentStatus.WORKING,
                label="main",
                detail=tool_name,
                tool_name=tool_name,
                tool_use_id=tool_use_id,
                raw=dict(raw.p),
            )
        )
        return events

    if event == "Stop":
        events.append(
            AgentEvent.new(
                type="finished",
                agent_id=f"session:{session_id}",
                kind=AgentKind.SESSION,
                session_id=session_id,
                parent_id=None,
                status=AgentStatus.FINISHED,
                label="main",
                detail=raw.s("last_assistant_message", default="")[:120] or None,
                raw=dict(raw.p),
            )
        )
        # The Stop payload carries a snapshot of the in-flight background work.
        for task in raw.lst("background_tasks"):
            if not isinstance(task, dict):
                continue
            task_id = str(task.get("id") or "")
            if not task_id:
                continue
            events.append(
                AgentEvent.new(
                    type="started",
                    agent_id=f"wf:{task_id}",
                    kind=AgentKind.WORKFLOW,
                    session_id=session_id,
                    parent_id=f"session:{session_id}",
                    status=AgentStatus.WORKING,
                    label=task.get("agent_type") or task.get("type") or "task",
                    detail=task.get("description"),
                    raw=dict(task),
                )
            )
        return events

    if event == "SessionEnd":
        events.append(
            AgentEvent.new(
                type="removed",
                agent_id=f"session:{session_id}",
                kind=AgentKind.SESSION,
                session_id=session_id,
                parent_id=None,
                status=AgentStatus.REMOVED,
                label="main",
                detail=raw.s("reason"),
                raw=dict(raw.p),
            )
        )
        events.append(
            SessionEvent.new(
                type="session_ended",
                session_id=session_id,
                detail=raw.s("reason"),
                raw=dict(raw.p),
            )
        )
        return events

    if event == "Notification":
        notification_type = raw.s("notification_type", default="") or ""
        message = raw.s("message", default="") or ""
        if notification_type == "agent_completed" and agent_id:
            events.append(
                AgentEvent.new(
                    type="finished",
                    agent_id=f"sub:{agent_id}",
                    kind=AgentKind.SUBAGENT,
                    session_id=session_id,
                    parent_id=f"session:{session_id}",
                    status=AgentStatus.FINISHED,
                    label=agent_type or "subagent",
                    detail=message[:120] or None,
                    subagent_type=agent_type,
                    raw=dict(raw.p),
                )
            )
        else:
            events.append(
                SessionEvent.new(
                    type="notification",
                    session_id=session_id,
                    detail=f"{notification_type}: {message}"[:200] if notification_type else message[:200],
                    raw=dict(raw.p),
                )
            )
        return events

    if event == "PermissionRequest":
        events.append(
            SessionEvent.new(
                type="permission",
                session_id=session_id,
                detail=raw.s("tool_name"),
                raw=dict(raw.p),
            )
        )
        return events

    # Unknown event: keep it in the journal so nothing is silently lost.
    events.append(
        SessionEvent.new(
            type="unknown",
            session_id=session_id,
            detail=event or None,
            raw=dict(raw.p),
        )
    )
    return events
