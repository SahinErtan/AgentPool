"""Runtime configuration for the AgentPool backend."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    """Everything the backend needs, overridable through ``AGENTPOOL_*`` env vars."""

    port: int = 38000
    host: str = "127.0.0.1"
    scene: str = "pool"
    claude_dir: Path = Path.home() / ".claude"
    state_dir: Path = Path.home() / ".local" / "state" / "agentpool"
    frontend_dist: Path = REPO_ROOT / "frontend" / "dist"
    idle_ttl_s: float = 90.0
    session_ttl_s: float = 900.0
    exit_grace_s: float = 15.0
    journal_enabled: bool = True

    @classmethod
    def from_env(cls) -> "Settings":
        defaults = cls()
        return cls(
            port=_env_int("AGENTPOOL_PORT", defaults.port),
            host=os.environ.get("AGENTPOOL_HOST", defaults.host),
            scene=os.environ.get("AGENTPOOL_SCENE", defaults.scene),
            claude_dir=Path(
                os.environ.get("AGENTPOOL_CLAUDE_DIR", str(defaults.claude_dir))
            ).expanduser(),
            state_dir=Path(
                os.environ.get("AGENTPOOL_STATE_DIR", str(defaults.state_dir))
            ).expanduser(),
            frontend_dist=Path(
                os.environ.get("AGENTPOOL_FRONTEND_DIST", str(defaults.frontend_dist))
            ).expanduser(),
            idle_ttl_s=_env_float("AGENTPOOL_IDLE_TTL_S", defaults.idle_ttl_s),
            session_ttl_s=_env_float("AGENTPOOL_SESSION_TTL_S", defaults.session_ttl_s),
            exit_grace_s=_env_float("AGENTPOOL_EXIT_GRACE_S", defaults.exit_grace_s),
            journal_enabled=_env_bool("AGENTPOOL_JOURNAL", defaults.journal_enabled),
        )
