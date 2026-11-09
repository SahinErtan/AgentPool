"""Read the session transcripts.

The transcripts are the second source of truth. The metadata file of a
subagent (``subagents/agent-<id>.meta.json``) carries most of what is
needed, but the *parent* transcript carries two things the file does not:

- the tool call of the ``Agent`` tool, with the description and the type of
  the subagent, joined to the ``tool_use_id``;
- whether that call has a result yet. A tool call without a result is a
  subagent that is still running.

So the transcript answers two questions the metadata file cannot: what the
subagent was asked to do, and whether it is still going.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

# The result of the Agent tool carries the id of the agent it produced:
# "agentId: ab4b9f627ee7c76db (internal ID - do not mention to user...)".
AGENT_ID_PATTERN = re.compile(r"""agentId["']?\s*:\s*["']?([A-Za-z0-9_-]{6,64})""")


def find_session_transcript(claude_dir: Path, session_id: str) -> Optional[Path]:
    """The transcript of a session, if it has one."""
    projects = claude_dir / "projects"
    if not projects.is_dir():
        return None
    for path in projects.glob(f"*/{session_id}.jsonl"):
        return path
    return None


def _iter_entries(path: Path):
    """Every entry of a transcript, skipping the ones that cannot be read."""
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if isinstance(entry, dict):
                    yield entry
    except OSError:
        return


def _content_blocks(entry: Dict[str, Any]):
    message = entry.get("message")
    if not isinstance(message, dict):
        return
    content = message.get("content")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict):
                yield block


def read_agent_calls(claude_dir: Path, session_id: str) -> List[Dict[str, Any]]:
    """The ``Agent`` tool calls of a session, with their result if they have one.

    Each entry holds the tool call id, the description, the type of the
    subagent and whether the call has come back.
    """
    transcript = find_session_transcript(claude_dir, session_id)
    if transcript is None:
        return []

    calls: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []

    for entry in _iter_entries(transcript):
        for block in _content_blocks(entry):
            kind = block.get("type")
            if kind == "tool_use" and block.get("name") == "Agent":
                tool_use_id = block.get("id")
                if not tool_use_id:
                    continue
                tool_input = block.get("input")
                if not isinstance(tool_input, dict):
                    tool_input = {}
                if tool_use_id not in calls:
                    order.append(tool_use_id)
                calls[tool_use_id] = {
                    "tool_use_id": tool_use_id,
                    "description": tool_input.get("description"),
                    "subagent_type": tool_input.get("subagent_type"),
                    "prompt": str(tool_input.get("prompt") or "")[:200],
                    "finished": False,
                    "agent_id": None,
                }
            elif kind == "tool_result":
                tool_use_id = block.get("tool_use_id")
                call = calls.get(tool_use_id) if tool_use_id else None
                if call is None:
                    continue
                call["finished"] = True
                content = block.get("content")
                text = content if isinstance(content, str) else json.dumps(content or "")
                match = AGENT_ID_PATTERN.search(text)
                if match:
                    call["agent_id"] = match.group(1)

    return [calls[tool_use_id] for tool_use_id in order]


def read_running_agent_calls(claude_dir: Path, session_id: str) -> List[Dict[str, Any]]:
    """The ``Agent`` tool calls of a session that have not come back yet.

    A call without a result is a subagent that is still running.
    """
    return [call for call in read_agent_calls(claude_dir, session_id) if not call["finished"]]
