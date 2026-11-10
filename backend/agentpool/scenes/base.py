"""The scene adapter: the seam that makes the bridge reusable.

A scene translates the generic agent lifecycle into *scene state* and decides
*where in the scene* each agent belongs. The pool is the scene here; another
project — a stadium, an office — implements this protocol and lifts the
bridge unchanged. See ``docs/porting.md``.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from ..bridge.events import AgentStatus, SessionEvent
from ..bridge.registry import AgentState


class SceneState(str, Enum):
    """The generic scene vocabulary every scene maps into."""

    OFFSCREEN = "offscreen"  # not in the scene yet
    ENTERING = "entering"  # walking in through the entrance
    WALKING = "walking"  # moving around the scene
    RESTING = "resting"  # the agent has a place to sit
    ACTIVE = "active"  # the agent is doing its work
    EXITING = "exiting"  # leaving the scene
    WAITING = "waiting"  # blocked, needs input


@runtime_checkable
class SceneAdapter(Protocol):
    """What a scene has to provide."""

    scene_id: str

    async def on_agent_spawned(self, agent: AgentState) -> None: ...

    async def on_agent_started(self, agent: AgentState) -> None: ...

    async def on_agent_finished(self, agent: AgentState) -> None: ...

    async def on_agent_removed(self, agent_id: str) -> None: ...

    async def on_session_event(self, event: SessionEvent) -> None: ...

    def knows(self, agent_id: str) -> bool:
        """Whether the scene has already placed this agent.

        A reconcile uses it to tell a new agent from one it already knows, so
        a running agent is never put back on its route.
        """

    def describe(self) -> Dict[str, Any]:
        """Scene-level payload for the browser (slots, palette, counts)."""

    def presentation(self, agent: AgentState) -> Dict[str, Any]:
        """Per-agent scene data: the mode, the slot and its properties."""


async def replay_scene(scene: SceneAdapter, state: AgentState) -> None:
    """Let a scene catch up with an agent it has not seen before.

    The reconciler rebuilds the registry from disk, so the scene never saw
    the lifecycle events. Replaying the right sequence gives it the same
    lanes and loungers it would have assigned itself.
    """
    if state.status is AgentStatus.LEAVING:
        # The character is already on its way out: there is nothing to
        # place, only something to clean up.
        await scene.on_agent_removed(state.id)
        return
    await scene.on_agent_spawned(state)
    if state.status is AgentStatus.WORKING:
        await scene.on_agent_started(state)
    elif state.status is AgentStatus.FINISHED:
        await scene.on_agent_finished(state)


async def update_scene(scene: SceneAdapter, state: AgentState) -> None:
    """Tell a scene that already knows the agent about a change.

    The reconciler uses it for the agents the scene has placed already: a
    known agent is never spawned twice, it is only moved. An agent that
    finished gives its lane back and goes to a lounger, an agent that is
    leaving gives everything back and is forgotten.
    """
    if state.status is AgentStatus.WORKING:
        await scene.on_agent_started(state)
    elif state.status in (AgentStatus.IDLE, AgentStatus.FINISHED):
        await scene.on_agent_finished(state)
    elif state.status is AgentStatus.LEAVING:
        await scene.on_agent_removed(state.id)
