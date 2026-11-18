"""The journal: what it writes, and what it throws away."""

from __future__ import annotations

import time
from pathlib import Path

from agentpool.store.journal import Journal


def test_the_events_go_into_the_file_of_the_day(tmp_path: Path) -> None:
    journal = Journal(tmp_path, keep_days=7)
    journal.append({"type": "session_start", "detail": "hello"})

    today = time.strftime("%Y-%m-%d", time.localtime())
    written = tmp_path / f"events-{today}.jsonl"
    assert written.exists()
    assert "session_start" in written.read_text(encoding="utf-8")


def test_the_old_files_are_thrown_away(tmp_path: Path) -> None:
    journal = Journal(tmp_path, keep_days=7)

    now = time.time()
    old = tmp_path / "events-2020-01-01.jsonl"
    recent = tmp_path / "events-2020-02-08.jsonl"
    old.write_text("{}", encoding="utf-8")
    recent.write_text("{}", encoding="utf-8")

    # "now" is in February, so the January file is the old one and the
    # February one is still within the week.
    now = time.mktime(time.strptime("2020-02-10", "%Y-%m-%d"))
    removed = journal.prune(now=now)

    assert removed == [old]
    assert not old.exists()
    assert recent.exists()


def test_the_file_of_today_is_kept(tmp_path: Path) -> None:
    journal = Journal(tmp_path, keep_days=7)
    now = time.time()
    today = tmp_path / f"events-{time.strftime('%Y-%m-%d', time.localtime(now))}.jsonl"
    today.write_text("{}", encoding="utf-8")

    journal.prune(now=now)

    assert today.exists()


def test_a_file_that_is_not_a_journal_file_is_left_alone(tmp_path: Path) -> None:
    journal = Journal(tmp_path, keep_days=7)
    other = tmp_path / "notes.txt"
    other.write_text("hello", encoding="utf-8")

    journal.prune(now=time.time())

    assert other.exists()


def test_a_journal_that_is_off_keeps_everything(tmp_path: Path) -> None:
    journal = Journal(tmp_path, enabled=False, keep_days=7)
    old = tmp_path / "events-2020-01-01.jsonl"
    old.write_text("{}", encoding="utf-8")

    now = time.mktime(time.strptime("2020-02-10", "%Y-%m-%d"))
    assert journal.prune(now=now) == []
    assert old.exists()


def test_a_retention_of_zero_keeps_everything(tmp_path: Path) -> None:
    journal = Journal(tmp_path, keep_days=0)
    old = tmp_path / "events-2020-01-01.jsonl"
    old.write_text("{}", encoding="utf-8")

    now = time.mktime(time.strptime("2020-02-10", "%Y-%m-%d"))
    assert journal.prune(now=now) == []
    assert old.exists()


def test_pruning_a_directory_that_is_not_there_is_not_a_problem(tmp_path: Path) -> None:
    journal = Journal(tmp_path / "missing", keep_days=7)
    assert journal.prune(now=time.time()) == []


def test_the_replay_only_covers_the_window(tmp_path: Path) -> None:
    """The journal is a week long; the pool is for now.

    Measured on the live pool: the boot replayed 372 agents out of a week
    of journal, and the ones whose last event was a start came back as
    working. Nothing ever finished them, so they lay on a lounger for ever
    — five-day-old characters in a pool of two.
    """
    import asyncio

    from agentpool.bridge.events import AgentEvent, AgentKind, AgentStatus
    from agentpool.bridge.registry import AgentRegistry

    journal = Journal(tmp_path, keep_days=7)
    now = time.time()

    def event(agent_id: str, ts: float) -> AgentEvent:
        return AgentEvent.new(
            type="spawned",
            agent_id=agent_id,
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label="Explore",
            source="hook",
            ts=ts,
        )

    journal.append(event("sub:old", now - 86400))
    journal.append(event("sub:new", now - 60))

    registry = AgentRegistry()
    restored = asyncio.run(journal.replay_into(registry, since=now - 900))

    assert restored == 1, "the old agent was put back into the pool"
    assert registry.get("sub:old") is None
    assert registry.get("sub:new") is not None


