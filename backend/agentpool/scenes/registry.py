"""Scene registry: resolves the scene id to an adapter."""

from __future__ import annotations

from .base import SceneAdapter
from .pool import PoolScene


def build_scene(scene_id: str) -> SceneAdapter:
    """Return the scene adapter for ``scene_id``.

    AgentPool has one scene: the pool. A different project — a stadium, an
    office — brings its own scene and registers it here, or builds it in its
    own copy of the backend. The bridge never changes.
    """
    if scene_id == "pool":
        return PoolScene()
    raise ValueError(f"unknown scene {scene_id!r}")
