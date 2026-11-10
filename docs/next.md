# What to develop next

The project is done through its definition of done. This is the list of what
could come after it, grouped by what it buys, with the gaps first.

## 1. The gaps

These are things the plan asked for that are not quite there yet.

- **Clicking a character in the scene.** The plan says "clicking a character
  opens an inspector". Today only the agent in the list can be clicked. The
  scene has no pointer handling at all: `PoolScene` never listens for a
  click, and the characters have no hit areas.
  *The fix:* a pointerdown on the canvas, a hit test against the characters,
  and `store.select()` for the one that was hit. Hovering could highlight
  the matching row in the list and show its name.
- **The journal grows for ever.** Every event is appended to
  `~/.local/state/agentpool/events/*.jsonl` and nothing ever removes a day.
  *The fix:* keep a week and delete the rest, or one file per day with a
  clean-up in the sweeper.
- **`make install` does not build the frontend.** It installs the
  dependencies; the build happens in `make plugin`. A fresh clone therefore
  has no `frontend/dist`, and the backend warns that it is serving the API
  only.

## 2. The dashboard

Things that make it more useful to look at.

- **A summary.** "3 working, 2 idle, 4 finished in the last five minutes" —
  a line under the top bar. Right now the counts are there but there is no
  history.
- **A timeline.** A row per agent with a bar for when it was working. The
  journal already knows every start and finish.
- **A filter.** Only the working ones, only the subagents, only one kind.
  The list holds everything and the panel is narrow.
- **The recent tool calls.** The inspector shows the session events, but not
  which tool an agent is using right now. The `tool_name` is there; a short
  history is not.
- **A command in the plugin.** `/agentpool` opens the dashboard, and maybe
  `/agentpool stop` shuts the backend down. Right now the plugin only has
  hooks.

## 3. The pool

Things that make it a nicer place.

- **Day and night.** The sky, the light on the water and the colour of the
  pool follow the time of day. The scene knows the time already.
- **Weather.** Rain on the water, ripples, the umbrella that appears when it
  rains. The parasol is drawn but never moves.
- **More idle activities.** There are eight; a newspaper, a phone call, a
  game of cards and a stretching routine would each need a prop and a pose.
- **The reactions.** When a subagent finishes, the others could look up. A
  wave, a raised glass. This is the one thing that would make the pool feel
  like a place where something is happening.
- **The pool grows with the crowd.** Six loungers is a number the backend
  owns; it could be a number that depends on how many agents are around.
- **The camera.** A slow pan along the deck, or a zoom towards the character
  you clicked.

## 4. Packaging

- A licence and a README that explains the whole thing to a stranger.
- A GitHub repository, with the tests running on every push.
- A release: `make release` builds the plugin and the frontend and packs
  them.

## What I would do first

The click in the scene, because the plan promised it and it is the thing a
person tries first. Then the journal, because it is the only part of the
project that gets worse the longer it runs. After that the summary and the
filter, because they make the panel useful with twenty agents in it. The
pool itself can wait: it is the part that is already pleasant to look at.
