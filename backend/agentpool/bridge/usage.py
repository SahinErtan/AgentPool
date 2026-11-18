"""The model and the token counts of an agent, read from its transcript.

The hooks say which model a session *started* on, but ``/model`` changes
the model of a running session, and only the transcript knows it: the last
assistant turn names the model it was answered with. The same turn names
the tokens it cost.

A transcript is big — a long session reaches tens of megabytes — so it is
never read whole twice. The reader keeps the offset it has read up to and
reads only the bytes that are new. The first read is the whole file, which
is the price of knowing what a session has used.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional

#: How many transcripts the reader keeps the state of. The live sessions
#: are few, and a session that is gone is never read again.
MAX_TRACKED = 64


@dataclass(frozen=True)
class Usage:
    """What a transcript says about the agent that writes it."""

    #: The model of the last turn.
    model: Optional[str] = None
    #: The tokens the last turn sent: the context and the cache.
    tokens_in: Optional[int] = None
    #: The tokens the last turn produced.
    tokens_out: Optional[int] = None
    #: The tokens the session has used in all.
    tokens_total: Optional[int] = None


@dataclass
class _Seen:
    """What the reader knows about one transcript so far."""

    offset: int = 0
    #: Whether the file ended on a line boundary: the next read starts a
    #: line, and not in the middle of one.
    at_line_start: bool = True
    total: int = 0
    turns: int = 0
    model: Optional[str] = None
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None


def _usage_of(entry: dict) -> Optional[dict]:
    """The token counts of an assistant entry, if it has any."""
    message = entry.get("message")
    if not isinstance(message, dict):
        return None
    usage = message.get("usage")
    return usage if isinstance(usage, dict) else None


def _tokens(usage: dict) -> tuple[int, int, int]:
    """The tokens of one turn: the context, what came out, what it cost.

    The context of a turn is everything the model was given: the fresh
    tokens, the ones read from the cache and the ones written into it.

    What the turn *cost* is the fresh tokens, the ones written into the
    cache and the ones that came out. The tokens read from the cache are
    not counted again: they are the same context the turn before read, and
    counting them for every turn would say the same thing ten times.
    """
    fresh = usage.get("input_tokens")
    cache_read = usage.get("cache_read_input_tokens")
    cache_write = usage.get("cache_creation_input_tokens")
    out = usage.get("output_tokens")

    def number(value: object) -> int:
        if isinstance(value, bool) or not isinstance(value, int):
            return 0
        return value

    context = number(fresh) + number(cache_read) + number(cache_write)
    produced = number(out)
    spent = number(fresh) + number(cache_write) + produced
    return context, produced, spent


class UsageReader:
    """Reads the model and the token counts of the transcripts.

    The reader is stateful on purpose: it remembers where it stopped, so
    the second round over a transcript reads the new lines only.
    """

    def __init__(self) -> None:
        self._seen: Dict[str, _Seen] = {}

    def read(self, key: str, path: Path) -> Optional[Usage]:
        """What the transcript of ``key`` says, or None when there is none.

        The key is the identity of the transcript (a session id, a sub-agent
        id); the same key is read again on the next round.
        """
        try:
            size = path.stat().st_size
        except OSError:
            return None

        seen = self._seen.get(key)
        if seen is None:
            seen = _Seen()
            self._seen[key] = seen
            self._trim()
        elif size < seen.offset:
            # The file was replaced: the transcript is written again from
            # the beginning when a session is compacted. The counters start
            # over with it, rather than counting a file that is not there.
            seen = _Seen()
            self._seen[key] = seen

        if size > seen.offset:
            self._read_new(seen, path)

        if seen.turns == 0:
            return None
        return Usage(
            model=seen.model,
            tokens_in=seen.tokens_in,
            tokens_out=seen.tokens_out,
            tokens_total=seen.total,
        )

    def _read_new(self, seen: _Seen, path: Path) -> None:
        """Read the bytes that are new since the last round."""
        start = seen.offset
        try:
            with path.open("rb") as handle:
                handle.seek(start)
                data = handle.read()
        except OSError:
            return
        seen.offset = start + len(data)

        text = data.decode("utf-8", errors="replace")
        lines = text.split("\n")
        # The first line is only whole when the last read ended on a line
        # boundary. Otherwise it is the tail of a line that was read
        # before, and it is dropped.
        if not seen.at_line_start and lines:
            lines = lines[1:]
        seen.at_line_start = text.endswith("\n")

        for line in lines:
            line = line.strip()
            if not line or '"model"' not in line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if not isinstance(entry, dict) or entry.get("type") != "assistant":
                continue
            message = entry.get("message")
            if not isinstance(message, dict):
                continue
            model = message.get("model")
            if isinstance(model, str) and model:
                seen.model = model
                seen.turns += 1
            usage = _usage_of(entry)
            if usage is None:
                continue
            sent, produced, spent = _tokens(usage)
            seen.tokens_in = sent
            seen.tokens_out = produced
            seen.total += spent

    def _trim(self) -> None:
        """Forget the transcripts of the agents that are long gone."""
        if len(self._seen) <= MAX_TRACKED:
            return
        for key in list(self._seen)[: len(self._seen) - MAX_TRACKED]:
            del self._seen[key]


#: The reader the reconciler uses. It keeps the offsets it has read, so
#: the next round reads only what is new.
READER = UsageReader()
