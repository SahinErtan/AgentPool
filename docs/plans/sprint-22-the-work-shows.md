# Sprint 22 — The work shows

**Goal.** Make it possible to tell from the pool what each agent is doing:

- **The tool decides how a swimmer swims.** Bash is a sprint, an edit is
  butterfly, reading is snorkelling with dives to the floor, the web is
  backstroke, delegating is treading water, planning is floating.
- **An agent whose session is waiting for the person** swims to the wall
  and raises its hand until the person answers.
- **Sub-agents** carry their parent's colour, and the parent waves when
  one is born.

There is no backend change. Everything comes from fields the frontend
already receives:

- `AgentView.tool_name`, `status`, `kind`, `parent_id`, `session_id` and
  `last_event_at`;
- the session events in `store.get().feed`.

Read `docs/plans/README.md` first. This sprint needs Sprint 21: the
action layer, `?demo` and `debug`.

**Files touched:**

| Kind | Files |
|---|---|
| New | `src/scene/pool3d/work.ts`, `test/work.test.ts` |
| Changed | `characters/poses.ts` (two new swim styles), `characters/spec.ts` (types only), `motion/driver.ts`, `motion/actions.ts`, `pool3d/flow.ts`, `pool3d/swim.ts`, `pool3d/PoolScene3D.ts`, `pool3d/overlay.ts`, `styles.css`, `lab/Lab3D.tsx`, `test/world3d.test.ts`, `test/character3d.test.ts` |

---

## Step 22.1 — What kind of work a tool is (`work.ts`, pure)

```ts
export type WorkKind = 'run' | 'edit' | 'read' | 'web' | 'delegate' | 'plan' | 'other';

/** The kind of work a tool does, from its name. */
export function toolKind(tool: string | null | undefined): WorkKind;
```

Match the exact names first, then the patterns, in this order:

| Kind | Names | Patterns |
|---|---|---|
| `run` | `Bash`, `BashOutput`, `KillShell`, `KillBash`, `Monitor`, `TaskStop` | |
| `edit` | `Edit`, `MultiEdit`, `Write`, `NotebookEdit` | |
| `read` | `Read`, `Grep`, `Glob`, `LS`, `NotebookRead`, `ToolSearch`, `LSP` | |
| `web` | `WebSearch`, `WebFetch` | `mcp__` names containing `browser`, `playwright`, `chrome`, `fetch` or `search` |
| `delegate` | `Agent`, `Task`, `Workflow`, `SendMessage` | |
| `plan` | `TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskList`, `EnterPlanMode`, `ExitPlanMode`, `AskUserQuestion` | |
| `other` | everything else, `null` and the empty string | |

The match is case-sensitive for the exact names and case-insensitive for
the patterns.

**The smoother.** Tools change every few seconds (Read, Edit, Read). A
swimmer that changed its stroke each time would flicker. The shown kind
only changes when the new one has lasted.

```ts
export interface WorkShown {
  kind: WorkKind;
  since: number;          // seconds, when `kind` started being shown
  candidate: WorkKind;
  candidateSince: number;
}

export function initialWork(kind: WorkKind, now: number): WorkShown;

/**
 * Feed the latest kind; returns the kind to show.
 * The candidate must have been seen without a break for CANDIDATE_S (2.5 s),
 * and the shown kind must have been shown for at least MIN_SHOWN_S (6 s).
 */
export function smoothWork(w: WorkShown, latest: WorkKind, now: number): WorkKind;
```

**When the session needs the person.** This is pure, and it reads the
feed:

```ts
/**
 * True when the agent's session asked the person something that has not
 * been answered yet.
 *
 * A `permission` or `notification` session event for the agent's session
 * that is newer than the agent's last own event means the session is
 * waiting. Any later event of the agent means it was answered.
 */
export function needsYou(
  agent: Pick<AgentView, 'kind' | 'session_id' | 'last_event_at' | 'status'>,
  feed: readonly SessionEventView[],
  nowS: number,
): boolean;
```

The rules:

- Only `kind === 'session'` agents with a `session_id` can need the
  person; sub-agents run inside a session and do not ask by themselves.
- Find the newest feed event with that `session_id` whose `type` is
  `permission` or `notification`.
- It counts if all of these hold:
  - `event.ts > agent.last_event_at - 0.5`;
  - `nowS - event.ts < 15 * 60`;
  - the agent's `status` is not `finished`, `leaving` or `removed`.
