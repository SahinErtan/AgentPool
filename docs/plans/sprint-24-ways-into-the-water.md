# Sprint 24 — Ways into the water, and ways to swim

**Goal.** Every swimmer climbs down the same ladder today, swims the same
lengths and climbs out the same ladder. This sprint adds:

- **Ways in:**
  - a racing dive from the starting block of its own lane;
  - a dive off the diving board;
  - the water slide;
  - a cannonball off the edge.
- **Ways to swim:**
  - a flip turn at the wall;
  - a rest at the wall now and then;
  - a short race when two swimmers come level in neighbouring lanes.
- **Ways to wait and to leave:**
  - the agents waiting for a lounger sit on the edge with their feet in
    the water;
  - a swimmer by a long wall sometimes gets out over the edge instead of
    using a ladder.

Read `docs/plans/README.md` first. This sprint needs Sprints 21, 22
and 23.

**Files touched:**

| Kind | Files |
|---|---|
| New | `src/scene/pool3d/entries.ts` (pure), `test/entries.test.ts` |
| Changed | `pool3d/flow.ts`, `pool3d/swim.ts`, `pool3d/world.ts` (the waiting spots at the edge), `motion/actions.ts` (new actions), `motion/driver.ts` (new states), `pool3d/PoolScene3D.ts`, `pool3d/equipment.ts` (the board bends), `lab/Lab3D.tsx`, `test/world3d.test.ts` |

## The shape of it

Today `deckGoal` sends a body that should swim to a ladder, and `arrive`
starts the climb. That stays, and becomes **one entry among several**:

```ts
export type EntryKind = 'ladder' | 'block' | 'board' | 'slide' | 'cannonball';

export interface EntryState {
  kind: EntryKind;
  /** The step of the entry; each kind has its own list of phases. */
  phase: string;
  /** Seconds into the current phase. */
  t: number;
  /** Where the body lands in the water. */
  splash: Vec2;
  /** The way it will swim after the entry. */
  dir: 1 | -1;
}
```

`Body` gets:
- `entry: EntryState | null`;
- `entriesMade: number`, which counts the entries so the choice varies;
- `pendingEntry: EntryKind | null`, the choice made when the walk to the
  water starts.

While `entry` is set, `stepBody` calls `stepEntry` instead of the deck
code, the same way `climbing !== 0` calls `stepClimb` now. The existing
ladder climb stays as it is. `'ladder'` is just the entry that uses
today's code path.

**The rule for every entry:**
- It ends by calling one shared function, `enterWater(body, world, x, z, dir)`.
  This sets `inWater`, starts the `SwimState` at `(x, z)` heading `dir`,
  and sets the state to `swimming`.
- It is aborted, with the body walked back to the deck, when `desired`
  stops being `'swim'` **before** the body has left the ground. Once it
  is in the air, the entry finishes and the swimmer gets out in the usual
  way.

---

## Step 24.1 — Choosing the way in (`entries.ts`, pure)

```ts
export function chooseEntry(body: Body, world: World, busy: EntryBusy, reducedMotion: boolean): EntryKind;

export interface EntryBusy {
  /** Someone is on the slide's stairs, its platform or in its chute. */
  slide: boolean;
  /** Someone is on the board or walking along it. */
  board: boolean;
  /** Someone is standing on (or diving from) this lane's starting block. */
  block(lane: number): boolean;
  /** A swimmer is within this radius of the point, in the water. */
  waterNear(x: number, z: number, radius: number): boolean;
}
```

