# The living pool — Sprints 21 to 27

These are the implementation plans for the work that comes after Sprint 20
(the pool in three dimensions). They are written to be carried out by an
implementer who has not seen the conversation they came from, one step at a
time. Read this file first, then the sprint you are working on, and nothing
else is assumed.

## Why

After Sprint 20 the 3D pool works, but it is quiet and the same all the
time:

- **The scene does not show what an agent is doing.** The backend sends
  each agent's current tool (`tool_name`), its last events, whether its
  session is waiting for the person (`permission` and `notification`
  session events) and its parent (`parent_id`). The 3D scene uses none of
  them. An agent running Bash and an agent reading a file swim the same
  stroke.
- **Every behaviour is a single one.**
  - A swimmer swims lengths in one lane for ever.
  - A lounger sits upright and, most of the time, does nothing.
  - With a few agents most of the deck, two lanes and half the loungers
    are empty.
- **Nothing lives in the pool apart from the agents.** The birds and the
  petals of the 2D pool were not ported.
- **Visible flaws:**
  - stripes of shadow acne on the parasols and the cushions;
  - seen from behind, the head and the hair read as one big dark ball;
  - a swimmer leaves no foam behind it;
  - the water is equally clear everywhere;
  - the figure on a lounger sits up instead of leaning on the back rest.

## Decisions taken with the user (2026-11-14)

1. **The only humans in the scene are the agents.** No lifeguard, no
   vendor, no crowd extras. Every person on the screen is an agent.
2. **Animals are allowed, but only a very few.** At most **four creatures
   on screen at once**, all together (`MAX_CREATURES = 4`, Sprint 26).
3. **All the sprints below are planned and will be built.**
4. **The pool gets new equipment:** a water slide, a diving board, a hot
   tub, a shower, a self-service kiosk, a ping-pong table and inflatables
   (Sprint 23).

The earlier decisions still hold:

- No backend change and no change of the scene contract
  (`describe()` / `presentation()`).
- All code, comments and docs are in English.
- No commit unless the user asks for one.

## The sprints

| Sprint | File | What it gives |
|---|---|---|
| 21 | `sprint-21-polish-and-tools.md` | Visual fixes, the action layer, squash and stretch, foam and bubbles, the `?demo` crowd and the debug hooks. Every later sprint uses these tools. |
| 22 | `sprint-22-the-work-shows.md` | The tool an agent is using decides how it swims; an agent that needs the person raises its hand; sub-agents look like their parent. |
| 23 | `sprint-23-new-pool-equipment.md` | A bigger deck with a water slide, a diving board, a hot tub, a shower, a kiosk, a ping-pong table, fountains and inflatables. Paths go round all of it. |
| 24 | `sprint-24-ways-into-the-water.md` | Entering by the starting block, the diving board, the slide or a cannonball; flip turns, rests at the wall, races, waiting at the edge with the feet in the water, getting out over the edge. |
| 25 | `sprint-25-deck-life.md` | Smart objects and errands: shower, kiosk, hot tub, ping-pong, beach ball, chat groups, a stroll, and more ways to lie on a lounger. |
| 26 | `sprint-26-world-and-creatures.md` | A cat, a visiting duck, birds and butterflies (at most four in all); clouds, night lights, stars, a sprinkler, and what people do in the rain. |
| 27 | `sprint-27-moments-and-camera.md` | Applause, milestones, confetti and fireworks; a camera that follows and a slow tour; clicking on things; the last observer round and the docs. |
| 28 | `sprint-28-who-is-who.md` | Every character's name says which agent it is; a card under the pointer says what it is doing; MCP servers stop being characters. Planned 2026-11-15, after 21–27; **it is the one sprint allowed to change the backend.** |
| 29 | `sprint-29-life-on-the-lounger.md` | The lounger activities redone for 3D (they were made for the 2D side view): props held and aimed, a repertoire chosen by the time of day, the weather and how long the agent has been idle, a glass of tea on a side table, and new activities. Planned 2026-11-15. |

The order matters:

- 21 builds the tools the others use.
- 23 builds the places that 24 and 25 use.
- 27 closes the whole run.

Inside a sprint, the steps are ordered so that each one leaves the app
working.

## Ground rules for the implementer

1. **One step at a time.** Do the step, run its tests, look at it in the
   browser if the step says so, and only then go on.
2. **The code wins over the plan.** If a name, a signature or a number in a
   plan does not match the code, do not force the plan. Do what the plan
   means in the code as it is, and write the difference into the
   **Deviations** list at the end of that sprint's file.
