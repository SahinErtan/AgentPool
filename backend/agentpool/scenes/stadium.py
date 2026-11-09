"""The stadium scene: the proof that the bridge is reusable.

This is a second implementation of the scene adapter. It knows nothing about
hooks, about the registry or about the WebSocket: it only receives the agent
lifecycle and decides where its agents belong.

A stadium has benches and a running track instead of loungers and a pool, so
the vocabulary differs on purpose. The bridge does not care: the tests in
``tests/test_bridge_is_scene_agnostic.py`` check that the bridge never mentions
a scene by name.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..bridge.events import AgentStatus, SessionEvent
from ..bridge.registry import AgentState

LANES = 2
BENCHES = 8
# The agents that have no bench wait at the entrance.
WAITING = 2

GATE = "gate"
TRACK = "track"


class StadiumScene:
    """Puts the agents on the benches and on the running track."""

    scene_id = "stadium"

    def __init__(self) -> None:
        self._lane_of: Dict[str, int] = {}
        self._lane_occupant: Dict[int, str] = {}
        self._bench_of: Dict[str, int] = {}
        self._bench_occupant: Dict[int, str] = {}
        self._waiting_of: Dict[str, int] = {}
        self._waiting_occupant: Dict[int, str] = {}
        # The agents that have neither a bench nor a waiting spot.
        self._overflow: List[str] = []
        self._route_of: Dict[str, Dict[str, Any]] = {}
        self._dirty: set[str] = set()

    # -- lifecycle ----------------------------------------------------

    async def on_agent_spawned(self, agent: AgentState) -> None:
        if agent.status is AgentStatus.WORKING:
            # An agent that appears already working goes straight onto the
            # track, so it has a lane from the first frame.
            self._take_lane(agent.id)
            self._assign_route(agent, from_point=GATE, to_point=TRACK, route="walk")
        else:
            bench = self._take_bench(agent.id)
            if bench is None:
                self._send_to_waiting(agent)
            else:
                self._assign_route(
                    agent, from_point=GATE, to_point=f"bench:{bench}", route="walk"
                )

    async def on_agent_started(self, agent: AgentState) -> None:
        self._release_bench(agent.id)
        self._release_waiting(agent.id)
        lane = self._take_lane(agent.id)
        self._assign_route(agent, from_point=TRACK, to_point=TRACK, route="enter")
        self._lane_of[agent.id] = lane

    async def on_agent_finished(self, agent: AgentState) -> None:
        self._release_lane(agent.id)
        bench = self._take_bench(agent.id)
        if bench is None:
            self._send_to_waiting(agent)
        else:
            self._assign_route(
                agent, from_point=TRACK, to_point=f"bench:{bench}", route="leave"
            )

    async def on_agent_removed(self, agent_id: str) -> None:
        self._release_lane(agent_id)
        self._release_bench(agent_id)
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
        lane = min(range(LANES), key=lambda index: 1)
        self._lane_of[agent_id] = lane
        return lane

    def _release_lane(self, agent_id: str) -> None:
        lane = self._lane_of.pop(agent_id, None)
        if lane is not None and self._lane_occupant.get(lane) == agent_id:
            del self._lane_occupant[lane]

    def _take_bench(self, agent_id: str) -> Optional[int]:
        current = self._bench_of.get(agent_id)
        if current is not None and self._bench_occupant.get(current) == agent_id:
            return current
        for bench in range(BENCHES):
            if bench not in self._bench_occupant:
                self._bench_occupant[bench] = agent_id
                self._bench_of[agent_id] = bench
                return bench
        return None

    def _release_bench(self, agent_id: str) -> None:
        bench = self._bench_of.pop(agent_id, None)
        if bench is not None and self._bench_occupant.get(bench) == agent_id:
            del self._bench_occupant[bench]
            self._promote_waiting()

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

    def _send_to_waiting(self, agent: AgentState) -> None:
        slot = self._take_waiting(agent.id)
        if slot is None:
            if agent.id not in self._overflow:
                self._overflow.append(agent.id)
            self._assign_route(agent, from_point=GATE, to_point=GATE, route="wait")
            return
        self._assign_route(
            agent, from_point=GATE, to_point=f"waiting:{slot}", route="walk"
        )

    def _promote_waiting(self) -> None:
        if self._waiting_occupant:
            agent_id = self._waiting_occupant[min(self._waiting_occupant)]
        elif self._overflow:
            agent_id = self._overflow[0]
        else:
            return
        bench = self._take_bench(agent_id)
        if bench is None:
            return
        self._release_waiting(agent_id)
        self._route_of[agent_id] = {
            "from": GATE,
            "to": f"bench:{bench}",
            "route": "walk",
        }
        self._dirty.add(agent_id)

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
            "benches": BENCHES,
            "waiting": WAITING,
            "gate": GATE,
            "track": TRACK,
        }

    def presentation(self, agent: AgentState) -> Dict[str, Any]:
        lane = self._lane_of.get(agent.id)
        bench = self._bench_of.get(agent.id)
        waiting = self._waiting_of.get(agent.id)
        route = self._route_of.get(agent.id, {})

        status = agent.status
        if status is AgentStatus.WORKING:
            mode = "run"
        elif status is AgentStatus.FINISHED:
            mode = "leaving_track"
        elif status is AgentStatus.LEAVING:
            mode = "leaving"
        elif status is AgentStatus.REMOVED:
            mode = "offscreen"
        elif bench is None:
            mode = "waiting"
        else:
            mode = "bench"

        props: Dict[str, Any] = {
            "lane": lane,
            "lane_offset": 0.0 if lane is None else (0.18 if lane % 2 else -0.18),
            "direction": 1 if (lane or 0) % 2 == 0 else -1,
            "speed_scale": 1.0,
            "bench": bench,
            "waiting": waiting,
            "queue": self._overflow.index(agent.id) if agent.id in self._overflow else 0,
            "route": route.get("route"),
            "from": route.get("from"),
            "to": route.get("to"),
        }

        slot = None
        if mode == "run" and lane is not None:
            slot = f"lane:{lane}"
        elif mode == "bench" and bench is not None:
            slot = f"bench:{bench}"
        elif mode == "waiting" and waiting is not None:
            slot = f"waiting:{waiting}"

        return {"mode": mode, "slot": slot, "props": props}
