# Sprint 21 — The tools and the polish

**Goal.** Fix what looks wrong in the 3D pool today, and build the tools
every later sprint needs:

- a scripted fake crowd (`?demo`) and debug hooks, so a behaviour can be
  looked at without waiting for real agents;
- an **action layer** in the pose driver, so a character can cheer, clap,
  raise its hand or tread water on top of whatever it is doing;
- squash and stretch, a mouth, hair styles, foam and bubbles.

Read `docs/plans/README.md` first.

**Files touched:**

| Kind | Files |
|---|---|
| New | `src/scene/demo/demoFeed.ts`, `src/scene/motion/actions.ts`, `src/scene/characters3d/hair.ts`, `test/demo.test.ts`, `test/actions.test.ts` |
| Changed | `App.tsx`, `pool3d/PoolScene3D.ts`, `pool3d/lighting.ts`, `pool3d/world.ts`, `pool3d/environment.ts`, `pool3d/flow.ts`, `pool3d/effects3d.ts`, `pool3d/water.ts`, `characters/poses.ts`, `motion/driver.ts`, `characters3d/skeleton3d.ts`, `characters3d/rig3d.ts`, `characters3d/apply3d.ts`, `lab/Lab3D.tsx`, `test/character3d.test.ts` |

---

## Step 21.1 — The demo crowd (`?demo`)

**Why.** Every later sprint adds behaviour that only shows when agents are
in particular states: running Bash, waiting for permission, finishing,
being a sub-agent. Waiting for real agents to do these things makes a
change impossible to check. The demo feeds the store with scripted fake
agents, so the panels and the scene behave as if a backend sent them.

**New file `src/scene/demo/demoFeed.ts`:**

```ts
export interface DemoHandle { close(): void }

/** The number of fake agents asked for by `?demo` or `?demo=N`, or 0. */
export function demoCount(search: string): number;
//  "?demo" → 12, "?demo=40" → 40, clamped to 1..60; no param → 0.

/** Pure: the fake agents at `nowS` (seconds) for a crowd of `n`. */
export function demoAgents(n: number, nowS: number, state: DemoState): AgentView[];

export interface DemoState { /* allocator memory, see below */ }
export function createDemoState(n: number, startS: number): DemoState;

/** Start feeding the store; replaces the websocket. */
export function startDemo(n: number): DemoHandle;
```

**The crowd.** For `n` agents:

- `ceil(n / 6)` sessions, ids `session:demo-s{k}`, kind `session`, label
  `demo-s{k}`, `session_id` `demo-s{k}`;
- one `workflow` (id `wf:demo`) when `n >= 8`;
- one `mcp` (id `mcp:demo-browser`) when `n >= 10`;
- the rest are sub-agents: id `sub:demo-{i}-{gen}`, kind `subagent`,
  `parent_id` the session `i % sessions`, `subagent_type` picked from
  `['Explore', 'Plan', 'general-purpose', 'code-improver']`.

**The timeline.** Every agent's timeline is a pure function of its id,
built with `rngFor(id, 'demo')` from `characters/spec.ts`:

- It alternates between `working` (40–120 s) and `idle` (30–90 s). The
  first phase and its offset come from the rng, so the crowd does not
  switch all at once.
- While working, `tool_name` changes every 4–15 s. It is picked from:

  ```
  ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'Bash', 'WebSearch',
   'WebFetch', 'Agent', 'TodoWrite', 'mcp__plugin_playwright_playwright__browser_click']
  ```

  `last_event_at` moves to the time of each change.
- **A sub-agent's life.** After its second working phase it becomes
  `finished` for 8 s, then `leaving` for 20 s, and then it is replaced by
  the next generation (`gen + 1`, a new id). That way arrivals, exits and
  new characters keep happening.
- **Sessions ask for permission.** Every 150–260 s a session pushes a
  session event through `store.pushFeed`:

  ```js
  { event_id: 'demo-…', ts: nowS, type: 'permission', session_id, detail: 'Bash', source: 'demo' }
  ```

  The session then stays `working` with no new `last_event_at` for
  15–30 s. After that its `last_event_at` moves on, which is how a real
  session looks once the person has answered.

**Presentation.** The allocator in `DemoState` mirrors the backend
(`backend/agentpool/scenes/pool.py`, `presentation()`). Copy the numbers,
not the code:

