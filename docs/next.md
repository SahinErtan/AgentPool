# What to develop next

The project is done through its definition of done. This is the list of what
could come after it, and the order I would take it in.

The order follows one rule: **the things that break first, then the things
that were promised, then the things that make it useful at scale, then the
things that make it beautiful.** Everything in the project is in English; the
conversation about it is not.

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

Items 1–3 are done — they were Sprint 9. Items 4–8 are done — they were
Sprint 10, the dashboard. Items 9–12 are the pool. Item 13 is packaging.

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

## Sprint 11 — the pool

Things that make it a nicer place.

### 9. The reactions

When a subagent finishes, the others could look up. A wave, a raised glass.
This is the one thing that would make the pool feel like a place where
something is happening.

### 10. Day and night, and weather

The sky, the light on the water and the colour of the pool follow the time
of day; rain on the water, ripples, the umbrella that appears when it rains.
The parasol is drawn but never moves.

### 11. More idle activities

There are eight; a newspaper, a phone call, a game of cards and a stretching
routine would each need a prop and a pose.

### 12. The camera, and a pool that grows

A slow pan along the deck, or a zoom towards the character you clicked.
Six loungers is a number the backend owns; it could be a number that depends
on how many agents are around.

## Sprint 12 — packaging

- A licence and a README that explains the whole thing to a stranger.
- A GitHub repository, with the tests running on every push.
- A release: `make release` builds the plugin and the frontend and packs
  them.

## Why this order

The click first, because the plan promised it and it is the thing a person
tries first. The journal second, because it is the only part of the project
that gets worse the longer it runs, and the fix is twenty lines. The rest of
the small fixes third, because they are each smaller than the effort of
deciding whether to do them. All three are done.

The dashboard before the pool, because a dashboard that is useful with twenty
agents in it is worth more than a tenth idle activity. The reactions before
the day and night, because they are the thing that makes the pool feel like
something is happening there; the weather is a mood, the reactions are a
story.

The packaging last, because a licence on a repository nobody can open yet is
a chore.

## What comes next

The pool: the reactions first — when a subagent finishes, the others look
up — and then the day and night. The pool is the part that is already
pleasant to look at, so it can wait; the panel is now useful with twenty
agents in it.
