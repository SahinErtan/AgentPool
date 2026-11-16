# Sprint 28 — Who is who

Read `README.md` in this folder first: the ground rules, the commands and
the checks apply here too, with one exception that is written below.

## Why

The person looking at the pool cannot tell from a character's name which
session it belongs to or what it is doing. Measured on 2026-11-15 against
the running backend, with two live sessions:

| What is on the screen | Where it comes from | Its name today | What is wrong |
|---|---|---|---|
| A session | `~/.claude/sessions/*.json` and the hooks | `main` | **A bug.** The reconciler reads the session's name from the disk (`pool-scene-3d-sprint`), but every hook event after that writes `label="main"` (`normalizer.py`), and `registry._upsert` takes it (`state.label = event.label or state.label`). Every session ends up called `main`. |
| A subagent | `SubagentStart`, `subagents/*.meta.json` | `general-purpose`, `Explore` | The label is the agent **type**. What tells two subagents apart — the description the parent gave, "Implement Sprint 21" — is only in `detail`, and `detail` is overwritten by the next tool note. |
| An MCP server | any `mcp__*` tool call | `plugin_playwright_playwright` | A tool is drawn as a person, which breaks the rule that the only humans are the agents. Its id is `mcp:{server}`, so every session shares one character, and whichever used it last owns it. |
| A workflow / background task | `background_tasks` on Stop, the CLI | the type or `task` | It does not say whose it is. |

And:

- **`cwd` is never filled in (a bug).** The normalizer reads it
  (`normalizer.py:69`) and never passes it on; `AgentState.cwd` is always
  `None`. The inspector's "Folder" row shows `—` for every agent, so the
  project an agent works in is lost.
- **What an agent is doing is a bare tool name** (`Bash`). The command or
  the file is not kept.
- **The label is cut at 14 characters** (`overlay.ts:53`), so
  `pool-scene-3d-sprint` becomes `pool-scene-3d…`.

## Decisions taken with the user (2026-11-15)

1. **The backend may change in this sprint.** The scene contract
   (`describe()` / `presentation()`) still does not change. New fields on
   the agent payload (`AgentState.to_dict`) are allowed; no field is
   removed or renamed.
2. **MCP servers are no longer characters.** An MCP call is something the
   session does: it shows on the session's character, as its current
   activity.
3. **The screen shows only the name.** The details come up when the
   pointer is over the character. **The name itself must tell the agents
   apart** — two characters on the screen never carry the same name.

## The naming rule

This is the heart of the sprint. Each agent has one display name, chosen
in this order, and the first one that exists wins:

| Agent | 1st | 2nd | 3rd |
|---|---|---|---|
| Session | its name on the disk (`sessions/*.json` → `name`), unless it is a placeholder | the project: the last folder of `cwd` (`AgentPool`) | `session` + the first 4 characters of the session id |
| Subagent | the description the parent gave the Agent tool (`Implement Sprint 21`) | the subagent type (`Explore`) | `subagent` |
| Workflow | its description | its name or type | `task` |

- The **placeholders** are `main`, `session`, `subagent`, `task` and the
  empty string. They never win over a real name.
- The name is tidied: whitespace is collapsed, and it is cut at a word
  boundary to **24 characters** with an ellipsis.
- **Two names on the screen are never the same.** When two agents end up
  with the same name, the rule adds the shortest thing that tells them
  apart, in this order:
  1. a session: its project (`pool-sprint · AgentPool`);
  2. a subagent: the name of its parent session (`Explore · pool-sprint`);
  3. if that is still not enough: a number in the order the agents were
     created (`Explore 2`, `Explore 3`). The oldest keeps the bare name, so
     a name does not change when a newer agent arrives.

The backend sends the parts (`name`, `project`, `description`, …); the
frontend makes the display names, because telling duplicates apart depends
on who is on the screen together.

## Steps

### 28.1 — The session keeps its name (backend)

- `AgentEvent.label` becomes `Optional[str]`, default `None`. Every hook
  event in `normalizer.py` that today writes the placeholder `"main"`
  writes `None` instead. `SessionStart` keeps `session_title` when the
  payload has one.