- **The scene description:**
  - lanes 4;
  - loungers = `clamp(idleCount + 2, 6, 12)`;
  - waiting 4.

  Call `store.setScenePayload({ scene: 'pool', lanes, loungers, waiting, gate: 'gate', ladder: 'ladder' })`
  whenever these change.
- **`working` → `mode: 'swim'`.** The agent gets the lane with the fewest
  swimmers, lowest index first, and keeps it for the whole working phase.
  Its place is its index in that lane's list. Then:
  - `lane_offset = (lane % 2 ? 0.18 : -0.18) + place * 0.3`;
  - `direction = (lane + place) % 2 === 0 ? 1 : -1`;
  - slot `lane:{lane}`.
- **`idle` → `mode: 'lounge'`.** The agent gets the lowest free lounger;
  if none is free, `mode: 'waiting'` with the lowest free waiting spot; if
  none is free either, `waiting` with `queue` = its place in the overflow.
- **`finished`** → `mode: 'exiting'`, `props.to: 'gate'`.
- **`leaving`** → `mode: 'leaving'`.
- `speed_scale: 1`. `route`, `from` and `to` are null except as above.

**Every other field of `AgentView`:**

- `created_at` / `started_at` are the start time of the demo;
- `finished_at` is null;
- `event_count` grows by one every time the tool changes;
- `scene: 'pool'`;
- `events: []`;
- `cwd: null`;
- `detail`: the tool name.

**Driving it.** In `App.tsx`, where `connectAgentSocket()` is called:

```tsx
useEffect(() => {
  const demo = demoCount(window.location.search);
  const handle = demo > 0 ? startDemo(demo) : connectAgentSocket();
  return () => handle.close();
}, []);
```

`startDemo` does the following:

- calls `store.setConnection('live')` once;
- then every 500 ms calls
  `store.replaceAgents(demoAgents(n, Date.now() / 1000, state))`,
  updates the payload when it changes, and pushes the permission events;
- removes an agent from the list 20 s after it became `leaving`, and does
  not wait for `acknowledgeExit`.

`acknowledgeExit` opens a websocket. In demo mode it must do nothing:
guard it in `net/ws.ts` with `if (demoCount(window.location.search) > 0) return;`.

**Check:**

- `test/demo.test.ts`:
  - `demoCount` parses `''`, `'?demo'`, `'?demo=5'`, `'?demo=999'` and
    `'?x=1&demo=3'`;
  - `demoAgents(12, t, state)` called twice with the same `t` and a fresh
    state gives the same list;
  - over 600 simulated seconds, stepped 0.5 s at a time:
    - every agent has a presentation mode in the allowed set;
    - no two swimmers in one lane share a `lane_offset`;
    - no two loungers or waiting spots are given to two agents;
    - at least one permission event, one `finished` and one new
      generation happen.
- In the browser, `/?demo=12`: the pool fills, the list on the right shows
  the fake agents, and characters come and go over two minutes.
  `/` without `?demo` still shows the real agents.

## Step 21.2 — Debug hooks

**Why.** To look at one behaviour now, instead of waiting for it.

In `PoolScene3D`, add a public `debug` object. It exists only when the URL
has `debug` or `demo`; otherwise it is `undefined`.

```ts
debug?: {
  list(): Array<{ id: string; state: string; x: number; z: number; inWater: boolean;
                  action: string | null; work?: string }>;
  play(id: string, action: ActionKind): void;   // driver.play
  hold(id: string, action: ActionKind | null): void; // driver.hold / release
  force(id: string, patch: Record<string, unknown>): void; // see later sprints; for now { yaw, x, z }
  look(x: number, z: number, distance?: number): void; // camera target + distance, marks userMovedCamera
};
```

`look` sets `controls.target`, puts the camera at `distance` (default 8)
along its current direction, and calls `controls.update()`.

**Check.** In the browser, `window.__agentpool.debug.list()` returns the
characters. `debug.look(0, 0, 7)` moves the camera. On `/` (no
`debug`/`demo`), `debug` is undefined.

## Step 21.3 — No shadow acne

**Why.** The parasols and the cushions are striped with shadow acne.

In `pool3d/lighting.ts`, where the sun is set up:

1. Change `sun.shadow.normalBias` from `0.02` to `0.05`, and
   `sun.shadow.bias` from `-0.0004` to `-0.0006`.
