/**
 * The moments of the pool: what counts as finished, a milestone, a session
 * that ends, a quiet pool, a busy one and an awakening. Pure, so it is
 * checked here in node, with the clock given by the test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AgentStatus, AgentView } from '../src/net/types';
import {
  BUSY_GAP_S,
  BUSY_COUNT,
  QUIET_AFTER_S,
  createMomentMemory,
  detectMoments,
  type Moment,
} from '../src/scene/pool3d/moments';

function agent(id: string, status: AgentStatus, events = 1, kind: AgentView['kind'] = 'subagent'): AgentView {
  return {
    id,
    kind,
    status,
    label: id,
    session_id: null,
    parent_id: null,
    tool_use_id: null,
    subagent_type: null,
    tool_name: null,
    detail: null,
    cwd: null,
    created_at: 0,
    last_event_at: 0,
    started_at: null,
    finished_at: null,
    event_count: events,
    leaving_deadline: null,
    scene: 'pool',
    presentation: { mode: 'swim', slot: null, props: {} },
  };
}

/** A memory that has seen the agents once, at time zero. */
function primed(agents: AgentView[]) {
  const memory = createMomentMemory();
  detectMoments(agents, 0, memory);
  return memory;
}

test('the first snapshot fills the memory and reports nothing', () => {
  const memory = createMomentMemory();
  const moments = detectMoments([agent('a', 'finished', 900), agent('b', 'working', 4)], 0, memory);
  assert.deepEqual(moments, []);
  assert.equal(memory.status.get('a'), 'finished');
  assert.equal(memory.events.get('b'), 4);
});

test('an agent that becomes finished is a finished moment, once', () => {
  const memory = primed([agent('a', 'working')]);
  assert.deepEqual(detectMoments([agent('a', 'finished')], 1, memory), [{ kind: 'finished', id: 'a' }]);
  assert.deepEqual(detectMoments([agent('a', 'finished')], 2, memory), []);
});

test('a finished agent seen for the first time is not a moment', () => {
  const memory = primed([agent('a', 'working')]);
  assert.deepEqual(detectMoments([agent('a', 'working'), agent('b', 'finished')], 1, memory), []);
});

test('a milestone is reported when the count crosses it, and not repeated', () => {
  const memory = primed([agent('a', 'working', 99)]);
  assert.deepEqual(detectMoments([agent('a', 'working', 100)], 1, memory), [{ kind: 'milestone', id: 'a', count: 100 }]);
  assert.deepEqual(detectMoments([agent('a', 'working', 101)], 2, memory), []);
  assert.deepEqual(detectMoments([agent('a', 'working', 249)], 3, memory), []);
});

test('a jump from 90 to 600 reports the 500 only', () => {
  const memory = primed([agent('a', 'working', 90)]);
  assert.deepEqual(detectMoments([agent('a', 'working', 600)], 1, memory), [{ kind: 'milestone', id: 'a', count: 500 }]);
});

test('a session that starts leaving or is removed has ended; a sub-agent that leaves has not', () => {
  const memory = primed([agent('s', 'working', 1, 'session'), agent('t', 'working', 1, 'subagent')]);
  const moments = detectMoments([agent('s', 'leaving', 1, 'session'), agent('t', 'leaving', 1, 'subagent')], 1, memory);
  assert.deepEqual(moments, [{ kind: 'sessionEnded', id: 's' }]);
  const removed = detectMoments([agent('s', 'removed', 1, 'session')], 2, memory);
  assert.deepEqual(removed, []);
});

test('a session that is removed without leaving first has ended', () => {
  const memory = primed([agent('s', 'idle', 1, 'session')]);
  assert.deepEqual(detectMoments([agent('s', 'removed', 1, 'session')], 1, memory), [{ kind: 'sessionEnded', id: 's' }]);
});

test('the pool is quiet once nobody has worked for two minutes, and says so once', () => {
  const memory = primed([agent('a', 'idle')]);
  assert.deepEqual(detectMoments([agent('a', 'idle')], QUIET_AFTER_S - 1, memory), []);
  const at = detectMoments([agent('a', 'idle')], QUIET_AFTER_S, memory);
  assert.deepEqual(at, [{ kind: 'quiet' }] as Moment[]);
  assert.deepEqual(detectMoments([agent('a', 'idle')], QUIET_AFTER_S + 30, memory), []);
});

test('awake is the first work after quiet, and only then', () => {
  const memory = primed([agent('a', 'idle')]);
  detectMoments([agent('a', 'idle')], QUIET_AFTER_S + 1, memory);
  assert.deepEqual(detectMoments([agent('a', 'working')], QUIET_AFTER_S + 2, memory), [{ kind: 'awake' }]);
  assert.deepEqual(detectMoments([agent('a', 'working')], QUIET_AFTER_S + 3, memory), []);
});

test('quiet and awake alternate: a pool can go quiet again after it wakes', () => {
  const memory = primed([agent('a', 'working')]);
  const idle = QUIET_AFTER_S + 10;
  assert.deepEqual(detectMoments([agent('a', 'idle')], 10, memory), []);
  assert.deepEqual(detectMoments([agent('a', 'idle')], idle, memory), [{ kind: 'quiet' }]);
  assert.deepEqual(detectMoments([agent('a', 'working')], idle + 1, memory), [{ kind: 'awake' }]);
  assert.deepEqual(detectMoments([agent('a', 'idle')], idle + 2, memory), []);
  assert.deepEqual(detectMoments([agent('a', 'idle')], idle + 2 + QUIET_AFTER_S, memory), [{ kind: 'quiet' }]);
});

test('busy is six or more working at once, and comes at most once in ten minutes', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => agent(`w${i}`, 'working'));
  const memory = primed(many(BUSY_COUNT - 1));
  assert.deepEqual(detectMoments(many(BUSY_COUNT), 10, memory), [{ kind: 'busy' }]);
  assert.deepEqual(detectMoments(many(BUSY_COUNT + 2), 20, memory), []);
  assert.deepEqual(detectMoments(many(BUSY_COUNT), 10 + BUSY_GAP_S - 1, memory), []);
  assert.deepEqual(detectMoments(many(BUSY_COUNT), 10 + BUSY_GAP_S, memory), [{ kind: 'busy' }]);
});

test('five working at once is not busy, and the first snapshot is never busy', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => agent(`w${i}`, 'working'));
  const memory = createMomentMemory();
  assert.deepEqual(detectMoments(many(BUSY_COUNT + 3), 0, memory), []);
  const five = primed(many(5));
  assert.deepEqual(detectMoments(many(5), 1, five), []);
});

test('an agent that leaves the list is forgotten', () => {
  const memory = primed([agent('a', 'working', 3)]);
  detectMoments([], 1, memory);
  assert.equal(memory.status.size, 0);
  assert.equal(memory.events.size, 0);
  // Back again, it is a newcomer: its count sets the memory, no milestone.
  assert.deepEqual(detectMoments([agent('a', 'working', 900)], 2, memory), []);
});
