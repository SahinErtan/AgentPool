# The lifecycle of an agent

An agent is a row in the registry. The registry owns the truth; the scene
only decides where the agent belongs.

```
                 SessionStart                UserPromptSubmit
                      │                            │
                      ▼                            ▼
   ┌──────────▶   SPAWNED  ────────────────▶   WORKING
   │              (idle, on a lounger)          (swimming)
   │                   │                            │
   │              SessionEnd                       │ Stop
   │                   │                            ▼
   └──────────────── LEAVING  ◀───────────────  FINISHED
              (walks out through the gate)   (climbs out, takes a lounger)
```

## The states

| State | Meaning | What the character does |
|---|---|---|
| `IDLE` | The agent exists but does not work. | It lies on a lounger, or waits at the pool edge when every lounger is taken. |
| `WORKING` | The agent is doing something. | It swims in its lane. |
| `FINISHED` | The work is done. | It climbs out of the water and takes a lounger. |
| `LEAVING` | The session is closed. | It walks out through the gate, and the backend drops it. |
| `REMOVED` | The agent is gone. | The character is removed from the scene. |

## The events

The normaliser turns a hook payload into one or more events:

- `spawned` — the agent exists.
- `spawn_hint` — a description arrived before the agent id.
- `spawn_bind` — the agent id arrived; the description is joined in.
- `started` — the agent starts working.
- `finished` — the agent is done.
- `removed` — the agent leaves.
- `note` — something happened that is only worth a line in the feed.

The registry applies them in order and returns the agents that changed. Those
are the ones that are sent to the browser.

## The exit grace

A session that ends does not remove its agent right away: it becomes `LEAVING`
and gets a deadline. The character walks out through the gate and, when it
arrives, the browser sends `agent_exited` back. Only then is the agent
dropped.

The grace period covers the case where the browser is closed: the sweeper
removes the agent when the deadline passes.

## The sweeper

Every ten seconds the registry checks the agents that have not been heard from
for a while:

- an idle agent is dropped after `idle_ttl_s` (90 s by default);
- a session is dropped after `session_ttl_s` (900 s by default).

Both are configurable with `AGENTPOOL_IDLE_TTL_S` and
`AGENTPOOL_SESSION_TTL_S`.

## The reconciler

When the backend starts, it reads `~/.claude` and rebuilds the agents that are
still alive: the live sessions from `~/.claude/sessions/*.json` and the
subagents that have not finished yet. An agent that the reconciler finds is
replayed into the scene, so it gets the same lane and the same lounger it
would have had.
