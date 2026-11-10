import { useEffect, useState } from 'react';

/**
 * A clock that ticks.
 *
 * The panel shows how long an agent has been running, so it has to redraw
 * every now and then even when nothing happens in the pool.
 */
export function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
