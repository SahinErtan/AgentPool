/**
 * The history of the pool, and the health of the backend.
 *
 * The panel reads two endpoints that may not exist. The rules about what
 * a record means, in which order the events are shown and when the health
 * line is worth saying are pure, so they are tested here without a
 * browser and without a backend.
 */

// The clock of the panel is the clock of the machine, so the times are
// pinned to UTC here: a test must not fail in another timezone.
process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  eventAgentName,
  eventWhat,
  formatClock,
  formatEventTime,
  healthLine,
  historyUrl,
  metricsUrl,
  orderEvents,
  parseHistory,
  parseMetrics,
  parseRecord,
  shortAgentId,
  shortDetail,
  type HistoryRecord,
  type Metrics,
} from '../src/net/history';

/** A record as the backend writes it. */
function record(over: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    event_id: 'e1',
    ts: 1_700_000_000,
    type: 'started',
    agent_id: 'sub:abcdef0123456789',
    kind: 'subagent',
    session_id: 's1',
    parent_id: null,
    status: 'working',
    label: '',
    detail: null,
    tool_name: null,
    tool_use_id: null,
    subagent_type: null,
    source: 'hook',
    raw: {},
    ...over,
  };
}

/** The metrics of a backend that has had nothing wrong happen to it. */
function healthyMetrics(): Metrics {
  return {
    type: 'metrics',
    agents: 2,
    broker: { published: 10, dropped: 0 },
    hub: { clients: 1, sent: 10, dropped: 0 },
    ingest: {
      deliveries: 12,
      accepted: 10,
      duplicates: 1,
      refused: 0,
      failed: 0,
      last_error: null,
      last_error_at: null,
    },
    background: { failed: 0, last_error: null, last_error_at: null },
  };
}

test('a record is read out of the payload the backend sends', () => {
  const payload = {
    type: 'history',
    events: [
      {
        event_id: 'e7',
        ts: 1_700_000_123,
        type: 'tool_used',
        agent_id: 'sub:abc',
        kind: 'subagent',
        session_id: 's1',
        parent_id: 'session:s1',
        status: 'working',
        label: 'reader',
        detail: 'Read the file',
        tool_name: 'Read',
        tool_use_id: 't1',
        subagent_type: 'general',
        source: 'hook',
        raw: { a: 1 },
      },
    ],
    count: 1,
  };
  const events = parseHistory(payload);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, 'e7');
  assert.equal(events[0].ts, 1_700_000_123);
  assert.equal(events[0].type, 'tool_used');
  assert.equal(events[0].tool_name, 'Read');
  assert.equal(events[0].detail, 'Read the file');
  assert.equal(events[0].label, 'reader');
  assert.equal(events[0].parent_id, 'session:s1');
});

test('a payload that is not a history gives no events', () => {
  assert.deepEqual(parseHistory(null), []);
  assert.deepEqual(parseHistory({ type: 'history' }), []);
  assert.deepEqual(parseHistory({ type: 'history', events: 'no' }), []);
});

test('an event that says nothing is dropped', () => {
  assert.equal(parseRecord(null), null);
  assert.equal(parseRecord('tool_used'), null);
  // A record without a type says nothing about anything.
  assert.equal(parseRecord({ ts: 12 }), null);
  assert.ok(parseRecord({ ts: 12, type: 'started' }));
});

test('the events are shown newest first', () => {
  const events = parseHistory({
    type: 'history',
    events: [
      { ts: 100, type: 'old', agent_id: 'a' },
      { ts: 300, type: 'new', agent_id: 'b' },
      { ts: 200, type: 'middle', agent_id: 'c' },
    ],
  });
  const ordered = orderEvents(events);
  assert.deepEqual(
    ordered.map((event) => event.type),
    ['new', 'middle', 'old'],
  );
});

test('the order of the events is not changed by the sort', () => {
  const events = [
    record({ ts: 10, type: 'a' }),
    record({ ts: 10, type: 'b' }),
    record({ ts: 10, type: 'c' }),
  ];
  assert.deepEqual(
    orderEvents(events).map((event) => event.type),
    ['a', 'b', 'c'],
  );
});

