# AgentPool

Your Claude Code agents swim in a pool.

The usual way to watch an agent is to see it sit at a desk and type. AgentPool
does the opposite: an idle agent lies on a sun-lounger with a cup of tea, and
the moment it starts working it jumps into the pool and swims. When it is
done it climbs out and goes back to lounging. When the session ends it walks
out through the gate, and the next agent walks in through the same gate.

There are no picture assets. Every character is drawn from vectors at run
time, and every character is different.

The pool has a morning and an evening: the light on the water follows the
clock, the lamps come on when the sun goes down, and sometimes it rains.

![the pool](docs/pool.png)

## What it shows

- Every Claude Code session and every subagent, as a character.
- The state of each one: idle, working, done, on its way out.
- The details of an agent when you click it: the folder it works in, the
  prompt it got, how long it has been running. A character in the pool can
  be clicked as well as a row in the list.
- A summary of the pool: how many are working, how many are idle, how many
  finished in the last five minutes.
- A filter for the list, and a bar under every agent that shows when it was
  working in the last fifteen minutes.
- The pool itself: the agents swim, they lie on the loungers with a cup of
  tea or a newspaper, and when one of them finishes the others wave. The
  camera looks at the agent you pick.

Inside Claude Code, `/agentpool` asks the pool what the agents are doing and
reports it back.

## Install

```sh
make install     # the python environment, the frontend dependencies and the build
make plugin      # register the Claude Code plugin
```

`make install` ends with the frontend build, so a fresh clone has a
`frontend/dist` and the backend can serve the dashboard.

`make plugin` installs the plugin from the local marketplace in `plugin/`, so
it always matches the code in this working copy. It is a separate step on
purpose: it writes to the global Claude configuration.

The dashboard comes up on <http://127.0.0.1:38000> as soon as a session
starts. The plugin starts the backend if it is not listening yet.

## Run it by hand

```sh
make server      # the backend on :38000, with the built frontend
make frontend    # the vite dev server on :5173, with hot reload
make test        # the backend and the frontend test suites
make lab         # the animation lab: every swim style and every idle activity
```

The frontend tests run in plain Node: the character system has its own
invariants — a character is a pure function of its id, the animation does not
depend on the frame rate, the pose layers never fight each other and the pose
is never a `NaN` — and they are checked on every `make test`.

The lab is at <http://127.0.0.1:5173/?lab>. It shows the four swim styles
(crawl, breaststroke, butterfly, doggy) and the idle activities (tea, book,
phone, sunbathe, nap, stretch, chat) next to each other, with a slider for
the phase and a dump of the pose weights.

## How it works

```
Claude Code ──hook──▶ the bridge ──▶ the registry ──▶ the scene ──▶ the browser
```

1. **The hook.** The plugin registers the Claude Code hooks. `SessionStart`
   starts the backend if it is not running yet; every other event is posted
   straight to the ingest endpoint over HTTP.
2. **The bridge** (`backend/agentpool/bridge/`) turns the raw hook payloads
   into events. It is deliberately dull: it knows about agents, never about
   scenes.
3. **The registry** owns the agents: who exists, what state they are in, when
   they are dropped.
4. **The scene** decides where an agent belongs: a lane to swim in, a lounger
   to lie on. The pool is one scene; `docs/scenes.md` explains how to write
   another one.
5. **The browser** draws the scene with PixiJS. The React layer only draws
   the panels; the 60 fps path never touches React.

The parts are documented in `docs/`:

- [the hook events](docs/hook-events.md)
- [the lifecycle of an agent](docs/lifecycle.md)
- [the scenes](docs/scenes.md)
- [porting the bridge to another project](docs/porting.md)
- [the architecture](docs/architecture.md)
- [the sprint plan](docs/sprints.md)

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `AGENTPOOL_PORT` | `38000` | The port the backend listens on. |
| `AGENTPOOL_IDLE_TTL_S` | `90` | How long an idle agent is kept. |
| `AGENTPOOL_SESSION_TTL_S` | `900` | How long a silent session is kept. |
| `AGENTPOOL_EXIT_GRACE_S` | `30` | How long a closing agent may take to walk out. |
| `AGENTPOOL_CLAUDE_DIR` | `~/.claude` | Where the reconciler looks for sessions. |

The frontend has two query parameters: `?debug` shows the state of every
character, and `?lab` opens the animation lab instead of the pool.
