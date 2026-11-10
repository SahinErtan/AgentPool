"""The AgentPool application factory."""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .api.ingest import create_ingest_router
from .api.state import create_state_router
from .api.ws import WsHub, create_ws_router
from .bridge.broker import Broker
from .bridge.events import AgentStatus
from .bridge.reconcile import reconcile
from .bridge.registry import AgentRegistry
from .config import Settings
from .scenes.base import replay_scene
from .scenes.registry import build_scene
from .store.journal import Journal

log = logging.getLogger("agentpool")

# How often the disk is read to catch the events that never arrived.
RECONCILE_INTERVAL_S = 30.0


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings.from_env()

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
    started_at = time.time()

    async def sweeper() -> None:
        """Expire stale agents on a timer."""
        while True:
            await asyncio.sleep(10)
            try:
                changed = registry.sweep()
                if changed:
                    await hub.broadcast(
                        {
                            "type": "agent_upsert",
                            "agents": [
                                dict(
                                    hub.agent_view(state),
                                )
                                for state in changed
                            ],
                        }
                    )
            except Exception:
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
                changed = reconcile(registry, settings.claude_dir)
                if not changed:
                    continue
                for state in changed:
                    # Only an agent the scene has never seen is placed. The
                    # ones it knows keep their lane or their lounger, but
                    # they have to hear about a state that changed.
                    if not scene.knows(state.id):
                        await replay_scene(scene, state)
                    elif state.status is AgentStatus.WORKING:
                        await scene.on_agent_started(state)
                    elif state.status is AgentStatus.IDLE:
                        await scene.on_agent_finished(state)
                await hub.broadcast(
                    {
                        "type": "agent_upsert",
                        "agents": [hub.agent_view(state) for state in changed],
                    }
                )
            except Exception:
                log.exception("reconcile failed")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await hub.start()
        try:
            journal.prune()
        except Exception:
            log.exception("the journal could not be pruned")
        try:
            recovered = reconcile(registry, settings.claude_dir)
            if recovered:
                log.info("recovered %s agents from disk", recovered)
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
            log.exception("reconciliation failed")
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

    app.include_router(create_ingest_router(registry, broker, scene, journal))
    app.include_router(create_state_router(registry, scene, started_at))
    app.include_router(create_ws_router(hub))

    dist = settings.frontend_dist
    if dist.is_dir():
        # One process serves the API and the UI, the claude-mem pattern.
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="ui")
    else:
        log.warning("frontend build not found at %s - serving the API only", dist)

    return app


app = create_app()
