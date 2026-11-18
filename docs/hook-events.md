# The hook events

AgentPool listens to the Claude Code hook system. The hooks are registered by
the plugin in `plugin/agentpool/hooks/hooks.json`; every event is posted to
`http://127.0.0.1:38000/hooks/<EventName>` and the payload is the standard
hook input JSON.

## What each event does

| Event | What the backend does |
|---|---|
| `SessionStart` | A session appears. A character walks in through the gate and takes a lounger. |
| `UserPromptSubmit` | The session starts working. Its character climbs into the pool and swims. |
| `PreToolUse` | A tool is about to run. For the `Agent` tool the description is remembered, because it arrives before the agent id. |
| `PostToolUse` | The tool is done. For the `Agent` tool the result carries the `agentId`, so the subagent is created and starts swimming. For every other tool the session is marked busy, and the tool is remembered. |
| `SubagentStart` | A subagent starts. It appears in its own lane. |
| `SubagentStop` | The subagent is done. It climbs out and takes a lounger. |
| `Stop` | The session is done. Its character climbs out of the pool. |
| `SessionEnd` | The session is closed. The character walks out through the gate and disappears. |
| `Notification` | Claude Code wants attention. The agent is marked as waiting. |

## The fields that matter

- `session_id` — the identity of the session. It becomes `session:<id>`.
- `agent_id` — only present for a subagent. It becomes `sub:<id>`.
- `agent_type` — the kind of subagent, for example `Explore`.
- `cwd` — the folder the session works in.
- `prompt` — the text of the prompt, kept as the detail of the agent.
- `source` — on `SessionStart`: `startup`, `resume` or `clear`.
- `model` — on `SessionStart`: the model the session runs on. It is the
  model the session *started* on: `/model` changes it while the session
  runs, and the transcript is what says which one it runs on now.
- `effort` — on the tool calls and on `Stop`: the reasoning effort the
  agent works at, as `{"level": "medium"}`.

## The payload is not the whole truth

Two things the pool shows do not come from a hook at all:

- **The model of a running session.** The transcript of the session names
  the model of its last assistant turn, and that is the one that is
  current. The reconciler reads it every 30 seconds.
- **The model of a subagent.** Its hook payload has none; the metadata
  file next to its transcript does: `pickedEffortModel`.

The token counts come from the same place: the usage of the last
assistant turn is the context that was sent and what came out of it.

## The description arrives late

The `PreToolUse` hook for the `Agent` tool carries the *description* of the
subagent, but not its id: the id is only known once the tool call is done. The
backend keeps the description with the `tool_use_id` and joins the two when
the `PostToolUse` result arrives with `agentId`.

This is why the bridge has a `spawn_hint` and a `spawn_bind` event: the agent
is created twice, once without a name and once with it.

## Every tool, not only the Agent tool

The tool hooks used to watch the `Agent` tool alone, which meant the
inspector only ever showed the subagent spawns. They watch every tool
now, so the list of recent tool calls is the real one.

A delivery that is retried is applied once: the events are told apart by
the `tool_use_id` and the `agent_id`, which are unique for one call.

## Every hook must be harmless

The dashboard is a background thing. A hook that fails must never break the
session, so:

- the ingest endpoint always answers `200`, even for a payload it cannot
  read;
- the scripts in the plugin always exit `0`;
- a hook that cannot reach the backend simply delivers nothing.

## A note on `parent_tool_use_id`

There is no such field in a hook payload. It only exists in the Agent SDK
stream format, so the bridge does not use it.
