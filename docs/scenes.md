# Scenes

A scene is the part of AgentPool that decides *where* an agent is. The rest
of the backend — the bridge, the registry, the WebSocket — knows nothing about
pools, loungers or lanes.

AgentPool has one scene: **the pool**. A stadium or an office is a different
project, and it brings its own scene. This document is the contract it has to
satisfy; `docs/porting.md` lists the files it lifts from here.

## The adapter

```python
class SceneAdapter(Protocol):
    scene_id: str

    async def on_agent_spawned(self, agent: AgentState) -> None: ...
    async def on_agent_started(self, agent: AgentState) -> None: ...
    async def on_agent_finished(self, agent: AgentState) -> None: ...
    async def on_agent_removed(self, agent_id: str) -> None: ...
    async def on_session_event(self, event: SessionEvent) -> None: ...

    def describe(self) -> dict[str, Any]: ...
    def presentation(self, agent: AgentState) -> dict[str, Any]: ...
```

- `describe()` is the scene-level payload: how many lanes, how many loungers,
  what the waypoints are called. The frontend reads it and builds the world to
  fit, so the backend stays the owner of the numbers.
- `presentation()` is the per-agent payload: the mode, the slot and the
  properties of that slot.

A scene that moves an agent on its own — when a lounger frees up and somebody
who was waiting takes it — reports it through `take_dirty()`, and the backend
pushes the change to the browser.

## The shared vocabulary

The modes and slots are the contract between the scene and the frontend. A
scene maps the agent lifecycle into these:

| Mode | Meaning |
|---|---|
| `swim` | The agent is working. |
| `lounge` | The agent is idle and has a place to sit. |
| `waiting` | The agent is idle but every place is taken. |
| `exiting` | The agent is done and is on its way out of the water. |
| `leaving` | The agent is on its way out of the scene. |
| `offscreen` | The agent is gone. |

The slots are strings the frontend resolves into pixels: `lane:2`,
`lounger:0`, `waiting:1`, plus the waypoints `gate` and `ladder`.

The `SceneState` enum in `scenes/base.py` holds the same idea in one place:
`OFFSCREEN`, `ENTERING`, `WALKING`, `RESTING`, `ACTIVE`, `EXITING`, `WAITING`.
A scene maps its own vocabulary onto these.

## The pool

The only scene in this repository.

Six loungers along the deck and four waiting spots at the pool edge. An agent
that swims goes down the ladder at the right end; an agent that leaves walks
out through the gate at the left end.

When every lounger is taken the agents wait at the edge, and when that is
full too they wait at the gate. The queue is fair: the edge goes first, the
gate afterwards, and the agent that waited the longest takes the first place
that frees up.

### Who a character is

Every character is an agent: a session, a subagent or a background task.
MCP servers are not characters; their calls are what the session that made
them is doing. Each character carries one name, chosen in this order:

| Agent | Name | When there is none |
|---|---|---|
| Session | its name in `~/.claude/sessions/` | its project (the folder it started in), then `session` and four characters of its id |
| Subagent | the description its parent gave it | its type (`Explore`) |
| Background task | its description | its name or type |

`main`, `session`, `subagent` and `task` are placeholders and never win
over a real name. Two names on the screen are never the same: the project
or the parent session is added, and what is still equal is numbered, oldest
first. The backend sends the parts (`name`, `project`, `description`,
`activity`, `prompt`, `session_name`); `frontend/src/scene/names.ts` makes
the names, because telling duplicates apart depends on who is on the screen.

The label shows the name only. The card under the pointer shows the rest:
the kind and the project, the session it belongs to, what it is doing now
(`Bash: npm test`), for how long, and a session's last prompt.

### How the pool decides what a character does

The backend only says where an agent belongs: lounging, waiting, swimming
in a lane, or leaving. The frontend decides everything else, in this order:

1. **The backend's presentation.** It decides the place, and nothing below
   it can override that.
2. **The work.** The agent's tool (`tool_name`) picks how it swims: a run
   is a fast crawl, an edit is butterfly, a read is breaststroke with dives,
   a web call is backstroke, a plan floats, a delegation treads water. A
   session that has asked for permission is **needs you**: the swimmer goes
   to the wall and raises its hand, and its label pulses amber.
3. **The way into the water.** It is the ladder, a block dive, the board,
   the slide or a cannonball. It is chosen per agent, and only from the
   entries that can be reached. With reduced motion it is always the
   ladder.
4. **Errands.** An idle agent that has sat for a while may go to the shower,
   the kiosk, the hot tub, ping-pong or a ball game, have a chat, or take a
   stroll. **An errand never hides work**: when the agent starts working or
   needs you, it drops the errand at once, and its partner is freed.
5. **Life on the lounger.** An idle agent on its lounger picks something
   to do from a small repertoire: the favourite it was born with and two
   more. The choice follows the time of day, the weather, and the agent: one
   that has just come out of the water stretches and has a drink, one idle
   for long sleeps more. Tea is drunk from a glass on the side table, and
   two neighbours may talk. The planner is `leisurePlan.ts`, and the poses
   are `motion/leisure.ts`.
6. **Moments.** A finish gets a clap and a cheer. A round number of events
   gets confetti. A session that ends at night gets fireworks over the pool.

Animals are allowed, but few: **at most four creatures at once**
(`MAX_CREATURES`). They are a cat, a visiting duck, a pair of birds and two
butterflies. At night only the sleeping cat stays. The only people in the
scene are the agents.

The pure modules hold the rules, and the tests run them without WebGL.
They are in `frontend/src/scene/pool3d/`:

| Module | What it decides |
|---|---|
| `world.ts` | Where everything stands, in metres. |
| `nav.ts` | The paths round the pool and the equipment. |
| `flow.ts` | The state machine of each character. |
| `swim.ts` | The swimmer in its lane, and the turns. |
| `work.ts` | The tool's kind, needs you, and fatigue. |
| `entries.ts` | The ways into the water. |
| `errands.ts`, `games.ts` | The errands, and the flight of the balls. |
| `creatures.ts` | The animals and their budget. |
| `moments.ts`, `director.ts` | The celebrations, and the follow and tour camera. |
| `leisurePlan.ts`, `teaTables.ts` | What an idle agent does on its lounger, and the glasses on the side tables. |

The poses are in `frontend/src/scene/motion/`, and the demo crowd (`?demo=N`)
is in `frontend/src/scene/demo/`.

## Writing your own

1. Write a class with the methods above.
2. Register it in `backend/agentpool/scenes/registry.py`, or build it in your
   own copy of the backend.
3. Write the frontend for it: a layout module and a scene module, both driven
   by the same vocabulary.

The bridge, the registry, the WebSocket protocol and the plugin stay exactly
as they are. `tests/test_bridge_is_scene_agnostic.py` checks that the bridge
never names a scene — that is the property the next project relies on.
