"""Scene registry: resolves the scene id to an adapter."""

from __future__ import annotations

from .base import SceneAdapter
from .pool import PoolScene


def build_scene(scene_id: str) -> SceneAdapter:
    """Return the scene adapter for ``scene_id``.

    A future project registers its own scene here; nothing else in the
    backend has to change.
    """
    if scene_id == "pool":
        return PoolScene()
    if scene_id == "stadium":
        from .stadium import StadiumScene

        return StadiumScene()
    raise ValueError(f"unknown scene {scene_id!r}")
