"""The pool scene.

The scene owns the world model: which lane a swimmer is in, which lounger a
resting agent occupies, and which route it follows to get there. The frontend
turns that into pixels.

Every character enters and leaves through the same gate, so the pool reads as
a place rather than a diagram.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..bridge.events import AgentStatus, SessionEvent
from ..bridge.registry import AgentState

LANES = 4
LOUNGERS = 6
# When every lounger is taken, the agent waits at the pool edge instead of
# standing on somebody's feet.
WAITING = 4

# The semantic waypoints the frontend resolves into pixels.
GATE = "gate"
LADDER = "ladder"


class PoolScene:
    """Assigns lanes, loungers and routes to the agents."""

    scene_id = "pool"

    def __init__(self) -> None:
        self._lane_of: Dict[str, int] = {}
        self._lane_occupant: Dict[int, str] = {}
        self._lounger_of: Dict[str, int] = {}
        self._lounger_occupant: Dict[int, str] = {}
        self._route_of: Dict[str, Dict[str, Any]] = {}
        self._waiting_of: Dict[str, int] = {}
        self._waiting_occupant: Dict[int, str] = {}
        # The agents that have neither a lounger nor a waiting spot. They
        # stand at the gate until a place frees up.
        self._overflow: List[str] = []
        # Every agent the scene has ever placed. A reconcile uses it to know
        # which agents are new.
        self._known: set[str] = set()
        # The agents whose presentation changed without a lifecycle event.
        self._dirty: set[str] = set()

    # -- lifecycle ----------------------------------------------------

    async def on_agent_spawned(self, agent: AgentState) -> None:
        self._known.add(agent.id)
        if agent.status is AgentStatus.WORKING:
            self._assign_route(agent, from_point=GATE, to_point=LADDER, route="walk")
        else:
            lounger = self._take_lounger(agent.id)
            if lounger is None:
                self._send_to_waiting(agent)
            else:
                self._assign_route(
                    agent, from_point=GATE, to_point=f"lounger:{lounger}", route="walk"
                )

    async def on_agent_started(self, agent: AgentState) -> None:
        self._release_lounger(agent.id)
        self._release_waiting(agent.id)
        lane = self._take_lane(agent.id)
        self._assign_route(agent, from_point=LADDER, to_point=LADDER, route="descend")
        self._lane_of[agent.id] = lane

    async def on_agent_finished(self, agent: AgentState) -> None:
        self._release_lane(agent.id)
        lounger = self._take_lounger(agent.id)
        if lounger is None:
            self._send_to_waiting(agent)
        else:
            self._assign_route(
                agent, from_point=LADDER, to_point=f"lounger:{lounger}", route="ascend"
            )

    async def on_agent_removed(self, agent_id: str) -> None:
        self._release_lane(agent_id)
        self._release_lounger(agent_id)
        self._release_waiting(agent_id)
        self._route_of.pop(agent_id, None)

    async def on_session_event(self, event: SessionEvent) -> None:
        return None

    # -- slots --------------------------------------------------------

    def _take_lane(self, agent_id: str) -> int:
        current = self._lane_of.get(agent_id)
        if current is not None and self._lane_occupant.get(current) == agent_id:
            return current
        for lane in range(LANES):
            if lane not in self._lane_occupant:
                self._lane_occupant[lane] = agent_id
                self._lane_of[agent_id] = lane
                return lane
        # Every lane is busy: share the least crowded one.
        lane = min(range(LANES), key=lambda index: 1)
        self._lane_of[agent_id] = lane
        return lane

    def _release_lane(self, agent_id: str) -> None:
        lane = self._lane_of.pop(agent_id, None)
        if lane is not None and self._lane_occupant.get(lane) == agent_id:
            del self._lane_occupant[lane]

    def _take_lounger(self, agent_id: str) -> Optional[int]:
        current = self._lounger_of.get(agent_id)
        if current is not None and self._lounger_occupant.get(current) == agent_id:
            return current
        for lounger in range(LOUNGERS):
            if lounger not in self._lounger_occupant:
                self._lounger_occupant[lounger] = agent_id
                self._lounger_of[agent_id] = lounger
                return lounger
        return None

    def _release_lounger(self, agent_id: str) -> None:
        lounger = self._lounger_of.pop(agent_id, None)
        if lounger is not None and self._lounger_occupant.get(lounger) == agent_id:
            del self._lounger_occupant[lounger]
            self._promote_waiting()

    def _send_to_waiting(self, agent: AgentState) -> None:
        """There is no free lounger, so the agent waits at the pool edge."""
        slot = self._take_waiting(agent.id)
        if slot is None:
            # Even the pool edge is full: the agent waits at the gate, in the
            # queue for the first place that frees up.
            if agent.id not in self._overflow:
                self._overflow.append(agent.id)
            self._assign_route(agent, from_point=GATE, to_point=GATE, route="wait")
            return
        self._assign_route(
            agent, from_point=GATE, to_point=f"waiting:{slot}", route="walk"
        )

    def _take_waiting(self, agent_id: str) -> Optional[int]:
        current = self._waiting_of.get(agent_id)
        if current is not None and self._waiting_occupant.get(current) == agent_id:
            return current
        for slot in range(WAITING):
            if slot not in self._waiting_occupant:
                self._waiting_occupant[slot] = agent_id
                self._waiting_of[agent_id] = slot
                return slot
        return None

    def _release_waiting(self, agent_id: str) -> None:
        slot = self._waiting_of.pop(agent_id, None)
        if slot is not None and self._waiting_occupant.get(slot) == agent_id:
            del self._waiting_occupant[slot]
        if agent_id in self._overflow:
            self._overflow.remove(agent_id)

    def _promote_waiting(self) -> None:
        """A lounger became free: the agent that waited the longest takes it.

        The agents at the pool edge go first; the ones that wait at the gate
        take what is left.
        """
        agent_id = self._next_in_queue()
        if agent_id is None:
            return
        lounger = self._take_lounger(agent_id)
        if lounger is None:
            return
        self._release_waiting(agent_id)
        self._route_of[agent_id] = {
            "from": GATE,
            "to": f"lounger:{lounger}",
            "route": "walk",
        }
        self._dirty.add(agent_id)

    def _next_in_queue(self) -> Optional[str]:
        if self._waiting_occupant:
            return self._waiting_occupant[min(self._waiting_occupant)]
        if self._overflow:
            return self._overflow[0]
        return None

    def knows(self, agent_id: str) -> bool:
        """Whether the scene has already placed this agent."""
        return agent_id in self._known

    def take_dirty(self) -> List[str]:
        """The agents whose presentation changed without a lifecycle event."""
        dirty = sorted(self._dirty)
        self._dirty.clear()
        return dirty

    def _assign_route(
        self,
        agent: AgentState,
        *,
        from_point: str,
        to_point: str,
        route: str,
    ) -> None:
        self._route_of[agent.id] = {"from": from_point, "to": to_point, "route": route}

    # -- presentation -------------------------------------------------

    def describe(self) -> Dict[str, Any]:
        return {
            "scene": self.scene_id,
            "lanes": LANES,
            "loungers": LOUNGERS,
            "waiting": WAITING,
            "gate": GATE,
            "ladder": LADDER,
        }

    def presentation(self, agent: AgentState) -> Dict[str, Any]:
        lane = self._lane_of.get(agent.id)
        lounger = self._lounger_of.get(agent.id)
        waiting = self._waiting_of.get(agent.id)
        route = self._route_of.get(agent.id, {})

        status = agent.status
        if status is AgentStatus.WORKING:
            mode = "swim"
        elif status is AgentStatus.FINISHED:
            mode = "exiting"
        elif status is AgentStatus.LEAVING:
            mode = "leaving"
        elif status is AgentStatus.REMOVED:
            mode = "offscreen"
        elif lounger is None:
            # No lounger: the agent waits, either at the pool edge or, when
            # that is full too, at the gate.
            mode = "waiting"
        else:
            mode = "lounge"

        props: Dict[str, Any] = {
            "lane": lane,
            "lane_offset": 0.0 if lane is None else (0.18 if lane % 2 else -0.18),
            "direction": 1 if (lane or 0) % 2 == 0 else -1,
            "speed_scale": 1.0,
            "lounger": lounger,
            "waiting": waiting,
            "queue": self._overflow.index(agent.id) if agent.id in self._overflow else 0,
            "route": route.get("route"),
            "from": route.get("from"),
            "to": route.get("to"),
        }

        slot = None
        if mode == "swim" and lane is not None:
            slot = f"lane:{lane}"
        elif mode == "lounge" and lounger is not None:
            slot = f"lounger:{lounger}"
        elif mode == "waiting" and waiting is not None:
            slot = f"waiting:{waiting}"

        return {"mode": mode, "slot": slot, "props": props}