- A `notification` whose `detail` starts with `agent_completed` does not
  count.

**Check.** `test/work.test.ts`:

- `toolKind`: one test row per name in the table, plus `null`, `''`,
  `'mcp__x__browser_click'` (web), `'mcp__claude-mem__search'` (web) and
  `'mcp__y__frobnicate'` (other).
- `smoothWork`:
  - a sequence Read, Edit, Read with 1 s gaps never leaves `read`;
  - `edit` held for 3 s, after `read` was shown for 10 s, switches to
    `edit`;
  - nothing switches before 6 s of showing.
- `needsYou`:
  - a permission newer than `last_event_at` gives true;
  - after a later `last_event_at` it gives false;
  - another session's event gives false;
  - a sub-agent gives false;
  - an event older than 15 minutes gives false.

## Step 22.2 — Two new swim styles: backstroke and float (3D only)

**`characters/spec.ts`.** Widen the type, but **not** the table:

```ts
export type SwimStyle = 'crawl' | 'breaststroke' | 'butterfly' | 'doggy' | 'backstroke' | 'float';
/** The styles a character is born with. Backstroke and float are only put on by the work. */
type BornStyle = Exclude<SwimStyle, 'backstroke' | 'float'>;
const SWIM_TABLE: Record<BornStyle, number> = { /* unchanged */ };
```

`specFor` must still produce the very same values for every id, and the
pinned-spec test from Sprint 21 proves it.

**`characters/poses.ts`.** Add two functions and register them in
`SWIM_STYLES`:

- **`backstroke(out, t)`**, cadence 0.5. The swimmer lies on its back: the
  roll is half a turn about the long axis.
  - `roll = π + 0.45 · sin(t · 2π)`: the shoulders rock with the stroke;
  - each arm turns a full circle over the head, straight, half a cycle
    apart:
    - `armL = -((t) % 1) · 2π`;
    - `armR = -((t + 0.5) % 1) · 2π`;
  - the elbows are 0.1 above the water and bend to 0.7 during the pull
    under it (the half of the circle below the body);
  - a flutter kick: `legL = 0.22 · sin(t · 2π · 3)`, `legR` the opposite,
    knees -0.15;
  - `headPitch` 0.15 and `bob` 0.01 · sin(t · 4π);
  - every 3D field (spine, armOut, legOut) is set on every frame, the rule
    the other styles follow.
- **`float(out, t)`**, cadence 0.2. A star float on the back, nearly
  still:
  - `roll = π`;
  - the arms out to the side: `armOutL = armOutR = 1.35`, arms 0.1;
  - a slow scull: elbows `0.2 + 0.1 · sin(t · 2π)`;
  - the legs out: `legOutL = legOutR = 0.35`;
  - `bob 0.015 · sin(t · 2π)` and `spine -0.05`.

Look at both in `?lab&3d`. Add them to `SWIM_ORDER` there.

**Check** (`test/character3d.test.ts`):

- *A backstroke swimmer faces the sky.* Build a rig, run a driver forced
  to swim backstroke (`setSwimStyle`, see 22.3) for 1 s, apply the pose,
  and lay the root as the scene does for a swimmer.
  - The head bone's world +z axis is
    `new Vector3(0, 0, 1).transformDirection(head.matrixWorld)`.
  - Its `y` must be greater than 0.5 at five phases.
- For a crawl swimmer the same `y` is below 0.3: it looks down at the
  water.

## Step 22.3 — The driver takes a style and a tempo from outside

In `motion/driver.ts`:

```ts
/** Swim this style instead of the spec's, or the spec's again with null. */
setSwimStyle(style: SwimStyle | null): void
/** Multiply the stroke cadence (1 normal, 1.3 a sprint). */
setTempo(k: number): void
```

- **Changing the style cross-fades.** Keep `styleFrom`, `styleTo` and
  `styleFade` (0 to 1 over 0.6 s).
  - During the fade, build both swim layers into two buffers and blend
    them by `styleFade`.
  - Let the phase run on. A wrapped phase counts as a stroke whichever
    style it is.
- Use the cadence `SWIM_STYLES[current].cadence * spec.speedScale * tempo`.
- Add the state `'treading'` to `CharState`, with its own weight
  (`tread`) and layer: `treadPose(out, t, motion)`.
  - Move the pose function of the `tread` action from Sprint 21 into an
    exported `treadPose` in `actions.ts`, and let the action call it.
  - Treading is a *state*, not an action, because a swimmer can tread for
    minutes.
  - Like `swim`, it is only built when its weight is above 0.001.

