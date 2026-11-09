"""The stable internal event model.

This is the contract a future stadium / office project depends on. It must
never mention a pool, a lane, a lounger or a gate.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional


class AgentKind(str, Enum):
    SESSION = "session"  # a top-level Claude Code session
    SUBAGENT = "subagent"  # spawned through the Agent tool
    MCP = "mcp"  # an MCP server
    WORKFLOW = "workflow"  # workflow / background task


class AgentStatus(str, Enum):
    IDLE = "idle"  # exists, not working
    WORKING = "working"  # actively working
    FINISHED = "finished"  # just completed its turn (transient)
    LEAVING = "leaving"  # removed upstream, walking out (transient)
    REMOVED = "removed"  # gone from the scene


@dataclass(frozen=True)
class AgentEvent:
    """One normalised observation about one agent."""

    event_id: str
    ts: float
    type: str  # spawned | started | finished | removed | note
    agent_id: str
    kind: AgentKind
    session_id: Optional[str]
    parent_id: Optional[str]
    status: AgentStatus
    label: str
    detail: Optional[str] = None
    tool_name: Optional[str] = None
    tool_use_id: Optional[str] = None
    subagent_type: Optional[str] = None
    source: str = "hook"  # hook | reconcile | transcript
    raw: Dict[str, Any] = field(default_factory=dict)

    @staticmethod
    def new(**kwargs: Any) -> "AgentEvent":
        kwargs.setdefault("event_id", uuid.uuid4().hex)
        kwargs.setdefault("ts", time.time())
        return AgentEvent(**kwargs)


@dataclass(frozen=True)
class SessionEvent:
    """A session-level observation that is not tied to a single agent."""

    event_id: str
    ts: float
    type: str  # session_started | session_ended | prompt | notification | permission
    session_id: str
    detail: Optional[str] = None
    source: str = "hook"
    raw: Dict[str, Any] = field(default_factory=dict)

    @staticmethod
    def new(**kwargs: Any) -> "SessionEvent":
        kwargs.setdefault("event_id", uuid.uuid4().hex)
        kwargs.setdefault("ts", time.time())
        return SessionEvent(**kwargs)
