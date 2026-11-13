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
# The pool has a minimum of six loungers and grows with the crowd, so that
# a busy afternoon does not turn into a queue at the gate.
MIN_LOUNGERS = 6
MAX_LOUNGERS = 12
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
        # The swimmers of every lane. A lane can hold more than one of them.
        self._lane_occupants: Dict[int, List[str]] = {}
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
        # How many loungers the pool has right now.
        self._lounger_count = MIN_LOUNGERS

    # -- lifecycle ----------------------------------------------------

    async def on_agent_spawned(self, agent: AgentState) -> None:
        self._known.add(agent.id)
        # The pool grows before the agent is placed, so that it finds a
        # lounger of its own instead of waiting at the edge.
        self._resize_loungers(extra=1)
        if agent.status is AgentStatus.WORKING:
            self._assign_route(agent.id, from_point=GATE, to_point=LADDER, route="walk")
        else:
            lounger = self._take_lounger(agent.id)
            if lounger is None:
                self._send_to_waiting(agent.id)
            else:
                self._assign_route(
                    agent.id, from_point=GATE, to_point=f"lounger:{lounger}", route="walk"
                )
        self._resize_loungers()

    async def on_agent_started(self, agent: AgentState) -> None:
        self._release_lounger(agent.id)
        self._release_waiting(agent.id)
        lane = self._take_lane(agent.id)
        self._assign_route(agent.id, from_point=LADDER, to_point=LADDER, route="descend")
        # The agent is in the water now, so the pool can be smaller.
        self._resize_loungers()

    async def on_agent_finished(self, agent: AgentState) -> None:
        # The agent comes out of the water and wants a lounger of its own.
        self._resize_loungers(extra=1)
        self._release_lane(agent.id)
        lounger = self._take_lounger(agent.id)
        if lounger is None:
            self._send_to_waiting(agent.id)
        else:
            self._assign_route(
                agent.id, from_point=LADDER, to_point=f"lounger:{lounger}", route="ascend"
            )
        self._resize_loungers()

    async def on_agent_removed(self, agent_id: str) -> None:
        self._release_lane(agent_id)
        self._release_lounger(agent_id)
        self._release_waiting(agent_id)
        self._route_of.pop(agent_id, None)
        # The agent is gone: the scene forgets it, so a reconcile does not
        # mistake it for somebody it has never seen.
        self._known.discard(agent_id)
        self._dirty.discard(agent_id)
        # One less agent: the pool can be smaller again.
        self._resize_loungers()

    async def on_session_event(self, event: SessionEvent) -> None:
        return None

    # -- slots --------------------------------------------------------

    def _take_lane(self, agent_id: str) -> int:
        """The lane the agent swims in.

        A lane holds more than one swimmer when the crowd is bigger than the
        pool, so the lane keeps the *list* of its swimmers and not the name
        of one of them. When it kept a single name, the lane was given away
        as soon as that one swimmer left, and two agents ended up swimming
        in a lane that only one of them was in.
        """
        current = self._lane_of.get(agent_id)
        if current is not None and agent_id in self._lane_occupants.get(current, []):
            return current
        free = [index for index in range(LANES) if not self._lane_occupants.get(index)]
        if free:
            # A lane of its own: the first swimmer takes the first lane.
            lane = free[0]
        else:
            # Every lane is busy: share the emptiest one. The tie goes to
            # the last lane, so that the swimmers pile up from the far end
            # instead of all in the first one.
            counts = {
                index: len(self._lane_occupants.get(index, [])) for index in range(LANES)
            }
            fewest = min(counts.values())
            lane = max(index for index, count in counts.items() if count == fewest)
        self._lane_occupants.setdefault(lane, []).append(agent_id)
        self._lane_of[agent_id] = lane
        return lane

    def _release_lane(self, agent_id: str) -> None:
        lane = self._lane_of.pop(agent_id, None)
        if lane is None:
            return
        occupants = self._lane_occupants.get(lane)
        if occupants is None:
            return
        if agent_id in occupants:
            occupants.remove(agent_id)
        if not occupants:
            del self._lane_occupants[lane]
        # A lane is empty now, so nobody has to swim in a crowded one.
        self._balance_lanes()

    def _balance_lanes(self) -> None:
        """Nobody swims in a crowded lane while another one stands empty.

        The swimmers that share a lane are moved into the empty ones, the
        one that came last first. Without this the pool keeps the shape of
        the crowd it had ten minutes ago: a lane with three swimmers next to
        a lane that nobody uses.
        """
        empty = [index for index in range(LANES) if not self._lane_occupants.get(index)]
        if not empty:
            return
        for lane in range(LANES):
            if not empty:
                return
            occupants = self._lane_occupants.get(lane)
            if not occupants or len(occupants) < 2:
                continue
            # The swimmer that came last moves to the empty lane.
            mover = occupants.pop()
            target = empty.pop(0)
            self._lane_occupants.setdefault(target, []).append(mover)
            self._lane_of[mover] = target
            self._dirty.add(mover)

    def _take_lounger(self, agent_id: str) -> Optional[int]:
        current = self._lounger_of.get(agent_id)
        if current is not None and self._lounger_occupant.get(current) == agent_id:
            return current
        for lounger in range(self._lounger_count):
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

    def _desired_loungers(self, extra: int = 0) -> int:
        """How many loungers the pool should have for this crowd.

        The loungers are for the agents that are not working, so it is them
        that are counted. The pool never shrinks below six and never grows
        beyond twelve.
        """
        idle = len(self._lounger_of) + len(self._waiting_of) + len(self._overflow) + extra
        return max(MIN_LOUNGERS, min(MAX_LOUNGERS, idle))

    def _resize_loungers(self, extra: int = 0) -> None:
        """The pool grows and shrinks with the crowd.

        When a lounger disappears, the agent that was on it goes back to the
        edge of the pool and the others take their chances.
        """
        wanted = self._desired_loungers(extra)
        if wanted == self._lounger_count:
            return
        self._lounger_count = wanted

        # The loungers that no longer exist are given up.
        for lounger in sorted(self._lounger_occupant, reverse=True):
            if lounger < wanted:
                break
            agent_id = self._lounger_occupant.pop(lounger)
            self._lounger_of.pop(agent_id, None)
            self._send_to_waiting(agent_id)
            self._dirty.add(agent_id)

        self._promote_waiting()

    def _send_to_waiting(self, agent_id: str) -> None:
        """There is no free lounger, so the agent waits at the pool edge."""
        slot = self._take_waiting(agent_id)
        if slot is None:
            # Even the pool edge is full: the agent waits at the gate, in the
            # queue for the first place that frees up.
            if agent_id not in self._overflow:
                self._overflow.append(agent_id)
            self._assign_route(agent_id, from_point=GATE, to_point=GATE, route="wait")
            return
        self._assign_route(
            agent_id, from_point=GATE, to_point=f"waiting:{slot}", route="walk"
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
        agent_id: str,
        *,
        from_point: str,
        to_point: str,
        route: str,
    ) -> None:
        self._route_of[agent_id] = {"from": from_point, "to": to_point, "route": route}

    # -- presentation -------------------------------------------------

    def describe(self) -> Dict[str, Any]:
        return {
            "scene": self.scene_id,
            "lanes": LANES,
            "loungers": self._lounger_count,
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

        # The swimmers of the lane, in the order they came in, so that each
        # of them knows where in the lane it swims.
        swimmers = list(self._lane_occupants.get(lane, [])) if lane is not None else []
        place = swimmers.index(agent.id) if agent.id in swimmers else 0

        props: Dict[str, Any] = {
            "lane": lane,
            # Two swimmers in one lane are drawn at different heights and
            # swim in different directions, or they would be one swimmer.
            "lane_offset": 0.0
            if lane is None
            else (0.18 if lane % 2 else -0.18) + place * 0.3,
            "direction": 1 if ((lane or 0) + place) % 2 == 0 else -1,
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
            # A lane with more than one swimmer says so: two agents with the
            # same slot are not the same agent twice.
            slot = f"lane:{lane}" if len(swimmers) < 2 else f"lane:{lane} ({len(swimmers)})"
        elif mode == "lounge" and lounger is not None:
            slot = f"lounger:{lounger}"
        elif mode == "waiting" and waiting is not None:
            slot = f"waiting:{waiting}"

        return {"mode": mode, "slot": slot, "props": props}
