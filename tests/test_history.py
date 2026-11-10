"""The journal read back: the history, and the state that survives a restart."""

from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from agentpool.api.state import create_state_router
from agentpool.bridge.events import AgentEvent, AgentKind, AgentStatus
from agentpool.bridge.registry import AgentRegistry
from agentpool.scenes.registry import build_scene
from agentpool.store.journal import Journal


def make_event(**kwargs) -> AgentEvent:
    """An agent event with the fields the journal writes."""
    kwargs.setdefault("type", "spawned")
    kwargs.setdefault("agent_id", "sub:a1")
    kwargs.setdefault("kind", AgentKind.SUBAGENT)
    kwargs.setdefault("session_id", "s1")
    kwargs.setdefault("parent_id", "session:s1")
    kwargs.setdefault("status", AgentStatus.IDLE)
    kwargs.setdefault("label", "Explore")
    return AgentEvent.new(**kwargs)


def journal_of(tmp_path: Path, events) -> Journal:
    """A journal with the given events written to it."""
    journal = Journal(tmp_path, keep_days=7)
    for event in events:
        journal.append(event)
    return journal


def today_file(tmp_path: Path) -> Path:
    today = time.strftime("%Y-%m-%d", time.localtime())
    return tmp_path / f"events-{today}.jsonl"


def test_the_events_round_trip_through_the_file(tmp_path: Path) -> None:
    event = make_event(detail="looking around", tool_name="Read")
    journal = journal_of(tmp_path, [event])

    lines = today_file(tmp_path).read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1

    payload = json.loads(lines[0])
    assert payload["type"] == "spawned"
    assert payload["agent_id"] == "sub:a1"
    assert payload["kind"] == "subagent"
    assert payload["status"] == "idle"
    assert payload["detail"] == "looking around"
    assert payload["tool_name"] == "Read"
    assert payload["ts"] == event.ts


def test_the_recent_events_are_newest_first(tmp_path: Path) -> None:
    journal = journal_of(
        tmp_path,
        [
            make_event(type="spawned", ts=1000.0),
            make_event(type="started", ts=2000.0, status=AgentStatus.WORKING),
            make_event(type="finished", ts=3000.0, status=AgentStatus.FINISHED),
        ],
    )

    recent = journal.recent()

    assert [item["type"] for item in recent] == ["finished", "started", "spawned"]


def test_the_recent_events_can_be_limited_and_filtered(tmp_path: Path) -> None:
    journal = journal_of(
        tmp_path,
        [
            make_event(agent_id="sub:a1", type="spawned", ts=1000.0),
            make_event(agent_id="sub:a2", type="spawned", ts=2000.0),
            make_event(agent_id="sub:a2", type="finished", ts=3000.0),
        ],
    )

    assert len(journal.recent(limit=2)) == 2
    only_a2 = journal.recent(agent_id="sub:a2")
    assert [item["agent_id"] for item in only_a2] == ["sub:a2", "sub:a2"]
    assert journal.recent(agent_id="nobody") == []


def test_the_agents_are_restored_into_the_registry(tmp_path: Path) -> None:
    journal = journal_of(
        tmp_path,
        [
            make_event(type="spawned", ts=1000.0),
            make_event(type="started", ts=2000.0, status=AgentStatus.WORKING),
            make_event(type="finished", ts=3000.0, status=AgentStatus.FINISHED),
        ],
    )

    registry = AgentRegistry()
    restored = await_journal_replay(journal, registry)

    assert restored == 1
    state = registry.get("sub:a1")
    assert state is not None
    assert state.status is AgentStatus.FINISHED
    assert state.finished_at == 3000.0
    assert state.last_event_at == 3000.0
    assert state.event_count == 3