**Check.** `test/actions.test.ts`:
- `setSwimStyle('butterfly')` changes `currentPose` within 0.7 s, and
  `null` brings the spec's style back;
- the `treading` state reaches weight 1 within 1 s.

## Step 22.4 — The body knows its work, and the swimmer acts on it

**`flow.ts`.** Add to `Body`:

```ts
/** The kind of work the agent is doing, as shown (after smoothing). */
work: WorkKind;
/** True while the agent's session waits for the person. */
needsYou: boolean;
/** For the read dive: seconds to the next dive, and the dive in progress (0..1, 0 none). */
diveIn: number;
diveT: number;
```

Initial values: `work: 'other'`, `needsYou: false`, `diveIn` 6 +
(hash % 6), `diveT: 0`.

**`swim.ts`.** Extend `SwimState`:

```ts
/** True while the swimmer stays where it is instead of swimming on. */
holding: boolean;
```

Change `swimStep(...)` to take an options object as its last argument:

```ts
export interface SwimOptions {
  /** Swim to the wall ahead, turn, and stay there with the back to it. */
  stopAtWall?: boolean;
  /** Stay where you are (treading water). */
  hold?: boolean;
}
```

- **`hold`:** `x` does not move. The drift across the lane still runs, so
  the swimmer stays in its lane. There is no turn.
- **`stopAtWall`:** the swimmer swims as usual. When it reaches the wall
  it starts the normal turn, and when the turn ends it sets
  `holding = true` and stops moving. The turn is what puts its back to the
  wall and its face to the pool, where it can be seen.
- When neither option is set, `holding` is false and the swimmer goes on.

**What each kind of work does.** In `flow.ts` `stepWater`, in the
`desired === 'swim'` branch, before `swimStep`, decide the mode:

| Condition | Style | Speed × | Options | Body state |
|---|---|---|---|---|
| `needsYou` | own | 1.0 | `stopAtWall` | `treading` once `holding` |
| work `delegate` | own | — | `hold` | `treading` |
| work `plan` | `float` | 0.15 | — | `swimming` |
| work `run` | `crawl` | 1.4 | — | `swimming`, tempo 1.3 |
| work `edit` | `butterfly` | 1.0 | — | `swimming` |
| work `read` | `breaststroke` | 0.6 | — | `swimming`, with the dive below |
| work `web` | `backstroke` | 0.8 | — | `swimming` |
| work `other` | own | 1.0 | — | `swimming` |

The style and the tempo are not body fields the driver reads by itself.
Add to `Body`:
- `swimStyle: SwimStyle | null`;
- `tempo: number`.

`stepWater` sets them; `PoolScene3D` passes them to
`driver.setSwimStyle(body.swimStyle)` and `driver.setTempo(body.tempo)`
every frame. Both are cheap: they do nothing when the value did not change.

**The read dive.** It only happens when the work is `read`, the swimmer is
not turning, and it is not `needsYou`.

- `diveIn` counts down. At 0 the dive starts: `diveT` runs from 0 to 1
  over 2.8 s.
- The depth below the surface is:

  ```
  sink = floorClear * sin(π * diveT)^2
  floorClear = min(0.75, floorDepthAt(world, swim.x) - 0.45)
  ```

- Add `sink` to the y of a lying swimmer:
  `body.y = world.waterY - 0.06 - sink`.
- At the end, `diveIn = 8 + (hash of id and dive count) % 7` seconds.

The scene spawns `particles.bubbles(head x, head y, head z, 2)` every
0.25 s while `diveT` is between 0.15 and 0.85.

**The treading position.** For a body in `treading`, the root is at the
feet of an upright figure:

```ts
body.x = swim.x;  body.z = swim.z;
body.y = world.waterY - body.height * 0.62;   // the chest at the waterline
body.yaw = swim.yaw;
```

Keep `swimCentre` working for a treading body. The hover ring and the
camera use it, and for an upright body the centre is `(x, z)` itself.

**Applying the work.** `PoolScene3D.syncAgents` decides the work of each
character:

```ts
const latest = agent.status === 'working' ? toolKind(agent.tool_name) : 'other';
character.workShown ??= initialWork(latest, nowS);
body.work = smoothWork(character.workShown, latest, nowS);
body.needsYou = needsYou(agent, store.get().feed, nowS);
```