3. **Pure first.** Every decision (where to go, what to do, when) lives in
   a pure module with no Three.js objects: `world.ts`, `flow.ts`, `swim.ts`,
   `work.ts`, `entries.ts`, `errands.ts`, `creatures.ts`, `moments.ts`. Each
   gets node tests. The Three.js side only draws what the pure side
   decided.
4. **Deterministic.** Never call `Math.random()` in pure modules.
   - Use a seeded generator: `mulberry32` / `rngFor` from
     `characters/spec.ts`, or `hashOf` / `hashId`.
   - Keep the state on the body, so the same inputs give the same pool.
5. **Never change an existing random stream.** `specFor` picks every
   attribute from its own named stream (`rngFor(id, 'swim')`, and so on).
   - Adding an entry to `SWIM_TABLE`, `ACTIVITY_TABLE` or
     `ACCESSORY_TABLE` would change the look of **every existing agent**.
   - A new attribute gets a **new channel name**, e.g.
     `rngFor(id, 'hair-style')`.
6. **Reduced motion** (`prefersReducedMotion()`):
   - no camera moves the person did not make;
   - no confetti or fireworks;
   - no slide, dive or cannonball (agents take the ladder);
   - creatures stay still or are hidden.
7. **The frame does not allocate.** Reuse vectors (`this.tmp`), poses and
   arrays in the per-frame code, as the existing code does.
8. **Comments in the house style.** Explain *why*, in plain sentences, the
   way the existing files do. No commented-out code.
9. **Performance budget.** Measured with `?demo=60&debug` on a desktop:
    - 50 fps or more;
    - draw calls ≤ 3 × agents + 110. Each character costs three calls:
      the body, the outline and the shadow pass. The scene cost about 75
      before Sprint 23, measured at 4, 24 and 60 agents, and Sprints 23–25
      brought it to 89. Sprints 26 and 27 share the remaining 20, which is
      why static things are merged and creatures stay cheap. (Raised from
      +90 after Sprint 25, with the fps still at 60.);
    - triangles ≤ 1.2 M.

    `?demo=12` on a phone-sized window (390 × 844) stays at 30 fps or more.
10. **Console clean.** 0 errors and 0 warnings in the browser console.

## Commands

```
cd frontend
npm test                    # every test file (node, no browser)
node test/run.mjs world3d   # only the files whose name contains "world3d"
npx tsc -b                  # type check
npm run build               # the bundle the backend serves

cd ..
make test-backend           # must stay green; nothing in the backend changes
make server                 # http://127.0.0.1:38000  (skip if it already runs)
```

The backend serves `frontend/dist`. After `npm run build`, reload the page
with a new cache-buster: `http://127.0.0.1:38000/?v=21a`, `?v=21b`, and so
on.

Useful URLs (`?demo` and the `debug` hooks come from Sprint 21):

| URL | What |
|---|---|
| `/` | the 3D pool with the real agents |
| `/?demo=12` | the 3D pool with 12 scripted fake agents, no backend needed |
| `/?demo=60&debug` | the crowd test, with fps, draw calls and triangles in the corner |
| `/?lab` | the 3D animation lab |

In the browser console, or through Playwright's `browser_evaluate`:

```js
const s = window.__agentpool;           // the PoolScene3D
s.stats();                              // { fps, calls, triangles, agents, props }
s.debug.list();                         // [{ id, state, x, z, work, action, errand, ... }]
s.debug.play(id, 'cheer');              // play an ActionKind once
s.debug.hold(id, 'raiseHand');          // hold it until hold(id, null)
s.debug.force(id, { work: 'edit' });    // override the tool it works with; null clears
s.debug.force(id, { errand: 'towel' }); // start an errand now, for a figure on its lounger
s.debug.leisure(id, 'tea', 20);         // a leisure activity for 20 s, on a lounger
s.debug.look(x, z, distance);           // point the camera at a spot
s.debug.time(60);                       // move the scene clock on by 60 s
```

The full list of hooks, with their signatures, is in `README.md`.

## How each step is checked

Every step in a sprint file ends with **Check**: the tests to add and run,
and what to look at in the browser. A sprint is done when:

- every step's check passes;
- `npm test`, `npx tsc -b`, `npm run build` and `make test-backend` pass;
- the performance budget holds, with `?demo=60&debug` measured after
  20 s;
- the screenshots listed in the sprint's **Done** section were taken and
  looked at. They are saved under `.playwright-mcp/`, which is not
  committed;
- `docs/next.md` has a short entry for the sprint, in the style of the
  entries already there: what changed, what was measured, and what was
  found.
