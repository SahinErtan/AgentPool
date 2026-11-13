"""One delivery, one effect.

A hook delivery that is retried — the network hiccups, the client gives up
and sends it again — must not be applied twice. The agent's event count may
not grow, the journal may not get a second line, and the scene may not be
told the same thing twice.
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import FastAPI
from fastapi.testclient import TestClient

from agentpool.api.ingest import create_ingest_router
from agentpool.app import create_app
from agentpool.bridge.broker import Broker
from agentpool.bridge.registry import AgentRegistry
from agentpool.config import Settings


class _CountingJournal:
    """A journal that only counts what it was given."""

    def __init__(self) -> None:
        self.appended: List[Any] = []

    def append(self, event: Any) -> None:
        self.appended.append(event)


class _CountingScene:
    """A scene that remembers every effect it was told about."""

    scene_id = "test"

    def __init__(self) -> None:
        self.spawned: List[str] = []
        self.started: List[str] = []
        self.finished: List[str] = []
        self.removed: List[str] = []
        self.session_events: List[Any] = []
        self.dirty: List[str] = []

    async def on_agent_spawned(self, agent) -> None:
        self.spawned.append(agent.id)

    async def on_agent_started(self, agent) -> None:
        self.started.append(agent.id)

    async def on_agent_finished(self, agent) -> None:
        self.finished.append(agent.id)

    async def on_agent_removed(self, agent_id: str) -> None:
        self.removed.append(agent_id)

    async def on_session_event(self, event) -> None:
        self.session_events.append(event)

    def knows(self, agent_id: str) -> bool:
        return agent_id in self.spawned or agent_id in self.started

    def take_dirty(self) -> List[str]:
        dirty, self.dirty = self.dirty, []
        return dirty

    def describe(self) -> Dict[str, Any]:
        return {"scene": self.scene_id}

    def presentation(self, agent) -> Dict[str, Any]:
        return {"mode": "active"}


def _payload(event_id: str = "delivery-1", agent_id: str = "abc123") -> Dict[str, Any]:
    """A subagent delivery."""
    return {
        "hook_event_name": "SubagentStart",
        "session_id": "s1",
        "agent_id": f"agent-{agent_id}",
        "agent_type": "Explore",
        "event_id": event_id,
    }


def _router_client(registry, scene, journal):
    """A tiny app that carries only the ingest router."""
    app = FastAPI()
    app.include_router(create_ingest_router(registry, Broker(), scene, journal))
    return TestClient(app)


def _app_client(tmp_path) -> TestClient:
    """The real application, with its state kept in a temporary directory."""
    settings = Settings(
        state_dir=tmp_path / "state",
        claude_dir=tmp_path / "claude",
        journal_enabled=True,
    )
    headers = {"X-AgentPool-Token": settings.token} if settings.token else {}
    return TestClient(create_app(settings), headers=headers)


def test_the_same_delivery_is_applied_only_once() -> None:
    """The retry of a delivery changes nothing: the agent counts one event."""
    registry = AgentRegistry()
    scene = _CountingScene()
    journal = _CountingJournal()
    client = _router_client(registry, scene, journal)
    payload = _payload()

    first = client.post("/hooks/SubagentStart", json=payload)
    second = client.post("/hooks/SubagentStart", json=payload)

    assert first.status_code == 200
    assert first.json() == {"ok": True, "accepted": 2, "duplicates": 0}
    assert second.status_code == 200
    assert second.json() == {"ok": True, "accepted": 0, "duplicates": 2}

    state = registry.get("sub:abc123")
    assert state is not None
    assert state.event_count == 2


def test_a_duplicate_reaches_neither_the_journal_nor_the_scene() -> None:
    """The duplicate is skipped whole: nothing is written and nothing is told."""
    registry = AgentRegistry()
    scene = _CountingScene()
    journal = _CountingJournal()
    client = _router_client(registry, scene, journal)

    client.post("/hooks/SubagentStart", json=_payload())
    client.post("/hooks/SubagentStart", json=_payload())

    assert len(journal.appended) == 2
    assert scene.spawned == ["sub:abc123"]
    assert scene.started == ["sub:abc123"]


def test_two_different_events_are_both_applied() -> None:
    """Two deliveries with different ids are two real events."""
    registry = AgentRegistry()
    scene = _CountingScene()
    journal = _CountingJournal()
    client = _router_client(registry, scene, journal)

    first = client.post("/hooks/SubagentStart", json=_payload("delivery-1", "aaa111"))
    second = client.post("/hooks/SubagentStart", json=_payload("delivery-2", "bbb222"))

    assert first.json() == {"ok": True, "accepted": 2, "duplicates": 0}
    assert second.json() == {"ok": True, "accepted": 2, "duplicates": 0}

    assert registry.get("sub:aaa111") is not None
    assert registry.get("sub:bbb222") is not None
    assert len(journal.appended) == 4
    assert scene.spawned == ["sub:aaa111", "sub:bbb222"]


def test_a_payload_without_an_id_is_applied_every_time() -> None:
    """Without anything that identifies it, the event is kept every time.

    A payload that cannot be told from its twin may be a real second
    event, so it is applied. Dropping it would lose the event; applying it
    twice is the safer mistake.
    """
    registry = AgentRegistry()
    scene = _CountingScene()
    journal = _CountingJournal()
    client = _router_client(registry, scene, journal)
    # A prompt carries no id, no tool use id and no agent id.
    payload = {
        "hook_event_name": "UserPromptSubmit",
        "session_id": "s1",
        "prompt": "do the thing",
    }

    first = client.post("/hooks/UserPromptSubmit", json=payload)
    second = client.post("/hooks/UserPromptSubmit", json=payload)

    assert first.json() == {"ok": True, "accepted": 2, "duplicates": 0}
    assert second.json() == {"ok": True, "accepted": 2, "duplicates": 0}

    assert len(journal.appended) == 4


def test_a_claude_code_payload_is_told_apart_by_its_agent_id() -> None:
    """The real payload has no delivery id, but it has an agent id.

    Claude Code does not put an id in the hook payload, so the key is
    taken from the fields that identify the event. A retried delivery of
    the same subagent is the same event.
    """
    registry = AgentRegistry()
    scene = _CountingScene()
    journal = _CountingJournal()
    client = _router_client(registry, scene, journal)
    payload = _payload()
    payload.pop("event_id")

    first = client.post("/hooks/SubagentStart", json=payload)
    second = client.post("/hooks/SubagentStart", json=payload)

    assert first.json() == {"ok": True, "accepted": 2, "duplicates": 0}
    assert second.json() == {"ok": True, "accepted": 0, "duplicates": 2}

    state = registry.get("sub:abc123")
    assert state is not None
    assert state.event_count == 2
    assert len(journal.appended) == 2


def test_a_tool_call_is_told_apart_by_its_tool_use_id() -> None:
    """The same tool call arrives before and after it ran: two events."""
    registry = AgentRegistry()
    scene = _CountingScene()
    journal = _CountingJournal()
    client = _router_client(registry, scene, journal)

    before = {
        "hook_event_name": "PreToolUse",
        "session_id": "s1",
        "tool_name": "Read",
        "tool_use_id": "toolu_01",
    }
    after = dict(before, hook_event_name="PostToolUse")

    first = client.post("/hooks/PreToolUse", json=before)
    second = client.post("/hooks/PostToolUse", json=after)
    again = client.post("/hooks/PreToolUse", json=before)

    assert first.json()["duplicates"] == 0
    assert second.json()["duplicates"] == 0
    # The very same delivery, sent again, is skipped.
    assert again.json()["duplicates"] == 1
    assert again.json()["accepted"] == 0


def test_the_real_application_survives_a_retried_delivery(tmp_path) -> None:
    """The whole app: the agent counts the event once and the journal once."""
    client = _app_client(tmp_path)
    payload = _payload()

    first = client.post("/hooks/SubagentStart", json=payload)
    second = client.post("/hooks/SubagentStart", json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["accepted"] == 2
    assert second.json()["accepted"] == 0
    assert second.json()["duplicates"] == 2

    registry = client.app.state.registry
    state = registry.get("sub:abc123")
    assert state is not None
    assert state.event_count == 2

    events = sorted((tmp_path / "state" / "events").glob("events-*.jsonl"))
    lines = [line for path in events for line in path.read_text().splitlines()]
    assert len(lines) == 2


def test_a_broken_payload_still_answers_ok(tmp_path) -> None:
    """The endpoint never raises: the session must not be disturbed."""
    client = _app_client(tmp_path)

    response = client.post(
        "/hooks/SubagentStart",
        content=b"not json",
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "accepted": 0, "duplicates": 0}


def test_a_finished_agent_is_not_a_failed_delivery(tmp_path) -> None:
    """An agent that finishes is told to the browser, not swallowed.

    Measured on the live pool: the counters said one delivery had failed
    with `name 'settings' is not defined`. The announcement of the finished
    agent used a name it did not have, and the error took the whole event
    with it — the browser was not told that the agent was done.
    """
    client = _app_client(tmp_path)

    start = {
        "hook_event_name": "SubagentStart",
        "session_id": "s1",
        "agent_id": "agent-abc",
        "agent_type": "Explore",
    }
    stop = {
        "hook_event_name": "SubagentStop",
        "session_id": "s1",
        "agent_id": "agent-abc",
        "agent_type": "Explore",
    }
    headers = {"content-type": "application/json"}
    client.post("/hooks/SubagentStart", json=start, headers=headers)
    client.post("/hooks/SubagentStop", json=stop, headers=headers)

    metrics = client.get("/api/metrics").json()
    assert metrics["ingest"]["failed"] == 0, metrics["ingest"]["last_error"]
    assert metrics["ingest"]["last_error"] is None

    agents = client.get("/api/state").json()["agents"]
    finished = [a for a in agents if a["status"] == "finished"]
    assert finished, "the agent that finished is not in the state"
