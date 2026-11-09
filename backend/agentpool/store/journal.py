"""An append-only JSONL journal of every normalised event.

This is not a database: it exists so a session can be inspected after the
fact. The live state is always reconstructible from Claude Code's own files.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, is_dataclass
from enum import Enum
from pathlib import Path
from typing import Any


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
    """Appends one JSON object per line, one file per day."""

    def __init__(self, path: Path, enabled: bool = True) -> None:
        self.path = path
        self.enabled = enabled

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
