# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AgentPool draws every running Claude Code session and subagent as a character in a 3D swimming
pool: idle agents lie on a sun-lounger with tea, working agents swim, finished agents climb out.
A Claude Code plugin posts hook events to a local FastAPI backend; the backend owns the world
model; a React + Three.js frontend draws it. No picture assets anywhere — every character is
generated from code and is a pure function of its agent id.

## Commands

Everything runs through the Makefile (Python 3.11 pyenv env `agentpool-env`, backend on :38000,
vite dev server on :5173).

```sh
make install      # venv + npm install + frontend build (a fresh clone needs this before the backend serves the UI)
make server       # backend on http://127.0.0.1:38000
make frontend     # vite dev server on :5173 (hot reload)
make build        # tsc -b && vite build into frontend/dist
make test         # backend pytest + frontend node tests
make lab          # the animation lab: every swim style and every idle activity
make agentpool ARGS="--json"   # ask the running pool what the agents are doing
make plugin       # install the Claude Code plugin from ./plugin (separate on purpose — see below)
```

Single tests:

```sh
cd frontend && node test/run.mjs poses    # the frontend files whose name contains "poses"
cd frontend && npx tsc -b                 # type check
make test-backend                         # or: $(HOME)/.pyenv/versions/3.11.11/envs/agentpool-env/bin/python -m pytest tests -q
$(HOME)/.pyenv/versions/3.11.11/envs/agentpool-env/bin/python -m pytest tests/test_registry.py -k idle -q
```

The frontend tests are TypeScript bundled by esbuild and run in plain Node (`node --test`), no
browser and no WebGL. The pure modules carry the rules; the Three.js side only draws what the
pure side decided.

Useful URLs: `/?demo=12` (scripted fake agents, no backend), `/?demo=60&debug` (crowd test with
fps / draw calls / triangles in the corner), `/?lab`, `/?agent=<id>`, `?debug`.
`window.__agentpool` exposes `stats()`, `debug.list()`, `debug.play(id, action)`,
`debug.force(id, {work})`, `debug.moment(kind, id)`, `debug.look(x, z, d)`.

## Architecture

```
Claude Code ──hook──▶ bridge ──▶ registry ──▶ scene adapter ──▶ WS frames ──▶ browser
backend/agentpool/bridge/   raw hook JSON → AgentEvent → AgentState   (knows nothing about scenes)
backend/agentpool/scenes/   AgentState → SceneState + placement        (owns slots, lanes, routes)
frontend/src/scene/pool3d/  the pixels (Three.js, WebGL2)
```

- **The bridge is scene-agnostic and must stay that way.** `tests/test_bridge_is_scene_agnostic.py`
  greps the bridge for pool vocabulary. Another project (a stadium, an office) lifts the bridge
  and writes its own `SceneAdapter` and its own frontend — see `docs/porting.md`.
- **Placement lives on the server.** Two browser tabs must agree on who is in which lane, so the
  backend owns the world model (slots, routes, queues) and the frontend owns the pixels.
- **The scene contract is `describe()` / `presentation()`** plus a fixed mode vocabulary
  (`swim`, `lounge`, `waiting`, `exiting`, `leaving`, `offscreen`) — `docs/scenes.md` is the
  contract, `backend/agentpool/scenes/base.py` holds the `SceneState` enum.
- **The 60 fps path never touches React.** The scene reads from the small external store
  (`frontend/src/state/store.ts`) in its frame loop; React only draws the panels.
- **The WebSocket may die.** The client reconnects with a backoff and falls back to polling
  `/api/state` while there is no socket (`frontend/src/net/`).
- The registry is the truth; the reconciler re-reads `~/.claude` every 30 s as a safety net for
  hooks that never arrived, and obeys the disk in both directions. The pool shows *now*, not a
  museum of the week.

Key files: `backend/agentpool/bridge/` (normaliser, registry, reconciler, broker),
`backend/agentpool/api/` (ingest, state, ws, auth), `backend/agentpool/store/journal.py`,
`backend/agentpool/cli.py` (the `agentpool` command), `plugin/agentpool/` (hooks + scripts),
`frontend/src/scene/characters/` (spec, poses, math, noise, spring — pure),
`frontend/src/scene/characters3d/` (the skinned mesh rig),
`frontend/src/scene/motion/` (the pose driver and the leisure activities),
`frontend/src/scene/pool3d/` (the world, the flow machine, the errands, the moments).

## Invariants worth knowing before you touch anything

- **A character is a pure function of its agent id.** `hash(agent_id)` → domain-separated named
  random streams (`rngFor(id, 'skin')`, `'hair'`, …). Adding an attribute means a *new channel
  name*; changing an existing table reshuffles every character that already exists.
- **The pose is a weighted sum of layers** (`rest`, `lounge`, `activity`, `walk`, `swim`, `climb`).
  The weights are damped; the layer oscillations are not — damping the angles would make the
  stroke syrupy. A sub-layer must be taken out of a *separately damped* parent, otherwise the
  weights diverge (see `docs/architecture.md`).
- **Pure first, deterministic, no allocation.** Every decision (where to go, what to do, when)
  lives in a pure module with no Three.js objects — `world.ts`, `nav.ts`, `flow.ts`, `swim.ts`,
  `work.ts`, `entries.ts`, `errands.ts`, `games.ts`, `creatures.ts`, `moments.ts`,
  `leisurePlan.ts`. Never `Math.random()` in a pure module; use the seeded generators. The
  frame loop reuses vectors and arrays.
- **Performance budget** (measured with `?demo=60&debug` on a desktop): ≥ 50 fps, draw calls
  ≤ 3 × agents + 110 (body, outline, shadow), triangles ≤ 1.2 M; `?demo=12` on a 390 × 844
  window stays at ≥ 30 fps. The browser console must stay clean.
- **Reduced motion** (`prefersReducedMotion()`): no camera moves, no confetti or fireworks, the
  ladder instead of a dive, creatures still.
- **The scene is 3D-only now.** The 2D/Pixi pool and its fallback have been removed; `frontend/src/scene/pool3d/`
  and `frontend/src/scene/characters3d/` are the scene, and `frontend/src/scene/characters/` holds
  the shared pure modules only.

## Conventions

- Everything in the repository — code, comments, docs — is in **English**; the conversation with
  the user is in Turkish.
- **Do not commit unless the user asks.** The working tree currently holds a large uncommitted
  change set.
- `make plugin` stays separate from `make install`: installing the plugin writes to the global
  Claude configuration and is a deliberate step.
- The house comment style explains *why* in plain sentences, no commented-out code.
- The plans in `docs/plans/` are written to be carried out one step at a time by an implementer
  who has not seen the conversation they came from; when the code and a plan disagree, the code
  wins and the difference goes into that sprint file's **Deviations** list.
- On a UI change, run a read-only observer agent alongside the work: it must not edit files or
  touch git, and it reports what it *saw* separately from what it *inferred*. It has caught bugs
  that no test did.

## Docs

`docs/architecture.md` (the seam, identity, the pose model, the tuning constants),
`docs/scenes.md` (the scene contract and how to write another), `docs/lifecycle.md` (the agent
states, the sweeper, the reconciler), `docs/hook-events.md`, `docs/porting.md`,
`docs/next.md` (what to develop next, in order), `docs/plans/` (the sprint plans).
