"""The ``agentpool`` command.

Ask the running backend what the agents are doing, from a script or from a
terminal. The command speaks to the same HTTP API the dashboard uses, so
there is one answer and not two.

    agentpool                     a table of the agents
    agentpool --json              the same, machine readable
    agentpool --watch             keep printing the changes
    agentpool --agent <id>        the details of one agent

The exit code is meant to be used: 0 when the pool answered, 1 when the
backend could not be reached, 3 when the agent that was asked for is not
there.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

EXIT_OK = 0
EXIT_UNREACHABLE = 1
EXIT_UNKNOWN_AGENT = 3

DEFAULT_PORT = 38000


def _base_url(host: str, port: int) -> str:
    return f"http://{host}:{port}"


def _token() -> str:
    return os.environ.get("AGENTPOOL_TOKEN", "").strip()


def fetch(url: str, timeout: float = 3.0) -> Dict[str, Any]:
    """Ask the backend for the state. Raises on anything that is not JSON."""
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    token = _token()
    if token:
        request.add_header("X-AgentPool-Token", token)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def agent_line(agent: Dict[str, Any]) -> str:
    """One line about one agent, for a human."""
    status = agent.get("status", "?")
    # The name is what the dashboard shows; the label is what older
    # backends send, and the id is the last resort.
    label = agent.get("name") or agent.get("label") or agent.get("id", "?")
    detail = agent.get("detail") or ""
    if len(detail) > 52:
        detail = detail[:49] + "..."
    presentation = agent.get("presentation") or {}
    mode = presentation.get("mode", "")
    return f"{status:<8} {label:<22} {mode:<10} {detail}".rstrip()


def render(state: Dict[str, Any]) -> str:
    """The table of the agents."""
    agents: List[Dict[str, Any]] = list(state.get("agents") or [])
    counts = state.get("counts") or {}
    lines = [
        f"{counts.get('working', 0)} working, {counts.get('idle', 0)} idle, "
        f"{counts.get('total', len(agents))} in the pool"
    ]
    if not agents:
        lines.append("")
        lines.append("the pool is empty")
        return "\n".join(lines)
    width = max(len(agent_line(agent)) for agent in agents)
    for agent in agents:
        lines.append(agent_line(agent).ljust(width))
    return "\n".join(lines)


def render_agent(agent: Dict[str, Any]) -> str:
    """The details of one agent, for a human."""
    lines = [agent_line(agent)]
    for key in (
        "id",
        "kind",
        "session_id",
        "cwd",
        "project",
        "description",
        "activity",
        "prompt",
        "detail",
        "started_at",
        "finished_at",
    ):
        value = agent.get(key)
        if value not in (None, ""):
            lines.append(f"  {key:<12} {value}")
    events = agent.get("events") or []
    if events:
        lines.append("")
        lines.append("  the last events:")
        for event in events[-10:]:
            tool = event.get("tool_name") or ""
            lines.append(f"    {event.get('type', '?'):<12} {tool:<14} {event.get('detail') or ''}".rstrip())
    return "\n".join(lines)


def _signature(state: Dict[str, Any]) -> str:
    """A short summary of the pool, used to decide whether anything changed."""
    parts = []
    for agent in state.get("agents") or []:
        parts.append(f"{agent.get('id')}:{agent.get('status')}:{agent.get('last_event_at')}")
    return "|".join(parts)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="agentpool",
        description="Ask the AgentPool backend what the agents are doing.",
    )
    parser.add_argument("--host", default=os.environ.get("AGENTPOOL_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("AGENTPOOL_PORT", DEFAULT_PORT))
    )
    parser.add_argument("--json", action="store_true", help="machine readable output")
    parser.add_argument(
        "--watch", action="store_true", help="keep printing the pool as it changes"
    )
    parser.add_argument("--agent", default=None, help="the details of one agent")
    parser.add_argument(
        "--interval", type=float, default=2.0, help="how often --watch asks (seconds)"
    )
    args = parser.parse_args(argv)

    base = _base_url(args.host, args.port)

    if args.agent:
        url = f"{base}/api/agents/{urllib.parse.quote(args.agent, safe='')}"
        try:
            agent = fetch(url)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                print(f"there is no agent called {args.agent}", file=sys.stderr)
                return EXIT_UNKNOWN_AGENT
            print(f"the pool answered {error.code}", file=sys.stderr)
            return EXIT_UNREACHABLE
        except (OSError, json.JSONDecodeError) as error:
            print(f"the pool is not answering on {base}: {error}", file=sys.stderr)
            return EXIT_UNREACHABLE
        if args.json:
            print(json.dumps(agent, indent=2, sort_keys=True))
        else:
            print(render_agent(agent))
        return EXIT_OK

    last: Optional[str] = None
    while True:
        try:
            state = fetch(f"{base}/api/state")
        except urllib.error.HTTPError as error:
            print(f"the pool answered {error.code}", file=sys.stderr)
            return EXIT_UNREACHABLE
        except (OSError, json.JSONDecodeError) as error:
            print(f"the pool is not answering on {base}: {error}", file=sys.stderr)
            return EXIT_UNREACHABLE

        signature = _signature(state)
        if args.watch and signature == last:
            time.sleep(max(0.2, args.interval))
            continue
        last = signature

        if args.json:
            print(json.dumps(state, indent=2, sort_keys=True))
        else:
            print(render(state))
            print()

        if not args.watch:
            return EXIT_OK
        time.sleep(max(0.2, args.interval))


if __name__ == "__main__":
    raise SystemExit(main())
