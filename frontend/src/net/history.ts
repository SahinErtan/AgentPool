/**
 * The history of the pool, and the health of the backend.
 *
 * The socket carries the state of the pool as it is now. It does not carry
 * what the pool did, and it does not carry the numbers the backend keeps
 * about its own failures. Those live behind two read-only endpoints, and
 * both may be missing: a backend from before the endpoints existed answers
 * with a 404, and a backend that is down answers with nothing at all.
 *
 * Neither is a reason to break the panel, so both readers answer with an
 * empty result and a flag that says why.
 */

import { tokenFromSearch } from './ws';

/** One journal record, the event as it was written. */
export interface HistoryRecord {
  event_id: string;
  /** UNIX seconds. */
  ts: number;
  type: string;
  agent_id: string;
  kind: string;
  session_id: string | null;
  parent_id: string | null;
  status: string;
  label: string;
  detail: string | null;
  tool_name: string | null;
  tool_use_id: string | null;
  subagent_type: string | null;
  source: string;
  raw: Record<string, unknown>;
}

/** What the ingest path has seen. */
export interface IngestMetrics {
  deliveries: number;
  accepted: number;
  duplicates: number;
  refused: number;
  failed: number;
  last_error: string | null;
  last_error_at: number | null;
}

/** What the background loops have done. */
export interface BackgroundMetrics {
  failed: number;
  last_error: string | null;
  last_error_at: number | null;
}

/** What the backend has done, in numbers. */
export interface Metrics {
  type: string;
  agents: number;
  broker: { published: number; dropped: number };
  hub: { clients: number; sent: number; dropped: number };
  ingest: IngestMetrics | null;
  background: BackgroundMetrics | null;
}

/**
 * The events, with the two flags that say what the backend did.
 *
 * The flags are on the array itself so that the reader keeps the simple
 * shape a list of events should have, and the caller can still tell "the
 * pool did nothing" from "the backend did not answer".
 */
export type HistoryResult = HistoryRecord[] & {
  /** The backend answered the endpoint. */
  answered: boolean;
  /** The backend does not know the endpoint: it is too old. */
  missing: boolean;
};

/* --- reading the payloads -------------------------------------------- */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function maybeText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * One record, read out of a payload that may not hold one.
 *
 * A record without a type says nothing about anything, so it is dropped:
 * the panel would only show an empty line.
 */
export function parseRecord(value: unknown): HistoryRecord | null {
  if (!isObject(value)) return null;
  const type = text(value.type);
  if (!type) return null;
  return {
    event_id: text(value.event_id),
    ts: count(value.ts),
    type,
    agent_id: text(value.agent_id),
    kind: text(value.kind),
    session_id: maybeText(value.session_id),
    parent_id: maybeText(value.parent_id),
    status: text(value.status),
    label: text(value.label),
    detail: maybeText(value.detail),
    tool_name: maybeText(value.tool_name),
    tool_use_id: maybeText(value.tool_use_id),
    subagent_type: maybeText(value.subagent_type),
    source: text(value.source),
    raw: isObject(value.raw) ? value.raw : {},
  };
}

/** The events of a history payload, the ones that make sense. */
export function parseHistory(payload: unknown): HistoryRecord[] {
  const list = Array.isArray(payload)
    ? payload
    : isObject(payload) && Array.isArray(payload.events)
      ? payload.events
      : [];
  const out: HistoryRecord[] = [];
  for (const item of list) {
    const record = parseRecord(item);
    if (record) out.push(record);
  }
  return out;
}

/** The metrics payload, with the parts that may be missing filled in. */
export function parseMetrics(payload: unknown): Metrics | null {
  if (!isObject(payload)) return null;
  const broker = isObject(payload.broker) ? payload.broker : {};
  const hub = isObject(payload.hub) ? payload.hub : {};
  const ingest = isObject(payload.ingest) ? payload.ingest : null;
  const background = isObject(payload.background) ? payload.background : null;
  return {
    type: text(payload.type, 'metrics'),
    agents: count(payload.agents),
    broker: { published: count(broker.published), dropped: count(broker.dropped) },
    hub: { clients: count(hub.clients), sent: count(hub.sent), dropped: count(hub.dropped) },
    ingest: ingest
      ? {
          deliveries: count(ingest.deliveries),
          accepted: count(ingest.accepted),
          duplicates: count(ingest.duplicates),
          refused: count(ingest.refused),
          failed: count(ingest.failed),
          last_error: maybeText(ingest.last_error),
          last_error_at:
            typeof ingest.last_error_at === 'number' ? ingest.last_error_at : null,
        }
      : null,
    background: background
      ? {
          failed: count(background.failed),
          last_error: maybeText(background.last_error),
          last_error_at:
            typeof background.last_error_at === 'number' ? background.last_error_at : null,
        }
      : null,
  };
}

/* --- showing the events ---------------------------------------------- */

/** The newest event first: the panel shows what just happened. */
export function orderEvents(records: HistoryRecord[]): HistoryRecord[] {
  return [...records].sort((a, b) => b.ts - a.ts);
}

