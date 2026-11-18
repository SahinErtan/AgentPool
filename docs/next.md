# What to develop next

The project is done through its definition of done. This is the list of what
could come after it, and the order I would take it in.

The order follows one rule: **the things that break first, then the things
that were promised, then the things that make it useful at scale, then the
things that make it beautiful.** Everything in the project is in English; the
conversation about it is not.

The sprints 9, 10 and 11 are done. What follows is what a careful reading of
the code turned up afterwards — two of the items are measured bugs, not
opinions, and the measurements are written down below so they can be checked
again.

## The order at a glance

| # | What | Why here | Size |
|---|------|----------|------|
| 1 | Click a character in the scene | The plan promised it and it is the first thing a person tries | small |
| 2 | Journal rotation | The only part of the project that gets worse the longer it runs | tiny |
| 3 | `make install` builds the frontend | A fresh clone has no `dist` and the backend says so | tiny |
| 4 | A summary line | Makes the panel readable at a glance | small |
| 5 | A filter | The list holds everything; the panel is narrow | small |
| 6 | A timeline | The journal already knows every start and finish | medium |
| 7 | The recent tool calls | The inspector has the events but not the tools | small |
| 8 | `/agentpool` in the plugin | The plugin only has hooks today | small |
| 9 | The reactions | The one thing that makes the pool feel alive | medium |
| 10 | Day and night, weather | The scene knows the time already | medium |
| 11 | More idle activities | Each one needs a prop and a pose | medium |
| 12 | The camera, a pool that grows | Polish; nice, not needed | medium |
| 13 | Licence, GitHub, CI, release | Only worth it when there is something to share | medium |
| 14 | The model of an agent | The hooks already say which model an agent runs | small |

Items 1–3 were Sprint 9. Items 4–8 were Sprint 10, the dashboard. Items 9–12
are the pool, Sprint 11. Item 13 is the packaging. Item 14 is Sprint 31.

The three sprints below come **before** the packaging, because they are about
correctness. The packaging is last, as it always was.

---

## Sprint 9 — the small fixes (done)

### 1. Clicking a character in the scene — done

The plan says "clicking a character opens an inspector". It can now be done
from the scene as well as from the list.

`frontend/src/scene/pool/hittest.ts` turns the geometry the scene already
has into a hit area: a swimmer is caught at the waterline, a character that
lies down along its body, one that stands as a column. Clicking a character
selects it; clicking the water closes the inspector. Hovering draws a ring
under the character, shows its name and lights up its row in the list.

### 2. The journal grows for ever — done

`Journal.prune()` deletes the files that are older than the retention —
a week by default, `AGENTPOOL_JOURNAL_KEEP_DAYS` to change it. The sweeper
runs at startup and in the reconcile loop. The files that are not named
after a day are left alone.

### 3. `make install` does not build the frontend — done

`make install` ends with the build, so a fresh clone has a `frontend/dist`
and the backend can serve the dashboard. The plugin is still a separate
step: it writes to the global Claude config.

While fixing the click, a second bug turned up: the scene's layout could be
older than the canvas — the renderer was resized by the observer but the
layout was not, so the pool was drawn in the wrong size and a click landed
on the wrong character. The scene now follows the renderer.

## Sprint 10 — the dashboard (done)

Things that make it more useful to look at.

### 4. A summary — done

A line at the top of the panel: "3 working, 2 idle, 0 done", and how many
agents finished in the last five minutes. The last number outlives the
agents: a character that finishes walks out of the scene, but the panel
keeps a short memory of it.

### 5. A filter — done

Chips for the status (All, Working, Idle, Done) and a dropdown for the kind
(every kind, sessions, subagents, MCP servers, workflows). The two work
together.

### 6. A timeline — done

A thin bar under every agent row, showing when it was working in the last
fifteen minutes. The window is short on purpose: a person wants to see
whether the agent is busy now, not to read a day.

### 7. The recent tool calls — done

The backend now sends the last events of every agent, with the tool that
was used. The inspector shows them instead of the session's own feed.

### 8. A command in the plugin — done

`/agentpool` asks the pool what the agents are doing: it reads the state
of the backend and reports the working ones, what they are doing and what
looks off.

## Sprint 11 — the pool (done)

Things that make it a nicer place.

### 9. The reactions — done

When an agent finishes, the others react: the ones on the deck wave, the
ones in the water lift their head. A reaction is an offset that is added on
top of whatever the character is doing, so a character can wave while it is
lying down. The animation lab has a row of reactions and a scrubber.

### 10. Day and night, and weather — done

The sky, the light on the water and the colour of the pool follow the
clock; the lamps come on when the sun goes down, the stars come out, the
bird stops flying and the petals stop falling. The weather changes on its
own: the sky clouds over and sometimes it rains, and the rain fades in over
a minute instead of starting all at once.

### 11. More idle activities — done

A newspaper, a game of cards and a phone call, each with a prop and a
pose. There are eleven now.

### 12. A pool that grows with the crowd — done

The pool has a minimum of six loungers and grows to twelve when it is
busy, and it shrinks again when the agents leave. The scene description
travels with the agents, so the frontend knows.

### The camera — done

The camera looks at whoever is picked: it pans over and zooms in a little,
and it goes back when the selection is dropped.

A camera needs a world that is bigger than the screen, so the terrace and
the sky carry on past the edges of the canvas. The pool itself does not
grow: it still ends at the gate and at the ladder. The bottom of the world
stays where it is, so the floor of the pool does not move when the camera
zooms.

## Sprint 12 — the pool that keeps up (done)

**The scene and the registry must agree with reality.** The two of them are
told different stories by different code paths, and where they disagree the
pool keeps a body that is not there any more.

All four of the bugs below were measured before they were fixed and
measured again afterwards.

### 13. The sweeper never tells the scene that an agent is gone — measured

`app.py` broadcasts `agent_remove` for the agents the sweeper dropped, but
it never calls `scene.on_agent_removed(id)`. The browser forgets the
character; the backend keeps its lane, its lounger and its entry in
`_known`.

The measurement — three swimmers, the sweeper runs, the browser is told
that all three are gone:

```
lanes while swimming : {0: 'sub:s0', 1: 'sub:s1', 2: 'sub:s2'}
removals to browser  : ['sub:s0', 'sub:s1', 'sub:s2']
scene lanes after    : {0: 'sub:s0', 1: 'sub:s1', 2: 'sub:s2'}   <-- ghost lanes
```

There are four lanes. Four exits and the pool is full of ghosts: every new
swimmer is put in a lane that somebody else is already in, and they swim
through each other. The same holds for the loungers, the waiting slots and
the queue at the gate.

### 14. The reconciler never tells the scene that an agent finished — measured

The reconciler has three branches: an agent the scene has not seen is
replayed, a working one is told to start, an idle one is told to finish. A
**finished** agent matches none of them, so `on_agent_finished` never runs
and the lane is never given back. The same for a leaving one.

```
lanes while swimming : {0: 'sub:abc'}
FINISHED -> NO BRANCH TAKES IT  (the scene never hears)
lanes after the finish: {0: 'sub:abc'}
```

This is the safety net failing exactly where it is needed: the `SubagentStop`
hook did not arrive, the file on disk says the agent is done, and the pool
keeps swimming for it for ever.

### 15. A finished agent needs a browser to be reaped