2. Reload and look at a lounger and a parasol close up:
   `debug.look(world.loungers[0].x, world.loungers[0].z, 3.5)`.
3. If stripes remain, raise `normalBias` in steps of 0.02, up to 0.11.
   Stop at the first value with no stripes. Then check that the shadow of
   the parasol pole still touches the pole's foot: a gap of 5 cm or less
   is fine.
4. Write the value you kept, and why, in the comment above it.

**Check.** Screenshots `21-acne-lounger.png` and `21-acne-parasol.png`,
taken close up, show no stripes on the cushion or the canopy.

## Step 21.4 — A smaller head, hair styles and a mouth

**Why.**
- Seen from behind, a swimmer's head and hair read as one big dark ball.
  The head of the `round` archetype is 0.35 of the figure's height (59 cm
  on a 1.7 m character), and the hair cap is 8 % bigger than that.
- Every character has the same haircut.
- The faces have no mouth, so a cheer or a call looks the same as a
  rest.

**`characters3d/skeleton3d.ts`:**

1. Add `export const HEAD_SCALE_3D = 0.84;` and use it in
   `buildSkeleton3D`: `const headR = (p.headR / total) * HEAD_SCALE_3D;`.
   The 2D figure does not read this file, so it does not change.
2. Add two bones at the **end** of `BONES`, after `'footR'`: `'mouth'` and
   `'ponytail'`. Appending keeps every existing skin index the same.
3. In `boneLayout` add:
   - `mouth: { parent: 'head', x: 0, y: -sk.headR * 0.4, z: sk.headR * 0.88 }`;
   - `ponytail: { parent: 'head', x: 0, y: sk.headR * 0.35, z: -sk.headR * 0.9 }`.

**New file `characters3d/hair.ts`:**

```ts
export type HairStyle = 'crop' | 'bob' | 'bun' | 'ponytail' | 'buzz';

/** The haircut of a character: its own stream, so no other attribute moves. */
export function hairStyleFor(seed: number): HairStyle {
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  // weights: crop 30, bob 22, bun 14, ponytail 20, buzz 14
}
```

**In `rig3d.ts` `bodyParts`,** replace the single hair cap with one shape
per style:

| Style | Geometry |
|---|---|
| `crop` | `SphereGeometry(headR * 1.04, 18, 10, 0, 2π, 0, π * 0.42)`, scaled `[1, 0.85, 1]`, raised `headR * 0.05`, tilted back `-0.38` as now. The forehead shows. |
| `bob` | The same with `thetaLength π * 0.6`, scaled `[1.1, 1, 1.06]`: it covers down to the jaw at the sides and the back. |
| `bun` | `crop`, plus a sphere of `headR * 0.36` at `(0, head.y + headR * 0.75, head.z - headR * 0.55)`. |
| `ponytail` | `crop`, plus a capsule of radius `headR * 0.16` and length `headR * 1.1`, bound to the `ponytail` bone and hanging down from it. |
| `buzz` | `thetaLength π * 0.45`, radius `headR * 1.01`, colour `shade(spec.hair, 0.15)`: a thin layer that reads as very short hair. |

All of these stay on the `hair` bone, except the ponytail piece, which goes
on the `ponytail` bone.

**The mouth.**
- A sphere of radius `headR * 0.2`, scaled `[1, 0.32, 0.45]`, bound to the
  `mouth` bone.
- Colour `shade(spec.skin, -0.45)`; use the existing `shade` helper with a
  negative factor, which darkens.

**`apply3d.ts`.** Extend `Extras` with `mouth: number` and `ponytail: number`:

```ts
b.mouth.scale.set(1, 0.6 + 2.2 * extras.mouth, 1);
b.ponytail.rotation.x = 0.25 + extras.ponytail;   // hangs back, swings with the head
```

**`driver.ts`.** Add two getters:
- `get mouth(): number` returns `this.mouthValue`. It is 0.12, a closed
  smile, unless an action sets it (Step 21.6).
- `get ponytail(): number` returns `this.hairSpring.value * 1.6`.

Pass both from `PoolScene3D` and `Lab3D`, in the same place `hair` is
passed.

**Check:**

