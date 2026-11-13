---
description: Ask the pool what the agents are doing
allowed-tools: ["Bash(curl:*)"]
---

The AgentPool backend answers on http://127.0.0.1:38000.

Read the state of the pool:

```sh
curl -s http://127.0.0.1:38000/api/state
```

The answer holds the scene, the counts (`working`, `idle`, `total`) and one
entry per agent: its `label`, its `kind` (session, subagent, mcp, workflow),
its `status`, the `detail` it was given and the last events it had.

If something looks wrong with the pool itself — a character in a strange
place, a dashboard that does not move — read the counters as well:

```sh
curl -s http://127.0.0.1:38000/api/metrics
```

It says how many deliveries arrived, how many were refused, how many
events the broker had to drop and what the last error was.

The same answer comes from the command line, if the project is checked out:

```sh
make agentpool ARGS="--json"
```

Tell me, in a few lines:

- how many agents are working and how many are idle
- what each working agent is doing — its label, its kind, and the last tool
  it used
- anything that looks off: an agent that has been working for a long time,
  one that is waiting without a place, one that is stuck, an agent that
  finished but never left

If the curl answers nothing, the backend is not running: say that the pool is
down and that `make server` in the AgentPool project starts it. The
dashboard itself is at http://127.0.0.1:38000.
