# Sprint plan

The work is split into nine sprints so each one is a self-contained, committable
unit. Every sprint ends with something you can *see* or *measure* — never with
"code written".

| Sprint | Scope | Done when |
|---|---|---|
| **0** | Character system + animation lab | The four swim styles and the idle activities read correctly in the lab |
| **1** | Backend skeleton + hook transport proof | A real `claude` run delivers a payload over a `type:"http"` hook |
| **2** | The bridge, tested | Normaliser and registry covered by tests over real captured payloads |
| **3** | Scene adapter + WebSocket | The browser receives a snapshot and live deltas |
| **4** | The pool scene | The pool renders: water, caustics, lanes, loungers, the gate |
| **5** | Characters in the scene | Agents swim, lounge, walk in through the gate and leave through it |
| **6** | Idle activities + ambience | The loungers are alive: tea, books, naps, steam, birds, petals |
| **7** | Plugin packaging | `make install` registers the plugin; the UI comes up with any session |
| **8** | Inspector, responsive, the reuse kit, docs | The porting guide tells another project exactly what to lift |

## Sprint 2 — the bridge, tested

- `tests/test_normalizer.py` over the **real payloads captured on this machine**
  (a real `SessionStart`, a real `UserPromptSubmit`, a real `Stop` with
  `background_tasks`, a real `SubagentStart`).
- `tests/test_registry.py` for the lifecycle: spawn → work → finish → leave,
  including the late enrichment of a description that arrives after the agent
  exists.
- `bridge/sources.py`: read `~/.claude/sessions/*.json` and
  `subagents/agent-*.meta.json`.
- `bridge/reconcile.py`: rebuild the live agent set from disk on boot.

## Sprint 3 — scene adapter + WebSocket

- `scenes/base.py`, `scenes/pool.py` (already drafted), `scenes/registry.py`.
- The WebSocket protocol: `snapshot`, `agent_upsert`, `agent_remove`,
  `session_event`, and the client's `agent_exited` acknowledgement.
- The frontend client: `net/ws.ts` with reconnect and backoff, and a store
  built on `useSyncExternalStore`.

## Sprint 4 — the pool scene

- `scene/pool/layout.ts`: the world coordinates (water, lanes, loungers, gate,
  ladder) as a pure function of the canvas size.
- The layers: floor, caustics, water body, submerged, surface, deck with the
  gate hut.
- `scene/pool/placement.ts`: the semantic waypoints from the backend resolved
  into pixel paths, and the route follower.

## Sprint 5 — characters in the scene

- Two rigs per character (surface + underwater) so the waterline cuts them.
- Lane assignment and lounger assignment on the client, driven by the
  backend's `presentation`.
- The routes: walk in through the gate, descend into the water, swim, climb
  out, walk out through the gate.

## Sprint 6 — idle activities + ambience

- `characters/effects.ts`: the steam over a teacup, the "Z" glyphs over a
  napper and the speech bubble of a conversation. (The props themselves live
  in `characters/draw.ts` and are attached to the rig in `characters/rig.ts`,
  so there is no separate `props.ts`.)
- `scene/pool/ambience.ts`: the bird that crosses the sky, the drifting
  petals, the ambient ripples and the sun glint.
- The deck holds six loungers and four waiting spots, both numbers owned by
  the backend and read from the scene description. When every lounger is
  taken the agents wait at the pool edge, and when that is full too they
  wait at the gate instead of walking through each other.

## Sprint 7 — plugin packaging

- `plugin/.claude-plugin/plugin.json`, `plugin/hooks/hooks.json`.
- `plugin/scripts/agentpool-ensure-server.sh`: start the backend if the port
  is closed, with a PID file.
- The command-hook fallback (`agentpool-hook.sh`) that always exits 0.
- The local marketplace entry and `make install`.

## Sprint 8 — polish and the modularity proof

- `ui/Inspector.tsx`, `ui/Legend.tsx`, `ui/Toast.tsx`, responsive layout.
- `tests/test_bridge_is_scene_agnostic.py` — the architecture guard: the
  bridge never names a scene.
- `docs/porting.md` — the reuse kit: which files another project lifts and
  what it has to write itself.

A second scene (a stadium) was built to prove the seam and then removed
again: the pool is the only scene in this repository, and the stadium is a
separate project that lifts the bridge. What stays is the contract — the
adapter protocol, the shared vocabulary and the architecture guard.
- `README.md`, `docs/hook-events.md`, `docs/lifecycle.md`, `docs/scenes.md`.

The sprint also turned up a bug that only showed in one browser: the masked
layer — and with it every character — disappeared in Chromium under
Playwright, because the mask object had `renderable = false`. A mask in
PixiJS v8 is left out of the colour pass by itself; taking it out of the
render pass as well empties the layer, in some browsers only.
