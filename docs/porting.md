# Porting the bridge to another project

The hook communication is the reusable half of AgentPool. A stadium project, an
office project, a dashboard for something else entirely — they all need the
same thing: **Claude Code's hook events, turned into a live list of agents**,
over a WebSocket.

This document says exactly what to lift and what to leave behind.

## What to lift

Copy these directories as they are:

```
backend/agentpool/bridge/     the whole thing: hooks → events → registry
backend/agentpool/api/        the transport: ingest, state, websocket
backend/agentpool/store/      the journal
backend/agentpool/config.py   the settings
backend/agentpool/app.py      the application factory
frontend/src/net/             the wire model and the socket client
frontend/src/state/           the store
```

They contain no pool vocabulary. `tests/test_bridge_is_scene_agnostic.py`
enforces that: it parses the bridge with `ast` and fails if a file mentions
`scenes`, `pool`, `stadium`, `pixi`, `fastapi`, `lane`, `lounger`, `swim`,
`gate`, `ladder` or `walk`.

## What to write

| File | What it does |
|---|---|
| `scenes/<your scene>.py` | The scene adapter. See `docs/scenes.md`. |
| `scenes/registry.py` | One line: your scene instead of the pool. |
| `frontend/src/scene/<your scene>/` | The layout and the scene. |

The character system is reusable too, and it is worth lifting: the procedural
characters, the pose blend and the swim styles are in

```
frontend/src/scene/characters/
```

A stadium would want different poses — running instead of swimming — but the
rig, the spec and the drawing code are the same.

## The steps

1. **Copy the bridge.** `backend/agentpool/bridge/` and `backend/agentpool/api/`
   come over unchanged.
2. **Write your scene.** Implement the protocol in `scenes/base.py`.
3. **Register it.** `build_scene()` in `scenes/registry.py` returns your scene.
4. **Write the frontend.** A layout module that turns `describe()` into pixels
   and a scene module that draws the characters.
5. **Keep the plugin.** `plugin/agentpool/hooks/hooks.json` posts the hook
   events to `http://127.0.0.1:38000/hooks/<Event>`; the port is the only
   thing you change.
6. **Keep the contract.** The frontend reads the counts out of `describe()`, so
   your scene decides how many lanes and how many seats it has, and the
   frontend builds the world to fit.

## What stays in this repository

Nothing in the bridge mentions the pool, and nothing in the pool mentions the
bridge. The two meet in exactly three places:

- `scenes/base.py` — the adapter protocol and the vocabulary.
- `describe()` / `presentation()` — the payload the frontend reads.
- `SceneState` — the shared lifecycle words.

That is the whole seam. A second implementation needs nothing else, which is
why the pool can be the only scene here.

## The checklist for the new project

- [ ] The bridge tests pass unchanged: `pytest tests/`
- [ ] The architecture guard passes: the bridge names no scene
- [ ] A real `claude` run produces events in the journal
- [ ] The character walks in through the entrance and leaves through it
- [ ] The frontend builds the world from `describe()`
