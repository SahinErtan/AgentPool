# AgentPool architecture

## The seam

```
Claude Code
   │  HTTP hook  POST http://127.0.0.1:38000/hooks/<event>
   ▼
backend/agentpool/
   bridge/    raw hook JSON → AgentEvent → AgentState      ← scene agnostic
   broker.py  in-process pub/sub
   scenes/    SceneAdapter: AgentState → SceneState + placement
   ▼
   WS frames { scene, agents: [AgentView] }
   ▼
frontend/src/scene/pool/                                    ← the pixels
```

The **bridge** never mentions a pool, a lane, a lounger or a gate. It converts Claude Code's hook
payloads into a stable event/snapshot schema and asks a **scene adapter** to translate agent state
into *scene state* plus *placement*.

A future "stadium" or "office" project installs the bridge, writes `class StadiumScene(SceneAdapter)`
and ships its own frontend renderer. **Zero changes to `bridge/`.** That property is enforced by
`tests/test_bridge_is_scene_agnostic.py`, which greps the bridge for forbidden vocabulary.

**Placement lives on the server.** Two open browser tabs must agree on who is in which lane, so the
backend owns the world model (slots, routes) and the frontend owns the pixels.

## Agent identity

`agent_id` is the primary key for a character. A character is a pure function of it:

```
hash(agent_id) → domain-separated random streams → archetype + palette + accessory + swim style
```

Each attribute draws from its own named stream (`rngFor(id, 'skin')`, `rngFor(id, 'hair')`, …) so that
adding an attribute later cannot reshuffle the characters that already exist.

## The pose model

A pose is a flat vector of joint angles. The final pose is the **weighted sum of six layers**:

| Layer | Used when |
|---|---|
| `rest` | standing idle |
| `lounge` | lying on a lounger |
| `activity` | an idle activity (tea, book, …) on a lounger |
| `walk` | on the deck, moving |
| `swim` | in the water |
| `climb` | on the ladder |

The **weights are damped; the layer oscillations are not**. Damping the angles would also damp the
oscillation and lag the stroke by ~80 ms, which makes the swim look syrupy. Damping the weights keeps
each stroke crisp while still cross-fading smoothly, and it makes interruption free: an agent that
goes idle mid-swim simply has its `swim` weight fall to zero.

### Two rules that are easy to get wrong

1. **A sub-layer must be taken out of a separately damped parent.**
   Writing `w.lounge = damp(w.lounge, 1, k, dt) - w.activity` creates a feedback loop: the fixed
   point is `1 - activity/damping`, which is *negative* for a damping factor below 1. The weights then
   diverge every frame. The activity is therefore a sub-layer of the lounge, and the lounge weight is
   damped on its own (`loungeRaw`) before the activity is subtracted from it.

2. **Never rotate the root container for facing.** Mirroring with `scale.x = -1` also mirrors the
   rotation sense. The rig therefore has a dedicated `facing` container between the root and the
   body, so the root keeps the unit scale and the facing keeps the flip.

## Tuning constants

### Swim styles (cadence = cycles per second)

| Style | Cadence | Character |
|---|---|---|
| crawl | 0.55 | alternating arms, recovery elbow bend, 2× flutter kick, body roll with the pulling arm |
| breaststroke | 0.38 | symmetric pull, knees snap in, head lifts to breathe |
| butterfly | 0.42 | one big arm arc, the body wave travels chest to feet |
| doggy | 0.75 | head above water, fast 2× front-back paddle |

### Damping rates

| What | k | Settles in |
|---|---|---|
| swim / walk weights | 10 | ~0.3 s |
| climb weight | 12 | ~0.25 s |
| lounge weight | 8 | ~0.4 s |
| activity weight | 6 | ~0.5 s (slow: an activity eases in) |

### Idle activities

Each character has a deterministic activity, a start delay of 6–30 s, a duration of 5–14 s and a
cooldown of 20–60 s, all drawn from its own `motion` stream. The rules that keep the loungers from
looking mechanical: **weighted random choice**, **bursts rather than loops**, and **desynchronised
starts**.

## PixiJS v8 notes

- `Application.init()` is asynchronous and must be awaited.
- `app.view` is gone → `app.canvas`.
- The Graphics API is the fluent one: `g.roundRect(...).fill(...)`, `g.stroke({ width, color })`.
  `beginFill` / `lineStyle` no longer exist.
- `TilingSprite` uses the object constructor: `new TilingSprite({ texture, width, height })`.
- `container.sortableChildren = true` plus `zIndex` replaces `sortChildren()`.
- Masks live in the **parent's coordinate space**; the mask `Graphics` must be a child of the same
  container that uses it.

### Do not use `resizeTo`

PixiJS v8's `ResizePlugin` keeps its state in **static** fields. Destroying one `Application` wipes
the plugin for every other live application, which under React's StrictMode (mount → unmount → mount)
breaks the surviving instance with `this._cancelResize is not a function`.

AgentPool therefore does not use `resizeTo` at all: `frontend/src/scene/pixi.ts` exposes
`observeHostSize(app, host)`, a plain `ResizeObserver` that calls `app.renderer.resize()`.

### Destroying an application

`Application.destroy()` throws if the application never finished initialising. Always guard the
teardown with an `initialized` flag and destroy a pending application from inside its own
`init().then()`.

## The two-rig masking trick

A swimming character has to be cut by the waterline. A Pixi container can only have one parent, so
each character owns **two rigs built from the same spec**: a surface rig masked to above the waterline
and an underwater rig masked to below it. The animator computes the pose once and writes the same
joint transforms to both rigs, so the halves line up exactly. The underwater rig is created lazily —
a character lounging on the deck never needs one.
