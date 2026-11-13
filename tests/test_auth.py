"""The token on the local port, and the desktop notification."""

from __future__ import annotations

from agentpool import notify
from agentpool.api import auth


def test_an_empty_token_leaves_the_port_open():
    assert auth.token_matches("", None) is True
    assert auth.token_matches("", "anything") is True


def test_the_token_has_to_match():
    assert auth.token_matches("secret", "secret") is True
    assert auth.token_matches("secret", "wrong") is False
    assert auth.token_matches("secret", None) is False
    assert auth.token_matches("secret", "") is False


def test_the_token_is_read_from_the_header():
    class Headers(dict):
        def get(self, key, default=None):
            return dict.get(self, key, default)

    assert auth.token_from_headers(Headers({auth.HEADER: " secret "})) == "secret"
    assert auth.token_from_headers(Headers({})) is None
    assert auth.token_from_headers(None) is None


def test_only_the_local_hosts_are_local():
    assert auth.is_local_host("127.0.0.1") is True
    assert auth.is_local_host("localhost") is True
    assert auth.is_local_host("0.0.0.0") is False
    assert auth.is_local_host("192.168.1.10") is False


def test_a_page_from_another_origin_may_not_write():
    assert auth.origin_is_allowed(None) is True  # the hook, not a browser
    assert auth.origin_is_allowed("http://127.0.0.1:38000") is True
    assert auth.origin_is_allowed("http://localhost:5173") is True
    assert auth.origin_is_allowed("https://example.com") is False
    assert auth.origin_is_allowed("http://192.168.1.10:8080") is False


def test_the_content_types_a_browser_may_send_are_refused():
    assert auth.content_type_is_allowed(None) is True
    assert auth.content_type_is_allowed("application/json") is True
    assert auth.content_type_is_allowed("application/json; charset=utf-8") is True
    assert auth.content_type_is_allowed("text/plain") is False
    assert auth.content_type_is_allowed("application/x-www-form-urlencoded") is False


def test_a_page_cannot_put_a_character_that_does_not_exist_in_the_pool():
    """The whole point: a browser on another page cannot write."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from agentpool.api.ingest import create_ingest_router
    from agentpool.bridge.broker import Broker
    from agentpool.bridge.registry import AgentRegistry

    class Scene:
        scene_id = "test"

        async def on_agent_spawned(self, agent):
            pass

        async def on_agent_started(self, agent):
            pass

        async def on_agent_finished(self, agent):
            pass

        async def on_agent_removed(self, agent_id):
            pass

        async def on_session_event(self, event):
            pass

        def take_dirty(self):
            return []

        def presentation(self, agent):
            return {}

        def describe(self):
            return {}

    class Journal:
        def append(self, event):
            pass

    app = FastAPI()
    registry = AgentRegistry()
    app.include_router(
        create_ingest_router(registry, Broker(), Scene(), Journal())
    )
    client = TestClient(app)

    payload = {
        "hook_event_name": "SubagentStart",
        "session_id": "s1",
        "agent_id": "agent-made-up",
    }

    # A page on the internet cannot write.
    refused = client.post(
        "/hooks/SubagentStart",
        json=payload,
        headers={"origin": "https://example.com"},
    )
    assert refused.status_code == 200
    assert refused.json() == {"ok": True, "accepted": 0, "duplicates": 0}
    assert registry.snapshot() == []

    # The hook itself can: it does not come from a browser, so it does not
    # say where it comes from.
    allowed = client.post(
        "/hooks/SubagentStart",
        json=payload,
        headers={"content-type": "application/json"},
    )
    assert allowed.json()["accepted"] > 0
    assert len(registry.snapshot()) == 1

    # And it can even come with a content type that a browser may send
    # without a preflight, because a browser always says where it is from
    # and the hook does not. (A different agent, so that it is not simply
    # the same delivery twice.)
    plain = client.post(
        "/hooks/SubagentStart",
        json=dict(payload, agent_id="agent-plain"),
        headers={"content-type": "text/plain"},
    )
    assert plain.json()["accepted"] > 0
    assert len(registry.snapshot()) == 2


def test_the_notification_never_raises():
    # There is probably no notification daemon in the test environment.
    # The call must simply say that it did not show anything.
    assert notify.notify("AgentPool", "hello") in (True, False)


def test_a_short_run_is_not_worth_telling_somebody_about():
    assert notify.notify_finished("main", 1.0) is False


def test_the_duration_is_readable():
    assert notify.MIN_SECONDS == 30.0
