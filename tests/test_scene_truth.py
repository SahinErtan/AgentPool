"""The scene and the registry have to agree about who is in the pool.

These are the regression tests for the four ghosts of Sprint 12:

* the sweeper dropped an agent but never told the scene, so the pool kept
  a lane, a lounger and a place at the edge for an agent that was gone;
* the reconciler had no branch for a finished or a leaving agent, so the
  safety net failed exactly where it was needed;
* a finished agent stayed in the registry until a browser said goodbye;
* the scene and the registry only ever grew.
"""

from __future__ import annotations

import asyncio

from agentpool.app import _scene_exit_hook, sweep_once, sync_scene
from agentpool.bridge.events import AgentEvent, AgentKind, AgentStatus
from agentpool.bridge.registry import AgentRegistry
from agentpool.scenes.pool import PoolScene


class Clock:
    """A clock the tests can move."""

    def __init__(self, now: float = 1000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class FakeHub:
    """A hub that keeps the messages instead of sending them."""

    def __init__(self, scene: PoolScene) -> None:
        self.scene = scene
        self.messages = []

    def agent_view(self, state):
        payload = state.to_dict()
        payload["scene"] = self.scene.scene_id
        payload["presentation"] = self.scene.presentation(state)
        return payload

    async def broadcast(self, message) -> None:
        self.messages.append(message)

    def of_type(self, kind: str):
        return [message for message in self.messages if message.get("type") == kind]


def event(agent_id: str, kind: str, status: AgentStatus, **kwargs):
    return AgentEvent.new(
        type=kind,
        agent_id=agent_id,
        kind=AgentKind.SUBAGENT,
        session_id="s1",
        parent_id="session:s1",
        status=status,
        label="Explore",
        **kwargs,
    )


def spawn(registry: AgentRegistry, agent_id: str, status=AgentStatus.WORKING) -> None:
    registry.apply(event(agent_id, "spawned", status))


def spawn_into(registry: AgentRegistry, scene: PoolScene, agent_id: str, status=AgentStatus.WORKING):
    """Spawn an agent and let the scene place it."""
    spawn(registry, agent_id, status)
    state = registry.get(agent_id)
    asyncio.run(sync_scene(scene, [state]))
    return state


# -- the sweeper -----------------------------------------------------


def test_the_sweeper_releases_the_lanes_it_reaped() -> None:
    """The agents that are gone must give their lanes back.

    Before the fix the sweeper only told the browser: the scene kept the
    lanes, so four exits left the pool full of ghosts and the new
    swimmers swam through each other.
    """
    clock = Clock()
    registry = AgentRegistry(clock=clock, exit_grace_s=15.0)
    scene = PoolScene()
    hub = FakeHub(scene)

    for index in range(4):
        spawn_into(registry, scene, f"sub:s{index}")

    assert len(scene._lane_occupants) == 4, "the four swimmers need a lane each"

    # The agents are removed upstream and walk out of the gate.
    for index in range(4):
        registry.apply(event(f"sub:s{index}", "removed", AgentStatus.REMOVED))

    clock.now += 16.0
    asyncio.run(sweep_once(registry, scene, hub))

    assert scene._lane_occupants == {}, "the lanes are still full of ghosts"
    assert scene._lane_of == {}
    for index in range(4):
        assert not scene.knows(f"sub:s{index}")

    removals = hub.of_type("agent_remove")
    assert removals, "the browser has to be told as well"
    assert sorted(removals[0]["agent_ids"]) == ["sub:s0", "sub:s1", "sub:s2", "sub:s3"]


def test_the_sweeper_gives_the_lounger_back_as_well() -> None:
    """A finished agent that is reaped takes its lounger with it."""
    clock = Clock()
    registry = AgentRegistry(clock=clock, exit_grace_s=15.0)
    scene = PoolScene()
    hub = FakeHub(scene)

    spawn_into(registry, scene, "sub:a1")
    registry.apply(event("sub:a1", "finished", AgentStatus.FINISHED))
    asyncio.run(sync_scene(scene, [registry.get("sub:a1")]))
    assert scene._lounger_of.get("sub:a1") is not None

    clock.now += 16.0
    asyncio.run(sweep_once(registry, scene, hub))

    assert scene._lounger_of == {}
    assert scene._lounger_occupant == {}
    assert not scene.knows("sub:a1")


def test_the_pool_shrinks_again_when_the_sweeper_reaps_the_crowd() -> None:
    """The pool follows the crowd, in both directions."""
    clock = Clock()
    registry = AgentRegistry(clock=clock, exit_grace_s=15.0)
    scene = PoolScene()
    hub = FakeHub(scene)

    for index in range(9):
        spawn_into(registry, scene, f"sub:i{index}", AgentStatus.IDLE)
    assert scene.describe()["loungers"] == 9

    for index in range(9):
        registry.apply(event(f"sub:i{index}", "removed", AgentStatus.REMOVED))

    clock.now += 16.0
    asyncio.run(sweep_once(registry, scene, hub))

    assert scene.describe()["loungers"] == 6
    assert scene._lounger_occupant == {}
    assert scene._overflow == []


# -- the reconciler --------------------------------------------------


def test_the_reconciler_gives_the_lane_back_for_a_finished_agent() -> None:
    """The safety net has to work where it is needed.

    The stop hook never arrived, the disk says the agent is done and the
    reconciler has to give the lane back. Before the fix a finished agent
    matched no branch at all and swam for ever.
    """
    registry = AgentRegistry()
    scene = PoolScene()

    spawn_into(registry, scene, "sub:a1")
    assert scene._lane_of.get("sub:a1") == 0

    registry.apply(event("sub:a1", "finished", AgentStatus.FINISHED))
    state = registry.get("sub:a1")
    assert state.status is AgentStatus.FINISHED

    asyncio.run(sync_scene(scene, [state]))

    assert "sub:a1" not in scene._lane_of, "the finished agent still swims"
    assert scene._lane_occupants == {}
    assert scene._lounger_of.get("sub:a1") is not None, "it has to get out of the water"


def test_the_reconciler_forgets_an_agent_that_is_leaving() -> None:
    """A leaving agent gives its lane back and is forgotten."""
    registry = AgentRegistry()
    scene = PoolScene()

    spawn_into(registry, scene, "sub:a1")
    assert scene.knows("sub:a1")

    registry.apply(event("sub:a1", "removed", AgentStatus.REMOVED))
    state = registry.get("sub:a1")
    assert state.status is AgentStatus.LEAVING

    asyncio.run(sync_scene(scene, [state]))

    assert scene._lane_occupants == {}
    assert not scene.knows("sub:a1")


def test_the_reconciler_does_not_spawn_a_known_agent_twice() -> None:
    """A known agent is moved, never placed again."""
    registry = AgentRegistry()
    scene = PoolScene()

    spawn_into(registry, scene, "sub:a1")
    lane = scene._lane_of["sub:a1"]

    registry.apply(event("sub:a1", "finished", AgentStatus.FINISHED))
    asyncio.run(sync_scene(scene, [registry.get("sub:a1")]))

    # The lane was given back and no second lane was taken.
    assert len(scene._lane_occupants) == 0
    assert lane not in scene._lane_of.values()


# -- the registry ----------------------------------------------------


def test_a_finished_agent_is_reaped_without_a_browser() -> None:
    """The backend must not need a dashboard to tidy up.

    Before the fix only the browser could drop a finished agent, so with
    no dashboard open they piled up in the registry for ever.
    """
    clock = Clock()
    registry = AgentRegistry(clock=clock, exit_grace_s=15.0)

    spawn(registry, "sub:a1")
    registry.apply(event("sub:a1", "finished", AgentStatus.FINISHED))
    assert registry.get("sub:a1") is not None, "the agent stays for its grace period"

    clock.now += 16.0
    changed = registry.sweep()

    assert registry.get("sub:a1") is None, "the finished agent was never reaped"
    assert [state.id for state in changed] == ["sub:a1"]


def test_an_agent_that_finished_long_ago_is_reaped_at_once() -> None:
    """The grace period is measured from the moment it finished.

    An agent that was restored from the journal finished minutes ago, not
    now: it must not stay in the pool for another grace period.
    """
    clock = Clock()
    registry = AgentRegistry(clock=clock, exit_grace_s=15.0)

    spawn(registry, "sub:a1")
    registry.apply(event("sub:a1", "finished", AgentStatus.FINISHED))
    state = registry.get("sub:a1")
    state.finished_at = 100.0

    clock.now = 116.0
    registry.sweep()

    assert registry.get("sub:a1") is None


def test_the_scene_is_told_when_a_finished_agent_is_reaped() -> None:
    """The reaping has to reach the scene, or the pool keeps a ghost."""
    clock = Clock()
    registry = AgentRegistry(clock=clock, exit_grace_s=15.0)
    scene = PoolScene()
    hub = FakeHub(scene)

    spawn_into(registry, scene, "sub:a1")
    registry.apply(event("sub:a1", "finished", AgentStatus.FINISHED))
    asyncio.run(sync_scene(scene, [registry.get("sub:a1")]))

    clock.now += 16.0
    asyncio.run(sweep_once(registry, scene, hub))

    assert not scene.knows("sub:a1")
    assert scene._lounger_of == {}
    assert hub.of_type("agent_remove")


def test_the_registry_has_a_ceiling() -> None:
    """The registry may not grow for ever.

    The oldest and the idlest go first when the ceiling is reached, and
    the scene is told about every one of them.
    """
    clock = Clock()
    registry = AgentRegistry(clock=clock, max_agents=10)
    scene = PoolScene()
    hub = FakeHub(scene)

    for index in range(12):
        clock.now += 1.0
        spawn_into(registry, scene, f"sub:{index:02d}")

    assert len(registry) == 12, "the ceiling is enforced by the sweeper"

    clock.now += 1.0
    asyncio.run(sweep_once(registry, scene, hub))

    assert len(registry) == 10
    assert registry.get("sub:00") is None, "the oldest agent goes first"
    assert registry.get("sub:01") is None
    assert registry.get("sub:11") is not None, "the newest agent stays"

    removals = hub.of_type("agent_remove")
    assert sorted(removals[0]["agent_ids"]) == ["sub:00", "sub:01"]
    assert not scene.knows("sub:00")


def test_the_scene_forgets_an_agent_that_left() -> None:
    """The set of known agents has to shrink."""
    scene = PoolScene()
    agent = spawn_into(AgentRegistry(), scene, "sub:a1")
    assert scene.knows("sub:a1")
    assert agent is not None

    asyncio.run(scene.on_agent_removed("sub:a1"))

    assert not scene.knows("sub:a1")
    assert len(scene._known) == 0


def test_the_scene_gives_the_place_back_when_the_browser_says_goodbye() -> None:
    """The browser may drop an agent; the scene has to hear about it."""

    async def run() -> None:
        registry = AgentRegistry()
        scene = PoolScene()

        spawn(registry, "sub:a1")
        await sync_scene(scene, [registry.get("sub:a1")])
        registry.apply(event("sub:a1", "finished", AgentStatus.FINISHED))
        await sync_scene(scene, [registry.get("sub:a1")])
        assert scene._lounger_of.get("sub:a1") is not None

        registry.set_exit_hook(_scene_exit_hook(scene))
        assert registry.acknowledge_exit("sub:a1") is True
        await asyncio.sleep(0)

        assert scene._lounger_of == {}
        assert not scene.knows("sub:a1")

    asyncio.run(run())


# -- the journal -----------------------------------------------------


def test_the_journal_is_replayed_on_boot(monkeypatch, tmp_path) -> None:
    """The state has to survive a restart.

    The journal is replayed after the disk, so the disk has the last word.
    """
    from fastapi.testclient import TestClient

    from agentpool import app as app_module
    from agentpool.config import Settings

    played = []

    class StubJournal:
        def __init__(self, *args, **kwargs) -> None:
            self.path = tmp_path

        def prune(self, now=None):
            return []

        async def replay_into(self, registry):
            played.append(registry)
            spawn(registry, "sub:j1")
            return 1

    monkeypatch.setattr(app_module, "Journal", StubJournal)
    monkeypatch.setattr(app_module, "reconcile", lambda *args, **kwargs: [])

    settings = Settings(
        state_dir=tmp_path,
        claude_dir=tmp_path / "claude",
        journal_enabled=False,
    )
    application = app_module.create_app(settings)

    with TestClient(application):
        pass

    assert played, "the journal was not replayed on boot"
    assert application.state.scene.knows("sub:j1")


def test_the_replay_call_survives_a_broken_journal(monkeypatch, tmp_path) -> None:
    """A journal that raises must never stop the backend."""
    from fastapi.testclient import TestClient

    from agentpool import app as app_module
    from agentpool.config import Settings

    class BrokenJournal:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def prune(self, now=None):
            return []

        async def replay_into(self, registry):
            raise RuntimeError("the journal is broken")

    monkeypatch.setattr(app_module, "Journal", BrokenJournal)
    monkeypatch.setattr(app_module, "reconcile", lambda *args, **kwargs: [])

    settings = Settings(
        state_dir=tmp_path,
        claude_dir=tmp_path / "claude",
        journal_enabled=False,
    )
    application = app_module.create_app(settings)

    with TestClient(application) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["ok"] is True
