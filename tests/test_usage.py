"""The transcript reader: the model and the token counts it finds."""

from __future__ import annotations

import json
from pathlib import Path

from agentpool.bridge.usage import UsageReader


def write_transcript(path: Path, entries: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for entry in entries:
            handle.write(json.dumps(entry) + "\n")


def assistant(model: str, **usage: int) -> dict:
    return {
        "type": "assistant",
        "message": {
            "role": "assistant",
            "model": model,
            "usage": {
                "input_tokens": usage.get("fresh", 0),
                "cache_read_input_tokens": usage.get("cache_read", 0),
                "cache_creation_input_tokens": usage.get("cache_write", 0),
                "output_tokens": usage.get("out", 0),
            },
        },
    }


def test_the_model_of_the_last_turn_is_found(tmp_path: Path) -> None:
    path = tmp_path / "session.jsonl"
    write_transcript(
        path,
        [
            assistant("claude-opus-5-5", fresh=10, out=5),
            assistant("claude-sonnet-5-5", fresh=20, out=7),
        ],
    )

    usage = UsageReader().read("session", path)

    assert usage is not None
    assert usage.model == "claude-sonnet-5-5"


def test_the_tokens_of_the_last_turn_are_the_whole_context(tmp_path: Path) -> None:
    path = tmp_path / "session.jsonl"
    write_transcript(path, [assistant("m", fresh=100, cache_read=900, cache_write=50, out=20)])

    usage = UsageReader().read("session", path)

    assert usage is not None
    assert usage.tokens_in == 1050
    assert usage.tokens_out == 20


def test_the_total_does_not_count_the_cache_twice(tmp_path: Path) -> None:
    path = tmp_path / "session.jsonl"
    write_transcript(
        path,
        [
            assistant("m", fresh=100, cache_read=900, out=20),
            assistant("m", fresh=100, cache_read=950, out=30),
        ],
    )

    usage = UsageReader().read("session", path)

    assert usage is not None
    # The fresh tokens and what came out, and not the cache that was read
    # again: 100 + 20 + 100 + 30.
    assert usage.tokens_total == 250


def test_only_the_new_bytes_are_read_the_second_time(tmp_path: Path) -> None:
    path = tmp_path / "session.jsonl"
    write_transcript(path, [assistant("claude-opus-5-5", fresh=10, out=5)])
    reader = UsageReader()

    first = reader.read("session", path)
    assert first is not None
    assert first.model == "claude-opus-5-5"

    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(assistant("claude-haiku-5-5", fresh=30, out=9)) + "\n")

    second = reader.read("session", path)

    assert second is not None
    assert second.model == "claude-haiku-5-5"
    assert second.tokens_in == 30
    # The first turn is still counted: the reader adds up, it does not
    # forget. 10 + 5 for the first turn, 30 + 9 for the second.
    assert second.tokens_total == 54


def test_a_transcript_that_is_written_again_starts_over(tmp_path: Path) -> None:
    path = tmp_path / "session.jsonl"
    write_transcript(path, [assistant("m", fresh=100, out=20)])
    reader = UsageReader()
    reader.read("session", path)

    # The session was compacted: the file is written again from the start.
    write_transcript(path, [assistant("m", fresh=50, out=10)])

    usage = reader.read("session", path)

    assert usage is not None
    assert usage.tokens_total == 60


def test_a_transcript_without_a_model_says_nothing(tmp_path: Path) -> None:
    path = tmp_path / "session.jsonl"
    path.write_text(json.dumps({"type": "user", "message": {"role": "user"}}) + "\n", encoding="utf-8")

    assert UsageReader().read("session", path) is None


def test_a_transcript_that_is_not_there_is_not_an_error(tmp_path: Path) -> None:
    assert UsageReader().read("session", tmp_path / "nothing.jsonl") is None
