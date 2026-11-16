# Sprint 25 — Deck life

**Goal.** An idle agent sits on its lounger for ever today. From this
sprint on, it gets up from time to time and **does something**:

- **Away from the lounger:**
  - takes a shower;
  - fetches a drink or an ice cream from the kiosk;
  - soaks in the hot tub;
  - plays ping-pong or beach ball with other idle agents;
  - chats in a small group;
  - goes for a stroll round the pool.
- **At the lounger:**
  - shakes out its towel;
  - puts on sunscreen;
  - lies on its side or sits up for a while.

The waiting agents in the queue fidget.

**One rule above all the others.** An errand never hides what the agent
is doing. The moment the backend wants something else (`desired` stops
being `'lounge'`), the errand is dropped and the body goes where it must.
An agent that starts working while in the hot tub climbs out and walks to
the water at once.

Read `docs/plans/README.md` first. This sprint needs Sprints 21, 23 and 24.

**Files touched:**

| Kind | Files |
|---|---|
| New | `src/scene/pool3d/errands.ts` (pure), `src/scene/pool3d/games.ts` (pure ball paths), `test/errands.test.ts` |
| Changed | `pool3d/world.ts` (the ball court), `pool3d/flow.ts`, `motion/actions.ts`, `motion/driver.ts` (activity override, carried props), `characters3d/rig3d.ts` (new props), `characters3d/apply3d.ts`, `pool3d/equipment.ts` (the balls, the paddles, the shower stream), `pool3d/PoolScene3D.ts`, `lab/Lab3D.tsx`, `test/world3d.test.ts` |

## The model

**Smart objects.** A place says how it is used; the agent only chooses
where to go. Every place has **slots**, and a slot holds one body at a
time.

| Place | Slots | Queue | Use |
|---|---|---|---|
| `shower` | 1 (`shower.stand`) | 1 behind it, 0.9 m back | 8–12 s |
| `kiosk` | 1 (`kiosk.use`) | 2 behind it, 0.8 m apart | 4 s at the counter |
| `hotTub` | 4 (`hotTub.seats`), entered by `hotTub.step` | none: full is full | 30–60 s |
| `pingPong` | 2 (`pingPong.ends`), only as a pair | none | a rally of 25–40 s |
| `ballCourt` | 3, only as a group of three | none | 30–45 s |
| `chat` | 2–3 points round a meeting point, made when the group forms | none | 15–30 s |
| `stroll` | none: a loop of waypoints | none | 1 lap or less |
| `towel`, `sunscreen` | none: done at the lounger | none | 4 s and 6 s |

**The ball court** is new. Add it to `Equipment` in `world.ts`:

```
ballCourt.centre = (pool.maxX + 3.6, (pool.minZ + pool.maxZ) / 2 + 0.6)      (11.6, 0.6)
ballCourt.spots  = three spots at radius 1.6 round the centre, at 90°, 210° and 330°,
                   each facing the centre
```

Extend the Sprint 23 tests to it: on the deck, outside every obstacle, no
overlap with the paths to the stairs foot and the board.

---

## Step 25.1 — The errand planner (`errands.ts`, pure)

```ts
export type ErrandKind =
  | 'shower' | 'kiosk' | 'hotTub' | 'pingPong' | 'ballGame' | 'chat' | 'stroll' | 'towel' | 'sunscreen';

export interface ErrandState {
  kind: ErrandKind;
  phase: 'going' | 'queued' | 'using' | 'leaving';
  /** Where it stands or sits to do it. */
  spot: Spot;
  /** The slot key it holds, e.g. 'hotTub:2', or '' for none. */
  slot: string;
  /** Seconds into the phase. */
  t: number;
  /** How long the use lasts. */
  useFor: number;
  /** The others it does it with (ping-pong, ball, chat), by id. */
  with: string[];
  /** For a stroll: the waypoints left. */
  route: Vec2[];
}

export interface ErrandCandidate {
  id: string;
  lounger: number;          // the lounger it belongs to
  seatedFor: number;        // seconds since it last sat down; 0 when not seated
  needsYou: boolean;
  errand: ErrandState | null;
  nextErrandAt: number;     // scene seconds
  leftWaterAt: number | null;
  errandsDone: number;
}

export interface SlotBook {
  taken: Map<string, string>;   // slot key → body id
}

/** Which new errands to start now. Pure; called once a second. */
export function planErrands(
  candidates: readonly ErrandCandidate[],
  world: World,
  book: SlotBook,
  now: number,
  raining: boolean,
): Array<{ ids: string[]; kind: ErrandKind; spots: Spot[]; slots: string[]; useFor: number }>;
```

