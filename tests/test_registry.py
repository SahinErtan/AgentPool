"""The registry: the agent lifecycle and the identity joins."""

from __future__ import annotations

from agentpool.bridge.events import AgentEvent, AgentKind, AgentStatus
from agentpool.bridge.registry import AgentRegistry


def make_registry(**kwargs):
    """A registry with a frozen clock so the sweepers can be tested."""
    if "clock" not in kwargs:
        now = [1000.0]

        def clock():
            return now[0]

        kwargs["clock"] = clock
    return AgentRegistry(**kwargs)


def spawn(registry, agent_id="sub:a1", status=AgentStatus.WORKING, **kwargs):
    return registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id=agent_id,
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=status,
            label=kwargs.pop("label", "Explore"),
            **kwargs,
        )
    )


def test_a_spawned_agent_exists_and_works():
    registry = make_registry()
    spawn(registry)
    agent = registry.get("sub:a1")
    assert agent is not None
    assert agent.status is AgentStatus.WORKING
    assert agent.started_at is not None


def test_a_description_that_arrives_late_is_merged_in():
    registry = make_registry()
    spawn(registry, detail=None)

    # The Agent tool was called: the description is known, the id is not.
    registry.apply(
        AgentEvent.new(
            type="spawn_hint",
            agent_id="sub:pending:toolu_1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.IDLE,
            label="Explore",
            detail="scout the repo",
            tool_use_id="toolu_1",
            subagent_type="Explore",
        )
    )
    # The agent already exists and the result now names it.
    registry.apply(
        AgentEvent.new(
            type="spawn_bind",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label="Explore",
            tool_use_id="toolu_1",
        )
    )
    agent = registry.get("sub:a1")
    assert agent.detail == "scout the repo"
    assert agent.tool_use_id == "toolu_1"


def test_finishing_then_idle():
    registry = make_registry()
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="finished",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.FINISHED,
            label="Explore",
        )
    )
    assert registry.get("sub:a1").status is AgentStatus.FINISHED


def test_removal_is_deferred_so_the_character_can_walk_out():
    registry = make_registry(exit_grace_s=15.0)
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="removed",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.REMOVED,
            label="Explore",
        )
    )
    agent = registry.get("sub:a1")
    assert agent is not None, "the agent must survive the removal long enough to leave"
    assert agent.status is AgentStatus.LEAVING
    assert agent.leaving_deadline is not None


def test_an_acknowledged_exit_removes_the_agent():
    registry = make_registry()
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="removed",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.REMOVED,
            label="Explore",
        )
    )
    assert registry.acknowledge_exit("sub:a1") is True
    assert registry.get("sub:a1") is None


def test_the_sweeper_reaps_an_expired_exit():
    registry = make_registry(exit_grace_s=15.0)
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="removed",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.REMOVED,
            label="Explore",
        )
    )
    registry.sweep(now=1000.0 + 16.0)
    assert registry.get("sub:a1") is None


def test_a_stalled_agent_goes_idle_instead_of_freezing_in_the_water():
    registry = make_registry(idle_ttl_s=90.0)
    spawn(registry)
    registry.sweep(now=1000.0 + 91.0)
    agent = registry.get("sub:a1")
    assert agent.status is AgentStatus.IDLE
    assert agent.detail == "stalled?"


def test_an_idle_session_is_eventually_reaped():
    registry = make_registry(session_ttl_s=900.0)
    registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id="session:s1",
            kind=AgentKind.SESSION,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.IDLE,
            label="main",
        )
    )
    registry.sweep(now=1000.0 + 901.0)
    agent = registry.get("session:s1")
    assert agent.status is AgentStatus.LEAVING


def test_the_event_ring_buffer_is_bounded():
    registry = make_registry()
    spawn(registry)
    for _ in range(80):
        registry.apply(
            AgentEvent.new(
                type="note",
                agent_id="sub:a1",
                kind=AgentKind.SUBAGENT,
                session_id="s1",
                parent_id="session:s1",
                status=AgentStatus.WORKING,
                label="Explore",
                detail="Read",
                tool_name="Read",
            )
        )
    agent = registry.get("sub:a1")
    assert len(agent.last_events) == 50
    assert agent.event_count == 81


def test_the_agent_carries_its_last_events_to_the_browser():
    """The inspector shows what the agent did, so the events travel with it."""
    registry = make_registry()
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="note",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label="Explore",
            detail="Read",
            tool_name="Read",
        )
    )

    payload = registry.get("sub:a1").to_dict()

    assert len(payload["events"]) == 2
    assert payload["events"][-1]["tool"] == "Read"
    assert payload["events"][-1]["detail"] == "Read"


def test_a_finished_agent_can_walk_out_of_the_scene():
    """A finished subagent climbs out and leaves like everybody else."""
    registry = make_registry()
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="finished",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.FINISHED,
            label="Explore",
        )
    )
    assert registry.get("sub:a1").status is AgentStatus.FINISHED

    assert registry.acknowledge_exit("sub:a1") is True
    assert registry.get("sub:a1") is None


def test_an_agent_that_is_still_in_the_pool_cannot_walk_out():
    """A character that waits at the gate is still part of the scene."""
    registry = make_registry()
    spawn(registry, status=AgentStatus.IDLE)

    assert registry.acknowledge_exit("sub:a1") is False
    assert registry.get("sub:a1") is not None


def test_a_leaving_agent_can_walk_out_of_the_scene():
    registry = make_registry()
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="removed",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.REMOVED,
            label="Explore",
        )
    )

    assert registry.acknowledge_exit("sub:a1") is True
    assert registry.get("sub:a1") is None