def test_a_restored_agent_keeps_the_time_it_really_finished(tmp_path: Path) -> None:
    """An agent that finished an hour ago must not look like it just did."""
    now = time.time()
    journal = journal_of(
        tmp_path,
        [
            make_event(type="spawned", ts=now - 3600.0),
            make_event(type="finished", ts=now - 1800.0, status=AgentStatus.FINISHED),
        ],
    )

    registry = AgentRegistry()
    await_journal_replay(journal, registry)

    state = registry.get("sub:a1")
    assert state is not None
    assert state.finished_at == now - 1800.0
    assert state.finished_at < time.time() - 900.0


def test_a_journal_that_is_empty_or_missing_restores_nothing(tmp_path: Path) -> None:
    journal = Journal(tmp_path / "missing", keep_days=7)
    registry = AgentRegistry()
    assert await_journal_replay(journal, registry) == 0
    assert len(registry) == 0


def test_a_journal_that_is_off_restores_nothing(tmp_path: Path) -> None:
    journal = Journal(tmp_path, enabled=False, keep_days=7)
    journal.append(make_event())
    registry = AgentRegistry()
    assert await_journal_replay(journal, registry) == 0


def test_a_half_written_last_line_does_not_break_the_replay(tmp_path: Path) -> None:
    journal = journal_of(
        tmp_path,
        [
            make_event(type="spawned", ts=1000.0),
            make_event(type="finished", ts=2000.0, status=AgentStatus.FINISHED),
        ],
    )

    # The last line was cut in half by a crash.
    path = today_file(tmp_path)
    with path.open("a", encoding="utf-8") as handle:
        handle.write('{"type": "finished", "agent_id": "sub:a2"')

    registry = AgentRegistry()
    restored = await_journal_replay(journal, registry)

    assert restored == 1
    assert registry.get("sub:a1") is not None


def test_the_replay_does_not_write_anything(tmp_path: Path) -> None:
    journal = journal_of(tmp_path, [make_event()])
    registry = AgentRegistry()
    await_journal_replay(journal, registry)

    assert list(tmp_path.iterdir()) == [today_file(tmp_path)]


def test_the_history_endpoint_returns_the_events_newest_first(tmp_path: Path) -> None:
    journal = journal_of(
        tmp_path,
        [
            make_event(agent_id="sub:a1", type="spawned", ts=1000.0),
            make_event(agent_id="sub:a2", type="spawned", ts=2000.0),
            make_event(agent_id="sub:a2", type="finished", ts=3000.0),
        ],
    )

    with client_for(journal) as client:
        payload = client.get("/api/history").json()

    assert payload["count"] == 3
    assert [item["type"] for item in payload["events"]] == ["finished", "spawned", "spawned"]


def test_the_history_endpoint_limits_and_filters(tmp_path: Path) -> None:
    journal = journal_of(
        tmp_path,
        [
            make_event(agent_id="sub:a1", type="spawned", ts=1000.0),
            make_event(agent_id="sub:a2", type="spawned", ts=2000.0),
            make_event(agent_id="sub:a2", type="finished", ts=3000.0),
        ],
    )

    with client_for(journal) as client:
        limited = client.get("/api/history?limit=1").json()
        assert limited["count"] == 1
        assert limited["events"][0]["type"] == "finished"

        filtered = client.get("/api/history?agent=sub:a2").json()
        assert filtered["count"] == 2
        assert {item["agent_id"] for item in filtered["events"]} == {"sub:a2"}


def test_the_history_endpoint_refuses_a_limit_that_is_too_big(tmp_path: Path) -> None:
    with client_for(Journal(tmp_path)) as client:
        assert client.get("/api/history?limit=5000").status_code == 422


def await_journal_replay(journal: Journal, registry: AgentRegistry) -> int:
    """Replay the journal into the registry."""
    import asyncio

    return asyncio.run(journal.replay_into(registry))


def client_for(journal: Journal) -> TestClient:
    """A client for the state endpoints alone."""
    app = FastAPI()
    registry = AgentRegistry()
    app.include_router(create_state_router(registry, build_scene("pool"), time.time(), journal))
    return TestClient(app)