- Update `test/character3d.test.ts` wherever it counts bones or
  checks head sizes. Add these tests:
  - `hairStyleFor` gives every one of the five styles over 500 seeds;
  - the same seed always gives the same style;
  - `specFor(id)` gives exactly the values it gave before for 20 fixed
    ids. Pin them by generating the values on the *old* code first.
- In the browser, `?lab&3d`: the faces have mouths, and the haircuts vary.
  In `?demo=12`, close up behind a swimmer, the head is no longer one big
  ball. Screenshot `21-heads.png`.

## Step 21.5 — Lying back on the lounger

**Why.** The figure on a lounger sits upright, away from the back rest.

1. **`world.ts`.** Add a pure helper that describes the back rest, so the
   drawing and the test use the same numbers:

   ```ts
   export const BACKREST_LEAN = 0.62; // radians back from upright
   export function backRest(l: Lounger): { y: number; z: number; normalY: number; normalZ: number } {
     // the middle of the back rest's front face, and its normal, as
     // environment.ts computes them in loungerPieces()
   }
   ```

   Use it in `environment.ts` `loungerPieces` instead of the local
   `lean = 0.62` and the `cy` / `cz` / `ny` / `nz` arithmetic. The drawing
   must not change.
2. **`flow.ts` `placeOnSeat`.** The hips sit at
   `lounger.length * 0.2` behind the middle of the lounger. Make that
   factor a named constant `HIP_BACK = 0.2`, so the test can tune it.
3. **New test** in `test/character3d.test.ts`: *the back of a lounging
   figure rests on the back rest*.
   - Build a rig with `buildRig3D(specFor('lean-test'))` and scale it as
     the scene does.
   - Run a `PoseDriver` in `lounging` for 2 s and apply the pose with
     `applyPose3D`.
   - Place `rig.root` where `placeOnSeat` puts a body with `sitT = 1`, with
     `rotation.y` from the lounger's facing.
   - Call `rig.root.updateMatrixWorld(true)` and read the world position
     of the `neck` bone.
   - Its distance to the back-rest plane (point and normal from
     `backRest`) must be between 0.02 and 0.14 m, on the front side.
   - Do this for all five archetypes, with specs overridden to each
     archetype.
4. If the test fails, change `HIP_BACK`, which moves the hips along the
   seat, until all five archetypes pass. Only if no value works, add a
   3D-only extra lean:
   - add `lean: number` to `Extras`, added to `b.hips.rotation.x`, passed
     as `LOUNGE_EXTRA_LEAN * body.sitT` when the body is seated;
   - **do not change `loungePose`** in `poses.ts`, because the 2D pool
     uses it.

**Check.** The new test passes. Screenshot `21-lounger.png`, close up from
the side, shows the back against the back rest.

## Step 21.6 — The action layer, and squash and stretch

**Why.** The later sprints need characters that do short things on top of
what they are doing:
- cheer, clap, raise a hand;
- tread water;
- dive, slide, throw a ball, take a shower.

The reactions (`wave`, `look`) can only add a small offset. The new layer
can also *replace* the pose for a while, and it can loop.

1. **A new pose field: `stretch`.** In `characters/poses.ts`, add
   `stretch: number` to `Pose`. Then:
   - add it to `POSE_KEYS`, `zeroPose`, `resetPose`, `copyPose`,
     `blendPose` and `addPose`, following the pattern of `spine`;
   - it defaults to 0, and the 2D rig ignores it;
   - comment: *positive stretches the figure up and thins it, negative
     squashes it; the volume stays about the same.*

   In `apply3d.ts`:

   ```ts
   const s = Math.max(-0.3, Math.min(0.3, pose.stretch));
   const thin = 1 / Math.sqrt(1 + s);
   b.bob.scale.set(thin, 1 + s, thin);
   ```