- With reduced motion it is always `'ladder'`.
- Otherwise draw from a seeded generator,
  `mulberry32(hashOf(body.id) ^ (body.entriesMade * 0x9e3779b9))`, with
  these weights:

  | Entry | Weight | When it is allowed |
  |---|---|---|
  | `ladder` | 40 | always |
  | `block` | 22 | the block of `body.lane` is free, and no swimmer is within 2.5 m of the point 1.2 m in front of the block, in the lane |
  | `board` | 14 | the board is free, and no swimmer within 2.5 m of `board.splash` |
  | `slide` | 14 | the slide is free, and no swimmer within 2.5 m of `slide.splash` |
  | `cannonball` | 10 | a point on the coping next to the body's lane exists (lanes 0 and L−1 only, at the long walls), and no swimmer within 2.5 m |

- A kind that is not allowed has its weight set to 0. The choice is made
  **once**, when the body first gets the goal of going into the water, and
  is kept in `body.pendingEntry`. When the walk is over the checks are
  made again: if the chosen way has become busy, the body takes the
  ladder.

**The walk goals.** `deckGoal` for `desired === 'swim'` returns, by
`pendingEntry`:

| Entry | Goal point |
|---|---|
| `ladder` | as now |
| `block` | `{ x: pool.minX − 0.75, z: lane.z }`, behind the block |
| `board` | `board.base` |
| `slide` | `slide.stairsFoot` |
| `cannonball` | the coping point (see 24.5), 0.4 m back from the edge |

Add a goal kind `{ kind: 'entry' }` to `Goal`, with `goalPoint` doing the
table above. `arrive` with that goal starts `body.entry`.

**Check** (`test/entries.test.ts`):
- the same body and the same `entriesMade` always give the same choice;
- over 400 bodies with free equipment, each kind is chosen with a share
  within ±5 % of its weight;
- with everything busy, the choice is always `ladder`;
- with `reducedMotion`, the choice is always `ladder`.

## Step 24.2 — The racing dive from the starting block

| Phase | Length | What happens |
|---|---|---|
| `step-up` | 0.6 s | The body moves from behind the block onto it (`x` += 0.45), `y` from 0 to 0.42. It faces +x, along the lane. Action `stepUp` (new): one knee high, then the other. |
| `ready` | 0.8 s | It crouches: action `blockReady` (new), with the body pitched forward 0.9, the hands down to the front edge, the knees bent −0.7 and `stretch` −0.05. |
| `flight` | 0.7 s | It leaves on a parabola to `entry.splash = (pool.minX + 2.4, lane z)`. `y(u) = 0.42 + 0.55·sin(πu)·(1 − u) − (0.42 − waterY + 0.1)·u²`, which ends just under the water. The body pitch goes from 0.9 to π/2 (flat) along the way, through action `dive` (new): arms straight ahead past the head (arms 2.9), legs together, `stretch` +0.12. |
| `glide` | 0.9 s | It is under the water: `enterWater` at the splash, then hold the swim with `sink = 0.35·sin(π·u)` (as the read dive does, Sprint 22) and the speed ×1.3. |

- At the start of `flight`, `particles.splash` is *not* called. It is
  called at the end of `flight`, at the splash point, with strength 1.4,
  together with `water.ripple(x, z, 1.4)`.
- The scene learns of this through a new **`body.events`** queue, a small
  array of strings the scene drains every frame:
  - `'splash:big'`;
  - `'splash:small'`;
  - `'board:bounce'`;
  - and so on.

  The pure side pushes these strings; the scene turns them into
  particles and ripples. Do it this way for **every** entry, so the pure
  code never touches Three.js.

## Step 24.3 — The dive off the board

| Phase | Length | What happens |
|---|---|---|
| `climb` | 0.5 s | It steps up onto the board's base: `y` from 0 to `board.height`. |
| `walk` | to the tip | It walks along the board (x from base to tip, `y = board.height`) at 0.9 m/s. Walking state, so the stride runs. |
| `bounce` | 2 × 0.55 s | Two bounces at the tip. Each is action `hop` from Sprint 21, smaller (`bob` 0.18). Push `'board:bounce'` at each landing. |
| `flight` | 1.0 s | A parabola from the tip, up 0.9 m, down to `board.splash` (y to `waterY − 0.3`). Half of the dives are a **pike**: action `pike` (new), the body folding at the hips (`legL = legR = 2.2`, arms down to the toes) in the first half, then straight. The other half are a **pencil**: action `pencil` (new), upright and straight with the arms at the sides, feet first, the body pitch staying 0. The split is chosen by `entriesMade % 2`. |
| `glide` | 1.0 s | The same as the block dive's glide, deeper (`sink 0.6`). |

