import { useStore } from '../state/useStore';
import { useTick } from './useTick';

/** How long a finished agent is still counted as "just finished". */
const RECENT_WINDOW_MS = 5 * 60 * 1000;

/**
 * The line that says what is happening.
 *
 * The first three numbers are of the agents that are in the pool right
 * now. The last one counts the agents that finished in the last five
 * minutes, including the ones that have already walked out of the scene —
 * without that memory the number would fall back to zero the moment a
 * character left.
 */
export function Summary() {
  const { agents, memory } = useStore();
  const now = useTick(1000);

  const list = [...agents.values()];
  const working = list.filter((agent) => agent.status === 'working').length;
  const idle = list.filter((agent) => agent.status === 'idle').length;
  const done = list.filter(
    (agent) => agent.status === 'finished' || agent.status === 'leaving',
  ).length;

  const recent = [...memory.values()].filter((entry) => {
    if (!entry.finishedAt) return false;
    return now - entry.finishedAt * 1000 <= RECENT_WINDOW_MS;
  }).length;

  return (
    // A live region: a screen reader hears how many agents are working,
    // without anybody having to ask for it.
    <section
      className="summary"
      aria-label="What is happening"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="summary__item summary__item--working">{working} working</span>
      <span className="summary__item summary__item--idle">{idle} idle</span>
      <span className="summary__item summary__item--done">{done} done</span>
      <span className="summary__item summary__item--total">{list.length} on the scene</span>
      {recent > 0 ? (
        <span className="summary__item summary__item--recent">
          {recent} finished in the last 5 min
        </span>
      ) : null}
    </section>
  );
}
