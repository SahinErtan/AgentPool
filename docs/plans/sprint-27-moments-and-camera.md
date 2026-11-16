# Sprint 27 — Moments, the camera, and the last look

**Goal.** Things that happen to the agents become little events in the
pool:

- **Finishing:** the finisher cheers and the others clap.
- **A milestone:** confetti.
- **A session that ends:** confetti by day, fireworks at night.
- **A quiet pool:** it settles down.

The camera learns two new tricks: following one agent closely, and a slow
tour round the pool that turns to look whenever something happens. Some
more things answer a click: an agent waves back, the water ripples and
the cat runs off.

Then an observer agent watches the whole thing, what it finds is fixed,
and the docs are written.

Read `docs/plans/README.md` first. This sprint needs every sprint before
it.

**Files touched:**

| Kind | Files |
|---|---|
| New | `src/scene/pool3d/moments.ts` (pure), `src/scene/pool3d/director.ts` (pure camera tour), `test/moments.test.ts`, `test/director.test.ts` |
| Changed | `pool3d/effects3d.ts` (sparks, fireworks), `pool3d/PoolScene3D.ts`, `pool3d/camera.ts`, `pool3d/Pool3DCanvas.tsx` (the tour button), `motion/driver.ts` (look at the camera), `ui/Legend.tsx` (the keys), `styles.css`, `docs/next.md`, `docs/architecture.md` (or the doc that describes the scene) |

---

## Step 27.1 — Detecting moments (`moments.ts`, pure)

```ts
export type Moment =
  | { kind: 'finished'; id: string }
  | { kind: 'milestone'; id: string; count: number }
  | { kind: 'sessionEnded'; id: string }
  | { kind: 'quiet' }            // no agent has been working for 120 s
  | { kind: 'busy' }             // 6 or more agents working at once
  | { kind: 'awake' };           // work started again after 'quiet'

export interface MomentMemory {
  status: Map<string, AgentStatus>;
  events: Map<string, number>;
  quietSince: number | null;
  quiet: boolean;
  lastBusyAt: number;
}

export const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000];

/** The moments between the last snapshot and this one. Updates the memory. */
export function detectMoments(agents: readonly AgentView[], now: number, memory: MomentMemory): Moment[];
```

**The rules:**

- **`finished`:** an agent whose status was not `finished` and now is.
- **`milestone`:** `event_count` went from below a milestone to at or
  above it. Only the highest milestone crossed is reported.
  - **An agent seen for the first time sets its count without a moment**,
    so a reload does not throw confetti for every agent at once.
- **`sessionEnded`:** a `session` agent whose status became `leaving` or
  `removed`.
- **`quiet`:** no agent has been `working` for 120 s; reported once.
  **`awake`:** the first `working` agent after `quiet`.
- **`busy`:** 6 or more working at once; at most once every 10 minutes.
- **The first call** (empty memory) fills the memory and returns nothing.

**Check.** `test/moments.test.ts`:
- each rule on its own;
- the first call returns nothing;
- a milestone is not repeated;
- a jump from 90 to 600 reports 500 only;
- `quiet` and `awake` alternate correctly;
- the `busy` cooldown holds.

## Step 27.2 — What the pool does at each moment

In `PoolScene3D`:
- keep a `MomentMemory`;
- call `detectMoments` from `syncAgents`;
- call it once a second from `update()` with the last agents, so the
  time-based moments (`quiet`) fire too;
- hand each moment to `celebrate(moment)`.

| Moment | In the pool |
|---|---|
| `finished` | The existing reaction stays: swimmers `look`, three others `wave`. In addition:<ul><li>up to 3 standing or seated characters within 8 m play `clap`, the nearest first;</li><li>the finisher gets `pendingCheer = true`; the first frame it stands on the deck (out of the water), it plays `cheer`, then `hop`;</li><li>a swimmer within 4 m slaps the water: `splash:small` at its hand.</li></ul> |
| `milestone` | `particles.confetti(x, head y + 0.6, z, 80)` over the agent; its label says `${count}!` for 3 s. A standing agent plays `hop`; a seated one `cheer`; a swimmer treads for 1.5 s with `cheer` arms, then swims on. |
| `sessionEnded` | **By day:** confetti at the gate when the character reaches it, and the two nearest characters wave. **At night** (`palette.light < 0.3`): three fireworks over the garden beyond the far fence, 0.8 s apart (Step 27.3). |
| `quiet` | Sprint 26's calm water and cat behaviour. The camera tour, if running, slows to half speed. |
| `awake` | The water comes back; the cat, if asleep within 3 m of the waking agent, wakes up. |
| `busy` | The fountains (Sprint 23) start now, for 40 s, whatever their cycle. |