- `registry._upsert` takes a new label only when it is not a placeholder
  (see the naming rule), or when the agent has no label yet. A real name is
  never overwritten by a placeholder.
- Add a pure helper `is_placeholder(label)` in `bridge/registry.py`.
- A new agent created from an event with no label gets the placeholder for
  its kind, so `label` is never `None` in the payload.

**Check:** `tests/test_registry.py`:

- a session spawned by the reconciler with the name `pool-sprint`, followed
  by `UserPromptSubmit`, `PreToolUse` and `Stop` hook events, is still
  called `pool-sprint`;
- a session that only ever had hooks is called `main`, as before.

`make test-backend` passes.

### 28.2 — The project travels with the agent (backend)

- `AgentEvent` gains `cwd: Optional[str] = None`. The normalizer passes the
  payload's `cwd` on every event it makes. The reconciler passes the
  session's `cwd` for sessions and the item's `cwd` for workflows.
- `registry._upsert` stores `cwd` when the event has one.
- A subagent or workflow with no `cwd` of its own uses its parent's
  (`parent_id`), looked up when the payload is made.
- `to_dict()` gains `project`: the last folder of `cwd`, or `None`.

**Check:** tests: a hook event's `cwd` reaches `AgentState.cwd`; a
subagent with no `cwd` reports its parent session's `project`.

### 28.3 — A subagent is named by its description (backend)

- `AgentState` gains `description: Optional[str]`. It holds the task the
  agent was given, and **only** that: the Agent tool's `description`
  (from `spawn_hint` / `spawn_bind`), the `.meta.json` description, or a
  background task's `description`. Tool notes never write to it (they
  write `detail`, as today).
- `AgentState` gains `prompt: Optional[str]`: the session's last prompt
  (the first 200 characters), set by `UserPromptSubmit`. `detail` keeps
  its current meaning for compatibility.
- `to_dict()` gains `name`, made by the naming rule's first two columns
  (the backend does not tell duplicates apart):
  - session: `label` unless it is a placeholder, else `project`, else
    `session ` + the first 4 characters of the session id;
  - subagent: `description`, else `subagent_type`, else `label`;
  - workflow: `description`, else `label`.
- `cli.py` and the desktop notification (`notify_finished`) use `name`.

**Check:** tests for every row of the naming table, and for the
placeholders; a `PreToolUse` after the spawn does not change a subagent's
`description` or its `name`.

### 28.4 — What the agent is doing, in a few words (backend)

- A pure function `summarize_tool(tool_name, tool_input) -> str | None` in
  `bridge/normalizer.py`. It never returns more than 60 characters, and
  never a newline.

| Tool | Summary |
|---|---|
| `Bash` | `Bash: ` + the first line of the command |
| `Read`, `Edit`, `Write`, `NotebookEdit` | the tool + the file's name only (`Edit: overlay.ts`) |
| `Grep`, `Glob` | the tool + the pattern |
| `WebFetch` | `WebFetch: ` + the host only |
| `WebSearch` | `WebSearch: ` + the query |
| `Agent` | `Agent: ` + the description |
| `Skill` | `Skill: ` + the skill's name |
| `mcp__server__tool` | `server: tool`, with a `plugin_x_` prefix cut so it reads `playwright: browser_click` |
| anything else | the tool name |

- `AgentState` gains `activity: Optional[str]`, written by `PreToolUse`
  and kept until the next tool, the end of the turn (`Stop`) or the
  finish, which clear it.
- The summary is local: it goes to the browser on the local port and into
  the journal, the same places the prompt already goes. It is cut short so
  that a long command never lands whole.

**Check:** one test per row of the table, plus a newline in a Bash command,
a 500-character command, a missing `tool_input`, and a file path with no
folder.

### 28.5 — MCP servers are not characters any more (backend)

- The normalizer turns an `mcp__*` call into a `note` on its **session**
  (`session:{session_id}`), with `tool_name` set and `activity` from 28.4.
  It no longer makes `mcp:` agents.
- `AgentRegistry.apply` drops every event of kind `mcp`. This is the one
  place that also catches old `mcp` records replayed from the journal at
  boot.
- `AgentKind.MCP` stays in the enum, because the journal and
  `/api/history` still hold old records.