2. **New file `motion/actions.ts`:**

   ```ts
   import type { Motion, Pose } from '../characters/poses';

   export type ActionKind =
     | 'cheer' | 'clap' | 'raiseHand' | 'raiseHandLying' | 'tread' | 'hop';
   // later sprints add more kinds here

   export interface ActionSpec {
     /** Seconds for one play, or one loop. */
     seconds: number;
     /**
      * 'replace' blends the whole pose towards the action's pose;
      * 'add' adds the action's pose as an offset, as a reaction does.
      */
     mode: 'replace' | 'add';
     /** Writes the action's pose at progress u (0..1) into out. */
     pose(out: Pose, u: number, motion: Motion): Pose;
     /** How open the mouth is at u (0 closed .. 1 wide). Optional. */
     mouth?(u: number): number;
   }

   export const ACTIONS: Record<ActionKind, ActionSpec>;
   ```

   The first actions. Angles follow the conventions written at the top of
   `poses.ts`: measured from straight down, positive forward, and the
   knee negative bends backwards.

   | Action | Mode | Length | What it does |
   |---|---|---|---|
   | `cheer` | add | 1.6 s | Both arms up (`armL = armR = -2.6·lift`), the elbows almost straight, the head back 0.15, `stretch` +0.08 at the top, a small hop (`bob` 0.05·sin(πu)). `mouth` 0.9. |
   | `clap` | add | 2.0 s | Both arms forward to 1.2; the elbows bend 1.1 + 0.25·sin(u·2π·5), so the hands meet five times. `mouth` 0.5. |
   | `raiseHand` | add, looped | 2.4 s | The right arm up to -2.7, a slow wave from the elbow (0.25·sin(u·2π)), the head a little up. `mouth` 0.25. |
   | `raiseHandLying` | add, looped | 2.4 s | The same for a figure on a lounger: copy the `waveLying` reaction's angle (`armR = 1.87`), at a third of its wave speed. |
   | `tread` | replace, looped | 2.0 s | Upright in the water. `bodyPitch` 0.05; the arms sculling out to the side (`armOutL/R = 0.9 + 0.25·sin(u·2π)`, arms 0.4, elbows 0.6); the legs in a slow eggbeater (`legL = 0.35·sin(u·2π)`, `legR` the opposite, knees -0.6); `bob` 0.02·sin(u·2π·2). |
   | `hop` | add | 0.9 s | A crouch (`stretch` -0.15, knees -0.5) up to u 0.3, a jump (`bob` up to 0.22, `stretch` +0.12) to u 0.7, then a landing squash (`stretch` -0.1) and a settle. This one is there to test squash and stretch, and to celebrate with. |

3. **`driver.ts`:**

   ```ts
   play(kind: ActionKind): void        // one play; replaces a running action
   hold(kind: ActionKind): void        // loops until release(); no-op if already holding it
   release(): void                     // fades the held action out
   get action(): ActionKind | null
   get actionProgress(): number        // u of the current play/loop
   ```

   - **State:** `actionKind`, `actionT`, `actionHeld`, `actionWeight`, and
     a pose buffer `layerAction` (made once, like the other layers).
   - **The weight:** damped towards 1 while an action runs and towards 0
     after it, with `damp(..., 8, dtMs)`. A one-shot play also fades by
     its own envelope, `min(1, u * 6) * min(1, (1 - u) * 6)`, so it starts
     and ends softly.
   - **Where it goes in `update`:** after the state layers are blended and
     *before* the reaction:

     ```ts
     if (this.actionKind) {
       const spec = ACTIONS[this.actionKind];
       const u = spec.seconds > 0 ? (this.actionT / spec.seconds) : 1;
       spec.pose(this.layerAction, held ? u % 1 : Math.min(1, u), this.motion);
       if (spec.mode === 'replace') blendPose(this.pose, this.pose, 1 - w, this.layerAction, w);
       else addPose(this.pose, this.layerAction, w);
     }
     ```

     A one-shot ends at u ≥ 1 and clears `actionKind` once its weight is
     below 0.01.
   - **The mouth:** `mouthValue = damp(mouthValue, spec.mouth?.(u) ?? 0.12, 10, dtMs)`.

4. **The lab.** In `Lab3D.tsx`, add a row of standing figures, one per
   action:
   - one-shot actions replay every 3 s;
   - looped ones are held;
   - the existing `reaction` scrubber also scrubs the action rows: add a
     driver helper `scrubAction(kind, u)`, written like `scrubReaction`.

**Check:**

- `test/actions.test.ts`:
  - every `ACTIONS` entry writes finite numbers into every field of a pose
    at u ∈ {0, 0.25, 0.5, 0.75, 1};
  - a one-shot `play` ends: after `seconds + 1` s of updates, `action` is
    null;
  - `hold` keeps going after 3 loops, and `release` ends it within 1 s;
  - `stretch` is 0 when no action runs;
  - the 2D animator's poses are unchanged: run the existing
    `characters.test.ts` and make sure it is green without changes.
