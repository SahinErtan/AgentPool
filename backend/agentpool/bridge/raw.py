"""Defensive access to a raw hook payload.

Claude Code adds fields between versions and the payload is not guaranteed to
contain any particular key, so nothing may assume a field exists.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


class RawHook:
    """A thin, forgiving wrapper around a hook payload."""

    def __init__(self, payload: Any) -> None:
        self.p: Dict[str, Any] = payload if isinstance(payload, dict) else {}

    def s(self, *names: str, default: Optional[str] = None) -> Optional[str]:
        """The first non-empty string among ``names``."""
        for name in names:
            value = self.p.get(name)
            if isinstance(value, str) and value:
                return value
        return default

    def o(self, *names: str, default: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """The first dictionary among ``names``."""
        for name in names:
            value = self.p.get(name)
            if isinstance(value, dict):
                return value
        return default

    def b(self, *names: str, default: bool = False) -> bool:
        """True if any of ``names`` holds a truthy value."""
        for name in names:
            value = self.p.get(name)
            if value:
                return True
        return default

    def i(self, *names: str, default: Optional[int] = None) -> Optional[int]:
        """The first integer among ``names``."""
        for name in names:
            value = self.p.get(name)
            if isinstance(value, bool):
                continue
            if isinstance(value, int):
                return value
            if isinstance(value, float):
                return int(value)
        return default

    def lst(self, *names: str) -> List[Any]:
        """The first list among ``names``."""
        for name in names:
            value = self.p.get(name)
            if isinstance(value, list):
                return value
        return []

    @property
    def event(self) -> str:
        return self.s("hook_event_name", default="") or ""
