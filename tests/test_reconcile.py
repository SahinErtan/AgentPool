"""The reconciler: what it corrects and what it must not undo."""

from __future__ import annotations

import json
import time
from pathlib import Path

from agentpool.bridge.events import AgentEvent, AgentKind, AgentStatus
from agentpool.bridge.reconcile import gone_agents, mark_gone, reconcile
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


def test_an_agent_the_disk_does_not_know_is_gone(tmp_path: Path) -> None:
    """The disk is the truth in both directions.

    Measured on the live pool: a background task of another session that
    had been over for a day was still in the pool, on a lounger, for ever.
    The reconciler merged what the disk had and never took anything out.
    """
    registry = AgentRegistry()
    registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id="wf:old",
            kind=AgentKind.WORKFLOW,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.WORKING,
            label="shell",
            source="hook",
        )
    )

    gone = gone_agents(registry, tmp_path, use_cli=False)

    assert gone == ["wf:old"]


def test_an_agent_the_disk_knows_stays(tmp_path: Path) -> None:
    write_session(tmp_path, "s1", "busy", time.time())
    registry = AgentRegistry()
    registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id="session:s1",
            kind=AgentKind.SESSION,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.WORKING,
            label="main",
            source="hook",
        )
    )

    assert gone_agents(registry, tmp_path, use_cli=False) == []


def test_a_finished_agent_is_left_to_the_sweeper(tmp_path: Path) -> None:
    """An agent on its way out is not the reconciler's business."""
    registry = AgentRegistry()
    registry.apply(
        AgentEvent.new(
            type="finished",
            agent_id="sub:done",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.FINISHED,
            label="Explore",
            source="hook",
        )
    )

    assert gone_agents(registry, tmp_path, use_cli=False) == []


def test_a_cli_that_cannot_be_read_means_nothing(tmp_path: Path, monkeypatch) -> None:
    """A CLI that fails is not an empty list.

    The rule that takes the agents out must not fire when the disk could
    not be read, or a hiccup of the CLI would empty the pool.
    """
    import agentpool.bridge.reconcile as reconcile_module

    monkeypatch.setattr(reconcile_module, "read_agents_cli", lambda timeout=3.0: None)

    registry = AgentRegistry()
    registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id="wf:old",
            kind=AgentKind.WORKFLOW,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.WORKING,
            label="shell",
            source="hook",
        )
    )

    assert gone_agents(registry, tmp_path, use_cli=True) == []


def test_the_agents_that_are_gone_walk_out_of_the_gate(tmp_path: Path) -> None:
    """The scene has to hear about it, or the place is kept for ever."""
    registry = AgentRegistry()
    registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id="wf:old",
            kind=AgentKind.WORKFLOW,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.WORKING,
            label="shell",
            source="hook",
        )
    )

    changed = mark_gone(registry, gone_agents(registry, tmp_path, use_cli=False))

    assert len(changed) == 1
    state = registry.get("wf:old")
    assert state is not None
    assert state.status is AgentStatus.LEAVING


def test_a_session_named_on_the_disk_keeps_that_name_through_its_hooks(tmp_path: Path) -> None:
    """The reconciler reads the name; the hooks that follow must not undo it."""
    from agentpool.bridge.normalizer import normalize

    now = time.time()
    write_session(tmp_path, "s1", "busy", now)
    session_file = tmp_path / "sessions" / "s1.json"
    data = json.loads(session_file.read_text(encoding="utf-8"))
    data["name"] = "pool-scene-3d-sprint"
    session_file.write_text(json.dumps(data), encoding="utf-8")

    registry = AgentRegistry()
    reconcile(registry, tmp_path, use_cli=False)
    assert registry.get("session:s1").label == "pool-scene-3d-sprint"

    for payload in [
        {"hook_event_name": "UserPromptSubmit", "session_id": "s1", "prompt": "go"},
        {"hook_event_name": "PreToolUse", "session_id": "s1", "tool_name": "Read",
         "tool_use_id": "call-1", "tool_input": {"file_path": "/tmp/a.ts"}},
        {"hook_event_name": "Stop", "session_id": "s1", "background_tasks": []},
    ]:
        for event in normalize(payload):
            if isinstance(event, AgentEvent):
                registry.apply(event)

    assert registry.get("session:s1").label == "pool-scene-3d-sprint"


def write_transcript(claude_dir: Path, session_id: str, model: str, tokens: int) -> Path:
    """A transcript with one assistant turn in it."""
    directory = claude_dir / "projects" / "tmp-project"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{session_id}.jsonl"
    path.write_text(
        json.dumps(
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "model": model,
                    "usage": {
                        "input_tokens": tokens,
                        "cache_read_input_tokens": 0,
                        "cache_creation_input_tokens": 0,
                        "output_tokens": 20,
                    },
                },
            }
        )
        + "\n",
        encoding="utf-8",
    )
    return path


def test_a_session_gets_its_model_and_its_tokens_from_the_transcript(tmp_path: Path) -> None:
    write_session(tmp_path, "s1", "busy", time.time())
    write_transcript(tmp_path, "s1", "claude-opus-5-5", 1200)
    registry = AgentRegistry()

    reconcile(registry, tmp_path, use_cli=False)

    state = registry.get("session:s1")
    assert state is not None
    assert state.model == "claude-opus-5-5"
    assert state.tokens_in == 1200
    assert state.tokens_out == 20
    assert state.tokens_total == 1220


def test_a_subagent_gets_its_model_from_the_metadata_file(tmp_path: Path) -> None:
    write_session(tmp_path, "s1", "busy", time.time())
    directory = tmp_path / "projects" / "tmp-project" / "s1" / "subagents"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "agent-abc123.meta.json").write_text(
        json.dumps(
            {
                "agentType": "Explore",
                "description": "look around",
                "toolUseId": "toolu_1",
                "finished": False,
                "pickedEffortModel": "MiniMax-M3.1-Flash",
            }
        ),
        encoding="utf-8",
    )
    import os

    os.utime(directory / "agent-abc123.meta.json", (time.time(), time.time()))
    registry = AgentRegistry()

    reconcile(registry, tmp_path, use_cli=False)

    state = registry.get("sub:abc123")
    assert state is not None
    assert state.model == "MiniMax-M3.1-Flash"