**Who may start an errand.** A candidate with all of these:
- `errand === null`;
- `!needsYou`;
- `seatedFor >= 20`;
- `now >= nextErrandAt`.

**How the kind is chosen.** It is a seeded pick, with
`mulberry32(hashOf(id) ^ (errandsDone * 0x85ebca6b))`, over these weights:

| Kind | Weight | Condition |
|---|---|---|
| `stroll` | 18 | always |
| `kiosk` | 16 | the kiosk's queue has room |
| `hotTub` | 14 | a seat is free |
| `towel` | 12 | always |
| `sunscreen` | 10 | not between 19:00 and 07:00 |
| `shower` | 8, **plus 30** when `leftWaterAt` is under 120 s ago | the shower's queue has room |
| `chat` | 14 | 1 or 2 other eligible candidates whose loungers are within 2 indices |
| `pingPong` | 8 | another eligible candidate, and the table is free |
| `ballGame` | 6 | two other eligible candidates, and the court is free |

- When it is raining, only `towel` and `hotTub` are allowed. The hot tub
  is nice in the rain.
- **Group kinds** (`chat`, `pingPong`, `ballGame`) take their partners
  from the eligible candidates, in id order, nearest lounger first. The
  partners are then no longer eligible this tick.

**Limits:**
- the errands running at once (`errand !== null`) are at most
  `max(1, floor(0.4 × candidates.length))`;
- at most one ping-pong pair, one ball group and two chat groups run at
  a time.

**The chat meeting point.** Take the mean of the group's
`loungerApproach` points, moved 0.6 m towards the pool. The members stand
on a circle of radius 0.55 round it, facing the centre. The point must be
outside every obstacle and at least 0.8 m from the pool's edge; when it is
not, the chat is not started.

**After an errand** (ended or aborted):
- `nextErrandAt = now + 60 + rng() * 120`;
- `errandsDone += 1`;
- the slots are freed in the book.

**The first errand.** When a body first sits down,
`nextErrandAt = now + 40 + (hashOf(id) % 110)`.

**Check.** `test/errands.test.ts`:
- **Determinism:** the same input gives the same plan.
- **Eligibility:** each rule above is tested on its own.
- **The limits:** with 40 eligible candidates, at most 16 errands start,
  with at most 1 ping-pong, 1 ball game and 2 chats, and no slot holds two
  bodies.
- **Rain:** only `towel` and `hotTub`.
- **The shower bonus:** for a swimmer just out of the water, the share of
  `shower` over 500 draws is at least 2.5 times the share for one that has
  not swum.

## Step 25.2 — Errands in the flow (`flow.ts`)

`Body` gets:
- `errand: ErrandState | null`;
- `nextErrandAt: number`;
- `errandsDone: number`;
- `leftWaterAt: number | null`;
- `carry: PropKind | null`, the prop held while walking back;
- `walkScale: number`, 1 normally and 0.75 on a stroll.

**The lounger lets go.** In `stepBody`, the seat is left when
`desired !== 'lounge' || body.lounger !== body.seat || body.errand !== null`.

