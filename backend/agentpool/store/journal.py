"""An append-only JSONL journal of every normalised event.

This is not a database: it exists so a session can be inspected after the
fact. The live state is always reconstructible from Claude Code's own files.

The journal is also read back: at boot the events are replayed into the
registry, so the pool remembers the agents of the session that came before,
and the recent events are served through the API.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, is_dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..bridge.events import AgentEvent, AgentKind, AgentStatus

# The journal files are named after the day they belong to.
FILE_PATTERN = re.compile(r"^events-(\d{4}-\d{2}-\d{2})\.jsonl$")


def _encode(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, dict):
        return {key: _encode(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_encode(item) for item in value]
    return value


def _agent_event(payload: Dict[str, Any]) -> Optional[AgentEvent]:
    """Rebuild the agent event a journal line describes.

    A line that is not an agent event — a session event, say — or that
    does not hold a known kind or status is not an event this can be
    replayed from, and is dropped.
    """
    if "agent_id" not in payload:
        return None
    try:
        return AgentEvent(
            event_id=str(payload.get("event_id", "")),
            ts=float(payload.get("ts", 0.0)),
            type=str(payload.get("type", "")),
            agent_id=str(payload["agent_id"]),
            kind=AgentKind(str(payload.get("kind", AgentKind.SUBAGENT.value))),
            session_id=payload.get("session_id"),
            parent_id=payload.get("parent_id"),
            status=AgentStatus(str(payload.get("status", AgentStatus.IDLE.value))),
            label=str(payload.get("label", "")),
            detail=payload.get("detail"),
            tool_name=payload.get("tool_name"),
            tool_use_id=payload.get("tool_use_id"),
            subagent_type=payload.get("subagent_type"),
            source=str(payload.get("source", "hook")),
            raw=payload.get("raw") or {},
        )
    except (TypeError, ValueError):
        return None


def _restore_times(state, event: AgentEvent, before) -> None:
    """Put the journal's own timestamps back on a restored agent.

    The registry stamps the agents with the time it applied the event,
    which during a replay is the time of the boot. The journal knows
    better when things really happened.
    """
    if before is None:
        state.created_at = event.ts
    state.last_event_at = event.ts

    if (before is None or before.started_at is None) and state.started_at is not None:
        state.started_at = event.ts
    if event.type == "finished":
        state.finished_at = event.ts
    if state.last_events:
        state.last_events[-1]["ts"] = event.ts


class Journal:
    """Appends one JSON object per line, one file per day.

    The journal is kept for a while and then thrown away: it is there so a
    session can be inspected after the fact, not to be an archive that grows
    for ever.
    """

    def __init__(self, path: Path, enabled: bool = True, keep_days: int = 7) -> None:
        self.path = path
        self.enabled = enabled
        self.keep_days = keep_days

    def _file_for(self, when: float) -> Path:
        day = time.strftime("%Y-%m-%d", time.localtime(when))
        return self.path / f"events-{day}.jsonl"

    def append(self, event: Any) -> None:
        if not self.enabled:
            return
        try:
            target = self._file_for(time.time())
            target.parent.mkdir(parents=True, exist_ok=True)
            line = json.dumps(_encode(event), ensure_ascii=False)
            with target.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        except Exception:  # the journal must never break the ingest path
            return

    # -- reading back -------------------------------------------------

    def _journal_files(self) -> List[Path]:
        """The journal files, the most recent one first.

        The files are named after the day they belong to, so the name
        order is the time order.
        """
        try:
            files = [
                file
                for file in self.path.glob("events-*.jsonl")
                if FILE_PATTERN.match(file.name)
            ]
        except OSError:
            return []
        return sorted(files, reverse=True)

    def _records(self, file: Path, newest_first: bool = False) -> List[Dict[str, Any]]:
        """The events of one journal file.

        A line that is not a whole JSON object is skipped: a file whose
        last line was cut in half by a crash must not break the reading
        of the lines before it.
        """
        try:
            text = file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return []

        records: List[Dict[str, Any]] = []
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except ValueError:
                continue
            if isinstance(payload, dict):
                records.append(payload)

        if newest_first:
            records.reverse()
        return records

    def recent(
        self, limit: int = 100, agent_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """The most recent events, newest first.

        The events are returned as they were written, so the caller sees
        the journal and not the state it describes. An agent id filters
        the list down to the events of that one agent.
        """
        if limit <= 0:
            return []

        out: List[Dict[str, Any]] = []
        for file in self._journal_files():
            for record in self._records(file, newest_first=True):
                if agent_id is not None and record.get("agent_id") != agent_id:
                    continue
                out.append(record)
                if len(out) >= limit:
                    return out
        return out

    async def replay_into(self, registry) -> int:
        """Read the journal back and restore the agents it describes.

        The events are applied in the order they were written, oldest
        first, so the registry ends up in the state the live ingest path
        would have left it in. The timestamps are the ones from the
        journal and not the time of the boot: an agent that finished ten
        minutes ago must still look like it finished ten minutes ago.

        Returns how many agents were restored.
        """
        if not self.enabled:
            return 0

        restored = set()
        for record in self._records_chronological():
            event = _agent_event(record)
            if event is None:
                continue
            try:
                before = registry.get(event.agent_id)
                registry.apply(event)
                state = registry.get(event.agent_id)
            except Exception:
                # One broken event must not stop the replay of the rest.
                continue
            if state is None:
                continue
            _restore_times(state, event, before)
            restored.add(event.agent_id)
        return len(restored)

    def _records_chronological(self) -> List[Dict[str, Any]]:
        """Every event of the journal, oldest first."""
        out: List[Dict[str, Any]] = []
        for file in reversed(self._journal_files()):
            out.extend(self._records(file))
        return out

    def prune(self, now: Optional[float] = None) -> List[Path]:
        """Delete the journal files that are older than the retention.

        The days are compared as dates, not as timestamps: a file belongs to
        the day it was written on, and it is kept for that whole day. A file
        that is not named after a day is left alone — it is not ours to
        delete.
        """
        if not self.enabled or self.keep_days <= 0:
            return []

        when = time.time() if now is None else now
        cutoff = time.strftime("%Y-%m-%d", time.localtime(when - self.keep_days * 86400))

        try:
            files = sorted(self.path.glob("events-*.jsonl"))
        except OSError:
            return []

        removed: List[Path] = []
        for file in files:
            match = FILE_PATTERN.match(file.name)
            if match is None:
                continue
            if match.group(1) >= cutoff:
                continue
            try:
                file.unlink()
            except OSError:
                continue
            removed.append(file)
        return removed