**The board bends.**
- `'board:bounce'` starts a damped spring on the scene's side:

  ```
  flex = 0.12·e^(−4t)·cos(14t)
  ```

  It is passed to `equipment.setBoardFlex(flex)` every frame.
- While somebody stands at the tip, add a static 0.04.
- The figure's `y` follows the tip's height:
  `board.height − (distance from base) · sin(flex)`.

## Step 24.4 — The slide

| Phase | Length | What happens |
|---|---|---|
| `stairs` | to the top | It climbs the stairs: `y` rises evenly with the distance from `stairsFoot` to `stairsTop`. Use the `climbing` state's pose. A walk with the stride is acceptable if the climb pose looks wrong; choose by looking. Wait at the foot while `slide` is busy with someone else in the chute: only one rider at a time. |
| `sit` | 0.7 s | It sits down at `slide.top`, facing along the chute: action `slideSit` (new), with the legs forward (`legL = legR = 1.5`), the knees straight, the body upright, the hands on the lips. |
| `ride` | ~3.2 s | It slides along the chute. `s` goes from 0 to 1 by `ds/dt = (0.12 + 0.55·s) / length · 3`, so it speeds up. The position is `curve.getPointAt(s)` plus 0.12 up. The yaw comes from the curve's tangent, `atan2(T.x, T.z)`. Action `slideRide` (new): leaning back 0.6, both arms up in a cheer (Sprint 21 `cheer` arms), mouth open. |
| `drop` | 0.35 s | From the end of the chute to the splash point, falling. |
| `plunge` | 1.0 s | The glide: `sink 0.5`, then swim. Push `'splash:big'` at the start. |

**The curve.** The pure side needs `getPointAt` and `getTangentAt` without
Three.js objects. In `entries.ts`, implement a centripetal Catmull–Rom
over `slide.path`, sampled once into an arc-length table of 200 points:

```ts
export interface PathTable { points: Vec3[]; lengths: number[]; total: number }
export function buildPathTable(points: Vec3[], samples = 200): PathTable;
export function pointAt(table: PathTable, s: number): Vec3;      // s in 0..1 by length
export function tangentAt(table: PathTable, s: number): Vec3;
```

`equipment.ts` keeps using Three's `CatmullRomCurve3` with
`curveType 'centripetal'`. The test checks that the two agree within 2 cm
at 50 points.

## Step 24.5 — The cannonball

- **The coping point:**
  - lane 0 is at the near wall: `{ x: clamp(body.x, pool.minX + 2, pool.maxX − 2), z: pool.maxZ + 0.25 }`;
  - lane L−1 is at the far wall: `z = pool.minZ − 0.25`.
- **The walk:** it walks there and faces the water.

| Phase | Length | What happens |
|---|---|---|
| `run-up` | 0.5 s | A crouch, then a jump. |
| `flight` | 0.8 s | It jumps out 1.3 m over the water and up 0.6 m. Action `cannonball` (new): the knees hugged to the chest (`legL = legR = 2.0`, knees −2.3, arms wrapped: arms 1.2, elbows 2.0), the body rolling forward 0.6. |
| `splash` | 1.2 s | Push `'splash:huge'`: a splash of strength 2.2, three ripples 0.15 s apart, and 40 drops. The body goes down 0.7 and comes up. Then `enterWater`. |

**Swimmers near the splash.** Every swimmer within 3 m gets `react('look')`.
Every lounging body within 6 m of the splash gets `react('wave')` with a
30 % chance (seeded): they were splashed.

