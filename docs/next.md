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

Items 1–3 are one sprint of small fixes. Items 4–8 are the dashboard.
Items 9–12 are the pool. Item 13 is packaging.

---

## Sprint 9 — the small fixes

### 1. Clicking a character in the scene

The plan says "clicking a character opens an inspector". Today only the agent
in the list can be clicked. The scene has no pointer handling at all:
`PoolScene` never listens for a click, and the characters have no hit areas.

*The fix:* a pointerdown on the canvas, a hit test against the characters,
and `store.select()` for the one that was hit. Hovering should highlight the
matching row in the list and show its name. This also gives the scene a
reason to know where its characters are on screen, which the camera in item
12 will need anyway.

### 2. The journal grows for ever

Every event is appended to `~/.local/state/agentpool/events/events-<day>.jsonl`
and nothing ever removes a day. A busy day is a couple of hundred kilobytes;
a year of that is a directory nobody will ever look at.

*The fix:* a sweeper that deletes the journal files older than a week, run
from the same place the reconciler runs. Keep it small: a `prune(days)` method
on `Journal` and one call in the loop.

### 3. `make install` does not build the frontend

It installs the dependencies; the build happens in `make plugin`. A fresh
clone therefore has no `frontend/dist`, and the backend warns that it is
serving the API only.

*The fix:* `install` depends on `build`. It stays separate from `plugin` —
the plugin install is still a deliberate step, because it writes to the
global Claude config.

## Sprint 10 — the dashboard

Things that make it more useful to look at.

### 4. A summary

"3 working, 2 idle, 4 finished in the last five minutes" — a line under the
top bar. Right now the counts are there but there is no history.

### 5. A filter

Only the working ones, only the subagents, only one kind. The list holds
everything and the panel is narrow.

### 6. A timeline

A row per agent with a bar for when it was working. The journal already
knows every start and finish, so this is a matter of reading it back.

### 7. The recent tool calls

The inspector shows the session events, but not which tool an agent is using
right now. The `tool_name` is there; a short history is not.

### 8. A command in the plugin

`/agentpool` opens the dashboard, and maybe `/agentpool stop` shuts the
backend down. Right now the plugin only has hooks.

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
deciding whether to do them.

The dashboard before the pool, because a dashboard that is useful with twenty
agents in it is worth more than a tenth idle activity. The reactions before
the day and night, because they are the thing that makes the pool feel like
something is happening there; the weather is a mood, the reactions are a
story.

The packaging last, because a licence on a repository nobody can open yet is
a chore.
