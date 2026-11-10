"""Telling the user that something finished.

The pool is a window on a desk. When it is not the thing you are looking
at, a quiet pool is no use at all: the agent finishes, the character climbs
out, and nobody notices.

This module sends the operating system's own notification. It is
deliberately small and it never raises: a notification that fails is not
worth breaking a session over.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from typing import Optional

# The shortest run that is worth telling somebody about.
MIN_SECONDS = 30.0


def _command(title: str, message: str) -> Optional[list]:
    """The command that shows the notification, for this operating system."""
    system = platform.system()
    if system == "Darwin":
        if not shutil.which("osascript"):
            return None
        script = f'display notification {message!r} with title {title!r}'
        return ["osascript", "-e", script]
    if system == "Linux":
        if not shutil.which("notify-send"):
            return None
        return ["notify-send", title, message]
    return None


def notify(title: str, message: str) -> bool:
    """Show a notification. Returns whether it was shown."""
    if os.environ.get("AGENTPOOL_NOTIFY", "1").strip().lower() in {"0", "false", "no"}:
        return False
    command = _command(title, message)
    if command is None:
        return False
    try:
        subprocess.run(
            command,
            check=False,
            timeout=5,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return True


def notify_finished(label: str, seconds: float, title: str = "AgentPool") -> bool:
    """Tell the user that an agent finished, if it took long enough."""
    if seconds < MIN_SECONDS:
        return False
    minutes = int(seconds // 60)
    if minutes < 1:
        how_long = f"{int(seconds)} seconds"
    else:
        how_long = f"{minutes} minute{'s' if minutes != 1 else ''}"
    return notify(title, f"{label} is done — it took {how_long}.")
