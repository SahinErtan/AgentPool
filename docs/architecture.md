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
frontend/src/scene/pool3d/                                  ← the pixels (Three.js)
```

The **bridge** never mentions a pool, a lane, a lounger or a gate. It converts Claude Code's hook
payloads into a stable event/snapshot schema and asks a **scene adapter** to translate agent state
into *scene state* plus *placement*.

AgentPool has one scene — the pool. A "stadium" or "office" project installs the bridge, writes its
own `SceneAdapter` and ships its own frontend renderer. **Zero changes to `bridge/`.** That property
is enforced by `tests/test_bridge_is_scene_agnostic.py`, which greps the bridge for forbidden
vocabulary, and `docs/porting.md` lists the files to lift.

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

### A rule that is easy to get wrong

**A sub-layer must be taken out of a separately damped parent.** Writing
`w.lounge = damp(w.lounge, 1, k, dt) - w.activity` creates a feedback loop: the fixed point is
`1 - activity/damping`, which is *negative* for a damping factor below 1. The weights then diverge
every frame. The activity is therefore a sub-layer of the lounge, and the lounge weight is damped on
its own (`loungeRaw`) before the activity is subtracted from it.

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

## Under the water

A swimming character is cut by the waterline in the 3D pool without masks: the water is a
surface, and a fragment below it is tinted with the colour of the water, deeper is bluer. One
patch applies to every material that can go into the pool (`frontend/src/scene/pool3d/underwater.ts`).