**Reduced motion:**
- there is no confetti, no fireworks, no hop and no camera move;
- the labels still say `done!` or `${count}!`;
- the clap is kept, because it is a small movement.

## Step 27.3 — Fireworks and confetti (`effects3d.ts`)

- **Confetti** is the Sprint 21 kind 4. Use a fixed palette of 8 bright
  colours.
- **Fireworks:**
  - a new particle kind `spark` (7), falling under gravity of 3 m/s²,
    its alpha fading with life;
  - `firework(x, z)` launches one rocket particle from `(x, 0, z)` up at
    14 m/s for 1.1 s, leaving a dim trail (one `spark` every 0.05 s);
  - at the top it bursts into 90 sparks in a sphere at 5 m/s, in one of
    4 colour pairs (seeded);
  - the rocket is advanced in `Particles.update` like the others; give it
    kind 8, `rocket`, which bursts when its life ends.
- **The particle budget.** Raise `COUNT` to 2400 if the fireworks starve
  the foam. Measure that it stays within the frame budget.

**Check.** A unit test: a firework makes at most 150 particles in all, and
all of them are dead 5 s later.

## Step 27.4 — The camera follows, and tours (`director.ts`, `camera.ts`)

1. **Follow.**
   - Today the camera glides to the selected agent and keeps its angle.
     Add a **close follow**: with an agent selected, the key `F` (or a
     double-click on the character) turns it on.
   - While it is on, the camera eases its distance to 7 and its polar
     angle to 1.0, and keeps the agent in the middle.
   - `F` again, `Escape`, or dragging the camera turns it off.
   - **Check the keys first.** Read `ui/keyboard.ts` and make sure `F`,
     `T` and `Escape` do not clash with what is there. The keys only
     count when the focus is not in a text field.
2. **The tour.**
   - A pure director in `director.ts`:

     ```ts
     export interface TourState { azimuth: number; focus: Vec3 | null; focusUntil: number; speed: number }
     export interface Interest { x: number; y: number; z: number; weight: number; at: number }
     export function tourStep(state: TourState, dt: number, now: number, interests: readonly Interest[],
                              world: World): { target: Vec3; azimuth: number; polar: number; distance: number };
     ```

   - **The orbit:** the camera turns slowly round the middle of the deck,
     with the azimuth growing by `0.035·speed` rad/s, at the default
     view's distance and polar angle.
   - **Interests** are things worth a look:
     - each `Moment` with a position;
     - the scene's body events: a slide ride, a board dive, a cannonball,
       a race, a needs-you hand;
     - the duck landing;
     - each one has a weight and a time.
   - **The look:** when one arrives with a weight of 1 or more and no
     focus is held, the target glides to it and stays for 7 s (`focus`,
     `focusUntil`). Then the tour goes back to the orbit.
   - **The order of importance:** needs-you 3, finished 2, milestone 2,
     slide or dive 1.5, race 1, duck 1.
   - **How it starts:**
     - by the key `T`;
     - by a small round button in the bottom left corner of the canvas,
       `▶`, with the title "Tour the pool", added in `Pool3DCanvas.tsx`
       and styled in `styles.css`;
     - by itself after 120 s with no pointer, wheel or key input, while
       the page is visible;
     - **never with reduced motion.**
   - **How it stops:** any pointer down, wheel, or key other than `T`.
   - **While it runs** a small chip says "Touring — move to stop". It sits
     in the bottom left, next to the button.
3. **`camera.ts`.** Every tour target is passed through `clampTarget`.
   The polar angle stays within `MIN_POLAR` and `MAX_POLAR`, and the
   distance within `MIN_DISTANCE` and `MAX_DISTANCE`.

**Check.** `test/director.test.ts`:
- with no interests the azimuth only grows;
- an interest of weight 2 takes the focus at once, and keeps it for 7 s;
- a second interest of weight 1.5 that arrives during that time does not
  take the focus;
- one of weight 3 does;
- every returned target is inside the deck, and every polar angle and
  distance is within its limits.

## Step 27.5 — More things answer a click

In `PoolScene3D`'s pointer code:

1. **Clicking the selected agent again.**
   - It turns its head to the camera and waves: `react('wave')` standing,
     `waveLying` seated, `look` swimming.
   - Add `driver.setLookYaw(rad | null)`, a target the head eases to,
     added to `headYaw` and clamped to ±1.2.
   - The angle is the camera's bearing from the character minus the
     character's yaw, normalised. It holds for 2.5 s.
2. **Clicking the water** where there is no character.
   - Raycast against the water mesh. Where it hits, call
     `water.ripple(x, z, 1)` and `particles.splash(x, waterY, z, 0.5)`.
   - Swimmers within 2 m `look`.
3. **Clicking the cat.**
   - Give the cat its own hit capsule, tested after the characters.
   - The cat `flee`s and says `mrrp` in a bubble. `LabelOverlay.say` needs
     a label: give the creatures a hidden label (`ensure('cat', '')`,
     never `wanted`) so the bubble can be placed. `place` must still be
     called with the cat's head position every frame.
4. **Clicking the flamingo or the beach ball.** It spins and bobs: a
   0.8 s impulse.

None of these change the store. Only selecting a character does, as
today.

## Step 27.6 — The observer's round

The user asked for an agent that watches the UI while the work is done.
It found two bugs no test had caught. Run one round now, with this brief
(adjust the paths):

> You are the observer for AgentPool's 3D pool. Open
> `http://127.0.0.1:38000/?demo=24&debug&v=27obs` in Playwright at
> 1440×900, then at 390×844. For 15 minutes, look at the pool and use
> `window.__agentpool.debug` (`list`, `look`, `force`, `play`, `time`,
> `creatures`). Check every item below and report each finding with:
> what you saw, a screenshot, how to reproduce it, and how bad it is.
> Do not change any code.
>
> 1. Nobody walks through anything: equipment, loungers, people, the
>    fence, or the water.
> 2. Nobody floats in the air or sinks into the deck.
> 3. Every entry into the water and every exit looks right, from two
>    camera angles.
> 4. The swimmers stay in their lanes and never swim through each other.
> 5. An agent that the demo turns to `working` during an errand goes to
>    the water at once.
> 6. An agent that needs the person ends at the wall with a raised hand,
>    and its label is amber.
> 7. There are never more than four creatures at once (`debug.creatures()`
>    over a simulated day via `debug.time`).
> 8. Nothing flickers: labels, styles, props, rings.
> 9. The labels never cover each other.
> 10. Night, rain and a quiet pool each look right.
> 11. The tour starts by itself after 2 minutes of no input, looks at
>     things as they happen, and stops on the first touch.
> 12. Reduced motion: emulate `prefers-reduced-motion: reduce` and check
>     that no camera moves by itself and there is no confetti, no slide
>     and no dive.
> 13. The console has 0 errors and 0 warnings.
> 14. `?demo=60&debug` holds 50 fps or more after 20 s.
> 15. `/?2d` still works and looks as it did.

Fix every finding that is a bug. Write each finding and what was done
about it into `docs/next.md`, as Sprints 19 and 20 did. Write down
findings left open, and why.

## Step 27.7 — The docs

- **`docs/next.md`.** A *Sprint 27* entry with:
  - the moments;
  - the camera tricks;
  - what the observer found.

  Add a closing summary of Sprints 21–27, with these measurements:
  - fps and draw calls at 60 agents, at noon and at night;
  - the test counts.
- **The scene document** (`docs/architecture.md`, or `docs/scenes.md` if
  that is where the pool scene is described). A short section on:
  - how the pool decides what a character does, in order: the backend's
    presentation, then the work and needs-you, then entries, errands and
    moments;
  - the rule that an errand never hides work;
  - the creature budget;
  - where each pure module lives.
- **`ui/Legend.tsx`:** the keys `F` and `T`, and what the strokes mean
  (Sprint 22), if Sprint 22 did not already add it.

## Done

- `npm test`, `npx tsc -b`, `npm run build` and `make test-backend` pass.
- `/?2d` is unchanged.
- **The observer's round:** run, findings fixed or written down.
- **The budget:** `/?demo=60&debug` meets it at noon and at night, with
  the tour running.
- **Screenshots:**
  - `27-finished.png` (the clap and the cheer);
  - `27-milestone.png`;
  - `27-fireworks.png`;
  - `27-follow.png`;
  - `27-tour.png`;
  - `27-click-water.png`.