/** The clock, as it is on the wall. */
export function formatClock(ts: number | null): string {
  if (ts === null || !Number.isFinite(ts)) return '—';
  const date = new Date(ts * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * When it happened, and how long ago.
 *
 * The clock time alone is not enough for a panel that may sit open for
 * hours, so the age is said too — but only when it says something.
 */
export function formatEventTime(ts: number, now: number = Date.now() / 1000): string {
  const clock = formatClock(ts);
  const age = now - ts;
  if (!Number.isFinite(age) || age < 60) return clock;
  if (age < 3600) return `${clock} (${Math.floor(age / 60)} min ago)`;
  if (age < 86_400) return `${clock} (${Math.floor(age / 3600)} h ago)`;
  return `${clock} (${Math.floor(age / 86_400)} d ago)`;
}

/** A short name for an agent that has no label of its own. */
export function shortAgentId(agentId: string): string {
  const trimmed = agentId.trim();
  if (!trimmed) return 'unknown';
  const colon = trimmed.indexOf(':');
  const prefix = colon > 0 ? trimmed.slice(0, colon) : '';
  const tail = colon > 0 ? trimmed.slice(colon + 1) : trimmed;
  const short = tail.length > 8 ? `${tail.slice(0, 8)}…` : tail;
  return prefix ? `${prefix}:${short}` : short;
}

/** The name of the agent an event belongs to. */
export function eventAgentName(record: HistoryRecord): string {
  const label = record.label.trim();
  return label ? label : shortAgentId(record.agent_id);
}

/** What happened, and with which tool when the event names one. */
export function eventWhat(record: HistoryRecord): string {
  return record.tool_name ? `${record.type} · ${record.tool_name}` : record.type;
}

/** The detail, in a few words. */
export function shortDetail(detail: string, limit = 90): string {
  const flat = detail.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1)}…`;
}

/**
 * The health of the backend, in one line — or nothing at all.
 *
 * There is a line only when there is something to say: a healthy backend
 * has nothing to report, and a line that always says "0 refused, 0 failed"
 * is noise that hides the day it is not zero.
 */
export function healthLine(metrics: Metrics | null): string | null {
  if (!metrics) return null;
  const trouble: string[] = [];

  const ingest = metrics.ingest;
  if (ingest) {
    if (ingest.refused > 0) trouble.push(`${ingest.refused} refused`);
    if (ingest.failed > 0) trouble.push(`${ingest.failed} failed`);
    if (ingest.last_error) {
      trouble.push(`last error: ${ingest.last_error} (${formatClock(ingest.last_error_at)})`);
    }
  }
  if (metrics.hub.dropped > 0) {
    trouble.push(`${metrics.hub.dropped} messages dropped by the hub`);
  }
  if (metrics.broker.dropped > 0) {
    trouble.push(`${metrics.broker.dropped} events dropped by the broker`);
  }
  const background = metrics.background;
  if (background) {
    if (background.failed > 0) trouble.push(`${background.failed} background failures`);
    if (background.last_error) {
      trouble.push(`background error: ${background.last_error} (${formatClock(background.last_error_at)})`);
    }
  }

  if (trouble.length === 0) return null;
  const deliveries = ingest ? ingest.deliveries : 0;
  return [`${deliveries} deliveries`, ...trouble].join(' · ');
}

/* --- the two endpoints ------------------------------------------------ */

/** The address of the history endpoint, with the token when there is one. */
export function historyUrl(token: string, limit: number): string {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  if (token) query.set('token', token);
  return `/api/history?${query.toString()}`;
}

/** The address of the metrics endpoint, with the token when there is one. */
export function metricsUrl(token: string): string {
  return token ? `/api/metrics?token=${encodeURIComponent(token)}` : '/api/metrics';
}

/**
 * The token of the page, when the backend asks for one.
 *
 * The socket carries the token in the query; these requests do the same,
 * so that a backend with a token does not refuse them.
 */
function currentToken(): string {
  if (typeof window === 'undefined') return '';
  return tokenFromSearch(window.location.search);
}

function historyResult(
  events: HistoryRecord[],
  answered: boolean,
  missing: boolean,
): HistoryResult {
  return Object.assign(events, { answered, missing });
}

/**
 * The events of the pool, newest first.
 *
 * This never throws: a backend that is down, a backend that is too old and
 * a backend that answers with something else all end as "no answer", and
 * the caller says so instead of showing an empty box.
 */
export async function fetchHistory(limit = 100): Promise<HistoryResult> {
  try {
    const response = await fetch(historyUrl(currentToken(), limit), {
      cache: 'no-store',
    });
    // The endpoint does not exist: the backend is older than the history.
    if (response.status === 404) return historyResult([], false, true);
    if (!response.ok) return historyResult([], false, false);
    const payload = JSON.parse((await response.text()) || '{}') as unknown;
    return historyResult(orderEvents(parseHistory(payload)), true, false);
  } catch {
    return historyResult([], false, false);
  }
}

/**
 * The numbers of the backend, or nothing when it does not answer.
 *
 * A null is the honest answer for a backend that is down and for a backend
 * that is too old: there are no numbers to show.
 */
export async function fetchMetrics(): Promise<Metrics | null> {
  try {
    const response = await fetch(metricsUrl(currentToken()), { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = JSON.parse((await response.text()) || '{}') as unknown;
    return parseMetrics(payload);
  } catch {
    return null;
  }
}
