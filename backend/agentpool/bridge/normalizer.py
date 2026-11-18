"""Raw hook payload -> normalised events.

This is a **pure function**: no I/O, no state. The same payload always yields
the same events, which is what makes it testable and what makes the bridge
reusable by a future stadium / office project.
"""

from __future__ import annotations

import re
from dataclasses import replace
from typing import Any, List, Optional, Union
from urllib.parse import urlparse

from .events import AgentEvent, AgentKind, AgentStatus, SessionEvent
from .raw import RawHook

BridgeEvent = Union[AgentEvent, SessionEvent]

# The Agent tool reports the id of the subagent it spawned in its result.
_AGENT_ID_RE = re.compile(r"agentId:\s*([A-Za-z0-9_-]{6,64})")


def _injected(prompt: str) -> bool:
    """Whether a prompt was put in by the harness rather than typed.

    Messages from subagents, task notifications and slash-command
    expansions arrive through ``UserPromptSubmit`` too, wrapped in a tag.
    They are not what the person asked, so they never become the
    session's last prompt.
    """
    return prompt.lstrip().startswith("<")


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


# The longest a summary of what an agent does may be. The card and the list
# have one line each; a long command or a long path is cut, never wrapped.
ACTIVITY_LIMIT = 60

_FILE_TOOLS = frozenset({"Read", "Edit", "Write", "NotebookEdit"})


def _clip(text: str, limit: int = ACTIVITY_LIMIT) -> str:
    """One line, at most ``limit`` characters, with the cut marked by dots."""
    line = " ".join(text.split())
    if len(line) <= limit:
        return line
    return line[: limit - 3].rstrip() + "..."


def _first_line(value: Any) -> str:
    """The first line of a command that has something on it."""
    if not isinstance(value, str):
        return ""
    for line in value.splitlines():
        if line.strip():
            return line.strip()
    return ""


def _base_name(path: Any) -> str:
    """The file's own name, without the folders it sits in."""
    if not isinstance(path, str) or not path.strip():
        return ""
    parts = [part for part in re.split(r"[\\/]", path.rstrip("/\\")) if part]
    return parts[-1] if parts else ""


def _mcp_name(tool_name: str) -> Optional[str]:
    """``mcp__server__tool`` -> ``server: tool``, with the server's name short.

    A plugin's server is registered as ``plugin_<plugin>_<server>``, and the
    plugin name is often the server name twice over, so the short name is the
    last part of it: ``plugin_playwright_playwright`` reads ``playwright``.
    """
    parts = tool_name.split("__")
    if len(parts) < 3 or parts[0] != "mcp" or not parts[1]:
        return None
    server = parts[1]
    if server.startswith("plugin_"):
        rest = server[len("plugin_"):]
        halves = rest.split("_")
        middle = len(halves) // 2
        if len(halves) % 2 == 0 and halves[:middle] == halves[middle:]:
            server = "_".join(halves[:middle])
        else:
            server = halves[-1] or rest
    tool = "__".join(parts[2:])
    return f"{server}: {tool}"


def summarize_tool(tool_name: Optional[str], tool_input: Any) -> Optional[str]:
    """What a tool call is doing, in one short line: ``Bash: npm test``.

    The summary says what the agent is doing and not the details of it: the
    first line of a command, the name of a file, the host of a page. A
    missing input gives the bare tool name, so the summary always says
    something when there is a tool.
    """
    if not tool_name:
        return None
    tool_input = tool_input if isinstance(tool_input, dict) else {}

    if tool_name == "Bash":
        command = _first_line(tool_input.get("command"))
        summary = f"Bash: {command}" if command else "Bash"
    elif tool_name in _FILE_TOOLS:
        name = _base_name(tool_input.get("file_path") or tool_input.get("notebook_path"))
        summary = f"{tool_name}: {name}" if name else tool_name
    elif tool_name in {"Grep", "Glob"}:
        pattern = " ".join(str(tool_input.get("pattern") or "").split())
        summary = f"{tool_name}: {pattern}" if pattern else tool_name
    elif tool_name == "WebFetch":
        host = urlparse(str(tool_input.get("url") or "")).hostname
        summary = f"WebFetch: {host}" if host else tool_name
    elif tool_name == "WebSearch":
        query = " ".join(str(tool_input.get("query") or "").split())
        summary = f"WebSearch: {query}" if query else tool_name
    elif tool_name == "Agent":
        description = " ".join(str(tool_input.get("description") or "").split())
        summary = f"Agent: {description}" if description else tool_name
    elif tool_name == "Skill":
        skill = " ".join(str(tool_input.get("skill") or "").split())
        summary = f"Skill: {skill}" if skill else tool_name
    else:
        summary = _mcp_name(tool_name) or tool_name
    return _clip(summary)


def _effort_level(raw: RawHook) -> Optional[str]:
    """The reasoning effort a payload reports.

    The effort comes as a small object: ``{"level": "medium"}``. A payload
    without one says nothing about the effort, and an empty level is not a
    fact either.
    """
    effort = raw.o("effort")
    if not effort:
        return None
    level = effort.get("level")
    return level if isinstance(level, str) and level else None