- **The docs** are written.
- **The user is asked** whether to commit. Do not commit before that.

## Deviations

- **27.1, the memory.** `MomentMemory` has a `primed` flag the plan did not
  list: the first snapshot fills the memory, and `primed` says so. An agent
  that leaves the list is forgotten. `sessionEnded` fires only when a session
  enters `leaving` or `removed` from another status, so `leaving` then
  `removed` is one moment.
- **27.2, the step's own logic.** The old one-off status reaction (`noticeStatus`)
  is replaced by the `finished` moment, with the same reactions. `quiet` needs
  no code of its own: the calm of the water is read from the same two-minute
  clock. The night fireworks are in 27.3, and the gate cheer runs when the
  session reaches the gate, within 60 s.
- **27.3, kind numbers.** Petals took kind 5, so spark is **6** and rocket is
  **7** (the plan said 7 and 8). The rocket keeps its burst colour pair in
  `surface`. The pool holds **2400** particles, up from 1600, as the plan's
  contingency; the foam was not measured as starved, so this is precautionary.
  The rocket's trail and burst are queued and spawned after the loop, not in
  it. Confetti has eight colours.
- **27.4, `tourStep`.** It takes a fifth argument, `out`, to write into, so a
  frame does not allocate. `TourState` has fields the plan did not list:
  `look` (the eased point), `focusWeight`, `seenAt` (the interests already
  looked at), `polar` and `distance` (set by the scene when the tour starts,
  from the camera's own view). A new interest takes the focus when none is
  held, or when it weighs at least 1 more than the focus.
- **27.4, the follow.** With reduced motion the follow still works, since the
  person asked for it; the distance and angle snap rather than ease. A wheel
  turn also lets go of the follow, because the follow holds the distance and
  the wheel would do nothing. A double-click on an agent follows it.
- **27.4, the tour and reduced motion.** The tour never starts with reduced
  motion, by T, by the button or by itself, as the plan says. The button is
  shown disabled.
- **27.4, layout.** The tour's button and chip are children of the canvas host,
  not a new wrapper, because the mobile rules size `.pool-canvas` by
  percentage. The debug text moved from the bottom left to the top left, so the
  button has the corner.
- **27.5, the cat's label.** The cat has a label with no text (`ensure('cat', '')`).
  It is `wanted` only so that its speech bubble shows, and the overlay lays out
  only labels with text, so the empty label has no box.
- **27.5, the cat's flee.** `CreatureDirector.scare(x, z)` queues a scare that the
  next step runs as a flee. With reduced motion the cat does not run; the bubble
  still says `mrrp`.
- **27.5, no hit mesh.** The cat, the flamingo and the ball are hit by the
  distance from the aimed ray to a point, not by a mesh. The water is hit with
  the existing water mesh and kept to the pool.
- **27.5, selection.** Only an agent's click changes the selection. A click on
  the water, the cat, the flamingo or the ball leaves it, as the plan says; a
  click on bare deck still clears it.
- **27.5, the flamingo and the ball.** The impulse is a 0.8 s bob and turn added
  after each frame's own placement, so it does not accumulate. The ball keeps
  its last turn after the impulse ends.
- **Not done: the screenshots** `27-finished`, `27-milestone`, `27-fireworks`,
  `27-follow` and `27-click-water`. Taken: `27-tour.png`, at 24 agents, with the
  tour chip and the stop button.
- **Not done: the observer round** (27.6). The brief is in
  `docs/plans/sprint-27-observer-brief.md`, for the main session to run.
- **The docs in 27.7.** `docs/next.md` has its entry. The main session
  wrote the scene section in `docs/scenes.md` afterwards.
- **The fireworks were invisible** (found by the main session). The rockets
  went up 15 m over the garden beyond the far fence, which is above the top
  of the default view. A point of size 0.09 is also only a pixel wide from
  25 m. The rockets now go up from the far edge of the pool and burst about
  5 m up (speed 6 m/s for 0.85 s, burst speed 3.5). The rocket, trail and
  spark sizes are 0.3, 0.16 and 0.32. `particles.test.ts` checks the new
  height.
- **Checked in the browser:** the console is clean at 24 and 60 agents; 60 fps
  and 166 / 274 draw calls at 24 / 60 agents; the T key starts the tour and a
  real click stops it; reduced motion disables the button. Not checked on
  screen: the finish, the milestone, the fireworks, the follow and the clicks.
