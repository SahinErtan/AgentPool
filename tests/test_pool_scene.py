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
    """The pool grows, but not for ever: past twelve, the rest waits."""
    scene = PoolScene()
    agents = fill(scene, 16)

    modes = [scene.presentation(agent)["mode"] for agent in agents]
    assert modes.count("lounge") == 12
    assert modes.count("waiting") == 4


def test_the_agent_at_the_gate_gets_the_first_free_lounger() -> None:
    """The queue works: nobody is left without a place for ever."""
    scene = PoolScene()
    agents = fill(scene, 17)

    # Twelve on a lounger, four at the edge, one at the gate.
    modes = [scene.presentation(agent)["mode"] for agent in agents]
    assert modes.count("lounge") == 12
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


def test_the_pool_grows_with_the_crowd() -> None:
    """More agents, more loungers: the pool gets bigger."""
    scene = PoolScene()
    assert scene.describe()["loungers"] == 6

    fill(scene, 9)

    assert scene.describe()["loungers"] == 9


def test_the_pool_keeps_at_least_six_loungers() -> None:
    scene = PoolScene()
    fill(scene, 3)
    assert scene.describe()["loungers"] == 6


def test_the_pool_never_grows_past_twelve_loungers() -> None:
    scene = PoolScene()
    fill(scene, 20)
    assert scene.describe()["loungers"] == 12


def test_the_pool_shrinks_again_when_the_crowd_leaves() -> None:
    scene = PoolScene()
    agents = fill(scene, 9)
    assert scene.describe()["loungers"] == 9

    for agent in agents[:4]:
        asyncio.run(scene.on_agent_removed(agent.id))

    assert scene.describe()["loungers"] == 6


def test_an_agent_whose_lounger_disappears_goes_to_the_edge() -> None:
    """The agent that loses its lounger is not left standing on nothing."""
    scene = PoolScene()
    agents = fill(scene, 9)
    assert scene.describe()["loungers"] == 9

    for agent in agents[:4]:
        asyncio.run(scene.on_agent_removed(agent.id))

    # Somebody is now waiting at the edge of the pool.
    waiting = [
        scene.presentation(agent)["mode"]
        for agent in agents
        if scene.presentation(agent)["mode"] == "waiting"
    ]
    assert waiting, "nobody was sent to the edge"


def swim(scene: PoolScene, agent: AgentState) -> None:
    """Put an agent in the water."""
    asyncio.run(scene.on_agent_spawned(agent))
    asyncio.run(scene.on_agent_started(agent))


def test_every_swimmer_is_counted_in_its_lane() -> None:
    """The lanes are told apart, and the book-keeping says the truth.

    Measured on the live pool: two agents were swimming in `lane:0` while
    the other three lanes stood empty. The lane kept the name of one
    swimmer only, so a swimmer that shared a lane was never counted, and
    the lane was given away as soon as the counted one left.

    The invariant: every agent that says it swims in a lane is in that
    lane's set of swimmers, and the two counts are the same.
    """
    scene = PoolScene()
    agents = [make_agent(index, AgentStatus.WORKING) for index in range(1, 9)]
    for agent in agents:
        swim(scene, agent)

    # The pool turns over: half of the swimmers leave, a new one comes.
    for agent in agents[:4]:
        asyncio.run(scene.on_agent_finished(agent))
    newcomer = make_agent(20, AgentStatus.WORKING)
    swim(scene, newcomer)

    swimming = [agent for agent in agents[4:] if agent.id in scene._lane_of]
    swimming.append(newcomer)

    claimed: dict[int, list[str]] = {}
    for agent in swimming:
        lane = scene.presentation(agent)["props"]["lane"]
        claimed.setdefault(lane, []).append(agent.id)

    for lane, ids in claimed.items():
        counted = scene._lane_occupants.get(lane, [])
        assert set(ids) <= set(counted), f"a swimmer of lane {lane} was not counted"
        assert len(ids) == len(counted), (
            f"lane {lane} says {len(counted)} swimmers and holds {len(ids)}"
        )


def test_a_lane_is_shared_only_when_every_lane_is_busy() -> None:
    """Five swimmers, four lanes: one lane is shared, and none is empty."""
    scene = PoolScene()
    agents = [make_agent(index, AgentStatus.WORKING) for index in range(1, 6)]
    for agent in agents:
        swim(scene, agent)

    lanes = [scene.presentation(agent)["props"]["lane"] for agent in agents]
    assert sorted(lanes) == [0, 1, 2, 3, 3], f"the lanes are wrong: {lanes}"
    assert len(scene._lane_occupants) == 4, "a lane was left empty"


def test_a_shared_lane_says_how_many_swimmers_it_has() -> None:
    """Two agents in one lane must not look like one agent twice."""
    scene = PoolScene()
    agents = [make_agent(index, AgentStatus.WORKING) for index in range(1, 6)]
    for agent in agents:
        swim(scene, agent)

    slots = [scene.presentation(agent)["slot"] for agent in agents]
    assert "lane:3 (2)" in slots, f"the shared lane does not say so: {slots}"


def test_a_swimmer_that_leaves_gives_its_lane_back() -> None:
    """The lane is free again when the last swimmer of it leaves."""
    scene = PoolScene()
    agents = [make_agent(index, AgentStatus.WORKING) for index in range(1, 6)]
    for agent in agents:
        swim(scene, agent)

    for agent in agents:
        asyncio.run(scene.on_agent_finished(agent))

    newcomer = make_agent(9, AgentStatus.WORKING)
    swim(scene, newcomer)
    assert scene.presentation(newcomer)["props"]["lane"] == 0


def test_nobody_swims_in_a_crowded_lane_while_another_one_is_empty() -> None:
    """When a swimmer leaves, the pool uses the empty lane.

    Measured: five swimmers, four lanes, one lane shared. When the swimmer
    of an empty lane goes, the one that shared a lane moves into it, so the
    pool does not keep a crowded lane next to an empty one.
    """
    scene = PoolScene()
    agents = [make_agent(index, AgentStatus.WORKING) for index in range(1, 6)]
    for agent in agents:
        swim(scene, agent)

    assert scene.presentation(agents[4])["slot"] == "lane:3 (2)"

    asyncio.run(scene.on_agent_finished(agents[0]))

    lanes = {
        agent.id: scene.presentation(agent)["props"]["lane"] for agent in agents[1:]
    }
    assert sorted(lanes.values()) == [0, 1, 2, 3], f"the lanes are wrong: {lanes}"
    assert all(
        scene.presentation(agent)["slot"] == f"lane:{lanes[agent.id]}"
        for agent in agents[1:]
    ), "a lane still says that it is shared"