`acknowledge_exit` is called by the frontend, when the character walks out of
the gate. With no dashboard open, nothing calls it: the finished agents pile
up in the registry and stay in `/api/state`. The backend must not need a
browser to tidy up after itself.

### 16. The scene must not grow for ever

`_known` only ever grows, and the registry has no cap. An agent that has
left is remembered for the life of the process. The scene must forget, and
the registry must have a ceiling.

### 17. The journal is written and never read

The journal collects every event, and the only way to read it is `cat`. It
should be readable through the API — `/api/history` — and the state should
survive a restart: at boot the journal is replayed into the registry, so the
"finished in the last five minutes" counters and the history of the agents
are still there after the backend is stopped and started.

### 18. One delivery, one effect

The ingest endpoint applies every event it is given. A hook that is
retried — the network hiccups, the client gives up and sends it again — is
applied twice, and the event count grows by two. The events carry an id;
they should be remembered and skipped the second time.

## Sprint 13 — the pool you can reach and script (done)

### 19. The dashboard must survive a lost connection

The client opens one WebSocket and does nothing else. There is no
reconnect, no backoff, and no fallback: if the socket is blocked by a proxy
or the backend is restarted, the dashboard is dead until the page is
reloaded. It should reconnect with a backoff and fall back to polling
`/api/state` while the socket is down.

### 20. One slow tab must not stall the others

The broadcast awaits `send_json` for each client in turn. A tab that has
stopped reading holds the whole pool up. Every client should have its own
queue, and a queue that is too long should drop the oldest state rather
than grow.

### 21. Nothing may fail silently

The broker counts the events it drops and nobody can read the number. The
loops swallow every exception with a log line, so a reconciler that broke
an hour ago looks exactly like one that is working. The counters belong on
`/api/health` — or a `/api/metrics` — and the last error belongs in the
panel.

### 22. The local port must not be open to the room

`POST /hooks/{event}` takes any JSON body from any process on the machine,
and `AGENTPOOL_HOST` can be set to `0.0.0.0`, which publishes the whole
dashboard to the network. The port should stay on `127.0.0.1` by default,
a shared token should be required, and a host that is not local should say
so loudly.

### 23. All the tools, not only the Agent tool

`hooks.json` limits `PreToolUse` and `PostToolUse` to the `Agent` tool, so
the inspector's list of recent tool calls only ever shows the subagent
spawns. The normalizer already understands every tool; the matcher is the
only thing in the way.

### 24. A command line

The only way to ask AgentPool something from outside is `curl /api/state`
inside a slash command. An `agentpool` command with `--json`, `--watch`,
`--agent <id>` and a useful exit code would make it scriptable — and it is
the same code the `/agentpool` command uses, so there is one answer, not
two.

### 25. Telling the user that something finished

Nothing tells you that an agent finished while you were looking at
something else. The backend should be able to send a desktop notification
when a long agent is done, and the plugin should be able to say so in the
session.

### 26. A link to an agent

The selection lives in the browser's memory, so an agent cannot be linked,
bookmarked or sent to somebody else. `?agent=<id>` would do it.

## Sprint 14 — the pool that is fast and reachable (done)

### 27. The keyboard and the screen reader

The agent rows are click-only `<li>` elements with no role, no tab index
and no key handler; the inspector neither takes nor gives back the focus;
`styles.css` has no focus style at all, and the canvas has no alternative
for somebody who cannot use a mouse.

### 28. The hot path

`clearanceAhead` is O(n) for every character in every frame, which is O(n²)
for the pool. `pickAt` builds a fresh array of hit boxes on every mouse
move. Every character allocates a new pose object every frame, and the foam
is cleared and drawn again every frame. With a dozen agents this is nothing;
with sixty it is not.

### 29. The tests for the code that has none

The parts with no tests are the parts that break: the WebSocket client
(reconnect, backoff, the stall timer), the 1100-line `PoolScene`, the
ingest endpoint, the state endpoints and the store. A registry-and-scene
test would have caught the ghost lanes on the first day.

## Sprint 15 — what the observer found (done)

An agent watched the dashboard while the work was being done and reported
what it saw, twice. The first round found the two bugs that no test had
caught: the characters stood at the gate and never moved, because they
were all born on the same spot and each of them told the other to stand
still; and the swimmers were drawn above the water, because the height a
swimmer swims at was worked out once and never again.

The second round confirmed the fixes and found the rest. Most of it is
fixed. What is left, and how it is being done:

### 29. There is no history to look back at

`/api/history` and `/api/metrics` exist, and nothing in the dashboard
calls them. There is no view of what happened: who finished, when, and
what the backend did while it was up.

**How:** the panel gets an "Activity" section — the last events from
`/api/history`, with the health of the backend underneath them (the
deliveries, the refusals, the dropped messages, the last error). It is a
`<details>`, so it takes no room until it is opened, and it stops asking
when the tab is hidden.

### 30. Two agents with the same name are the same row

Seven rows may say "general-purpose" and three may say
"code-reviewer", and nothing tells them apart. The name of a
subagent is its kind, not its description — the description is in the
prompt, and the prompt is what makes one subagent different from
another.

**How:** the second line of a row says the description of the agent when
it has one, the tool it used when it does not, and the slot when there is
neither. A detail that is only a folder path is not a description: that
is what the "Folder" row of the inspector is for.

### 31. The counts are said twice

The top bar says "2 working / 4 total" and the summary says "2 working 2
idle 0 done". One of them is enough.

**How:** the top bar keeps the name, the connection and the scene; the
panel owns the numbers.

### 32. The pool is a big flat rectangle

A hard seam runs across the water where the deep part begins, and with
one swimmer most of the picture is empty water.

**How:** the depth of the water is drawn as a gradient rather than as two
rectangles, and the floor — the lane lines, the depth markers — is seen
through it.

### 33. On a phone the characters are too small to read

At 390 pixels the characters are 25 to 30 pixels tall and fuse into a
strip, and the label above them is bigger than the figure it names.

**How:** fewer characters and bigger ones on a narrow canvas, and no
labels at all — the list beside the pool is the text version of the same
thing.

All five are done. What is left of the plan is the packaging.

## Sprint 16 — what the observer found in the last round

The third and last round of the observer. Most of it is fixed: the phone
layout scrolls, no character is drawn outside the pool, the Activity
section has the health of the backend under it, the "done" filter has
something to show, the ring sits on the figure, and the ground under the
pool is ground and not a hole.

What is left:

### 34. The standing character is a stack of blocks
Every part of a character has its own outline, and the parts are joined
only by overlapping. At the size the characters are drawn on the deck,
the outlines read as gaps, and the figure looks like a broken mannequin
rather than a person. The parts need to be drawn as one shape, or the
outlines need to be lighter where two parts meet.

### 35. The tag above a character is cut short

The tag says "observer-sess…" — thirteen characters is all that fits.
The name of the agent is in the list and in the inspector, so this is a
matter of taste, but a pool full of "observer-sess…" says nothing.

### 36. The rows can still say the same thing

The second line of a row is the description of the agent. It is usually
what makes two agents apart, but two subagents that were given the same
description still say the same thing. The tool they used last, and a few
characters of their id, would tell them apart when the description does
not.

### 37. Two swimmers in one lane while the others stand empty — done
Found while reading the live pool: two agents were swimming in `lane:0`
and the other three lanes stood empty. The lane kept the *name* of one
swimmer, so a swimmer that shared a lane was never counted, and the lane
was given away as soon as the counted one left.