**`deckGoal`** for `desired === 'lounge'`:
- while `body.errand` is going or queued, the goal is
  `{ kind: 'errand' }`, and `goalPoint` returns the errand's spot, or its
  queue spot;
- when the errand ends, the goal is the lounger again, as now.

**The abort.** In `applyPresentation` and at the top of `stepBody`: if
`body.errand` is set and `desired !== 'lounge'`, call
`abortErrand(body, book)`.
- When it is in the hot tub, it first climbs out: a 1 s phase `leaving`
  that moves it to `hotTub.step`. Ping-pong drops the paddle on the table.
- Then the errand is null and the usual goal takes over.
- `abortErrand` also frees the partners: they end their errand too and
  walk back.

**On arrival** (`arrive` with goal `errand`): the phase becomes `using`,
`t = 0`. What the body does depends on the kind (Step 25.3). When
`t >= useFor` the phase becomes `leaving`; the body does its leaving
motion, if any, and then `errand = null`.

**A stroll** is just a route:
- `route` holds 2 or 3 corners of the path graph round the pool: the
  corners of the pool grown by `CORNER_CLEARANCE`, from the nearest one,
  clockwise;
- the body walks it at `walkScale 0.75` and holds the action `stroll`;
- then it walks back.

**Errands in place** (`towel`, `sunscreen`) do not leave the lounger area:
- `towel` stands up at `loungerApproach`, plays the action, and sits
  again;
- `sunscreen` stays seated and plays a lounging action.

**Check** (`test/world3d.test.ts`, a new section *errands*). For each
kind, a lounging body given that errand:
- reaches its spot;
- uses it for `useFor` (± 1 frame);
- walks back and is seated again (`sitT === 1`) within `useFor + 40` s;
- never steps into an obstacle.

Then:
- **The abort:** setting `desired = 'swim'` in each phase sends the body
  into the water within 60 s, and frees its slot. From the hot tub it
  comes out by the step first.
- **The crowd:** in the 60-agent crowd test, make 30 of the agents
  lounge and run the planner every second. For 300 s:
  - every running errand ends;
  - no slot is ever held twice;
  - no body is ever inside an obstacle;
  - then switch all 30 to `swim`. All of them are swimming within 200 s.

## Step 25.3 — What each use looks like

New actions in `motion/actions.ts`. `R` means `replace` mode and `A` means
`add` mode.

| Action | Mode | Length | Pose |
|---|---|---|---|
| `shower` | R, loop | 3 s | Standing, the face up (`headPitch` −0.5), both hands rubbing the head: arms −2.5, elbows 2.2 ± 0.3·sin(u·2π·3). Mouth 0.4. |
| `headShake` | A | 0.8 s | `headYaw` 0.5·sin(u·2π·4)·(1 − u). Played when leaving the shower. |
| `reach` | A | 1.4 s | The right arm forward to 1.4 and back (for the fridge). |
| `tubSit` | R, loop | 6 s | Seated deep, leaning back 0.5, the arms along the rim (`armOutL/R` 1.3, arms −0.3), the head back 0.25, a slow breath. |
| `stepOver` | A | 0.8 s | One knee up high, then the other: getting over the tub's rim. |
| `pingPong` | R, loop | 1.2 s | Standing at the table, the knees soft (−0.25), the body forward 0.25; the right arm swings a forehand at u ∈ [0, 0.15] (arm from 0.2 back to 1.4 forward, elbow 0.9); the rest is a ready stance. The two players are half a loop apart. |
| `catch` | A | 0.6 s | Both arms up forward to 2.0, the elbows 0.4. |
| `throw` | A | 0.7 s | Both arms back over the head (−2.8), then forward to 1.2. `stretch` +0.06 on the throw. |
| `chatStand` | A, loop | 4 s | The right hand gestures (arm 0.6 ± 0.3·sin(u·2π·2)), small nods (`headPitch` 0.08·sin(u·2π·3)). Mouth 0.2 + 0.3·abs(sin(u·2π·5)) while speaking. Each member's loop is offset, so they take turns. |
| `stroll` | A, loop | 3 s | The hands behind the back (arms −0.45, elbows 0.7), the head looking about (`headYaw` 0.5·fbm). |
| `towelShake` | A | 4 s | The towel held in both hands in front, shaken up and down (arms 1.2 ± 0.5·sin(u·2π·4)). |
| `sunscreen` | A, on a lounger | 6 s | The right hand rubs the left arm, then the legs: an `armR` sweep 0.4 to 1.2, `elbowR` 1.6. |