## Step 24.6 — The flip turn and the rest at the wall (`swim.ts`)

1. **The flip turn.**
   - `SwimState` gets `turnKind: 'open' | 'flip'`. When a turn starts,
     choose `flip` when the swim style is `crawl` or `butterfly` and
     either the work is `run` or `hash(id, turns) % 2 === 0`.
   - The driver gets the turn through the body:
     `body.turning = swim.turning > 0 ? swim.turnKind : null`.
   - The scene plays action `flipTurn` (new, `replace`, 1.1 s) when a
     flip starts. It rolls the body forward one whole turn (`rootRot`
     += 2π·smooth(u)), tucked (knees −2.0, legs 1.8), and sinks it by
     0.3·sin(πu).
   - The yaw turn of the open turn still happens. The flip only changes
     how it looks.
2. **The rest.**
   - `SwimState` gets `lengths` (the turns so far), `restAfter`
     (3 + hash % 4) and `resting` (seconds left).
   - When `lengths` reaches `restAfter` at a wall, the swimmer holds at
     the wall instead of turning: `resting = 4 + hash % 4`.
   - It is `treading`, with action `wallRest` (new): the back to the
     wall, both elbows up on the coping (arms −2.2 out to the side,
     `armOutL/R = 1.2`, elbows 1.4) and the head turning slowly
     (`headYaw` 0.4·sin).
   - When the rest is over, the swimmer turns and pushes off. `lengths`
     goes back to 0 and `restAfter` is drawn again.
   - **Never** while `needsYou`. That case has its own wall hold
     (Sprint 22).

## Step 24.7 — The race

A pure function, called by the scene once a second:

```ts
export function findRaces(swimmers: Array<{ id: string; lane: number; x: number; dir: 1 | -1;
                                             racing: boolean; style: SwimStyle; work: WorkKind }>,
                          now: number, cooldown: Map<string, number>): Array<[string, string]>;
```

Two swimmers race when all of these hold:
- their lanes differ by 1;
- they swim the same way;
- `|x1 − x2| < 1.0`;
- both are more than 4 m from the wall ahead;
- neither is racing, `needsYou`, treading or floating;
- the pair has not raced in the last 120 s (the cooldown is keyed by the
  sorted ids).

**During the race:**
- both get `body.raceBoost = 1.35`, a speed factor, until the next wall;
- the first to reach the wall ahead pushes `'race:won'` and plays `cheer`
  (Sprint 21) while treading for 2 s;
- the other plays `look`.

At most two races run at a time in the whole pool.

## Step 24.8 — Waiting at the edge with the feet in the water

1. **`world.ts`.** The waiting spots move to the edge of the pool, on the
   near side:

   ```
   waiting[i] = { x: pool.minX + 3.6 + i * 1.3, z: pool.maxZ + 0.32 }
   ```

   This keeps them clear of the ladder at `pool.minX + 2.6`. If 8 spots
   would reach a ladder, skip the 1.2 m around each ladder.

   Add `edge: true` to the spot type, so `arrive` knows to sit. Update the
   `world3d.test.ts` expectations that pin the old spots, and keep the
   test *no waiting spot is in the water*. The spot is on the coping,
   0.32 m from the water.
2. **`flow.ts` `arrive`.** On reaching a waiting spot the body turns to
   face the water. The spots are on the near side, so the water is towards
   −z and the yaw is `π`. Then it sits:
   - the state is `edgeSitting` (a new `CharState`);
   - `body.y = −body.hipHeight + 0.05`, so the hip is on the coping and
     the legs hang in the water.