- `tests/test_normalizer.py::test_mcp_tools_become_mcp_agents` becomes
  `test_mcp_tools_belong_to_their_session`.

**Check:**

- tests: an `mcp__chrome-devtools__click` call marks its session working,
  with activity `chrome-devtools: click`; a journal replay with an old
  `mcp:` record creates no agent;
- `make test-backend` passes;
- after a restart, `curl -s http://127.0.0.1:38000/api/agents` lists no
  `mcp:` agent.

### 28.6 — The display names (frontend, pure)

- `AgentView` in `net/types.ts` gains the new optional fields: `name`,
  `project`, `description`, `prompt`, `activity`. They are optional, so an
  older backend still works: the frontend falls back to `label`.
- New pure module `frontend/src/scene/names.ts` (shared by the 3D scene and
  the panels, with no Three.js in it):
  - `displayNames(agents: AgentView[]): Map<string, string>` applies the
    naming rule, including the duplicates step, in the order the agents
    were created (`created_at`, then `id`), so that it is stable.
  - `tidyName(text: string, max = 24): string` collapses whitespace and
    cuts at a word boundary.
- Every place that shows a name uses `displayNames`: the 3D labels, the
  "go, X!" announcement, `AgentList`, the `Inspector` header and the
  history rows.
- The 2D pool keeps reading `label`. It is frozen.

**Check:** `frontend/test/names.test.ts`:

- every row of the naming table;
- two sessions both named `pool-sprint` in different projects get the
  project added;
- three `Explore` subagents with no description in one session become
  `Explore`, `Explore 2` and `Explore 3`, and the names stay the same when
  a fourth one arrives;
- a 60-character description is cut at a word, at 24 characters at most;
- **for any set of agents the names are all different** (a loop over a
  generated set of 60 agents, with deliberate collisions).

### 28.7 — The label on the screen (frontend)

- The 3D label shows the display name, up to 24 characters
  (`shortLabel` goes; `tidyName` replaces it).
- A small dot on the left of the label, in the colour of the family: a
  session's own suit, and a subagent's parent suit, the same colour as the
  family rings (`showFamilyRing`). The agents of one session read as one
  group at a glance.
- Check the label separation (`separateLabels`) with the wider labels at
  `?demo=60`: labels may hide behind each other more often, but must never
  overlap.

**Check:** browser at `?demo=24`. Every label is readable, no two labels
say the same thing, and no two overlap. Screenshot
`s28-labels.png`.

### 28.8 — The card under the pointer (frontend)

- When the pointer is over a character, a card shows next to its label. It
  is a DOM element in the overlay, the same layer as the labels:

```
pool-scene-3d-sprint                       ← the full name, uncut
session · AgentPool                        ← kind (or the subagent type) · project
in: Implement Sprint 21                    ← subagent: its description, uncut
of: pool-scene-3d-sprint                   ← subagent/workflow: its parent session
now: Bash: npm test                        ← activity, or "idle"
working for 4 min                          ← status and how long
"check how far Sprint 21 got and …"        ← session: the last prompt, two lines at most
```

  Rows with nothing in them are left out. A session that needs the person
  shows `needs you` at the top, in amber.
- The card follows the character, stays inside the window, and is one
  element that is reused, not one per agent.
- It goes away when the pointer leaves. A click still selects the agent
  and opens the inspector, as today. On a touch screen, where there is no
  hover, the inspector is the card.
- It is `aria-hidden`, like the labels: the agent list and the inspector
  are what a screen reader uses.

**Check:** browser: hover a session, a subagent and a swimmer in the far
lane; the card is next to the right character, inside the window, and
every field is right. Compare it with `/api/agents`. Screenshot
`s28-card.png`.

### 28.9 — The panels (frontend)

- `AgentList` groups the agents by session: the session's row (the family
  dot, its name, its project) and its subagents and tasks under it,
  indented. An agent whose session is not in the list goes under "Other".
- The kind filter loses "MCP servers"; `Legend` loses the MCP entry; the
  `AgentKind` type keeps `'mcp'` for old history records.
- The `Inspector` header shows the display name, and under it the kind
  and project. New rows: Project, Description, Activity, Last prompt. The
  "Folder" row now has a value.

