# Sprint 31 — What the hooks already know

Read `README.md` in this folder first: the ground rules, the commands and
the checks apply here. This sprint is backend and frontend.

## Why

A person watching the pool wants to know one thing about an agent before
anything else: **which model is it running on**. The pool cannot say it,
although Claude Code says it in every single session's own payload — the
`SessionStart` hook carries a `model` field, and the value has been sitting
in the journal all along.

The reason is not a missing feature but a missing *step*. The bridge keeps
the whole hook payload in `raw`, and `raw` never leaves the backend: the
registry has no field for the model, so no field goes out to the browser,
so the inspector has nothing to show. The information is one field away.

### What the payloads carry today

Measured on the journal of the last days (212 `SessionStart` payloads, and
every other event type):

| Event | Fields the pool uses | Fields it throws away |
|---|---|---|
| `SessionStart` | `session_id`, `cwd`, `source`, `prompt_id` | **`model`**, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd`, `seconds_since_last_response`, `transcript_path`, `scratchpad_dir`, `agent_type` |
| `UserPromptSubmit` | `prompt`, `cwd`, `session_id` | `permission_mode`, `prompt_id`, `transcript_path` |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id`, `agent_id`, `agent_type` | `effort.level`, `permission_mode`, `mcp_server`, `prompt_id` |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_response`, `tool_use_id` | **`duration_ms`**, `effort.level`, `permission_mode`, `mcp_server` |
| `SubagentStart` | `agent_id`, `agent_type`, `cwd` | — (the payload has no model; the model is in the meta file) |
| `SubagentStop` | `agent_id`, `last_assistant_message`, `background_tasks` | `agent_transcript_path`, `effort.level`, `session_crons` |
| `Stop` | `last_assistant_message`, `background_tasks` | `effort.level`, `session_crons`, `seconds_since_last_response` |
| `SessionEnd` | `reason` | `agent_type` |
| `Notification` | `notification_type`, `message` | `prompt_id` |

And outside the hook payloads, on the disk:

| Source | Fields the pool uses | Fields it throws away |
|---|---|---|
| `~/.claude/projects/*/*/subagents/agent-*.meta.json` | `agentType`, `description`, `toolUseId`, `finished` | **`pickedEffortModel`** (the model!), `spawnDepth`, `requestShape`, `launchedWithDefaults`, `isBuiltIn` |
| `~/.claude/sessions/*.json` | `sessionId`, `cwd`, `name`, `status`, `startedAt` | `version`, `kind`, `pid`, `entrypoint` |
| `claude agents --json` | `sessionId`, `cwd`, `name`, `status` | `kind`, `pid` |
| the transcripts (`*.jsonl`) | the `Agent` tool calls | **`message.model`**, the token counts of every turn |

The model names seen in the wild on this machine: `claude-opus-5-5`,
`claude-fable-5-2`, `MiniMax-M3.1-Flash`, `qwen3.5:2b`, `qwen3.5:4b`,
`qwen3.8:27b-mtp-q4_K_M`, `gemma4:12b`. The pool must not assume that
Claude's models are the only ones: the field is a free string and is shown
as it is when it is not known.

### What must not change

- **The bridge stays scene agnostic.** A model is not pool vocabulary; the
  architecture guard (`tests/test_bridge_is_scene_agnostic.py`) still passes.
- **The wire stays backwards compatible.** Every new field is optional: a
  frontend that talks to an older backend still works, and a backend that
  talks to an older frontend sends fields nobody reads.
- **Nothing is read on the hot path.** The backend reads the disk in the
  reconciler, which already runs every 30 s; the hook path stays pure.

## The goal

1. **The inspector says which model an agent runs**, in words a person
   reads: "Opus 5.5", "MiniMax M3.1 Flash", "Qwen 3.5 2B".
2. **The model is right when it changes.** `/model` changes the model of a
   running session; the pool must follow it, not show the model the session
   started with.
3. **A subagent has a model too**, even though its hook payload has none.
4. **The facts that come free are kept**: the reasoning effort, the
   permission mode, how long the last tool took, which MCP server was
   called, how full the context is, what the session was started from.

## Steps

### 31.1 — The model on the session

- `backend/agentpool/bridge/events.py`: `AgentEvent` gets
  `model: Optional[str] = None`, next to `activity` and `description`.
- `backend/agentpool/bridge/normalizer.py`: on `SessionStart`, the event
  carries `model=raw.s("model")`. Any other payload that ever carries a
  `model` sets it too, so the normaliser does not have to be changed again
  when Claude Code adds one.
- `backend/agentpool/bridge/registry.py`: `AgentState.model`, and in
  `apply()` the model is written when the event carries one. A later event
  without a model does not clear it — an empty string is not a fact.
- `registry.py` `to_dict()`: `"model": self.model` goes into the wire.
- `backend/agentpool/store/journal.py`: `_agent_event()` restores
  `model`, or a boot loses it again and the pool starts empty-handed.

**Check:** `tests/test_normalizer.py` — a `SessionStart` payload with a
model produces an event with that model; a payload without one produces
`None`. `tests/test_registry.py` — the model survives a later event and
appears in `to_dict()`. `tests/test_journal.py` — a replay keeps it.

### 31.2 — The model of a subagent

- `backend/agentpool/bridge/sources.py` already reads `pickedEffortModel`
  into the `"model"` key of `read_subagents()`. The reconciler is what
  drops it.
- `backend/agentpool/bridge/reconcile.py`: the spawned and started events
  of a subagent carry `model=subagent.get("model")`.
- The meta file is written a moment after the subagent starts, so the
  model of a subagent arrives with the next reconciler round (30 s) or
  with the first event that carries it. The inspector shows "—" until
  then, which is honest.

**Check:** `tests/test_reconcile.py` — a subagent whose meta file names a
model gets that model; one without a meta file gets `None` and no error.

### 31.3 — The model that changed mid-session

`SessionStart` says which model the session *started* on. `/model` changes
it while the session runs, so the payload of the start is not the truth
afterwards. The truth is the transcript: the last assistant turn names the
model it was answered with.

- `backend/agentpool/bridge/transcript.py`: add
  `read_last_model(claude_dir, session_id) -> Optional[str]`. It finds the
  session transcript with the existing `find_session_transcript()`, seeks
  to the end of the file, reads the last kilobytes and returns the
  `message.model` of the last assistant entry it can parse.
- `backend/agentpool/bridge/reconcile.py`: for every live session, the
  model is refreshed from the transcript when the transcript is newer than
  what the backend knows. The reconciler's rule of "the disk never undoes
  what a hook knows" is kept: the transcript only fills in a model that is
  missing, or replaces one that the session itself changed.

**Check:** `tests/test_transcript.py` — a transcript with two assistant
turns of two models returns the last one; a transcript without a model
returns `None`; an empty file does not raise.

### 31.4 — The wire and the inspector

- `frontend/src/net/types.ts`: `model?: string | null` on `AgentView`.
- A new pure module `frontend/src/scene/model.ts`:
  `prettyModel('claude-opus-5-5')` → `Opus 5.5`,
  `prettyModel('MiniMax-M3.1-Flash')` → `MiniMax M3.1 Flash`,
  `prettyModel('claude-fable-5-2')` → `Fable 5.2`,
  `prettyModel('qwen3.8:27b-mtp-q4_K_M')` → `Qwen 3.8 27B`; an unknown
  name is returned as it is. No `Math.random()`, no exceptions: the
  frontend must never crash on a name nobody has seen.
- `frontend/src/ui/Inspector.tsx`: a `Model` row, between `Kind` and
  `Status` — it is what the person came to look at.
- `frontend/src/ui/AgentList.tsx`: nothing yet. A tag in the list and a
  colour per model family are a later, optional step.

**Check:** `frontend/test/model.test.ts` — the names above. The frontend
tests are TypeScript bundled by esbuild and run in plain Node.

### 31.5 — The other facts the payload already carries

Each of these is one field that is already in the payload, so each costs
almost nothing. They are listed in the order of what they are worth; a
later one may be left out without breaking the others.

1. **`effort.level`** (`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`):
   the reasoning effort the session runs on. Inspector row "Effort".
2. **`permission_mode`** (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
   `Stop`): "auto", "default", "plan". Inspector row "Permission".
3. **`duration_ms`** (`PostToolUse`): how long the tool took. It belongs
   to the event ring as well: a tool that took 94 s says something the
   tool's name does not.
4. **`mcp_server.name`** (`PreToolUse`, `PostToolUse`): which MCP server
   was called, when the tool is not one of the known ones. The activity
   line already says `server: tool`; this is the same fact for the
   inspector.
5. **`context_tokens`, `prompt_cache_likely_expired`,
   `estimated_cache_write_usd`** (`SessionStart` on `resume`, `compact`
   and `fork`): how full the context of the session is, and what the cache
   will cost to write again. Three inspector rows, one payload.
6. **`source`** (`SessionStart`: `startup`, `resume`, `compact`, `fork`):
   it is already the `detail` of the session; a session that was compacted
   or forked deserves to say so, because that is when its model and its
   context changed.
7. **`seconds_since_last_response`** (`SessionStart`): how long the last
   answer took.
8. **`version`** (`~/.claude/sessions/*.json`): the Claude Code version
   of the session.
9. **`spawnDepth`, `requestShape`, `launchedWithDefaults`, `isBuiltIn`**
   (the subagent meta file): how deep a subagent is, whether it runs in
   the background, and whether it runs with the defaults. The depth is
   worth showing: a subagent of a subagent is a different animal.
10. **`session_crons`** (`Stop`, `SubagentStop`): the cron jobs a session
    has.
11. **`agent_transcript_path`** (`SubagentStop`): the transcript of the
    subagent, which is where its model and its token counts are.

**The rule for all of them:** a fact the payload does not carry is not
shown as a dash. The inspector shows the rows it has and leaves the rest
out; a column of "—" is noise.

**Check:** `tests/test_normalizer.py` for each field that comes from a
payload; `tests/test_reconcile.py` for the two that come from the disk.

### 31.6 — The demo and the whole check

- `frontend/src/scene/demo/demoFeed.ts`: the demo agents get a model, so
  that `/?demo=12` shows the row too. The demo has no real model, so it
  uses a fixed set of names.
- `make test` (backend pytest + frontend node tests), `npx tsc -b`, and
  a **read-only observer agent** alongside the work: this is a UI change,
  and the observer must not edit files or touch git. It reports what it
  *saw* separately from what it *inferred*.

## What "done" means

- The inspector of a live session shows its model, in words; the model of
  a subagent appears within a reconciler round; a session whose model was
  changed with `/model` shows the new model within 30 s.
- The bridge mentions no scene vocabulary; `tests/test_bridge_is_scene_agnostic.py`
  passes.
- Every new field on the wire is optional, and an old frontend and an old
  backend still work against each other.
- The demo shows the row.
- The observer has looked at it and has not found a row of dashes where
  there should be a fact.

## Deviations

The sprint was carried out on 2026-11-18. What the plan said and what the
code does:

1. **The token counts were not in the plan the way they ended up.** The
   plan spoke of "the tokens of the last turn" and of "the tokens the
   agent has used in all". The first is the whole context of the turn
   (the fresh tokens, the ones read from the cache and the ones written
   into it); the second counts the fresh tokens, the cache writes and the
   output of every turn, and **not** the cache that is read again. The
   first version counted the cache reads in the total as well, and a
   session of half an hour said eleven million tokens, which is the same
   context counted once per turn.
2. **The token counts come from the transcript, not from the payload.**
   The payload of a session start has `context_tokens`, but only of the
   session as it was started; the transcript is the truth and it is read
   for the model anyway.
3. **The transcript is read only for the agents that are in the pool.**
   The first version read the transcript of every subagent Claude Code
   ever wrote, and the reconciler went from 0.07 s to 4.7 s. There are
   328 subagent transcripts on this machine and five agents in the pool.
4. **The reconciler runs in a thread.** It reads the disk, and a
   transcript is big: `asyncio.to_thread` keeps the event loop free.
5. **The reader remembers where it stopped.** A transcript is read once
   whole and then only the new lines, so the second round is cheap. The
   first read of a line that was cut in half is dropped.
6. **Step 31.5 was not carried out.** The other payload facts — the
   permission mode, the tool duration, the MCP server, the context size,
   the cron jobs — are not in the pool yet. They are written down here so
   they are not lost: the inventory is in the plan, and each of them is
   one field that is already in the payload.
7. **The demo agents got models, efforts and token counts** (31.6), so
   the row can be seen without a backend behind it.
8. **The label is "Tokens (last turn)" and "Tokens used"**, and neither
   row is shown when the agent has no numbers yet.