3. **`driver.ts`.** Add the state `edgeSitting` with the layer
   `edgeSitPose(out, t, motion)` (in `actions.ts`):
   - upright;
   - `legL = legR = 1.45`, which puts the thighs flat on the coping;
   - the knees bent down: `kneeL/R = -1.4` with a kick,
     `0.35 · sin(t · 2π · 0.7 + side · π)`. Each foot kicks on its own
     noise, so the two feet are never in step;
   - the hands on the coping beside the hips: arms −0.5, elbows 0.2.

   The kicking feet push ripples: the scene calls
   `water.ripple(foot x, foot z, 0.12)` every 1.5 s per sitter.
4. **The queue outside the gate** is unchanged. They stand.

**Check.**
- `world3d.test.ts`: a waiting body ends `edgeSitting`, and its `y`
  satisfies `y + hipHeight` ∈ [0, 0.1].
- In the browser, the sitters' shins are under the water. The underwater
  tint shows.

## Step 24.9 — Out over the edge

When a swimmer in lane 0 or L−1 has to get out (`desired !== 'swim'`):

- **The choice.** With a seeded 30 % chance, and when no ladder is nearer
  than 3 m, it does not swim to a ladder. It swims to the long wall next
  to it at its current x and gets out there.
- **The phases:**

  | Phase | Length | What happens |
  |---|---|---|
  | `reach` | 0.4 s | Hands on the coping. |
  | `push` | 1.0 s | Action `pushUp` (new). The arms straighten, and `y` goes from `waterY − 0.9` to `−hipHeight + 0.05`: up to sitting on the edge. |
  | `swing` | 0.6 s | The legs come out. The yaw turns by π, so it now faces away from the water. |
  | `stand` | 0.6 s | Up to standing, on the deck 0.5 m from the edge. |

- It then walks on as after a ladder (`goal = null`).
- Push `'splash:small'` at the start of `push`; water drips: 6 drops
  falling from the body for 2 s.

## Step 24.10 — The new actions in the lab

Add every new action to the action row in `Lab3D`:

- `stepUp`, `blockReady`, `dive`, `pike`, `pencil`;
- `slideSit`, `slideRide`, `cannonball`;
- `flipTurn`, `wallRest`, `pushUp`.

Add `edgeSitting` to the state rows. Each must read clearly at a glance;
adjust the angles until it does, and write down any big change in
**Deviations**.

## Checks for the whole sprint

`test/entries.test.ts`, with pure stepping as `world3d.test.ts` does
(`dt = 1/30`):

- **Each kind of entry:**
  - it ends in the water, inside the body's lane, within 12 s;
  - the body never passes through the tower, the board's base or another
    obstacle while it is on the deck;
  - its `y` never goes below the floor (`−floorDepthAt(x)`);
  - its `y` is never above 3.4 m.
- **The slide:**
  - the rider's distance to the chute centre line is under 0.2 m for the
    whole ride;
  - two bodies sent to the slide at once ride one after the other, never
    together.
- **Aborts:**
  - `desired` changed to `lounge` in `step-up` or `stairs` walks the body
    back to its lounger;
  - changed in `flight`, it lands, then gets out by a ladder.
- **The race:**
  - `findRaces` pairs only neighbours going the same way, respects the
    cooldown, and returns two pairs at most;
  - in a stepped run the winner reaches the wall first.
- **The rest:** a swimmer with `restAfter = 3` holds at a wall after 3
  lengths, for 4–7 s, and swims on.
- **The crowd** (60 agents, the existing test) still settles. Add a
  variant where every swimmer goes in by `chooseEntry`; all of them end up
  swimming within 180 simulated seconds.

## Done

- `npm test`, `npx tsc -b`, `npm run build` and `make test-backend` pass.
- `/?2d` is unchanged.
- `/?demo=24`, watched for five minutes: all five ways in happen, the
  flip turns and the rests happen, at least one race happens, the waiting
  agents sit at the edge kicking their feet, and somebody gets out over
  the edge.
