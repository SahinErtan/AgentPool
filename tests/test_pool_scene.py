"""The pool scene: the slots and the queue in front of them."""

from __future__ import annotations

import asyncio

from agentpool.bridge.events import AgentKind, AgentStatus
from agentpool.bridge.registry import AgentState
from agentpool.scenes.pool import PoolScene


def make_agent(index: int, status: AgentStatus = AgentStatus.IDLE) -> AgentState:
    return AgentState(
        id=f"sub:agent-{index}",
        kind=AgentKind.SUBAGENT,
        session_id="session:1",
        parent_id="session:1",
        status=status,
        label=f"agent-{index}",
        detail=None,
        subagent_type=None,
        tool_name=None,
        cwd=None,
        created_at=0.0,
        last_event_at=0.0,
        started_at=None,
        finished_at=None,
        event_count=0,
        leaving_deadline=None,
    )


def fill(scene: PoolScene, count: int) -> list[AgentState]:
    agents = [make_agent(index) for index in range(1, count + 1)]
    for agent in agents:
        asyncio.run(scene.on_agent_spawned(agent))
    return agents


def test_an_idle_agent_lies_on_a_lounger() -> None:
    scene = PoolScene()
    agent = make_agent(1)

    asyncio.run(scene.on_agent_spawned(agent))

    presentation = scene.presentation(agent)
    assert presentation["mode"] == "lounge"
    assert presentation["slot"] == "lounger:0"


def test_a_working_agent_swims_in_a_lane() -> None:
    scene = PoolScene()
    agent = make_agent(1, AgentStatus.WORKING)

    asyncio.run(scene.on_agent_spawned(agent))
    asyncio.run(scene.on_agent_started(agent))

    presentation = scene.presentation(agent)
    assert presentation["mode"] == "swim"
    assert presentation["slot"] == "lane:0"


def test_the_pool_fills_up_and_the_rest_waits_at_the_edge() -> None:
    scene = PoolScene()
    agents = fill(scene, 12)

    modes = [scene.presentation(agent)["mode"] for agent in agents]
    assert modes.count("lounge") == 6
    assert modes.count("waiting") == 6


def test_the_agent_at_the_gate_gets_the_first_free_lounger() -> None:
    """The queue works: nobody is left without a place for ever."""
    scene = PoolScene()
    agents = fill(scene, 11)

    # Six on a lounger, four at the edge, one at the gate.
    modes = [scene.presentation(agent)["mode"] for agent in agents]
    assert modes.count("lounge") == 6
    assert modes.count("waiting") == 5

    at_the_gate = [agent for agent in agents if agent.id in scene._overflow]
    assert len(at_the_gate) == 1

    at_the_edge = [
        agent
        for agent in agents
        if scene.presentation(agent)["mode"] == "waiting"
        and scene.presentation(agent)["slot"] is not None
    ]
    seated = [agent for agent in agents if scene.presentation(agent)["mode"] == "lounge"]

    # The edge goes first: the four agents at the pool edge each take a
    # lounger before the one at the gate gets anything.
    for index in range(4):
        asyncio.run(scene.on_agent_removed(seated[index].id))
        assert scene.presentation(at_the_edge[index])["mode"] == "lounge"
        assert scene.presentation(at_the_gate[0])["mode"] == "waiting"

    # Now the edge is empty and the agent at the gate takes the place.
    asyncio.run(scene.on_agent_removed(seated[4].id))

    assert scene.presentation(at_the_gate[0])["mode"] == "lounge"
    assert scene.presentation(at_the_gate[0])["slot"] is not None
    assert at_the_gate[0].id in scene.take_dirty()


def test_the_edge_goes_before_the_gate() -> None:
    scene = PoolScene()
    agents = fill(scene, 13)

    at_the_edge = [
        agent
        for agent in agents
        if scene.presentation(agent)["slot"] is not None
        and scene.presentation(agent)["mode"] == "waiting"
    ]
    seated = [agent for agent in agents if scene.presentation(agent)["mode"] == "lounge"]
    asyncio.run(scene.on_agent_removed(seated[0].id))

    assert scene.presentation(at_the_edge[0])["mode"] == "lounge"