**Check:** browser: the list matches the pool, group by group; the
inspector of a subagent shows its parent's name; `npx tsc -b` is clean.

### 28.10 — The demo crowd (frontend)

`frontend/src/scene/demo/demoFeed.ts` makes the crowd the naming rule is
written for:

- realistic session names and projects, with two sessions called
  `pool-sprint` in different projects;
- subagents with descriptions, and three `Explore` subagents with none in
  one session;
- an activity on every working agent, cycling through the tool table of
  28.4;
- no `mcp` agents.

**Check:** `?demo=24` and `?demo=60` show no duplicate names
(`window.__agentpool.debug.list()` can be checked from the console); the
demo tests still pass.

### 28.11 — Verification and docs

- With the real backend: restart it, open `/`. Every live session carries
  the name it has on the disk (`ls ~/.claude/sessions/*.json` and their
  `name` fields), the Folder row is filled in, and while a session uses
  Playwright it shows `playwright: …` and no extra character appears.
- Start a subagent from a session: its label is its description, its dot
  is its session's colour, and its card says which session it belongs to.
- The performance budget of `README.md` holds at `?demo=60&debug`. The
  hover card is DOM and costs no draw call.
- `docs/scenes.md`: a short subsection "Who a character is", with the
  naming rule.
- `docs/next.md`: the Sprint 28 entry.
- The **Deviations** list below.

## Done

- `npm test`, `npx tsc -b`, `npm run build` and `make test-backend` pass.
- No `mcp:` agent in `/api/agents`, and no MCP character in the pool.
- No two labels on the screen carry the same text, at `?demo=60` or with
  the real agents.
- Screenshots: `s28-labels.png`, `s28-card.png`, `s28-list.png` (the
  grouped agent list), `s28-real.png` (the real sessions).
- 0 errors and 0 warnings in the console.

## Deviations

### Backend

- **`to_dict()` takes an optional parent.** The parent's folder is looked up
  by `AgentRegistry.payload(state)`, which the API, the WebSocket hub and the
  ingest path now call instead of `state.to_dict()`. `AgentState.to_dict(parent)`
  is still there for callers that have no registry (the tests).
- **`cwd` in the payload is the effective folder.** A subagent or workflow
  without its own folder reports its parent's `cwd`, not `null`, so the
  Folder row and `project` agree.
- **Three fields were added to `AgentEvent`, not only to the payload:**
  `description`, `prompt` and `activity`. The journal stores them, so a
  replay after a restart keeps the names of the subagents.
- **The backend does not cut names to 24 characters.** It collapses the
  whitespace of `name` and nothing more, because 28.8 wants the full name on
  the card. The 24-character cut is the frontend's `tidyName`.
- **The MCP helper `_mcp_server` is gone**, with the MCP branch of the
  normaliser. `AgentKind.MCP` stays, and the registry drops every `mcp`
  event, so journal records from before this sprint are ignored at boot.
- **`activity` is cleared on `finished` and `removed` only.** It is not
  cleared when the next prompt starts (the plan does not say to), so a turn
  that ends without a `Stop` hook keeps its last activity until the next
  tool call.
- **The Agent tool does not set the session's `activity`.** Its `PreToolUse`
  only makes a spawn hint, so while a subagent is being started the session
  keeps the activity of the tool before it. `summarize_tool` still gives
  `Agent: <description>` for the row; nothing stores it on the session.
- **Open: a subagent's own `activity` is always `null`.** The normaliser sends
  every tool hook to the session and ignores `agent_id` on tool events, so the
  card's "now:" line will be empty for subagents until the hook payloads that
  come from inside a subagent are checked on a live run. Not verified here.
- **Session names come from the disk, then the hooks, then the project.** A
  session that has no name on the disk and only hooks has the placeholder
  `main` as its label, and its `name` is the project (or `session <id4>`
  when there is no folder either).

### Frontend

- **The context of a duplicate is only used when it splits the clash.** 28.6
  says "the shortest thing that tells them apart". A group whose members all
  have the same project or the same parent gets no context: its members are
  numbered instead (`Explore`, `Explore 2`, `Explore 3`, the example in 28.6).
  Two sessions `pool-sprint` in one project are numbered, not given the project.
