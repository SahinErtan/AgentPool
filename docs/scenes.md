# Scenes

A scene is the part of AgentPool that decides *where* an agent is. The rest
of the backend — the bridge, the registry, the WebSocket — knows nothing about
pools, benches or tracks.

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

## The two scenes

### The pool

The default. Six loungers along the deck and four waiting spots at the pool
edge. An agent that swims goes down the ladder at the right end; an agent that
leaves walks out through the gate at the left end. When every lounger is
taken the agents wait at the edge, and when that is full too they wait at the
gate.

### The stadium

`backend/agentpool/scenes/stadium.py` — the proof that the seam holds. It has
benches and a running track, its own mode names (`bench`, `run`) and its own
slot names. It shares no code with the pool beyond the adapter itself.

Run it with:

```sh
AGENTPOOL_SCENE=stadium make server
```

## Writing your own

1. Write a class with the methods above.
2. Register it in `backend/agentpool/scenes/registry.py`.
3. Write the frontend for it: a layout module and a scene module, both
   driven by the same `SceneState` vocabulary.

The bridge, the registry, the WebSocket protocol and the plugin stay exactly
as they are. `tests/test_bridge_is_scene_agnostic.py` checks that the bridge
never names a scene.