The measurement — twenty runs of a pool that turns over, before and after:

```
before:  lanes with two swimmers {0: 2} while lanes [1] stand empty
         lanes with two swimmers {0: 3} while lanes [2, 3] stand empty
after:   (nothing — every swimmer is counted in its lane)
```

**How:** a lane keeps the list of its swimmers, not the name of one of
them. A swimmer that arrives when every lane is busy joins the emptiest
one, and the one that came last moves into a lane that falls empty, so
nobody swims in a crowded lane next to an empty one. A shared lane says
how many swimmers it has: `lane:3 (2)`.

### 38. A finished agent was never told to the browser — done

The counters on the live pool said: one delivery had failed with
`name 'settings' is not defined`. The announcement of a finished agent
used a name it did not have, and the error took the whole event with it:
the agent left the pool in the backend, but the browser was never told.

**How:** the dispatcher gets the settings it needs, and the announcement
is wrapped so that a courtesy can never break the event that carries it.

## Sprint 17 — the pool that shows now

The question behind it: **why are there so many characters on the screen,
and who are they?** The answer, measured on the live pool: they are not
yours.

```
boot:  replayed 372 agents from the journal
pool:  30 characters — 2 working, 28 idle
       the oldest idle one: 432 579 s old (five days)
       19 of them were workflows of other sessions on this machine
       8 of them were your own subagents, days old
places: 12 loungers, 1 at the edge, 15 standing at the gate
```

Two different bugs, one cause each.

### 39. The journal replay is a museum — done

The journal is kept for a week, and at boot every event of the week is
replayed into the registry. The agents whose last event was a *start* —
the ones that never sent a stop — come back as working, and the sweeper
turns them into idle. They then lie on a lounger for ever, because
nothing ever finishes them.

**How:** the replay at boot only covers the last quarter of an hour
(`AGENTPOOL_JOURNAL_REPLAY_WINDOW_S`, 900 seconds by default). The whole
journal stays where it belongs: `/api/history`, which the Activity panel
reads. The registry is for now, not for the archive.

### 40. An agent whose source is gone stays in the pool — done

The reconciler merges what the disk has into the registry, and it never
takes anything out. A background task of another session that has been
running for a day is over, but it is still in the pool, on a lounger, for
ever. The disk is the truth about what is running; the reconciler has to
obey it in both directions.

**How:** the reconciler knows what the disk has — the live sessions, the
subagents and the background tasks. An agent of those kinds that the disk
does not know about has gone, and it walks out through the gate. The rule
does not fire when the disk could not be read: a `claude agents` that
fails to answer means nothing, not "there are no agents".

## Sprint 18 — packaging (done in Sprint 30)

The project is finished and works, so this is a deliberate later step. The
user decided on 2026-11-10 to hold off until they push the project to
GitHub, and to be reminded of this list at that point. Do not start it
unprompted.

- A licence and a README that explains the whole thing to a stranger. (MIT,
  and a README written for a stranger: done in Sprint 30.)
- A GitHub repository, with the tests running on every push. (The workflow
  is written; the repository is the last step.)
- A release: `make release` builds the plugin and the frontend and packs
  them. (Done in Sprint 30: `dist/agentpool-<version>.tar.gz`.)

## Sprint 19 — the pool that looks like a pool

The pool worked and the picture did not. Asked to look at the scene rather
than the code, the answer was that the figures were heaps of disconnected
shapes, that the loungers were orange slabs the figures were not on, and
that the lower half of the water was an empty gradient.

The measurements are below. Everything in this sprint is in the frontend;
the backend, the scene contract and the wire protocol are untouched.

### 41. Every limb in the pool was backwards

The pose angles are written the way a person thinks about them: a positive
angle is towards the way the figure is facing. `poses.ts` says so, and says
that the rig applies `rotation = -angle` — and the rig never did. PixiJS
turns a limb that hangs downwards *backwards*, so every angle in the
project was the wrong way round.

**What it did:** the crawl reached behind the swimmer instead of in front,
the knee of the walk bent on the wrong half of the stride, the wave
pointed at the deck, and the figure that lay on a lounger was a bundle of
sticks.

**How:** the rig applies the negation, and `characters.test.ts` pins it: a
positive arm angle has to put the hand in front of the shoulder. The knees
were wrong in the same way and in the opposite sense: a knee bends
*backwards*, so the bend is negative now.

### 42. The figure was not on its lounger

The lounger was 0.62 of a character long and the figure that lay on it was
0.95 of a character long, so the figure was half again as long as its bed.
The origin of a lying figure is its feet, and the body was rotated a
quarter turn about that origin, so the body stuck *upwards* from the feet
instead of along the lounger.

**How:** a lounger is a chair with a back rest now, and it is longer than
the figure. The figure leans back on it rather than lying flat: a body
that is turned a quarter turn is a body seen from above, and a row of
bodies seen from above is a row of blobs.

### 43. Every character breathed at the same moment

The scene handed one clock to every character, and the breathing and the
weight shift were sine waves on that clock. A row of loungers looked like
a row of machines.

**How:** each character has its own clock and its own noise
(`scene/characters/noise.ts`, one-dimensional value noise). The world still
moves together — the caustics, the foam and the light are shared — but the
people each have their own time.

### 44. The motion was a wave all the way down

The rule the motion is built on now:

> The primary motion stays periodic where it should be — a crawl stroke
> *is* a cycle, and making it aperiodic would look wrong. Everything
> layered on top of it becomes aperiodic: the breath, the head drift, the
> hair, the settle after a stroke.

The secondary layer was a sinusoid, so the whole pool looped. It is noise
and springs now (`scene/characters/spring.ts`): the head arrives a moment
after the body, the hair a moment after the head, and the body rides on
the stroke without riding the same way twice.

**How:** the animation lab has a **motion trace**: the stroke on one line
and the ride on the other. A stroke draws a clean wave; the ride wanders.
That chart is the tool that answers "is this looped?".

### 45. A character that is held up kept walking its legs

The stride was a free-running timer, so a character that the clearance
system stopped went on marching on the spot. The stride follows the
distance now.

### 46. The ladder was never drawn

`layout.ladder` has existed since the beginning, and the characters walk
to it and climb down there — and there was nothing to climb. It is drawn
now, with its grab rails, going down into the deep end.

### 47. Nothing was grounded

Only the figure under the pointer had a mark. Every figure has a shadow
now: a figure on the deck has one on the deck, and a swimmer has one on
the floor of the pool, away from the surface.

### 48. The pool was a flat rectangle

The floor of the pool was a flat colour with a line along it, so the depth
was only implied. It has tiles now, and the light shafts, the lane ropes,
the weeds at the deep end and the drain. The lower half of the water is
still the emptiest part of the picture.

### 49. The figure was a stack of blocks

Item 34 above, still open until now. Every part of a character had its own
outline, and the parts only overlapped, so the outlines read as gaps. The
limbs have no outline now, the torso is one shape with one outline, the
head hangs from the neck instead of pivoting about its own middle, and the
arm and the leg grow out of the body instead of being stuck onto its edge.

### 50. What the observer found in the reworked pool

An agent watched the reworked pool at three sizes and in the lab. What it
found, and what was done:

- **Every character wore every accessory.** The goggles, the snorkel and
  the floatie were drawn on everybody, whatever `spec.accessory` said, and
  they came out as a cross over every face. This was older than the
  rework. A character wears its own accessory now, and a test says so.