- **Context and numbers fit in 24 characters.** The plan's `pool-sprint · AgentPool`
  is the result. A longer base or project is cut so the whole label stays
  within the limit, and the number is kept whole. The base keeps at least half
  of the room before the context is cut.
- **A name can gain a context when a newer agent arrives.** If a new agent
  makes a clash split (for example a fourth `Explore` in another session), the
  earlier names of that clash get the context. The "names stay the same" rule
  holds for agents that join a group without changing its context.
- **The backend's `name` is the first candidate, not the answer.** The rule is
  applied again from `label`, `project`, `description` and `subagent_type`, so
  an older backend (no `name`) gets the same names.
- **The card's title is the full name, with its context.** A duplicate's card
  says `pool-sprint · AgentPool`, where the label says the same but cut to fit.
- **The family dot is the colour the pool gives the family.** A session's dot is
  its suit; a subagent's is its parent's suit, read from the subagent's `accent`.
  The list computes the same colour with `specFor`, so the two agree.
- **The list row's second line shows the activity first.** The plan does not
  say which field the row uses. A working agent's row says `Bash: npm test`
  rather than the raw tool name; `detail` (a prompt) and the tool are the
  fallbacks.
- **The "Other" heading only shows when some session is in the list.** With a
  kind filter that hides every session, the list stays flat.
- **Touch gets no card, with no separate flag.** A touch pointer never sets
  the hovered agent (`pointermove` with no buttons does not happen on touch),
  so the card is only shown for a mouse or a pen. The inspector is the card on
  a touch screen.
- **`KindFilter` lost `'mcp'`; `AgentKind` kept it.** The filter type changed,
  because the list no longer offers it. The wire type still has `'mcp'` for
  old history records.
- **`plainText` and `cutAtWord` moved to `scene/text.ts`.** `ui/Inspector.tsx`
  re-exports them, so the panels' imports did not change. The scene needs them
  for the card and must not import a React component.
- **The demo's MCP character is gone, and its test changed.** `demo.test.ts`
  asserted an `mcp` kind; it now asserts there is none. Demo names: two
  sessions called `pool-sprint` (AgentPool and forecast), a `docs-pass` session
  whose first three subagents are `Explore` with no description, and an activity
  on every working agent.
- **Measured at `?demo=60&debug` after 20 s:** 60 fps, 277 draw calls (budget
  290), 842,740 triangles (budget 1.2 M). The card and the labels are DOM and
  add no draw call.
- **Not done here:** the real-backend check (28.11), the `docs/scenes.md`
  subsection and the `docs/next.md` entry (both in 28.11, not in the frontend
  steps), and `s28-real.png`.

### Main session

The main session checked both halves against the real backend (28.11) and
changed what the real data showed:

- **A subagent's own tool calls are its own.** A hook fired inside a
  subagent carries `agent_id` (333 of 390 `PreToolUse` events on
  2026-11-15). They are routed to `sub:{agent_id}`; before, every one of them
  marked the session as working. A tool note never creates a subagent, so a
  late `PostToolUse` cannot bring back one that was reaped.
- **The Agent tool is the session's activity** while it starts a subagent
  (`Agent: <description>`).
- **A background subagent is one character, not two.** The Stop hook lists
  it in `background_tasks` with `type: "subagent"` and the agent's own id; it
  made a `wf:` character next to the `sub:` one. Now a running one updates
  the `sub:` agent, and a finished one is ignored.
- **The project is where the session started.** The hook's `cwd` follows the
  shell's `cd`; the first folder seen is kept, and the session file on the
  disk (`source="reconcile"`) overrides it.
- **A prompt the harness put in is not the last prompt** (it starts with
  `<`, such as `<agent-message>` or `<task-notification>`).
- **`session_name` on every agent.** A session leaves the pool when its turn
  ends; its background subagents do not. The registry remembers each
  session's name, and the card's `of:` row, the duplicate rule and the list
  use it. The list groups such subagents under the session's name rather
  than "Other".
- **The card** drops the `in:` row when the title is already the
  description, and says nothing on the `now:` row for a working agent whose
  tool is not known yet, rather than "idle" over "working".
- **The session lifecycle was not changed.** That a session leaves the pool
  between turns is older than this sprint; it is noted here, not fixed.

