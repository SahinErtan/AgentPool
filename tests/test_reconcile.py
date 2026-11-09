"""The reconciler: what it corrects and what it must not undo."""

from __future__ import annotations

import json
import time
from pathlib import Path

from agentpool.bridge.events import AgentEvent, AgentKind, AgentStatus
from agentpool.bridge.reconcile import reconcile
from agentpool.bridge.registry import AgentRegistry


def write_session(claude_dir: Path, session_id: str, status: str, updated_at: float) -> None:
    directory = claude_dir / "sessions"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{session_id}.json").write_text(
        json.dumps(
            {
                "sessionId": session_id,
                "pid": 4242,
                "cwd": "/tmp",
                "name": "main",
                "status": status,
                # Claude Code writes milliseconds.
                "updatedAt": updated_at * 1000,
            }
        ),
        encoding="utf-8",
    )


def write_subagent(
    claude_dir: Path,
    session_id: str,
    agent_id: str,
    *,
    finished: bool,
    modified: float,
    agent_type: str = "Explore",
) -> Path:
    directory = claude_dir / "projects" / "tmp-project" / session_id / "subagents"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"agent-{agent_id}.meta.json"
    path.write_text(
        json.dumps(
            {
                "agentType": agent_type,
                "description": "look around",
                "toolUseId": "toolu_1",
                "finished": finished,
            }
        ),
        encoding="utf-8",
    )
    import os

    os.utime(path, (modified, modified))
    return path


def test_a_live_session_is_picked_up(tmp_path: Path) -> None:
    write_session(tmp_path, "s1", "busy", time.time())
    registry = AgentRegistry()

    changed = reconcile(registry, tmp_path, use_cli=False)

    assert len(changed) == 1
    state = registry.get("session:s1")
    assert state is not None
    assert state.status is AgentStatus.WORKING


def test_a_running_subagent_is_picked_up(tmp_path: Path) -> None:
    write_session(tmp_path, "s1", "busy", time.time())
    write_subagent(tmp_path, "s1", "abc123", finished=False, modified=time.time())
    registry = AgentRegistry()

    reconcile(registry, tmp_path, use_cli=False)

    state = registry.get("sub:abc123")
    assert state is not None
    assert state.status is AgentStatus.WORKING
    assert state.subagent_type == "Explore"


def test_a_finished_subagent_is_history_not_a_new_agent(tmp_path: Path) -> None:
    write_session(tmp_path, "s1", "busy", time.time())
    write_subagent(tmp_path, "s1", "abc123", finished=True, modified=time.time())
    registry = AgentRegistry()

    reconcile(registry, tmp_path, use_cli=False)

    assert registry.get("sub:abc123") is None


def test_a_missed_stop_is_corrected_from_the_disk(tmp_path: Path) -> None:
    """The subagent finished, but the stop hook never arrived."""
    now = time.time()
    write_session(tmp_path, "s1", "busy", now)
    write_subagent(tmp_path, "s1", "abc123", finished=False, modified=now)
    registry = AgentRegistry()
    reconcile(registry, tmp_path, use_cli=False)

    # The hook arrives for the start.
    registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id="sub:abc123",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label="Explore",
            source="hook",
        )
    )

    # Now the file says it is done, and it is newer than the last event.
    write_subagent(tmp_path, "s1", "abc123", finished=True, modified=time.time() + 10)

    changed = reconcile(registry, tmp_path, use_cli=False)

    assert len(changed) == 1
    state = registry.get("sub:abc123")
    assert state is not None
    assert state.status is AgentStatus.FINISHED


def test_the_merge_never_goes_backwards(tmp_path: Path) -> None:
    """A file that is older than the last event does not undo it."""
    old = time.time() - 600
    write_session(tmp_path, "s1", "idle", old)
    registry = AgentRegistry()

    # The hook says the session is working, and it is newer than the file.
    registry.apply(
        AgentEvent.new(
            type="started",
            agent_id="session:s1",
            kind=AgentKind.SESSION,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.WORKING,
            label="main",
            source="hook",
        )
    )

    changed = reconcile(registry, tmp_path, use_cli=False)

    assert changed == []
    state = registry.get("session:s1")
    assert state is not None
    assert state.status is AgentStatus.WORKING


def test_a_newer_file_does_correct_the_state(tmp_path: Path) -> None:
    """When the disk is newer than the last event, the disk wins."""
    registry = AgentRegistry()
    registry.apply(
        AgentEvent.new(
            type="started",
            agent_id="session:s1",
            kind=AgentKind.SESSION,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.WORKING,
            label="main",
            source="hook",
        )
    )

    write_session(tmp_path, "s1", "idle", time.time() + 10)

    changed = reconcile(registry, tmp_path, use_cli=False)

    assert len(changed) == 1
    state = registry.get("session:s1")
    assert state is not None
    assert state.status is AgentStatus.IDLE