- **The gate hut was gone.** It was lost when the loungers were redrawn.
  It is back.
- **The swimmers lay on the coping.** The centre line of the body was
  above the water, so nothing was cut by the waterline. It is at the
  waterline now, and the roll of the crawl, which in a side view is a
  tilt, no longer lifts the swimmer out of the water.
- **The lounger hung in the air.** Its legs were eight pixels long at
  every size, and the seat was twice as high as a hip. The legs reach the
  deck, the seat is at the height of a hip, the figure faces the back
  rest and its legs lie along the seat.
- **The activities were backwards.** They had been tuned against the
  backwards rig: the cup went to the middle of the face and the hands of
  the sunbather stuck out of the head like horns. All eleven are written
  again in the corrected convention, and the prop turns the right way.
- **The lane ropes hung down into the water** like a thermometer. They
  run away from the edge now.
- **The labels piled up** when the characters queued at the ladder. A
  label that would cover a more important one is left out.
- **The parasol stood on a lounger.** It stands past the last one.

## Sprint 20 — the pool in three dimensions

The side view put every character on one line: the deck was a strip the
characters walked up and down, and the swimmers went to and fro on one
band of water. Most of the pool and of the deck was never used. The pool
is a 3D scene now, with a camera that goes round it.

Decided with the user: real 3D with Three.js, and the camera may orbit,
but only between about 15° above the horizon and nearly overhead; the
characters are low-poly figures with toon shading and an ink line, built
in code, so a character is still a pure function of its agent id; the 2D
pool stays as a fallback, frozen, until the 3D one has settled.

Frontend only. The backend sends no coordinates, so it did not change, and
neither did the scene contract. The `lanes` number in `describe()`, which
the 2D pool ignored, is read now.

### 51. The pool was a side view

- **The scene.** `scene/pool3d/` is the new pool: the world in metres, the
  flow of each agent, the water, the light, the environment, the labels.
  `SceneHost` picks the pool: 3D by default, `?2d` for the old one, which
  also opens when the browser has no WebGL2 or loses its GPU context for
  good. Each pool is loaded only when it is shown: the 2D page does not
  download Three.js and the 3D page does not download PixiJS.
- **One motion core for both.** The half of the animator that computes the
  pose (`motion/driver.ts`) is pure now; the 2D rig and the 3D rig each
  write its pose in their own way. The 2D pool did not move by a pixel.
- **The pose grew the parts a side view cannot show:** a spine, the roll
  of the body about its long axis, and the arms and legs out to the side.
  The crawl rolls shoulder to shoulder and brings the arm round over the
  water, the breaststroke sweeps out and kicks like a frog, the butterfly
  has its wave down the spine. The 2D rig ignores the new fields.
- **The character.** One skinned mesh per agent, rigidly bound: each part
  is a capsule or a sphere on one bone. One draw call per character, one
  more for the ink line, one material for all of them. Measured: 60
  characters at 60 fps, 245 draw calls with the shadow pass.
- **The water.** A shader with waves that never line up, Fresnel, the sun
  on the water, and rings: a stroke, the wake behind a swimmer and a drop
  of rain each start one. The floor and the walls have the light of the
  waves on them; everything below the surface is tinted with the water.
  The masks and the second, underwater rig of the 2D pool are gone.
- **Walking round the pool.** A path goes round the water, through its
  corners, never over it. People keep out of each other's way: they slow
  down behind somebody, step aside to pass, and in a crowd the one with
  the smaller id goes first, so a crowd always moves. The stride follows
  the ground covered, as in #45.
- **Four ladders.** One ladder was a queue that never moved. A swimmer
  takes the nearest one that is not busy, and one person is on a ladder
  at a time. A swimmer turns at the wall instead of vanishing there.
- **The gate.** The queue at the gate is outside the fence, along it, in
  lines a person can walk between; newcomers come up the garden path.
- **The deck, the loungers, the reflections (left from Sprint 19).** The
  deck has perspective of its own. The loungers face the pool, in a second
  row when there are more than eight, each with a towel, a back rest at
  the angle the figure leans at and flip-flops at the foot. A fence, a
  hedge, trees, the hut by the gate, a lifeguard's chair, a ring buoy,
  parasols that lean in the breeze, a toy and a ball drifting on the
  water. The water mirrors the sky.
- **The labels** are HTML over the canvas, sharp at every zoom; the ones
  that would cover a more important one are left out, as in the 2D pool.
- **The lab** has a 3D page, `?lab&3d`, with the same rows and scrubbers.

### 52. What the crowd test found

A pool with sixty agents, pushed in at once in the browser, found what the
first tests did not:

- **Seventeen swimmers stood round the one ladder for ever,** each waiting
  for the one next to it. Four ladders, and a ladder is reached from a
  step away and only when it is free.
- **The queue at the gate stood on the path** everybody walked, and the
  newcomers piled up against it. The queue is outside the fence now.
- **A crowd pushed itself to a standstill**, everybody pushing everybody
  and nobody giving way. Only the one who gives way is pushed, and the
  order of the ids says who that is.
- **A corner on the way had to be stood on**, and a crowd that all had to
  stand on the point outside the gate could never get past it. A corner
  is passed within a step of it.

Each has a test in `world3d.test.ts`; the last of them drives sixty agents
through the gate at once and asks that every one of them gets where it is
going.

### 53. What the observer found in the 3D pool (first round)

An observer agent watched the live 3D pool at three sizes, with the real
agents and with sixty pushed in. Fixed:

- **Swimmers in one lane swam through each other.** They keep to the right
  of the lane now, so two that meet pass; one that catches up drops in
  behind instead of swimming through, and the middle of a body stays a
  shoulder's width inside the ropes.
- **A swimmer turned with its feet in the wall.** The turn started half a
  body from the wall and the glide through it carried the swimmer on. It
  starts early enough for the legs, which point at the wall after it.
- **Every reload replayed every entrance**: an agent that had swum for
  fifteen hours walked in through the gate again. The agents that are
  there when the page opens start in their places; only the ones that
  come later walk in.
- **The whole crowd chose the ladder by the gate.** A body walking to a
  ladder did not count as using it yet. It does now; all four are used.
- **The trees' shadows ended in straight-cut wedges**, outside the shadow
  camera. The trees cast none.
- **On a phone the loungers at the ends were cut off**, and the default
  view left the gate out. Both are framed now.
- A console warning: the soft shadow map is gone from Three.js r186.

Left as it is: the agents that have left stand at the gate until the
backend takes them away, which the backend does once it is told.

## Sprint 21 — the tools and the polish

The plan is `docs/plans/sprint-21-polish-and-tools.md`. It builds the tools
the later sprints stand on, and smooths what the first 3D round left rough:

- **A demo crowd.** `?demo=N` fills the pool with N fake agents whose
  places follow the backend's own rules, so every behaviour can be watched
  without real agents.
- **Debug hooks.** `?debug` puts `list`, `play`, `hold`, `force` and `look`
  on `window.__agentpool.debug`.
- **The figures.** A smaller head, five hair styles and a mouth. A figure
  on a lounger lies back against the back rest.
- **Short actions.** The cheer, the clap, the raised hand, treading water
  and the hop play over the running motion, with squash and stretch.
- **The effects.** Foam behind a swimmer, bubbles, confetti and a bigger
  particle pool. No shadow acne. The water is clearer at the shallow end
  and darker at the deep end.

## Sprint 22 — the work shows (done)