def normalize(payload: dict) -> List[BridgeEvent]:
    """Convert one raw hook payload into zero or more normalised events.

    Every agent event carries the payload's folder: the folder is what the
    person sees in the inspector, and the registry gives it to the subagents
    that do not send one of their own.

    The same goes for the model and the effort. The payload of a session
    start names the model, and the payload of a tool call names the effort
    the agent works at; both are facts about the agent, so they ride along
    with every event the payload produces.
    """
    events = _normalise(payload)
    raw = RawHook(payload)
    cwd = raw.s("cwd")
    model = raw.s("model")
    effort = _effort_level(raw)
    if not (cwd or model or effort):
        return events
    return [
        replace(
            item,
            cwd=cwd or item.cwd,
            model=model or item.model,
            effort=effort or item.effort,
        )
        if isinstance(item, AgentEvent)
        else item
        for item in events
    ]


def _normalise(payload: dict) -> List[BridgeEvent]:
    raw = RawHook(payload)
    event = raw.event
    session_id = raw.s("session_id", default="") or ""
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
                label=raw.s("session_title"),
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
                detail=prompt[:120],
                prompt=(
                    None if _injected(prompt) else (prompt[:200] or None)
                ),
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
                label=agent_type,
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
                label=agent_type,
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
                label=agent_type,
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
                        label=agent_type,
                        detail=tool_input.get("description"),
                        description=tool_input.get("description"),
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
                    label=tool_input.get("subagent_type"),
                    detail=tool_input.get("description"),
                    description=tool_input.get("description"),
                    tool_use_id=tool_use_id,
                    subagent_type=tool_input.get("subagent_type"),
                    raw=dict(raw.p),
                )
            )
            # While the subagent is being started, starting it is what the
            # session is doing; otherwise the card keeps the tool before.
            if event == "PreToolUse" and not agent_id:
                events.append(
                    AgentEvent.new(
                        type="note",
                        agent_id=f"session:{session_id}",
                        kind=AgentKind.SESSION,
                        session_id=session_id,
                        parent_id=None,
                        status=AgentStatus.WORKING,
                        detail=tool_name,
                        tool_name=tool_name,
                        tool_use_id=tool_use_id,
                        activity=summarize_tool(tool_name, tool_input),
                        raw=dict(raw.p),
                    )
                )
            return events

        # Any other tool, an MCP server's included: the session is busy with
        # something. An MCP server is not a character of its own; its call is
        # shown as the activity of the session that made it.
        # The activity is set when the tool starts and kept until the next one.
        # A hook fired inside a subagent carries its agent id: the call is
        # that subagent's, not its session's, and the session may well be
        # idle while a background subagent works.
        if agent_id:
            events.append(
                AgentEvent.new(
                    type="note",
                    agent_id=f"sub:{agent_id}",
                    kind=AgentKind.SUBAGENT,
                    session_id=session_id,
                    parent_id=f"session:{session_id}",
                    status=AgentStatus.WORKING,
                    label=agent_type,
                    detail=tool_name,
                    tool_name=tool_name,
                    tool_use_id=tool_use_id,
                    subagent_type=agent_type,
                    activity=(
                        summarize_tool(tool_name, tool_input)
                        if event == "PreToolUse"
                        else None
                    ),
                    raw=dict(raw.p),
                )
            )
            return events
        events.append(
            AgentEvent.new(
                type="note",
                agent_id=f"session:{session_id}",
                kind=AgentKind.SESSION,
                session_id=session_id,
                parent_id=None,
                status=AgentStatus.WORKING,
                detail=tool_name,
                tool_name=tool_name,
                tool_use_id=tool_use_id,
                activity=(
                    summarize_tool(tool_name, tool_input)
                    if event == "PreToolUse"
                    else None
                ),
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
            if task.get("type") == "subagent":
                # A background subagent is the same agent SubagentStart made,
                # under the same id. As a workflow it was a second character
                # for one agent. Only one still running is news here.
                if task.get("status") not in (None, "running"):
                    continue
                events.append(
                    AgentEvent.new(
                        type="started",
                        agent_id=f"sub:{normalise_agent_id(task_id) or task_id}",
                        kind=AgentKind.SUBAGENT,
                        session_id=session_id,
                        parent_id=f"session:{session_id}",
                        status=AgentStatus.WORKING,
                        label=task.get("agent_type"),
                        detail=task.get("description"),
                        description=task.get("description"),
                        subagent_type=task.get("agent_type"),
                        raw=dict(task),
                    )
                )
                continue
            events.append(
                AgentEvent.new(
                    type="started",
                    agent_id=f"wf:{task_id}",
                    kind=AgentKind.WORKFLOW,
                    session_id=session_id,
                    parent_id=f"session:{session_id}",
                    status=AgentStatus.WORKING,
                    label=task.get("agent_type") or task.get("type"),
                    detail=task.get("description"),
                    description=task.get("description"),
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
                    label=agent_type,
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