test('the metrics are read with the parts that may be missing', () => {
  const metrics = parseMetrics({
    type: 'metrics',
    agents: 3,
    broker: { published: 4, dropped: 1 },
    hub: { clients: 1, sent: 4, dropped: 2 },
  });
  assert.ok(metrics);
  assert.equal(metrics.agents, 3);
  assert.equal(metrics.broker.dropped, 1);
  assert.equal(metrics.hub.dropped, 2);
  assert.equal(metrics.ingest, null);
  assert.equal(metrics.background, null);
  assert.equal(parseMetrics('nothing'), null);
});

test('the health line is not there when there is nothing to say', () => {
  assert.equal(healthLine(healthyMetrics()), null);
  assert.equal(healthLine(null), null);
});

test('the health line says what went wrong', () => {
  const metrics = healthyMetrics();
  assert.ok(metrics.ingest);
  metrics.ingest.refused = 3;
  metrics.ingest.failed = 1;
  metrics.ingest.last_error = 'the payload was not an event';
  metrics.ingest.last_error_at = 1_700_000_000;
  metrics.hub.dropped = 2;

  const line = healthLine(metrics);
  assert.ok(line);
  assert.match(line, /12 deliveries/);
  assert.match(line, /3 refused/);
  assert.match(line, /1 failed/);
  assert.match(line, /2 messages dropped by the hub/);
  assert.match(line, /the payload was not an event/);
});

test('the health line counts the background failures too', () => {
  const metrics = healthyMetrics();
  assert.ok(metrics.background);
  metrics.background.failed = 4;
  metrics.background.last_error = 'the sweeper stopped';
  metrics.background.last_error_at = 1_700_000_000;
  const line = healthLine(metrics);
  assert.ok(line);
  assert.match(line, /4 background failures/);
  assert.match(line, /the sweeper stopped/);
});

test('the times are said as a clock', () => {
  assert.equal(formatClock(1_700_000_000), '22:13:20');
  assert.equal(formatClock(null), '—');
});

test('the time of an event says how long ago it was', () => {
  const ts = 1_700_000_000;
  assert.equal(formatEventTime(ts, ts + 10), '22:13:20');
  assert.equal(formatEventTime(ts, ts + 120), '22:13:20 (2 min ago)');
  assert.equal(formatEventTime(ts, ts + 7_200), '22:13:20 (2 h ago)');
  assert.equal(formatEventTime(ts, ts + 172_800), '22:13:20 (2 d ago)');
});

test('an agent without a label is named by a short form of its id', () => {
  assert.equal(shortAgentId('sub:abcdef0123456789'), 'sub:abcdef01…');
  assert.equal(shortAgentId('short'), 'short');
  assert.equal(shortAgentId(''), 'unknown');
  assert.equal(eventAgentName(record({ label: 'reader' })), 'reader');
  assert.equal(eventAgentName(record({ label: '  ' })), 'sub:abcdef01…');
});

test('what happened is the type, and the tool when there is one', () => {
  assert.equal(eventWhat(record({ type: 'started' })), 'started');
  assert.equal(eventWhat(record({ type: 'tool_used', tool_name: 'Read' })), 'tool_used · Read');
});

test('the detail is said in a few words', () => {
  assert.equal(shortDetail('Read the file'), 'Read the file');
  assert.equal(shortDetail('a\n  b'), 'a b');
  const long = 'x'.repeat(200);
  const cut = shortDetail(long, 10);
  assert.equal(cut.length, 10);
  assert.ok(cut.endsWith('…'));
});

test('the requests carry the token of the page, like the socket does', () => {
  assert.equal(historyUrl('', 40), '/api/history?limit=40');
  assert.equal(historyUrl('a b', 40), '/api/history?limit=40&token=a+b');
  assert.equal(metricsUrl(''), '/api/metrics');
  assert.equal(metricsUrl('a b'), '/api/metrics?token=a%20b');
});