The pool could not say what an agent was doing: an agent running Bash and
an agent reading a file swam the same stroke, and a session that asked for
permission looked like any other. Now the tool an agent uses decides how it
swims, and a session that waits for the person swims to the wall and holds
up its hand until the person answers.

Frontend only, and the 2D pool is untouched.

- **The strokes.** Bash is a sprint (crawl at 1.3 tempo), an edit is a
  butterfly, reading is a breaststroke with a dive to the floor now and
  then, the web is a backstroke, planning is a float, and delegating is
  treading water. The work is smoothed, so a stroke does not change with
  every tool: a new kind has to hold for 2.5 s, and the shown one for 6 s.
- **Waiting for the person.** A permission or a question of the session,
  newer than the agent's last event and under 15 minutes old, makes the
  swimmer swim to the wall, turn and hold there. A waiting figure on a
  lounger, or standing, raises its hand. Its label turns amber and pulses,
  and says "needs you" every 8 s.
- **Sub-agents.** A sub-agent keeps its own suit, with its parent's suit as
  the trim. When one is born, its parent looks up or waves and says its
  name. Hovering or selecting an agent shows small rings under its parent
  and its children.
- **Tiredness.** An agent that has been working for more than half an hour
  has a swimmer that slows down, by a quarter at an hour and a half of work.
- **Two new strokes**, backstroke and float, are only put on by the work;
  the birth table is unchanged, so no existing agent looks different.
- **The driver** takes a swim style and a tempo from outside, cross-fades
  between styles over 0.6 s, and has a treading state that replaces the
  posture.

Measured with `?demo=60&debug` after 20 s: 60 fps, 809k triangles (the
budget is 1.2 M). Draw calls read 254 against a budget of 180; the new rings
are hidden unless somebody hovers, so the excess is most likely from the
figures themselves, but a build from before this sprint has not been
measured to prove it. The console is clean on `?demo=24` and `?demo=60`.

Found on the way: the existing "no stroke jumps" test read a full turn of
the backstroke arm as a jump of 6.3 radians. The arm angle is the same after
a full turn, so the test now measures the step the short way round.

## Sprint 23 — new pool equipment (done in part)

The pool had nothing to go to but the water and the loungers. Now the deck
has a terrace with a water slide, a diving board, a hot tub, a kiosk, a
ping-pong table and a shower, the shallow end has two fountains and a
flamingo, and a line of flags runs over the water. The paths go round all of
it. Nobody uses the places yet: Sprints 24 and 25 do that.

Frontend only, and the 2D pool is untouched.

- **The terrace, as data.** `world.ts` builds the equipment and the
  obstacles from the pool and the deck, so it still fits with one to eight
  lanes. The deck reaches 9.5 m past the far end of the pool.
- **Paths round everything.** `planPath` is a visibility graph over every
  obstacle, searched with Dijkstra. A walker never steps into equipment: a
  step that would is pushed back to the edge of its margin, so a walker
  slides along it.
- **The drawing.** The static parts are one merged mesh. The moving parts
  are the chute's water (stripes running down it), the plank, the hot tub's
  water (bubbles rising in it), the flags and the flamingo. The fountains
  throw 20 drops a second for 40 s out of every 120.
- **The toy** moved to the middle third of the pool, to make room for the
  flamingo at the shallow end.
- **The default view** now takes in the terrace (the plan's fallback
  framing); the slide was cut off before.

Measured with `?demo=60&debug` after 20 s: 60 fps, 831k triangles (the
budget is 1.2 M), 266 draw calls. That is 12 more than at the end of Sprint
22 (254), which is what this sprint should add. The budget of 180 is still
not met; that was already so after Sprint 22. `?demo=12` at 390 x 844 runs
at 60 fps with 113 calls. The console is clean on `?demo=60` and `?demo=12`,
and on `?2d`.

Found on the way:

- A two-lane pool leaves a sealed pocket between the board, the low chute
  and the hot tub. Their 0.5 m margins leave less than 1 m between them, and
  nothing passes. A walker that gets there has no way out. No agent goes
  there yet, but Sprint 24 has to route the diver and the slide users with
  this in mind.
- The planner's "end inside a margin" exception has to test the raw
  obstacle, not a margin of 5 cm: a point closer than 5 cm to the water
  could otherwise never leave it.
- The plan's down vector for the chute's trough points up on a level
  stretch; it is written the other way round.

## Sprint 24 — ways into the water (done in part)

Every swimmer used to climb down the same ladder. Now a swimmer chooses
its way in: the ladder (40 in 100), the starting block of its lane (22),
the board (14), the slide (14), or a cannonball off the wall of the two
outside lanes (10). A way that is busy, or that cannot be reached from the
deck, is not offered. Frontend only, and the 2D pool is untouched.

- **The entries.** `entries.ts` makes the choice from a seeded generator, and
  gives the approach of each way. The steps are in `flow.ts`: the racing
  dive, the board's walk and bounces with the board bending, the slide's
  stairs, sit, ride and drop, the cannonball's jump and splash. A way given
  up on the ground walks the body back down.
- **The swimming.** A flip turn for a run, and for every other turn of an
  edit. A rest at a wall after three to six lengths, for four to seven
  seconds. A race when two swimmers come level in neighbouring lanes.
- **The edge.** The waiting agents sit on the coping with their feet in the
  water and kick. At a long wall, with no ladder within 3 m, three in ten
  swimmers get out over the edge.
- **The sealed pocket.** The two-lane pocket that Sprint 23 left is closed
  off: `chooseEntry` only offers ways whose approach can be walked to. A test
  checks every lane count from one to six.

Measured with `?demo=60&debug` after 20 s: 60 fps, 263 draw calls against a
budget of 270, 831k triangles. The console is clean. The entries, the races,
the rests and the flips are covered by `entries.test.ts` and by two crowd
tests in `world3d.test.ts` (the 24 and the 60 agents, all going in by the
choice). 343 tests pass.

Not done in this round: the screenshots of each way, and the five-minute
watch. A forced board dive did not reach the board within the 30 s watched,
so the bend of the board and the new poses have not been seen on screen.
The deviations are in the sprint file.

## Sprint 25 — deck life (done in part)

An idle agent used to sit on its lounger for ever. Now it gets up from time
to time and goes on an errand: a shower, the kiosk, the hot tub, a game of
ping-pong or ball, a little talk in a group, a stroll round the pool, or a
towel shaken out where it lies. It can also lie on its side or sit up for a
while, and the queue fidgets. Frontend only, and the 2D pool is untouched.

- **The planner.** `errands.ts` is pure: a seeded draw over the kinds that are
  open now, with the partners of the group kinds taken from the idle agents.
  The shower gets a bonus for a swimmer that has just left the water. No more
  than 40 per cent of the idle agents are out at once.
- **The lifecycle.** `flow.ts` walks the agent to its place, uses it, and
  brings it back. The moment an agent wants the water, or its session needs
  the person, the errand is dropped; a body in the hot tub climbs out by the
  step first, and a partner is freed with it.
- **The use.** Seventeen new actions and five props, all held by the same
  pose driver as before. The balls are drawn once and move with the games.
- **The walkers.** Two fixes came out of the crowd test. A walker pressed
  against a face now slides along it, and a corner is only passed when the
  walk onward is clear of the margins. Before, a body could stand against the
  tower of the slide for minutes.

