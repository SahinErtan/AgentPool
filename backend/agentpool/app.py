"""The AgentPool application factory."""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .api import auth
from .api.ingest import create_ingest_router
from .api.state import create_metrics_router, create_state_router
from .api.ws import WsHub, create_ws_router
from .bridge.broker import Broker
from .bridge.reconcile import gone_agents, mark_gone, reconcile
from .bridge.registry import AgentRegistry
from .config import Settings
from .metrics import Counters
from .scenes.base import replay_scene, update_scene
from .scenes.registry import build_scene
from .store.journal import Journal

log = logging.getLogger("agentpool")

# How often the disk is read to catch the events that never arrived.
RECONCILE_INTERVAL_S = 30.0


def split_swept(registry, changed):
    """Tell the agents that changed from the agents that are gone.

    The sweeper drops the agents whose time is up. Sending them to the
    browser as an update would put them back, so they are sent as a
    removal instead.
    """
    upserts = []
    removals = []
    for state in changed:
        if registry.get(state.id) is None:
            removals.append(state.id)
        else:
            upserts.append(state)
    return upserts, removals


async def sync_scene(scene, states) -> None:
    """Bring the scene in line with the agents whose state changed.

    An agent the scene knows is only moved; an agent it has never seen is
    placed. A finished agent gives its lane back, an agent that is leaving
    gives everything back and is forgotten.
    """
    for state in states:
        if scene.knows(state.id):
            await update_scene(scene, state)
        else:
            await replay_scene(scene, state)


def _scene_exit_hook(scene):
    """A callback that takes an agent out of the scene when it leaves.

    The registry is synchronous, so the scene is told through a task. The
    callback is called from the websocket handler, where a loop is running.
    """

    def hook(agent_id: str) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No loop: nothing is running, so there is no scene to tell.
            return
        loop.create_task(scene.on_agent_removed(agent_id))

    return hook