**Props.** `PropKind` gets these new kinds:

| Prop | Shape | Used for |
|---|---|---|
| `icecream` | a cone and a ball | the kiosk |
| `bottle` | a short capsule | the sunscreen, and the kiosk drink |
| `paddle` | a disc and a handle, red or black by the end of the table | ping-pong |
| `towel` | a flat box 0.5 × 0.02 × 0.9 in the lounger's towel colour | the towel shake |

Add them to `buildProps` in `rig3d.ts`.

**The driver:**
- **It carries props.** Add `setCarry(prop: PropKind | null)`. The prop
  getter returns the carried prop, if any, before the activity's prop.
- **It can be given an activity.** Add `playActivity(kind: IdleActivity, seconds: number)`.
  It starts that activity now, even when it is not the spec's.
  `activityPose` is then called with the overriding kind instead of
  `spec.idleActivity`. This is how the drink from the kiosk is then
  drunk on the lounger (`tea` for a drink, `snack` for an ice cream).

**What each errand does, in the scene:**

- **`shower`:**
  - while using: hold `shower`, and spawn water from `shower.head`, 30
    drops a second falling on the body;
  - when leaving: play `headShake`;
  - another body in the queue stands 0.9 m behind, facing the shower.
- **`kiosk`:**
  - `reach` at the counter;
  - then `carry = icecream` (40 %) or `bottle` (60 %), seeded;
  - walk back; on sitting down, `carry = null` and `playActivity(snack or tea, 12)`.
- **`hotTub`:**
  - at the step, `stepOver`, while `y` rises to the rim (0.5) and goes
    down onto the seat: `y = 0.15 − hipHeight`, with the yaw facing the
    tub's centre;
  - hold `tubSit` while using;
  - when leaving, the same in reverse;
  - the tub spawns more bubbles while it has people in it.
- **`pingPong`:**
  - each player holds `pingPong`, with the paddle carried;
  - the table's resting paddles are hidden while they play;
  - the ball follows `pingPongBall` (Step 25.4);
  - when the rally ends the ball misses: it rolls 1.5 m off the end of a
    seeded loser. The winner plays `cheer` and the loser `headShake`.
