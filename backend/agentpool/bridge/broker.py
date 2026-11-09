"""In-process publish / subscribe.

The broker must never block the ingest path: a full queue drops the event and
counts it instead of stalling the hook that produced it.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator, List, Set


class Broker:
    """A tiny async fan-out."""

    def __init__(self, maxsize: int = 256) -> None:
        self._subscribers: Set[asyncio.Queue] = set()
        self._maxsize = maxsize
        self.dropped = 0
        self.published = 0

    def publish(self, event: Any) -> None:
        self.published += 1
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                self.dropped += 1

    def subscribe(self) -> "asyncio.Queue":
        queue: asyncio.Queue = asyncio.Queue(maxsize=self._maxsize)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: "asyncio.Queue") -> None:
        self._subscribers.discard(queue)

    async def stream(self) -> AsyncIterator[Any]:
        """Iterate over the events published while this consumer is alive."""
        queue = self.subscribe()
        try:
            while True:
                yield await queue.get()
        finally:
            self.unsubscribe(queue)
