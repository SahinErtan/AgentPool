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
| `PreToolUse` (the `Agent` tool) | A subagent is about to start. The description is remembered, because it arrives before the agent id. |
| `PostToolUse` (the `Agent` tool) | The agent result carries the `agentId`. The subagent is created and starts swimming. |
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

## The description arrives late

The `PreToolUse` hook for the `Agent` tool carries the *description* of the
subagent, but not its id: the id is only known once the tool call is done. The
backend keeps the description with the `tool_use_id` and joins the two when
the `PostToolUse` result arrives with `agentId`.

This is why the bridge has a `spawn_hint` and a `spawn_bind` event: the agent
is created twice, once without a name and once with it.

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