Measured with `?demo=24&debug` after a run of the clock: 60 fps, 159 draw
calls against a budget of 162, 382k triangles. With `?demo=60&debug`: 60 fps,
269 draw calls against 270, 832k triangles. The console is clean at warning
level in both. 360 frontend tests pass (17 new: the planner, the ball paths,
and the errands in the flow, including the 300-second crowd and the drop of
an errand when an agent wants the water).

Not done in this round: most of the screenshots, the ten-minute watch, and a
look at chat and the sunscreen on screen. The sunscreen is not drawn at night,
and chat needs two seated neighbours. The deviations are in the sprint file.
Two places have no errand on small pools: the kiosk, the hot tub and the court
are sealed off on one and two lanes.

## Sprint 26 — world and creatures (done in part)

The pool lives when no agent moves. A cat wanders, naps and watches the
water; a duck visits the quiet end now and then; two birds cross the sky, and
two butterflies work the flower beds. Clouds drift over the deck and throw
their shadows on it, and the lamps, the water and the string lights come on
after dark. The rain changes what people do: the loungers cover their heads
with a towel and the walkers hurry. Frontend only, and the 2D pool is untouched.

- **The limit.** `creatures.ts` is pure, and the animals are at most four on
  the screen at once, all kinds together (`MAX_CREATURES`). A test runs a
  simulated day and checks the count at every step.
- **The drawing.** `creatures3d.ts` makes each animal from a few merged
  pieces. The legs, the birds and the butterflies are instanced, and a kind
  that is not there costs no draw call. Only the cat's body casts a shadow.
- **The world.** A hut and its porch, six garden trees, a sprinkler, three
  flower beds and six lantern posts are fixed places in `world.ts`. The
  placement tests check them against the paths, the standing spots and the
  equipment.
- **The sky and the night.** Ten cloud puffs in one instanced mesh, cloud
  shadows on the deck, the lawn and the pieces, stars in the dome, and a moon.
  At night six lamps glow under the water, the lanterns and two strings of
  bulbs light up, the water glows, and two point lights come on. The hot tub
  steams.
- **The rain and the calm.** In the rain the loungers take a towel and the
  walkers hurry and lean; outdoor errands end. The deck wets and dries
  slowly, and the parasols sway more. After two minutes with nobody working,
  the water settles and the fountains stop.

Measured with `?demo=24&debug`: 60 fps, 165 draw calls clear, 177 in the rain,
against a budget of 182. With `?demo=60&debug`: 60 fps, 274 draw calls by day,
276 at night, 288 in the rain, against 290, and 843k triangles. The console is
clean at warning level in both. 376 frontend tests pass (16 new: the creature
rules over a simulated day, and the placement of the lanterns, the beds and
the sprinkler). `make test-backend` passes.

Not done in this round: five of the screenshots (the clouds, the duck, the
birds, the butterflies, the sprinkler), a watch through a full day, and tests
for the cover, the lean and the calm. The duck does not come to the 24-agent
demo, because the swimmers leave no room in the shallow end; it comes to a
quieter pool. The deviations are in the sprint file.

## Sprint 27 — moments and camera (done in part)

The pool reacts to what happens in it. An agent that finishes is clapped for
and cheers when it is out of the water; a round number of events brings
confetti and a shout; a session that ends is cheered at the gate, by fireworks
at night. A camera that follows one agent from close, and a tour that orbits
the deck and turns to look at what happens. And a click means something: the
selected agent waves back, the cat runs off, the water ripples.

- **The moments.** `moments.ts` is pure. It compares two snapshots and says
  what happened: finished, a milestone (only the highest one crossed), a
  session that ended, the pool gone quiet after two minutes, busy at six
  working, and awake again. The first snapshot fills the memory and says
  nothing, so a reload throws no confetti. 13 tests.
- **The reactions.** Clapping by the three nearest people in reach, a slap of
  the water by the swimmers near the finisher, the cheer and the hop. The
  fountains run for forty seconds when the pool is busy. A cat asleep near a
  working agent wakes up. Reduced motion keeps the claps and the labels, and
  takes away the confetti, the fireworks and the hop.
- **The particles.** Sparks (kind 6) and rockets (kind 7) live in the same
  points mesh, so the fireworks cost no draw call. A firework is 113
  particles. The pool holds 2400 now, up from 1600, because the sparks of a
  rocket would overwrite the foam of a busy pool.
- **The camera.** `F` follows the selected agent from 7 m, and a double-click
  on an agent does the same. `T` starts the tour, and so does a button in the
  bottom left corner. The tour orbits at 0.035 rad a second and looks at the
  things that weigh most: a needs-you hand (3), a finish or a milestone (2),
  a dive, a slide or a cannonball (1.5), a race or a duck (1). It starts by
  itself after two minutes with no input, and never with reduced motion. Any
  press, the wheel or another key stops it. `director.ts` is pure, 10 tests.
- **The clicks.** Clicking the selected agent again turns its head to the
  camera for 2.5 s and waves. Clicking the water ripples it. Clicking the cat
  makes it run and say `mrrp`. Clicking the flamingo or the beach ball makes
  it bob and turn. Only an agent's click changes the selection.

Measured with `?demo=24&debug`: 60 fps, 166 draw calls, against a budget of
182, and the console is clean. With `?demo=60&debug`: 60 fps, 274 draw calls,
against 290, and 842k triangles, with the console clean. Reduced motion
disables the tour button and starts no tour.

Not done in this round: the observer round, the screenshots of the finish,
the milestone, the fireworks and the follow, and a look at the click
reactions on screen. The brief for the observer is in
`docs/plans/sprint-27-observer-brief.md`; the main session runs it. The
deviations are in the sprint file.

## Sprint 28 — who is who

The user asked to be able to tell from a character's name which session it
belongs to and what it is doing. Measured against the running backend with
two live sessions, the names said almost nothing: every session was called
`main`, every subagent was called by its type (`general-purpose`), and an MCP
server stood in the pool as a person. The plan is
`docs/plans/sprint-28-who-is-who.md`; it is the one sprint allowed to change
the backend.

- **Four bugs in the backend, found by looking at real data.** Every hook
  event wrote the placeholder `main` over the session's name from the disk.
  The hook's `cwd` was read and dropped, so no agent had a project. The
  folder a hook reports moves with every `cd`, so once it was kept the
  project of this very session read `pool3d`; the project is now the folder
  the session started in. And a background subagent was drawn twice: once
  from `SubagentStart` as `sub:`, and once from the `background_tasks` of the
  Stop hook as `wf:`, under the same id.
- **The naming rule.** A session is its name on the disk, else its project; a
  subagent is the description its parent gave it, else its type. The
  placeholders never win. Two names on the screen are never the same: the
  rule adds the project or the parent session, and numbers what is still
  equal, oldest first. `names.ts` is pure; one test builds 60 agents with
  deliberate clashes and checks every name is different.
- **What the agent is doing.** `summarize_tool` turns a tool call into a few
  words (`Bash: npm test`, `Edit: overlay.ts`, `playwright: browser_click`).
  A hook fired inside a subagent carries its `agent_id`, measured on 333
  events of one day, so the call goes to the subagent and not to its session.
  Messages the harness puts in through `UserPromptSubmit` (`<agent-message>`
  and the like) are not taken as the person's last prompt.
- **MCP servers are not characters.** Their calls are the activity of the
  session that made them; old `mcp:` records in the journal are dropped at
  replay.