def test_the_replay_without_a_window_takes_everything(tmp_path: Path) -> None:
    import asyncio

    from agentpool.bridge.events import AgentEvent, AgentKind, AgentStatus
    from agentpool.bridge.registry import AgentRegistry

    journal = Journal(tmp_path, keep_days=7)
    journal.append(
        AgentEvent.new(
            type="spawned",
            agent_id="sub:old",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label="Explore",
            source="hook",
            ts=time.time() - 86400,
        )
    )

    registry = AgentRegistry()
    restored = asyncio.run(journal.replay_into(registry))

    assert restored == 1
    assert registry.get("sub:old") is not None


def test_a_replay_keeps_the_name_the_description_and_the_folder(tmp_path: Path) -> None:
    import asyncio

    from agentpool.bridge.events import AgentEvent, AgentKind, AgentStatus
    from agentpool.bridge.registry import AgentRegistry

    journal = Journal(tmp_path, keep_days=7)
    journal.append(
        AgentEvent.new(
            type="spawned",
            agent_id="session:s1",
            kind=AgentKind.SESSION,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.IDLE,
            label=None,
            cwd="/home/alice/work/AgentPool",
            source="hook",
        )
    )
    journal.append(
        AgentEvent.new(
            type="spawn_hint",
            agent_id="sub:pending:call-1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.IDLE,
            label="Explore",
            detail="Implement Sprint 21",
            description="Implement Sprint 21",
            tool_use_id="call-1",
            subagent_type="Explore",
            source="hook",
        )
    )
    journal.append(
        AgentEvent.new(
            type="spawned",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label="Explore",
            tool_use_id="call-1",
            source="hook",
        )
    )
    journal.append(
        AgentEvent.new(
            type="spawn_bind",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label=None,
            tool_use_id="call-1",
            source="hook",
        )
    )
    # An old record of an MCP server, written before the server stopped
    # being a character.
    journal.append(
        AgentEvent.new(
            type="started",
            agent_id="mcp:chrome-devtools",
            kind=AgentKind.MCP,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label="chrome-devtools",
            tool_name="mcp__chrome-devtools__click",
            source="hook",
        )
    )

    registry = AgentRegistry()
    asyncio.run(journal.replay_into(registry))

    assert registry.get("mcp:chrome-devtools") is None
    session = registry.get("session:s1")
    assert session.label == "main"  # no name on the disk: the placeholder
    assert session.cwd == "/home/alice/work/AgentPool"
    subagent = registry.get("sub:a1")
    assert subagent.label == "Explore"
    assert subagent.description == "Implement Sprint 21"
    payload = registry.payload(subagent)
    assert payload["name"] == "Implement Sprint 21"
    assert payload["project"] == "AgentPool"


def test_a_label_the_event_did_not_name_is_not_written_as_none_text(tmp_path: Path) -> None:
    import asyncio

    from agentpool.bridge.events import AgentEvent, AgentKind, AgentStatus
    from agentpool.bridge.registry import AgentRegistry

    journal = Journal(tmp_path, keep_days=7)
    journal.append(
        AgentEvent.new(
            type="started",
            agent_id="session:s9",
            kind=AgentKind.SESSION,
            session_id="s9",
            parent_id=None,
            status=AgentStatus.WORKING,
            label=None,
            source="hook",
        )
    )
    registry = AgentRegistry()
    asyncio.run(journal.replay_into(registry))
    assert registry.get("session:s9").label == "main"


def test_a_replay_keeps_the_model_and_the_effort(tmp_path: Path) -> None:
    import asyncio

    from agentpool.bridge.events import AgentEvent, AgentKind, AgentStatus
    from agentpool.bridge.registry import AgentRegistry

    journal = Journal(tmp_path, keep_days=7)
    journal.append(
        AgentEvent.new(
            type="spawned",
            agent_id="session:s1",
            kind=AgentKind.SESSION,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.IDLE,
            model="claude-opus-5-5",
            effort="medium",
            source="hook",
        )
    )

    registry = AgentRegistry()
    asyncio.run(journal.replay_into(registry))

    session = registry.get("session:s1")
    assert session.model == "claude-opus-5-5"
    assert session.effort == "medium"
