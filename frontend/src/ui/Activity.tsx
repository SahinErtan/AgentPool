import { useCallback, useEffect, useRef, useState } from 'react';
import {
  eventAgentName,
  eventWhat,
  fetchHistory,
  fetchMetrics,
  formatEventTime,
  healthLine,
  shortDetail,
  type HistoryRecord,
  type Metrics,
} from '../net/history';

/** How often the activity is read again, while somebody is looking. */
const POLL_MS = 5_000;

/** How many events the panel shows. The newest ones. */
const MAX_EVENTS = 40;

/**
 * What the pool did, and whether the backend is well.
 *
 * The section is a disclosure: it takes no room until it is opened, so it
 * never squeezes the agent list out of the panel.
 *
 * The reading is done over HTTP, not over the socket: the socket carries
 * the state of the pool, not its history. It is only done while the
 * section is open and the tab is visible — there is no point in asking a
 * backend about its past when nobody is looking at the answer.
 */
export function Activity() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<HistoryRecord[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [answered, setAnswered] = useState(false);
  const [missing, setMissing] = useState(false);
  // The answer may arrive after the section was closed: it must not then
  // set the state of a component that is gone.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const [history, numbers] = await Promise.all([
      fetchHistory(MAX_EVENTS),
      fetchMetrics(),
    ]);
    if (!alive.current) return;
    setEvents(history);
    setAnswered(history.answered);
    setMissing(history.missing);
    setMetrics(numbers);
  }, []);

  useEffect(() => {
    if (!open) return;
    const tick = async () => {
      // A tab nobody is looking at is not asked anything.
      if (document.visibilityState === 'hidden') return;
      await load();
    };
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [open, load]);

  const line = healthLine(metrics);

  return (
    <section className="activity">
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>Activity</summary>
        <div className="activity__body">
          {!answered ? (
            <p className="activity__note">
              {missing
                ? 'This backend is too old to have the history.'
                : 'The backend does not answer the history endpoint.'}
            </p>
          ) : events.length === 0 ? (
            <p className="activity__note">No events yet.</p>
          ) : (
            <ul className="activity__list">
              {events.map((event, index) => (
                <li
                  key={event.event_id || `${event.ts}-${event.type}-${index}`}
                  className="activity__event"
                >
                  <span className="activity__time">{formatEventTime(event.ts)}</span>
                  <span className="activity__agent">{eventAgentName(event)}</span>
                  <span className="activity__what">{eventWhat(event)}</span>
                  {event.detail ? (
                    <span className="activity__detail">{shortDetail(event.detail)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {line ? <p className="activity__health">{line}</p> : null}
        </div>
      </details>
    </section>
  );
}