- **On the screen, the name only.** A label of up to 24 characters with a
  dot in the colour of its family. The pointer over a character brings up one
  reused card: the full name, the kind and the project, whose session it is,
  what it is doing now, for how long, and a session's last prompt.
- **A session that has left still names its subagents.** A session leaves
  the pool when its turn ends, while its background subagents work on. The
  backend remembers every session's name and sends it with each agent as
  `session_name`, so the card says `of: mediaorganizer-77` and the list puts
  the subagents under that name.
- **The list** is grouped by session, and the inspector has the project, the
  description, the activity and the last prompt.

Checked with the real backend: every session carries the name it has in
`~/.claude/sessions/`, no `mcp:` agent is left, and the cards of the
MediaOrganizer subagents say whose they are and what they are searching.
With `?demo=60&debug`: 60 fps, 275 draw calls against 290, 842k triangles,
60 labels and 60 different names, the console clean. 439 frontend tests and
176 backend tests pass.

## Sprint 29 — life on the lounger

The user asked what had become of the lounger activities they had planned,
tea among them. They were designed for the 2D side view in Sprints 6 and 11
and carried into 3D unchanged, and looking at each of them in 3D showed why
they did not read: the arms only swung forward and back, so a hand never
came in front of the face; the props hung from one hand at a fixed offset,
so the book was held out like a sign and the newspaper floated behind the
head; and every figure had one habit for life. The plan is
`docs/plans/sprint-29-life-on-the-lounger.md`; the 2D pool is untouched.

- **Joints that reach the middle.** A twist of the upper arm and a bend of
  the wrist, both 3D only. Every prop has a grip, and two-handed props are
  held by both hands on every body shape (within 1 cm).
- **The activities redone for 3D** (`motion/leisure.ts`), each with a reach,
  a loop driven by noise and a put-away, and seven new ones: a laptop,
  music on headphones, a hand fan, lemonade through a straw, a crossword,
  watching a swimmer, and stroking the cat.
- **A repertoire chosen for the moment** (`leisurePlan.ts`): the favourite
  and two more; crosswords and tea in the morning, a fan and lemonade at
  midday, the laptop in the evening, sleep at night and after a long idle;
  stretch and a drink right after a swim. No sunbathing in the rain or at
  night, no chat without a neighbour, no cat without the cat.
- **Tea on a side table.** A table at every lounger and a tulip glass on
  it, taken, stirred, sipped and put back; refilled after five minutes.
- **Marks over the head** for a chat in turns, a call and music, and a
  `resting:` line on the hover card.

What looking found, beyond the plan: a lean that grew every frame (400 rad
by the end of a tea), a whole figure rolling off the lounger in a stretch,
and a prop costing two draw calls for a shadow nobody could see. Measured
with `?demo=60&debug`: 60 fps, 281–285 calls against 290. With the demo
held still, 7 kinds of activity in 90 s. 498 frontend tests pass. A short
figure's hand stays about 12 cm from its glass on the table; that is noted
in the plan.

## Sprint 30 — the crowd, the night and the packaging (done)

The user decided that the 2D pool goes: the 3D view is the one that is
wanted, and the 2D one is not needed. PixiJS, the 2D scene, the 2D lab and
their tests are gone. What was left of the crowd was the real work of this
round: sixty agents swam through each other, and a busy pool froze.

- **The swimmers keep apart.** A swimmer that comes within reach of another
  one steps aside instead of swimming through it; if there is no room, it
  holds still until there is. After ten seconds of waiting it is let
  through, after a step to the side. A swimmer that is on its way to a
  ladder crosses the lanes quickly rather than drifting across them.
- **A swimmer keeps its lane.** The lane a swimmer is given is ignored
  while it is in the water; it takes the new lane when it is out. The
  ladder queues are ordered, and the ladder foot is not in the traffic of
  the outer lane any more: the pool keeps a margin at the wall.
- **The pool grows with the crowd.** The demo grows the pool with the
  number of agents: four lanes up to twenty, six up to forty, eight above,
  and the length with it.
- **The measurement.** `frontend/test/crowd.test.ts` runs a crowd of 24 or
  60 bodies for twenty minutes and measures the torsos: a pair closer than
  0.3 m is an overlap, counted once per frame. Before the rework there were
  1.9 million of them at sixty agents; there are 26 thousand now, and 4
  thousand at twenty-four agents. Two thirds of the frames have some pair
  that close, which in a pool with sixty swimmers is passing traffic rather
  than a bug. What must not happen is a pair that stays on top of one
  another: the longest is 32 seconds at sixty agents (10 at twenty-four),
  and the test fails at 40.
- **A forced entry waits.** A forced entry whose place is busy waits for
  it; it does not fall back to the ladder any more, which used to put two
  bodies on the same ladder.
- **Reduced motion holds everywhere.** A forced slide, board or cannonball
  becomes the ladder when the motion is reduced, not only the natural
  choice (`entryForMotion`). It was the one place where the rule did not
  hold.
- **The fireworks of a night can be seen.** They burst about five metres up,
  which put them on the top edge of the picture, two or three pixels wide:
  a thing nobody sees. They burst at three and a half metres now, over the
  far edge of the pool, with bigger sparks (110 of them), and they read.
- **The packaging.** MIT, a README written for a stranger, GitHub Actions
  that runs the backend and the frontend tests on every push, and
  `make release`, which packs the backend, the plugin and the built frontend
  into `dist/agentpool-<version>.tar.gz`. `make install` no longer needs
  pyenv: a machine without it gets a plain `.venv` next to the project.
- **The demo has a session that ends.** The gate celebration needs a
  session whose status becomes "leaving", and the demo feed only ever gave
  its sessions "working" and "idle": the sub-agents were the ones that
  finished and left. So the confetti by day and the fireworks at night
  could not be seen in the demo at all, only with a real backend behind
  it. A session now works, rests, works again and then ends; it walks out
  through the gate and the next session walks in through the same gate.
  Measured in the browser on `?demo=12`: the first session ends at 159
  seconds, the rockets go up at the gate, and the next session walks in
  half a second later (`session:demo-s0-0` becomes `session:demo-s0-1`).
  The next endings follow at 348 and 376 seconds.

Measured with `?demo=24&debug`: 60 fps, 168 draw calls, 419k triangles, the
console clean. With `?demo=60&debug`: 58 fps, 266 draw calls against 290,
985k triangles against 1.2M, the console clean. 465 frontend tests and 176
backend tests pass.

Known: in a crowded pool two swimmers still stay overlapped for 10 to 30
seconds now and then, when they cross between the lanes.

### What the observer found in the 3D pool, the second round

The observer was let loose on the running pool with the brief of the first
round: it looks, it does not touch anything, and it says what it *saw*
separately from what it *inferred*. The screenshots are in
`.playwright-mcp/observer2/`.

**SAW**

- *Placement.* 3180 samples on `?demo=12`: every agent that stood inside an
  obstacle was on a legitimate one (a start block, the board, the slide, a
  ladder), and none stood in a flower bed, under a tea table or off the
  deck. The idle agents were on loungers, the working ones in the water.
- *The crowd.* 212 frames on `?demo=60`: 59–61 fps, 236–270 draw calls
  (the budget is 290), 975k–986k triangles (the budget is 1.2M).
- *The swimmers.* Two working swimmers came within 0.6 m of each other for
  at most two seconds at a time, once down to 0.13 m, in opposite
  directions in the middle of a lane.