- In `?lab&3d`, every action reads at a glance. Screenshot `21-actions.png`.
  The `hop` visibly squashes and stretches.

## Step 21.7 — Foam, bubbles and a bigger particle pool

**Why.** A swimmer leaves no trail, and later sprints need bubbles (a dive
under the water), confetti and a shower stream.

In `pool3d/effects3d.ts` (`Particles`):

1. Raise `COUNT` from 600 to 1600.
2. Widen `kind` to these values:

   | Value | Kind | Behaviour |
   |---|---|---|
   | 0 | drop | falls under gravity, as now |
   | 1 | steam | rises and spreads, as now |
   | 2 | foam | stays on the surface, grows and fades |
   | 3 | bubble | rises at 0.5 m/s and wobbles in x and z by 0.1·sin |
   | 4 | confetti | falls at 0.6 m/s, drifts on noise, many colours |

   In `update()`:
   - **foam:** `vy = 0`; its size grows by `dt * 0.25`; its alpha is
     `0.7 * life / maxLife`.
   - **bubble:** rises; it dies at the surface, when `y >= waterY`.
     Take `waterY` as a new argument of `update(dt, waterY)`.
   - **confetti:** falls; it spins by flicking its alpha between 0.6 and
     1 with `sin(life * 20)`.
3. New methods:

   ```ts
   foam(x: number, z: number, y: number, size = 0.14): void      // life 1.4 s
   bubbles(x: number, y: number, z: number, n = 4): void          // life up to 3 s
   confetti(x: number, y: number, z: number, n = 60): void        // life 3 s, burst outwards
   ```

4. **In `PoolScene3D.update`,** next to the existing wake:
   - Every 4th frame (offset by `spec.seed % 4`), each swimmer that is
     moving drops foam behind its feet:
     - the point is `swimCentre(body)` minus `heading * scale * 0.55`;
     - `y` is `world.waterY + 0.012`;
     - the size is `0.12`, or `0.2` when the stroke is butterfly.
   - Skip the foam on frames where `this.reducedMotion` is true. The
     ripples stay.

**Check:**

- Extend `test/world3d.test.ts`, or add `test/particles.test.ts`:
  - `Particles` in node, with no renderer: spawning 2000 particles never
    throws, and the ring buffer wraps;
  - foam stays at its `y`;
  - a bubble never goes above `waterY`.
- In the browser, `?demo=12`: each swimmer has a short white trail.
  `?demo=60&debug` stays within budget. Screenshot `21-foam.png`.

## Step 21.8 — Clearer shallow water, deeper deep water

**Why.** The water is equally see-through from end to end. Real pool water
lets you see the floor at the shallow end and goes darker and less clear
at the deep end.

In `pool3d/water.ts` `SURFACE_FRAG`, the `depth` term already darkens the
colour. Make the alpha follow it too:

```glsl
float alpha = mix(0.52, 0.9, fresnel) + depth * 0.1 + glint * 0.3;
```

Look at the result from the default view and from straight above
(`debug.look(0, 0, 14)` with the polar angle at its minimum). The swimmers
at the deep end must still be visible: their underwater legs show through.
If they do not, use `depth * 0.06`.

**Check.** Screenshot `21-water.png` from the default view.

## Done

- All steps checked; `npm test`, `npx tsc -b`, `npm run build` and
  `make test-backend` pass.
- `/?2d` looks exactly as before. Take screenshot `21-2d.png` and compare
  it with one taken before this sprint.
- `/?demo=60&debug` meets the budget after 20 s.
- Screenshots: `21-acne-lounger.png`, `21-acne-parasol.png`,
  `21-heads.png`, `21-lounger.png`, `21-actions.png`, `21-foam.png`,
  `21-water.png`, `21-2d.png`.
- `docs/next.md` gets a *Sprint 21 — the tools and the polish* entry.

## Deviations

(The implementer writes here anything that had to be done differently from
this plan, and why.)

- The debug hooks live on the scene itself: `window.__agentpool.debug`,
  not `window.__agentpool.scene.debug`.
- Checked on 2026-11-14: 263 tests pass, and `tsc -b` and the build are
  clean. `?demo=24&debug` runs at 60 fps with 144 calls and 359k
  triangles, and the console shows no errors. `?2d` is unchanged.
