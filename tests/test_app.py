"""The application: how the agents that are gone reach the browser."""

from __future__ import annotations

from agentpool.app import split_swept
from agentpool.bridge.events import AgentEvent, AgentKind, AgentStatus
from agentpool.bridge.registry import AgentRegistry


def make_registry() -> AgentRegistry:
    registry = AgentRegistry()
    registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.IDLE,
            label="Explore",
        )
    )
    return registry


def test_the_agents_that_are_gone_are_sent_as_a_removal() -> None:
    """Sending a dropped agent as an update would put it back."""
    registry = make_registry()
    state = registry.get("sub:a1")

    # The sweeper drops the agent whose time is up.
    registry._agents.pop("sub:a1")

    upserts, removals = split_swept(registry, [state])

    assert removals == ["sub:a1"]
    assert upserts == []


def test_the_agents_that_only_changed_are_sent_as_an_update() -> None:
    registry = make_registry()
    state = registry.get("sub:a1")

    upserts, removals = split_swept(registry, [state])

    assert removals == []
    assert upserts == [state]