- *Two agents on one spot.* A session on its way to its lounger and a
  leaving agent stayed within 0.6 m of each other for 28 seconds, at
  0.08 m at the closest, both walking the same narrow strip along the
  pool's long wall (x 10.7–10.8, z 6.6–6.8).
- *The celebration.* In 120 seconds of `?demo=12` at 23 o'clock no rocket,
  spark or confetti was ever seen and `rocketsLeft` stayed 0, although
  agents did reach "finished" and "leaving". At the same time a session
  agent stood at the gate in the "leaving" state.
- *The console.* No errors and no warnings on `?demo=12`.

**INFER**

- The geometry, the slots and the obstacle avoidance agree with the scene
  contract: no agent stands in the pool wall, in a flower bed or under a
  table. (High confidence.)
- The pool holds sixty agents inside every budget. (High confidence.)
- The brief interpenetration of two swimmers is a pass in a lane, and it
  is over in well under a second. (Medium-high confidence.)
- **The wall strip is a shared walk lane with no separation rule.** An
  agent that goes to its lounger and an agent that leaves walk through one
  another for half a minute, and on screen the two figures read as one
  merged body. This is the one place where two agents genuinely share a
  spot for a long time. (Medium-high confidence.)
- **The demo can never end a session.** The moment that celebrates a
  session needs a *session* agent whose status becomes "leaving", and the
  demo feed only ever gives its sessions "working" and "idle": the
  sub-agents are the ones that finish and leave. So the gate celebration
  is unreachable in the demo, and the showiest thing in the scene cannot
  be seen without a real backend behind it. (Medium confidence: read in
  the code, not driven end to end.)

The two findings that are real are on the list for the next round: the
deck walkers need a separation rule of their own, and the demo needs a
session that ends. The second one is done in this round: the demo's
sessions now end, walk out through the gate, and the next one walks in.

## Sprint 31 — what the hooks already know

Planned in `docs/plans/sprint-31-what-the-hooks-know.md`, carried out on
2026-11-18.

A person watching the pool wants to know one thing about an agent before
anything else: **which model is it running on**. The pool could not say it,
although Claude Code says it in every session's own payload: the
`SessionStart` hook carries a `model` field, and the value has been in the
journal all along. The reason was a missing step, not a missing feature —
the bridge keeps the whole payload in `raw`, `raw` never leaves the
backend, and the registry had no field for the model, so nothing went out
to the browser.

- **The model of a session.** `SessionStart` says which model the session
  started on. `SessionStart` is not the only word on it: `/model` changes
  the model of a running session, and the truth after that is the
  transcript, whose last assistant turn names the model it was answered
  with. The reconciler refreshes it every 30 s.
- **The model of a subagent.** Its hook payload has none, but its meta
  file does: `pickedEffortModel`. `sources.py` already read that value
  and the reconciler was what threw it away.
- **The effort.** The payload of a tool call names the effort the agent
  works at: `{"level": "medium"}`.
- **The tokens.** The last turn's context (the fresh tokens, the ones
  read from the cache and the ones written into it) and what came out of
  it, and the tokens the agent has used in all. The cache that is read
  again is not counted twice: a session of half an hour said eleven
  million tokens when it was counted, and half a million when it was not.
- **The transcript is read once whole, and then only the new lines.** A
  transcript is big, so the reader keeps the offset it stopped at. Only
  the agents that are in the pool are read: the disk keeps the
  transcripts of every subagent that ever ran, and reading all of them
  took the reconciler from 0.07 s to 4.7 s.
- **A fact that is not there is not shown.** The inspector shows the rows
  it has and leaves the rest out. A column of dashes is noise.

Measured on the live pool: a session of this machine reads "MiniMax M3.1
Flash", "medium", "153 k in · 102 out" and "902 k". The demo shows the
same rows with fake numbers. 193 backend tests and 472 frontend tests
pass.

Not done yet, and written down so it is not lost: the permission mode, the
duration of the last tool, the MCP server, the size of the context and the
cost of writing the cache again, and whether the session was started,
resumed, compacted or forked. They are all in the payload already.

## Why this order

The click first, because the plan promised it and it is the thing a person
tries first. The journal second, because it is the only part of the project
that gets worse the longer it runs, and the fix is twenty lines. All three
are done.

The dashboard before the pool, because a dashboard that is useful with twenty
agents in it is worth more than a tenth idle activity. The reactions before
the day and night, because they are the thing that makes the pool feel like
something is happening there; the weather is a mood, the reactions are a
story.

Then the correctness work, because a pool that keeps bodies that are not
there any more gets worse the longer the session runs — the same argument
as the journal. The transport and the port after that, because they decide
whether the dashboard is there at all. The keyboard and the hot path last
of the three, because they matter when the pool is busy.

The packaging still comes last, because a licence on a repository nobody can
open yet is a chore.

## What comes next

The packaging is done: MIT, the README, the CI and `make release`. What is
left is the observer's round on the pool, and then the repository itself.

The pool shows now: the journal is the archive and the disk is the truth
about what is running. A boot replays a quarter of an hour of the journal,
not a week of it, and an agent the disk does not know about walks out
through the gate. Measured on the same state: 30 characters before, 3
after.

Sprint 12, 13, 14 and 15 are done: the pool keeps up with reality, it
can be reached and scripted, it is fast and reachable with the keyboard,
and it has a history to look back at. Sprint 19 is the visual rework: the
figures read as people, they sit on the loungers, the strokes are strokes
and the pool is a place.

Sprint 20 put the pool in three dimensions. Most of what was left of
Sprint 19 came with it: the spine, the wake, the deck, the reflections of
the sky, and the lower half of the water, which is seen from above now.

What is left of Sprint 20, in the order I would take it:

- **The second observer round on the 3D pool.** (Running in Sprint 30.)
- **The 2D pool goes.** Done in Sprint 30, on the owner's decision: the 3D
  pool is the scene.
- **Reflections of the loungers** in the water (a `Reflector` at half
  resolution, on fast machines only). The sky is reflected already.
- **The lab's noise and spring sliders**, if they are needed.
- **The deck walkers need a separation rule.** Two agents that walk the
  same strip along the pool's wall walk through one another for half a
  minute; the swimmers have one, the deck has none.
- **The demo needs a session that ends**, so that the gate celebration
  (confetti by day, fireworks at night) can be seen without a real
  backend. (Done in Sprint 30.)
- **The model of an agent.** The hooks already carry it; the pool throws
  it away. (Sprint 31.)

After that comes **the living pool, Sprints 21 to 27**, planned step by
step in `docs/plans/` (start with `docs/plans/README.md`). Each sprint's
plan is written to be carried out on its own:

- **21:** the tools and the polish.
- **22:** the work an agent is doing shows in how it swims, and a session
  waiting for the person raises its hand.
- **23:** a terrace with a slide, a diving board, a hot tub, a kiosk and a
  ping-pong table.
- **24:** new ways into the water.
- **25:** errands on the deck.
- **26:** a few creatures, the sky and the night.
- **27:** moments, a touring camera and the last observer round.

Two decisions shape it:
- the only people in the pool are the agents;
- there are never more than four animals on screen at once.

The observer that watched the dashboard through all of it found the two
bugs that the tests did not: the characters stood at the gate and never
moved, because they were all born on the same spot and each of them told
the other to stand still; and the swimmers were drawn three hundred
pixels above the water, because the height a swimmer swims at was worked
out once and never again. Every round after that it found less.