- `syncAgents` only runs when the store changes, so also call
  `smoothWork` with the last `latest` once a second from `update()`.
  Otherwise a candidate that stopped changing would never get shown.
- `debug.force(id, { work, needsYou })` overrides these until it is called
  with `null` for that field.

**Check** (`test/world3d.test.ts`, new section *the work shows*):

- **needsYou:** a swimmer with `needsYou = true` in lane 2 reaches a wall
  within 30 s, `swim.holding` becomes true, its `x` stays within 1.8 m of
  that wall, its `z` stays inside lane 2, and `state === 'treading'`.
  Setting `needsYou` back to false makes it swim again within 2 s.
- **delegate:** after 3 s its `x` has moved less than 0.05 m, and it stays
  in its lane.
- **run:** in 20 s it covers at least 1.25× the distance of the same body
  with work `other`. Count the turns as well as the x travel: add up
  `|Δx|` every step.
- **read:** within 20 s, `body.y` goes at least 0.3 m below
  `waterY - 0.06` and comes back. It never goes below the floor:
  `body.y > -floorDepthAt(x)`.
- **web and plan:** `body.swimStyle` is `backstroke` and `float`.
- **The crowd still flows:** run the existing 60-agent test again with
  every body's work set by `toolKind` over a rotating list. All of them
  still reach their places.

## Step 22.5 — The waiting session raises its hand

The swimmer is handled by 22.4. What is left:

1. **The pose.**
   - A `treading` body that is `needsYou` holds `raiseHand`, through
     `driver.hold('raiseHand')`.
   - It releases the hand when `needsYou` goes false.
2. **A seated session** (on a lounger, `seat !== null`) that is
   `needsYou` holds `raiseHandLying`.
3. **A waiting or queuing body** that is standing (`state === 'resting'`
   and not walking) holds `raiseHand`.
4. **The label.** `LabelOverlay.place` gets an `attention: boolean`
   argument.
   - While it is true, the label gets the class
     `pool3d-label--attention` and is treated as rank 1, so it is never
     hidden by others.
   - In `styles.css` the class has:
     - an amber background (`#f2b134`) and dark text;
     - a slow pulse, `animation: attention 1.6s ease-in-out infinite`,
       scaling between 1 and 1.08;
     - no animation under `prefers-reduced-motion`.
5. **The bubble.** Every 8 s while `needsYou`, call
   `labels.say(id, 'needs you', 3)`.

**Check.** In the browser with `?demo=12&debug`:
- `debug.force(sessionId, { needsYou: true })` sends the session's swimmer
  to the wall, and it raises its hand. Its label turns amber and pulses.
  Screenshot `22-needs-you.png`.
- Clearing the force lets it swim on.
- The demo's own permission events do the same by themselves within
  three minutes.

## Step 22.6 — Sub-agents look like their parent

1. **The colour.** In `PoolScene3D.createCharacter`, for
   `agent.kind === 'subagent' && agent.parent_id`:

   ```ts
   const parentRole: Role = agent.parent_id.startsWith('session:') ? 'session' : 'subagent';
   const parentSpec = specFor(agent.parent_id, parentRole);
   const spec = specFor(agent.id, role, { accent: parentSpec.suit });
   ```

   The accent is the trim of the suit (read `rig3d.ts` to see where
   `spec.accent` is used). A sub-agent is then dressed in its own colour
   with its parent's colour as the trim. Only the 3D scene does this; the
   2D scene keeps calling `specFor` as before.
2. **The parent waves when a sub-agent is born.**
   - In `syncAgents`, a character created after `settled` that is a
     sub-agent, and whose parent has a character, makes the parent react:
     - in the water, `look`; while treading, `wave`;
     - on a lounger, `waveLying`;
     - otherwise, `wave`.
   - The parent says `go, <child label>!` (14 characters at most, the
     label rules apply) for 2.5 s.
3. **The family rings.**
   - When an agent is hovered or selected, small rings also show under
     its parent and its children:
     - opacity 0.45;
     - 0.7 of the size of the main ring;
     - the colour of the parent's suit.
   - Make a pool of 8 ring meshes once, in the constructor, and hide the
     unused ones. Position them the way `updateHoverRing` positions the
     main ring; factor its position code into a helper
     `ringSpot(character)` first.

**Check.**
- `?demo=24`: sub-agents of the same session share a trim colour.
  Hovering a session shows rings under its sub-agents. Screenshot
  `22-family.png`.
