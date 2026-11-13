"""The counters on /api/metrics.

A number nobody can read is a number that does not exist. Everything the
backend drops, refuses or fails at is counted, and the counts are on one
endpoint.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from agentpool.app import create_app
from agentpool.config import Settings


def _client(tmp_path) -> TestClient:
    settings = Settings(
        state_dir=tmp_path / "state",
        claude_dir=tmp_path / "claude",
        journal_enabled=False,
    )
    return TestClient(create_app(settings))


def test_the_metrics_answer_with_the_counters(tmp_path) -> None:
    client = _client(tmp_path)
    payload = client.get("/api/metrics").json()

    assert payload["type"] == "metrics"
    assert "broker" in payload
    assert "hub" in payload
    assert "ingest" in payload
    assert "background" in payload
    assert payload["ingest"]["deliveries"] == 0


def test_a_delivery_is_counted(tmp_path) -> None:
    client = _client(tmp_path)
    payload = {
        "hook_event_name": "SubagentStart",
        "session_id": "s1",
        "agent_id": "agent-abc",
    }
    client.post("/hooks/SubagentStart", json=payload, headers={"content-type": "application/json"})

    metrics = client.get("/api/metrics").json()
    assert metrics["ingest"]["deliveries"] == 1
    assert metrics["ingest"]["accepted"] >= 1
    assert metrics["agents"] >= 1


def test_a_refused_delivery_is_counted_and_the_reason_is_kept(tmp_path) -> None:
    client = _client(tmp_path)
    payload = {
        "hook_event_name": "SubagentStart",
        "session_id": "s1",
        "agent_id": "agent-abc",
    }
    client.post(
        "/hooks/SubagentStart",
        json=payload,
        headers={"origin": "https://example.com"},
    )

    metrics = client.get("/api/metrics").json()
    assert metrics["ingest"]["refused"] == 1
    assert "example.com" in metrics["ingest"]["last_error"]
    assert metrics["ingest"]["last_error_at"] is not None


def test_a_duplicate_is_counted(tmp_path) -> None:
    client = _client(tmp_path)
    payload = {
        "hook_event_name": "SubagentStart",
        "session_id": "s1",
        "agent_id": "agent-abc",
    }
    headers = {"content-type": "application/json"}
    client.post("/hooks/SubagentStart", json=payload, headers=headers)
    client.post("/hooks/SubagentStart", json=payload, headers=headers)

    metrics = client.get("/api/metrics").json()
    assert metrics["ingest"]["deliveries"] == 2
    assert metrics["ingest"]["duplicates"] >= 1


def test_the_counters_need_the_token_too(tmp_path) -> None:
    """The counters are as much a part of the pool as the agents are."""
    settings = Settings(
        state_dir=tmp_path / "state",
        claude_dir=tmp_path / "claude",
        journal_enabled=False,
        token="s3cret",
    )
    client = TestClient(create_app(settings))

    assert client.get("/api/metrics").status_code == 401
    assert client.get("/api/metrics", headers={"X-AgentPool-Token": "s3cret"}).status_code == 200
    assert client.get("/api/metrics?token=s3cret").status_code == 200


def test_the_history_is_readable(tmp_path) -> None:
    client = _client(tmp_path)
    payload = client.get("/api/history").json()
    assert payload["type"] == "history"
    assert payload["count"] == len(payload["events"])