- **`ballGame`:**
  - the three stand on their spots facing the centre;
  - the beach ball (a striped sphere of radius 0.25, built in
    `equipment.ts`, normally lying at the court's centre) flies by
    `ballFlight`;
  - the receiver plays `catch` on arrival and `throw` 0.5 s later.
- **`chat`:** hold `chatStand` with offset loops.
- **`towel`:**
  - stand at the approach point and play `towelShake`, with the towel
    carried;
  - the towel on the back rest is hidden meanwhile. That needs the towel
    piece of each lounger to be separable: add a per-lounger towel
    `InstancedMesh` in `environment.ts` instead of the towel piece in the
    merged loungers, and hide an instance by scaling it to 0.
- **`sunscreen`:** play it on the lounger, with the bottle carried.

## Step 25.4 — The ball paths (`games.ts`, pure)

```ts
/** Where the ping-pong ball is, t seconds into a rally. */
export function pingPongBall(t: number, ends: [Spot, Spot], tableTop = 0.76): Vec3;
```

- One hit to the next takes 0.6 s, so a whole exchange takes 1.2 s.
- From a paddle point (the end's spot moved 0.45 m towards the table, at
  y 0.95), the ball flies to a bounce point on the far half (70 % of the
  way, at y `tableTop`). Then it goes up to the other paddle point.
- Each part is a parabola with its apex 0.25 m above the higher end.

```ts
/** Where a thrown ball is, u (0..1) through a throw from a to b. */
export function ballFlight(a: Vec3, b: Vec3, u: number, apex = 2.4): Vec3;

/** Who gets the ball next: never the thrower; seeded by the throw count. */
export function nextCatcher(thrower: number, throwCount: number, seed: number): number;
```

**Check:**
- `pingPongBall`:
  - it is continuous: no jump over 0.06 m between samples 1/60 s apart;
  - it never goes below `tableTop` over the table;
  - it touches `tableTop` once per half.
- `ballFlight`:
  - it starts at `a` and ends at `b`;
  - its highest point is `max(a.y, b.y) + apex` ± 0.05.
- `nextCatcher` is never the thrower.

## Step 25.5 — More ways to lie on a lounger, and a restless queue

1. **Lounger variants.**
   - While lounging and not doing an activity, a body sometimes changes
     how it lies, for 20–40 s every 60–150 s, seeded from
     `rngFor(id, 'lounge-variant')`. That is a new channel, so nothing
     else moves.
   - The variants are two `replace` actions held by the scene:

     | Action | Pose |
     |---|---|
     | `loungeSide` | Rolled onto the side: `roll` 1.1, the lower arm under the head (arm −2.6, elbow 2.2), the upper arm along the side, the knees bent −0.6. |
     | `loungeSitUp` | Sitting up on the seat: the lean back removed, the elbows on the knees, the head turning slowly. |

   - Neither runs during an activity, an errand or `needsYou`.
2. **The queue fidgets.** A standing body in the gate queue plays, every
   10–20 s (seeded), one of these:

   | Action | Mode | Length | Pose |
   |---|---|---|---|
   | `checkWatch` | A | 1.5 s | The left forearm up in front of the chest, the head down to it. |
   | `shiftWeight` | A | 2 s | `bodyRoll` ±0.06 and one knee bent. |
   | `stretchArms` | A | 2 s | Both arms up and back, `stretch` +0.05. |

## Step 25.6 — The lab

Add every new action to the action row, and the props to a prop row:
`icecream`, `bottle`, `paddle` and `towel` held by standing figures.

## Done

- `npm test`, `npx tsc -b`, `npm run build` and `make test-backend` pass.
- `/?2d` is unchanged.
- `/?demo=24`, watched for ten minutes: every errand kind happens at least
  once. When a lounging agent is turned to `working` by the demo during an
  errand, it goes to the water at once.
  - If the demo's timing makes some errand too rare to see, add
    `debug.force(id, { errand: 'pingPong' })`. It starts that errand now,
    with partners if it needs them.
- `/?demo=60&debug` is within budget with errands running.
- Screenshots:
  - `25-shower.png`;
  - `25-kiosk.png`;
  - `25-hottub.png`;
  - `25-pingpong.png`;
  - `25-ballgame.png`;
  - `25-chat.png`;
  - `25-stroll.png`;
  - `25-towel.png`;
  - `25-lounge-side.png`.
- `docs/next.md` gets the *Sprint 25* entry.

## Deviations

- **25.1, the planner.** `planErrands` takes a sixth argument, `night`, since
  the sunscreen rule needs the clock and the planner is pure. The state has
  two fields the plan did not list: `index` (the place in a group, the seat of
  the tub) and `from` (where a body leaves the tub from). Starts also carry
  `route` and `indexes`. A chat's meeting point is held at 0.8 m from the
  water, on the walkway, when the feet of the loungers would put it nearer;
  the plan refused the chat instead, and no chat would then start from the
  first row.
- **25.1, reachability.** Every place of an errand must be reachable from the
  gate, or the errand is not offered. On one lane the hot tub, the board's
  base and the ball court are sealed off; on two lanes the kiosk, the hot tub,
  the far end of the table and the ball court are. Those errands are simply
  not drawn for those sizes.
- **25.1, the ball court centre.** It is on the pool's middle line, not 0.6 m
  towards the terrace: the far spot of the ring stood in the hot tub on three
  lanes. Clear of every obstacle for three to eight lanes.
- **25.2, the body.** Fields added: `seatedFor`, `walkScale` (set 1 by
  default), `leftWaterAt` (set by the flow when a body leaves the water).
  `nextErrandAt` is -1 until the first sit-down sets it.
- **25.2, aborts.** An errand is dropped in `stepBody`, not in
  `applyPresentation`, since the abort needs the other bodies. A session that
  starts needing the person also drops its errand; the plan only named a
  working agent.
- **25.2, walkers (found by the crowd test).** Two walker fixes, both only
  for bodies that were stuck. A step refused by the equipment margin now
  tries to slide on one axis before it is refused. A waypoint is no longer
  skipped when the walk onward would cut the margin of a corner. Without
  these, a body pressed against the slide tower stayed there for minutes
  (the crowd test found it at 170 s).
- **25.2, crowd test.** `buildWorld` caps the loungers at 24, so the test
  puts 24 agents on errands, not 30. The other 6 stay in the queue.
- **25.3, the lounge variants and the sunscreen are `add` actions**, not
  `replace`. The lounge pose leans back through `bodyPitch`, and a replacing
  pose would stand the figure up. The towel errand carries a towel, but the
  towel on the back rest is not hidden: it is in the merged loungers mesh, and
  moving it into instances was not done.
- **25.3, props.** One more prop, `paddleDark`, for the second player's
  paddle; `paddle` is red. The tub's bubbles grow with the people in it
  (2 + 2 per person every 0.3 s).
- **25.3, drinks.** A kiosk customer keeps the drink until it sits down, and
  the sitting raises a `drink:*` event; the scene plays the snack or the tea.
  An errand ends on the spot for a kiosk customer; the walk back is the usual
  goal.
- **25.3, the sunscreen** is not drawn at night (the local clock, 19:00 to
  07:00), so it did not show in the demo run.
- **25.4, the ping-pong ball.** A rally takes 0.6 s a hit over 2.3 m, so the
  ball moves up to 0.15 m a sixtieth of a second. The plan's 0.06 m bound is
  not reachable with that timing; the test uses 0.16 m. The ball is hidden at
  the end of a rally; it does not roll off the table.
- **25.4, ballFlight** returns one shared point, as `pointAt` does, so the
  frame does not allocate. The test copies the first result.
- **25.4, winners.** The loser of a rally is chosen by the hash of the pair,
  the same for both players, and the winner cheers, both through the flow's
  actions.
- **25.5, the queue's fidgets and the lounge variants** use their own streams
  (`fidget`, `lounge-variant`). No idle activity starts during an errand or a
  request for the person (`PoseDriver.allowActivity`, default on, so the 2D
  animator is unchanged).
- **25.6, the lab** has a row of carried props at z -10.6; the actions join
  the existing action row.
- **Debug hook.** `force(id, { errand })` is added. It starts the errand now,
  with partners if it needs them, through `forceErrand`.
- **Not done.** The screenshots except `25-hottub.png`: that one shows the tub
  and the table, but no figure is in frame. Not taken: `25-shower.png`,
  `25-kiosk.png`, `25-pingpong.png`, `25-ballgame.png`, `25-chat.png`,
  `25-stroll.png`, `25-towel.png`, `25-lounge-side.png`. The ten-minute watch
  of `?demo=24` was not run; the four errands the demo starts on its own were
  seen in a shorter watch, and the rest were forced. Chat was never seen on
  screen: it needs two seated neighbours near each other, which the demo
  rarely has.
