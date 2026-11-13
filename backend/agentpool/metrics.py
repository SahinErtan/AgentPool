"""The numbers the backend keeps.

A number nobody can read is a number that does not exist. Everything the
backend drops, retries or fails at is counted here, and the counts are on
``/api/metrics`` so that a person — or another tool — can see them.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class Counters:
    """What the ingest path has done."""

    deliveries: int = 0
    accepted: int = 0
    duplicates: int = 0
    refused: int = 0
    failed: int = 0
    last_error: Optional[str] = None
    last_error_at: Optional[float] = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def delivery(self) -> None:
        with self._lock:
            self.deliveries += 1

    def accepted_events(self, count: int) -> None:
        with self._lock:
            self.accepted += count

    def duplicate_events(self, count: int) -> None:
        with self._lock:
            self.duplicates += count

    def refuse(self, reason: str) -> None:
        with self._lock:
            self.refused += 1
            self.last_error = reason
            self.last_error_at = time.time()

    def fail(self, reason: str) -> None:
        with self._lock:
            self.failed += 1
            self.last_error = reason
            self.last_error_at = time.time()

    def as_dict(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "deliveries": self.deliveries,
                "accepted": self.accepted,
                "duplicates": self.duplicates,
                "refused": self.refused,
                "failed": self.failed,
                "last_error": self.last_error,
                "last_error_at": self.last_error_at,
            }
