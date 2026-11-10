/**
 * When an agent was working, as a piece of the last fifteen minutes.
 *
 * The panel is narrow, so the timeline is a bar under each row rather
 * than a chart of its own. The window is short on purpose: a person wants
 * to see whether the agent is busy right now, not to read a day.
 */

/** How wide the timeline is. */
export const TIMELINE_WINDOW_S = 15 * 60;

export interface Span {
  /** Where the bar starts, in percent. */
  left: number;
  /** How wide the bar is, in percent. */
  width: number;
}

/**
 * The working period of an agent inside the window.
 *
 * `now` is in milliseconds, like `Date.now()`. The agent's times are in
 * seconds, like the backend's.
 */
export function workingSpan(
  startedAt: number | null,
  finishedAt: number | null,
  now: number,
): Span | null {
  if (!startedAt) return null;

  const nowS = now / 1000;
  const windowStart = nowS - TIMELINE_WINDOW_S;
  const end = Math.min(finishedAt ?? nowS, nowS);
  const start = Math.max(startedAt, windowStart);

  if (end <= start) return null;

  return {
    left: ((start - windowStart) / TIMELINE_WINDOW_S) * 100,
    width: ((end - start) / TIMELINE_WINDOW_S) * 100,
  };
}
