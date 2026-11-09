"""The second scene: the proof that the bridge is reusable.

The stadium shares no code with the pool beyond the scene adapter itself.
If these tests pass, a new project only has to write a scene.
"""

from __future__ import annotations

import asyncio

from agentpool.bridge.events import AgentKind, AgentStatus
from agentpool.bridge.registry import AgentState
from agentpool.scenes.base import SceneAdapter, SceneState, replay_scene
from agentpool.scenes.stadium import StadiumScene


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


def test_the_stadium_is_a_scene_adapter() -> None:
    assert isinstance(StadiumScene(), SceneAdapter)


def test_an_idle_agent_sits_on_a_bench() -> None:
    scene = StadiumScene()
    agent = make_agent(1)

    asyncio.run(scene.on_agent_spawned(agent))

    presentation = scene.presentation(agent)
    assert presentation["mode"] == "bench"
    assert presentation["slot"] == "bench:0"
    assert presentation["props"]["bench"] == 0


def test_a_working_agent_runs_on_the_track() -> None:
    scene = StadiumScene()
    agent = make_agent(1, AgentStatus.WORKING)

    asyncio.run(scene.on_agent_spawned(agent))

    presentation = scene.presentation(agent)
    assert presentation["mode"] == "run"
    assert presentation["slot"] == "lane:0"


def test_the_benches_fill_up_and_the_rest_waits() -> None:
    scene = StadiumScene()
    agents = [make_agent(index) for index in range(1, 13)]

    for agent in agents:
        asyncio.run(scene.on_agent_spawned(agent))

    modes = [scene.presentation(agent)["mode"] for agent in agents]
    assert modes.count("bench") == 8
    assert modes.count("waiting") == 4


def test_a_free_bench_promotes_the_agent_that_waited_longest() -> None:
    scene = StadiumScene()
    agents = [make_agent(index) for index in range(1, 13)]
    for agent in agents:
        asyncio.run(scene.on_agent_spawned(agent))

    waiting = [agent for agent in agents if scene.presentation(agent)["mode"] == "waiting"]
    first_waiter = waiting[0]

    # One of the seated agents leaves the stadium.
    seated = [agent for agent in agents if scene.presentation(agent)["mode"] == "bench"]
    asyncio.run(scene.on_agent_removed(seated[0].id))

    assert scene.presentation(first_waiter)["mode"] == "bench"
    assert scene.presentation(first_waiter)["slot"] == "bench:0"
    # The scene reports the agent so the backend can push the change.
    assert first_waiter.id in scene.take_dirty()


def test_the_scene_state_vocabulary_is_shared() -> None:
    """The generic vocabulary every scene maps into."""
    assert SceneState.RESTING.value == "resting"
    assert SceneState.ACTIVE.value == "active"
    assert SceneState.EXITING.value == "exiting"


def test_replay_gives_a_scene_the_same_slots() -> None:
    """A scene that missed an event catches up with a replay."""
    scene = StadiumScene()
    agent = make_agent(1)

    asyncio.run(replay_scene(scene, agent))

    assert scene.presentation(agent)["mode"] == "bench"
    assert scene.presentation(agent)["slot"] == "bench:0"
