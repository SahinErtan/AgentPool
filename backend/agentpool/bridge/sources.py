"""Readers for the state Claude Code keeps on disk.

These are the fallback for the moments the hooks cannot cover: the server
started late, a hook timed out, or the session was already running before
AgentPool existed.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Dict, List


def _to_seconds(value: Any) -> float:
    """Claude Code writes its timestamps in milliseconds.

    The rest of AgentPool thinks in seconds, so the two are converted here,
    once, instead of at every place that reads a timestamp.
    """
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if number <= 0:
        return 0.0
    # Anything above the year 5138 in seconds is really milliseconds.
    if number > 1e11:
        return number / 1000.0
    return number


def read_sessions(claude_dir: Path) -> List[Dict[str, Any]]:
    """Every live session from ``~/.claude/sessions/*.json``."""
    sessions: List[Dict[str, Any]] = []
    directory = claude_dir / "sessions"
    if not directory.is_dir():
        return sessions

    for path in sorted(directory.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        session_id = data.get("sessionId")
        if not session_id:
            continue
        sessions.append(
            {
                "session_id": session_id,
                "pid": data.get("pid"),
                "cwd": data.get("cwd"),
                "name": data.get("name") or "session",
                "kind": data.get("kind") or "interactive",
                "status": data.get("status") or "idle",
                "started_at": _to_seconds(data.get("startedAt")),
                "updated_at": _to_seconds(data.get("updatedAt")),
                "version": data.get("version"),
            }
        )
    return sessions


def read_subagents(claude_dir: Path) -> List[Dict[str, Any]]:
    """Every subagent Claude Code has written a transcript for."""
    found: List[Dict[str, Any]] = []
    projects = claude_dir / "projects"
    if not projects.is_dir():
        return found

    for meta_path in projects.glob("*/*/subagents/agent-*.meta.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(meta, dict):
            continue

        # "agent-<id>.meta.json" -> "<id>"
        agent_id = meta_path.name.replace("agent-", "", 1)
        if agent_id.endswith(".meta.json"):
            agent_id = agent_id[: -len(".meta.json")]
        session_id = meta_path.parent.parent.name
        try:
            modified = meta_path.stat().st_mtime
        except OSError:
            modified = 0.0
        found.append(
            {
                "agent_id": agent_id,
                "modified": modified,
                "session_id": session_id,
                "agent_type": meta.get("agentType"),
                "description": meta.get("description"),
                "tool_use_id": meta.get("toolUseId"),
                "spawn_depth": meta.get("spawnDepth"),
                "finished": bool(meta.get("finished")),
                "model": meta.get("pickedEffortModel"),
                "meta_path": str(meta_path),
            }
        )
    return found


def read_agents_cli(timeout: float = 3.0) -> List[Dict[str, Any]]:
    """``claude agents --json`` — the sanctioned machine interface.

    Only the background sessions show up here; the subagents a session spawns
    are not listed as separate rows.
    """
    try:
        result = subprocess.run(
            ["claude", "agents", "--json"],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except Exception:
        return []
    if result.returncode != 0:
        return []
    try:
        data = json.loads(result.stdout or "[]")
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]