- `/?demo=60&debug` is within budget.
- Screenshots (catch them with `debug.force` and `debug.look`):
  - `24-block.png`;
  - `24-board-bounce.png`;
  - `24-slide-ride.png`;
  - `24-cannonball.png`;
  - `24-flip.png`;
  - `24-wall-rest.png`;
  - `24-edge-sit.png`;
  - `24-pushup.png`.
- `debug.force(id, { entry: 'slide' })` makes the next entry of that body
  the slide. This is the only way to catch an entry quickly; add it in
  this sprint.
- `docs/next.md` gets the *Sprint 24* entry.

## Deviations

- **24.1, the starting blocks.** They were already drawn in `environment.ts`
  (0.5 m boxes at `pool.minX - 0.3`). They are now obstacles too, as
  `startBlock`, so walkers keep off them. The approach is `minX - 0.75`.
- **24.1, reachability.** `chooseEntry` checks that each approach can be
  reached from the gate (cached per world), not from the body's own place.
  `nav.ts` gained `findPath` and `reachable`, which return null where
  `planPath` falls back to a straight line. `planPath` itself is unchanged.
- **24.1, the slide waits, the others fall back.** A rider that finds the
  slide busy on arrival waits at the foot, as step 24.4 says. The other ways
  take the ladder when they have become busy, as the general rule says.
- **24.2, events are objects.** `body.events` holds `{ name, x, z }`, not
  strings: the splash needs its place, and parsing it back would be worse.
- **24.2, the dive's pose.** The body pitch is `rootRot` (the whole figure),
  not `bodyPitch`. The arms of the dive keep the plan's 2.9 rad; not checked
  by eye.
- **24.3, the bounce.** The bounce uses the existing `hop` action at full
  size, not a smaller one. The flight is the plan's parabola down to the
  water, so it peaks about 0.45 m above the tip, not 0.9 m.
- **24.4, the ride's speed.** The plan's `ds/dt` formula takes about 22 s at
  the top of the chute. Speed is in metres a second instead:
  `1.8 + 2.4 s`, a ride of about 3 s. The stairs take 3 s, the walk to the
  top is not timed by the plan.
- **24.5, the cannonball's splash.** The body goes under by 0.7 m but never
  below the floor, which at the shallow end is 1.0 m down.
- **24.6, the turns.** A run flips at every wall, an edit at every other one
  (by the id's seed). Other works draw open turns. Rests are for every
  swimmer except the ones that hold for a session or a delegate.
- **24.7, the race finder.** `findRaces` takes the pool's ends as a fourth
  argument, to measure the wall ahead, and skips swimmers that need the
  person. The winner is the first racer to start a turn; it treads for 2 s
  and cheers.
- **24.8, the waiting spots.** They also skip the flag posts (0.5 m), not
  only the ladders. A spot that does not fit on the coping is placed on the
  old row, not on the edge. The water test in `world3d.test.ts` now lets a
  way that starts or ends in the 0.5 m margin stay there; it still may not
  enter the water.
- **24.9, out over the edge.** Only in lanes 0 and L-1, and only when the
  nearest ladder is at least 3 m away; the chance is 30 per cent, seeded by
  the id and the count of entries. The phases keep their plan lengths.
- **Entries and walkers.** A body in an entry is not a walker for the others.
- **Debug hook.** `force(id, { entry })` sends a swimmer in the water to the
  gate queue first, so that it walks to the entry at once.
- **Lab.** The new actions are in `ACTION_ORDER`, and a figure on the edge
  shows `edgeSitting`.
- **2D pool.** `PoseDriver` is shared with the 2D animator. The new `edge`
  weight is zero for every 2D figure, so its blend is unchanged.
- **Not done.** The screenshots `24-block`, `24-slide-ride`, `24-cannonball`,
  `24-flip`, `24-wall-rest`, `24-edge-sit` and `24-pushup` were not taken. A
  forced board dive did not reach the board within 30 s of the browser
  watch, so no dive was seen on screen. The five-minute watch of `?demo=24`
  was not run.