async def sweep_once(registry, scene, hub) -> None:
    """Sweep the registry and tell the scene and the browser about it.

    The agents the sweeper drops have to leave the scene as well: or they
    keep a lane, a lounger or a place at the edge that nobody will ever
    use, and the pool fills up with ghosts.
    """
    changed = registry.sweep()
    if not changed:
        return
    upserts, removals = split_swept(registry, changed)

    for agent_id in removals:
        await scene.on_agent_removed(agent_id)

    if upserts:
        # The agents that are still here may have changed their place:
        # a stalled swimmer climbs out of the water.
        await sync_scene(scene, upserts)
        await hub.broadcast(
            {
                "type": "agent_upsert",
                "agents": [hub.agent_view(s) for s in upserts],
                "scene_payload": scene.describe(),
            }
        )
    if removals:
        await hub.broadcast(
            {
                "type": "agent_remove",
                "agent_ids": removals,
                "scene_payload": scene.describe(),
            }
        )


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings.from_env()
    if not auth.is_local_host(settings.host):
        log.warning(
            "the backend listens on %s, which is not this machine: the whole "
            "dashboard is on the network. Set AGENTPOOL_TOKEN to give it a lock.",
            settings.host,
        )

    registry = AgentRegistry(
        idle_ttl_s=settings.idle_ttl_s,
        session_ttl_s=settings.session_ttl_s,
        exit_grace_s=settings.exit_grace_s,
    )
    broker = Broker()
    scene = build_scene(settings.scene)
    journal = Journal(
        settings.state_dir / "events",
        enabled=settings.journal_enabled,
        keep_days=settings.journal_keep_days,
    )
    hub = WsHub(broker, registry, scene)
    counters = Counters()
    started_at = time.time()

    async def sweeper() -> None:
        """Expire stale agents on a timer."""
        while True:
            await asyncio.sleep(10)
            try:
                await sweep_once(registry, scene, hub)
            except Exception as error:
                # The error is counted as well as logged: a sweeper that
                # broke an hour ago must not look like one that is working.
                counters.fail_background(f"the sweeper failed: {error}")
                log.exception("sweeper failed")

    async def reconciler() -> None:
        """Read the disk every thirty seconds.

        This is the safety net: a hook that never arrived — the server was
        down, the request timed out, the plugin was not installed yet — is
        corrected by what Claude Code has on disk. The merge never goes
        backwards, so a hook that arrived later is not undone by a file that
        was written earlier.
        """
        while True:
            await asyncio.sleep(RECONCILE_INTERVAL_S)
            try:
                # The journal is kept for a while and then thrown away, so
                # it cannot grow into something nobody wants to keep.
                journal.prune()
                # The disk is read in a thread: a transcript is big, and
                # the event loop must not wait for it.
                changed = await asyncio.to_thread(reconcile, registry, settings.claude_dir)
                # The disk is the truth in both directions: what it has is
                # merged in, and what it does not have any more goes out.
                changed.extend(
                    mark_gone(registry, gone_agents(registry, settings.claude_dir))
                )
                if not changed:
                    continue
                # The scene has to hear about every change: a finished
                # agent gives its lane back, an agent that is leaving gives
                # everything back. Without this the safety net fails exactly
                # where it is needed — the stop hook that never arrived.
                await sync_scene(scene, changed)
                await hub.broadcast(
                    {
                        "type": "agent_upsert",
                        "agents": [hub.agent_view(state) for state in changed],
                        "scene_payload": scene.describe(),
                    }
                )
            except Exception as error:
                counters.fail_background(f"the reconciler failed: {error}")
                log.exception("reconcile failed")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await hub.start()
        try:
            journal.prune()
        except Exception as error:
            counters.fail_background(f"the journal could not be pruned: {error}")
            log.exception("the journal could not be pruned")

        # The browser may drop an agent when its character walks out of the
        # gate. The scene has to hear about it too, or the agent keeps its
        # lounger for ever.
        registry.set_exit_hook(_scene_exit_hook(scene))

        try:
            recovered = await asyncio.to_thread(reconcile, registry, settings.claude_dir)
            if recovered:
                log.info("recovered %s agents from disk", recovered)
        except Exception as error:
            counters.fail_background(f"the reconciliation failed: {error}")
            log.exception("reconciliation failed")

        # The journal holds what happened while the backend was down. It is
        # replayed after the disk, so the disk has the last word. A broken
        # journal must never stop the backend.
        try:
            replay_into = getattr(journal, "replay_into", None)
            if replay_into is None:
                log.info("the journal cannot be replayed yet: the disk is the truth")
            else:
                window = settings.journal_replay_window_s
                replayed = await replay_into(
                    registry, since=time.time() - window if window > 0 else None
                )
                if replayed:
                    log.info(
                        "replayed %s agents from the last %s seconds of the journal",
                        replayed,
                        window,
                    )
        except Exception:
            log.exception("the journal could not be replayed")

        # The agents the disk does not know about have gone. They walk out
        # of the gate with everybody else.
        try:
            mark_gone(registry, gone_agents(registry, settings.claude_dir))
        except Exception as error:
            counters.fail_background(f"the gone agents could not be marked: {error}")
            log.exception("the gone agents could not be marked")

        try:
            for state in registry.snapshot():
                await replay_scene(scene, state)
            await hub.broadcast(
                {
                    "type": "snapshot",
                    "scene": scene.scene_id,
                    "ts": time.time(),
                    "agents": [hub.agent_view(state) for state in registry.snapshot()],
                    "scene_payload": scene.describe(),
                }
            )
        except Exception:
            log.exception("the scene could not be set up")
        tasks = [asyncio.create_task(sweeper()), asyncio.create_task(reconciler())]
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            await hub.stop()

    app = FastAPI(title="AgentPool", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.registry = registry
    app.state.scene = scene
    app.state.hub = hub

    app.include_router(
        create_ingest_router(registry, broker, scene, journal, counters, settings)
    )
    app.include_router(create_state_router(registry, scene, started_at, journal, settings.token))
    app.include_router(create_ws_router(hub, settings.token))
    app.include_router(create_metrics_router(broker, hub, registry, counters, settings.token))

    dist = settings.frontend_dist
    if dist.is_dir():
        # One process serves the API and the UI, the claude-mem pattern.
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="ui")
    else:
        log.warning("frontend build not found at %s - serving the API only", dist)

    return app


app = create_app()
