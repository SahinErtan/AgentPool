"""The transcript reader: the second source of truth."""

from __future__ import annotations

import json
from pathlib import Path

from agentpool.bridge.transcript import (
    read_agent_calls,
    read_running_agent_calls,
)


def write_transcript(claude_dir: Path, session_id: str, entries: list[dict]) -> Path:
    directory = claude_dir / "projects" / "tmp-project"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{session_id}.jsonl"
    path.write_text(
        "\n".join(json.dumps(entry) for entry in entries),
        encoding="utf-8",
    )
    return path


def tool_use(tool_use_id: str, description: str, agent_type: str) -> dict:
    return {
        "type": "assistant",
        "message": {
            "content": [
                {
                    "type": "tool_use",
                    "id": tool_use_id,
                    "name": "Agent",
                    "input": {
                        "description": description,
                        "subagent_type": agent_type,
                        "prompt": "do the thing",
                    },
                }
            ]
        },
    }


def tool_result(tool_use_id: str, agent_id: str) -> dict:
    return {
        "type": "user",
        "message": {
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    # The real shape of the result Claude Code writes.
                    "content": f"agentId: {agent_id} (internal ID - do not mention)",
                }
            ]
        },
    }


def test_a_call_without_a_result_is_still_running(tmp_path: Path) -> None:
    write_transcript(tmp_path, "s1", [tool_use("call_1", "look around", "Explore")])

    calls = read_agent_calls(tmp_path, "s1")
    assert len(calls) == 1
    assert calls[0]["finished"] is False
    assert calls[0]["description"] == "look around"
    assert calls[0]["subagent_type"] == "Explore"

    running = read_running_agent_calls(tmp_path, "s1")
    assert len(running) == 1


def test_a_call_with_a_result_is_finished(tmp_path: Path) -> None:
    write_transcript(
        tmp_path,
        "s1",
        [tool_use("call_1", "look around", "Explore"), tool_result("call_1", "abc123def456")],
    )

    calls = read_agent_calls(tmp_path, "s1")
    assert calls[0]["finished"] is True
    assert calls[0]["agent_id"] == "abc123def456"
    assert read_running_agent_calls(tmp_path, "s1") == []


def test_the_order_of_the_calls_is_kept(tmp_path: Path) -> None:
    write_transcript(
        tmp_path,
        "s1",
        [
            tool_use("call_1", "first", "Explore"),
            tool_use("call_2", "second", "Plan"),
            tool_result("call_1", "aaa111"),
        ],
    )

    calls = read_agent_calls(tmp_path, "s1")
    assert [call["description"] for call in calls] == ["first", "second"]


def test_a_session_without_a_transcript_is_not_an_error(tmp_path: Path) -> None:
    assert read_agent_calls(tmp_path, "nothing") == []
    assert read_running_agent_calls(tmp_path, "nothing") == []


def test_a_broken_line_is_skipped(tmp_path: Path) -> None:
    directory = tmp_path / "projects" / "tmp-project"
    directory.mkdir(parents=True)
    path = directory / "s1.jsonl"
    path.write_text(
        json.dumps(tool_use("call_1", "look around", "Explore")) + "\nnot json at all\n",
        encoding="utf-8",
    )

    calls = read_agent_calls(tmp_path, "s1")
    assert len(calls) == 1
