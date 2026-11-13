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

Items 1–3 were Sprint 9. Items 4–8 were Sprint 10, the dashboard. Items 9–12
are the pool, Sprint 11. Item 13 is the packaging.

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

## Sprint 18 — packaging (parked)

The project is finished and works, so this is a deliberate later step. The
user decided on 2026-11-10 to hold off until they push the project to
GitHub, and to be reminded of this list at that point. Do not start it
unprompted.

- A licence and a README that explains the whole thing to a stranger.
- A GitHub repository, with the tests running on every push.
- A release: `make release` builds the plugin and the frontend and packs
  them.

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

The packaging, and whatever the observer of the dashboard found in its
last round.

The pool shows now: the journal is the archive and the disk is the truth
about what is running. A boot replays a quarter of an hour of the journal,
not a week of it, and an agent the disk does not know about walks out
through the gate. Measured on the same state: 30 characters before, 3
after.

Sprint 12, 13, 14 and 15 are done: the pool keeps up with reality, it
can be reached and scripted, it is fast and reachable with the keyboard,
and it has a history to look back at.

The observer that watched the dashboard through all of it found the two
bugs that the tests did not: the characters stood at the gate and never
moved, because they were all born on the same spot and each of them told
the other to stand still; and the swimmers were drawn three hundred
pixels above the water, because the height a swimmer swims at was worked
out once and never again. Every round after that it found less.
