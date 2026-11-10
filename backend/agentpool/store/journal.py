"""An append-only JSONL journal of every normalised event.

This is not a database: it exists so a session can be inspected after the
fact. The live state is always reconstructible from Claude Code's own files.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, is_dataclass
from enum import Enum
from pathlib import Path
from typing import Any, List, Optional

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