- A new sub-agent's parent waves and says `go, …!`.

## Step 22.7 — Long work tires a swimmer

- **The scene keeps `character.workingSince`.**
  - It is set when the status becomes `working`, and cleared when it
    becomes anything else.
  - After 30 minutes of working the swimmer slows down by
    `min(0.25, (minutes - 30) / 240)` of its speed.
- **The body carries it** as `fatigue` (0..0.25), set by the scene. It
  multiplies the speed in `stepWater`.
- `debug.force(id, { fatigue: 0.25 })` shows it at once.

**Check.** A unit test: with `fatigue = 0.25`, the distance swum in 20 s is
75 % (± 5 %) of the distance with 0.

## Done

- `npm test`, `npx tsc -b`, `npm run build` and `make test-backend` pass.
- `/?2d` is unchanged.
- `/?demo=24`, watched for three minutes:
  - the strokes visibly differ between agents;
  - a reader dives now and then and bubbles rise;
  - the delegating sessions tread water;
  - a planner floats;
  - a permission request ends at the wall with a raised hand.
- `/?demo=60&debug` is within budget.
- Screenshots: `22-strokes.png` (three or more styles in one picture),
  `22-dive.png`, `22-needs-you.png`, `22-family.png`.
- **The legend.** In `ui/Legend.tsx`, add a short legend of what the
  strokes mean, if the legend lists scene meanings. Read it first:
  - sprint = running a command;
  - butterfly = editing;
  - snorkel and dive = reading or searching;
  - backstroke = on the web;
  - treading = waiting for a sub-agent;
  - floating = planning;
  - hand up = needs you.
- `docs/next.md` gets the *Sprint 22* entry.

## Deviations

- **22.2, the jump test.** `test/characters.test.ts` ("no stroke jumps")
  measured the arm step raw. The backstroke arm goes round a full turn, so
  the step is now measured the short way round the circle. The 2D rig never
  gets these styles; the test still covers every style in `SWIM_STYLES`.
- **22.3, `treadPose` parameter.** It is `treadPose(out, u)`, with `u` the
  progress through one loop, as the other action poses take it. The driver
  passes `this.time / ACTIONS.tread.seconds`, not a separate clock.
- **22.3, no `swimOverride` field.** `setSwimStyle` keeps only the current
  and the previous style; the spec's own style is recovered from the spec.
- **22.4, `Body` fields not in the plan.** Added `dives` (the dive count, so
  the next dive is timed from it) and `fatigue` (read by `stepWater`; the
  scene sets it in 22.7).
- **22.4, the dive stops for anything but reading.** A dive under way is
  cancelled when the work stops being `read`, the swimmer turns, holds or
  needs the person. The plan did not say what happens to a dive in
  progress.
- **22.4, the floor check.** The plan's `body.y > -floorDepthAt(x)` ignores
  `waterY` (-0.18 in this world). The test uses `waterY - floorDepthAt(x)`,
  the real floor.
- **22.4, `ringSpot`.** It writes into an object the caller passes, so the
  per-frame ring code does not allocate.
- **22.5, the attention label rank.** The scene ranks an attention label
  with the hovered one (rank 1); the label's `place` only receives the
  `attention` flag. The pulse animates `scale`, not `transform`, because the
  label is placed with an inline `transform`.
- **22.6, the trim.** The sub-agent takes its parent's suit from the parent's
  character when the parent is on the screen. The id-prefix rule of the plan
  is kept as the fallback for a parent not yet created.
- **22.6, the announcement.** The child's name is cut with the same rule as
  the labels (14 characters at most). The sentence `go, <name>!` is longer
  than 14 characters, as the plan's wording allows.
- **22.6, the family colour.** A parent's ring is in its own suit; the rings
  under its children are in the focused agent's suit.
- **22.7, `fatigueAfter`.** The curve is a pure function in `work.ts`, so it
  is tested in node. The scene only calls it.
- **Legend.** A "What the work shows" group was added to `ui/Legend.tsx`,
  with the seven meanings of the plan.
- **Not done: screenshots.** The four screenshots (`22-strokes.png`,
  `22-dive.png`, `22-needs-you.png`, `22-family.png`) were not taken. The
  browser was used for the console check and the forced `needsYou` only.
- **Not met: draw calls at `?demo=60&debug`.** 254 against 180. Not measured
  against a build from before the sprint.
