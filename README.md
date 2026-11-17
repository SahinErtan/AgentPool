# AgentPool

**Your Claude Code agents swim in a pool instead of sitting at a desk.**

The usual way to watch an agent is to see it type. AgentPool does the
opposite: an idle agent lies on a sun-lounger with a cup of tea, and the
moment it starts working it jumps into the pool and swims. When it is done
it climbs out and goes back to lounging. When the session ends it walks out
through the gate, and the next agent walks in through the same gate.

Every Claude Code session and every subagent is a character. You see them
all at once, see what each one is doing, and see it change the moment it
starts and stops working.

![the pool](docs/pool.png)

The picture above is the whole idea: a sunlit swimming pool, a row of
loungers along the deck, agents in the water and agents on the deck. The
light follows the clock, the lamps come on when the sun goes down, and
sometimes it rains.

There are no picture assets in this repository. Every character, the pool
and the deck are drawn from code at run time, and every character is
different — a character is a pure function of its agent id.

## Requirements

- Python 3.11
- Node.js 20 (or newer)
- A browser with WebGL2 (any current Chrome, Firefox, Safari or Edge)

Everything runs on your own machine. Nothing is sent anywhere.

`make install` makes the Python environment for you. If [pyenv](https://github.com/pyenv/pyenv)
with Python 3.11 is on the machine it uses that; otherwise it makes a plain
`.venv` next to the project. Neither pyenv nor a virtualenv of your own is
needed.

## Install

```sh
make install
```

That creates the Python environment, installs the backend requirements,
installs the frontend dependencies and builds the frontend into
`frontend/dist`. A fresh clone needs it once, before the backend can serve
the dashboard.

Then, in a second terminal:

```sh
make server
```

The dashboard comes up on <http://127.0.0.1:38000>.

### The plugin

```sh
make plugin
```

`make plugin` installs the Claude Code plugin from the local marketplace in
`plugin/`, so the plugin always matches the code in this working copy. It is
a **separate step on purpose**: it writes to your global Claude Code
configuration, and that is a deliberate thing to do.

The plugin registers the Claude Code hooks. `SessionStart` starts the
backend if it is not listening yet; every other event is posted to the
backend over HTTP. From then on the pool fills up by itself: start a
Claude Code session, and its character appears.

`make plugin-uninstall` takes it away again.

## Useful URLs

The backend serves the built frontend, so every URL below works on
<http://127.0.0.1:38000>. During development the vite dev server on
:5173 serves the same page with hot reload.

| URL | What it does |
|---|---|
| `/` | The pool, with your own agents. |
| `/?demo=12` | Twelve scripted agents and no backend — for looking at the scene on its own. |
| `/?demo=60&debug` | A crowd of sixty, with the fps, the draw calls and the triangle count in the corner. |
| `/?lab` | The animation lab: every swim style and every idle activity, side by side. |
| `?debug` | The debug hooks, listed at the bottom of this file. |
| `?agent=<id>` | Opens with that agent selected. |

## The commands

```sh
make install     # the python environment, the frontend dependencies and the build
make server      # the backend on :38000, with the built frontend
make server-stop # stop the backend that is holding :38000
make frontend    # the vite dev server on :5173, with hot reload
make build       # build the frontend into frontend/dist
make test        # the backend and the frontend test suites
make lab         # the animation lab
make agentpool   # ask the running pool what the agents are doing
make plugin      # install the Claude Code plugin from ./plugin
make release     # build the plugin and the frontend and pack them into dist/
```

`make agentpool` asks the pool the same question the dashboard answers, and
it is meant to be used from a script:

```sh
make agentpool ARGS="--json"
make agentpool ARGS="--watch"
make agentpool ARGS="--agent session:abc"
```

The exit code says what happened: 0 when the pool answered, 1 when the
backend could not be reached, 3 when the agent that was asked for is not
there.

Inside Claude Code, `/agentpool` asks the same question and reports it
back.

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
- The keyboard: the arrow keys walk the list, Enter opens the inspector,
  Escape closes it. The canvas is labelled, the list is the same
  information in text.
- An activity section: the last things that happened in the pool, and the
  health of the backend — the deliveries, the refusals, the dropped
  messages and the last error.

## Tests

```sh
make test           # both suites
make test-backend   # pytest, in the python environment
make test-frontend  # node --test, in the frontend
```

The frontend tests are written in TypeScript and run in plain Node — no
browser, no WebGL. The character system has its own invariants: a
character is a pure function of its id, the animation does not depend on
the frame rate, the pose layers never fight each other, and the pose is
never a `NaN`.

The same suites run on every push, on GitHub Actions
(`.github/workflows/ci.yml`).

## How it works

```
Claude Code ──hook──▶ the bridge ──▶ the registry ──▶ the scene ──▶ WebSocket ──▶ the browser
```

1. **The hook.** The plugin registers the Claude Code hooks and posts the
   events to the backend over HTTP.
2. **The bridge** (`backend/agentpool/bridge/`) turns the raw hook payloads
   into events. It is deliberately dull: it knows about agents, never about
   scenes.
3. **The registry** owns the agents: who exists, what state they are in,
   when they are dropped.
4. **The scene** decides where an agent belongs: a lane to swim in, a
   lounger to lie on. The pool is one scene; `docs/scenes.md` explains how
   to write another one.
5. **The browser** draws the pool with Three.js (WebGL2). The React layer
   only draws the panels; the 60 fps path never touches React.

Three rules hold the project together:

- **The backend owns the placement.** Two open browser tabs have to agree on
  who is in which lane, so the world model (slots, lanes, queues) lives on
  the server and the frontend owns the pixels.
- **The scene is 3D only.** The old 2D pool is gone. The scene is Three.js.
- **No picture assets.** Every character is generated from code, and a
  character is a pure function of its agent id.

The decisions live in *pure* modules with no Three.js objects in them
(`world.ts`, `nav.ts`, `flow.ts`, `swim.ts`, `work.ts`, …). The rules are
decided there and the 3D side only draws what they decided, which is why
they can be tested without a browser.

## The repository

```
backend/agentpool/    the backend: the bridge, the registry, the scene, the API
frontend/src/scene/   the 3D scene (pool3d), the characters and the motion
plugin/               the Claude Code plugin: the hooks and the /agentpool command
tests/                the backend tests
docs/                 the documentation
```

## The documentation

The README is the front door; `docs/` has the depth.

- [the architecture](docs/architecture.md) — the seam, the identity, the pose model
- [the scenes](docs/scenes.md) — the scene contract, and how to write another scene
- [the lifecycle of an agent](docs/lifecycle.md) — the states, the sweeper, the reconciler
- [the hook events](docs/hook-events.md) — what the plugin sends
- [porting the bridge](docs/porting.md) — how another project reuses the half that is not the pool
- [the sprint plan](docs/next.md) — what is done and what comes next

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `AGENTPOOL_PORT` | `38000` | The port the backend listens on. |
| `AGENTPOOL_IDLE_TTL_S` | `90` | How long an idle agent is kept. |
| `AGENTPOOL_SESSION_TTL_S` | `900` | How long a silent session is kept. |
| `AGENTPOOL_EXIT_GRACE_S` | `30` | How long a closing agent may take to walk out. |
| `AGENTPOOL_CLAUDE_DIR` | `~/.claude` | Where the reconciler looks for sessions. |
| `AGENTPOOL_TOKEN` | *(none)* | A shared token the local port asks for. |
| `AGENTPOOL_NOTIFY` | `1` | Tell the desktop when a long agent is done. |
| `AGENTPOOL_JOURNAL` | `1` | Write the events to the journal. |
| `AGENTPOOL_JOURNAL_KEEP_DAYS` | `7` | How long the journal is kept. |

## The backend API

| Address | What it says |
|---|---|
| `/api/health` | Whether it is alive, and how long it has been up. |
| `/api/state` | The whole pool: every agent, its counts and the scene. |
| `/api/agents` | The agents, without the scene. |
| `/api/agents/<id>` | One agent, with its last events. |
| `/api/history` | The journal, read back: the most recent events. |
| `/api/metrics` | What the backend has done: the counters, the drops, the last error. |

## The debug hooks

The page keeps the 3D scene in `window.__agentpool`. `stats()` is always
there. `debug` is set only with `?debug` or `?demo`:

```js
const s = window.__agentpool;
s.stats();                               // { fps, calls, triangles, agents, props }
s.debug.list();                          // id, state, x, z, action, work, errand, activity, lounger, ...
s.debug.play(id, 'cheer');               // play an action once
s.debug.force(id, { work: 'edit' });     // the tool it works with; null clears
s.debug.force(id, { errand: 'towel' });  // start an errand now
s.debug.force(id, { x, z, yaw });        // move a figure
s.debug.force('weather', 'rain');        // 'clear' | 'cloudy' | 'rain'
s.debug.clock(14);                       // the hour of the day
s.debug.creature('duck');                // 'duck' | 'birds'
s.debug.look(x, z, 8);                   // point the camera at a spot
```

The full list is in `docs/next.md`.

## Licence

MIT — see [LICENSE](LICENSE).
