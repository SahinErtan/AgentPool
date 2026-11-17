/**
 * The store.
 *
 * The scene reads it in its frame loop and React reads it when it paints,
 * so it is the one piece of the frontend that everything else goes
 * through. It has to hold its tongue: the same value set twice must not
 * wake anybody up.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { agentFromSearch, searchWithAgent, store } from '../src/state/store';
import type { AgentView } from '../src/net/types';

function agent(id: string, status: AgentView['status'] = 'idle'): AgentView {
  return {
    id,
    kind: 'session',
    status,
    label: id,
    session_id: null,
    parent_id: null,
    detail: null,
    cwd: null,
    tool_name: null,
    subagent_type: null,
    started_at: null,
    finished_at: null,
    created_at: Date.now() / 1000,
    last_event_at: Date.now() / 1000,
    event_count: 0,
  };
}

test('the connection has a finer state than on and off', () => {
  store.setConnection('connecting');
  assert.equal(store.get().connection, 'connecting');
  assert.equal(store.get().connected, false);

  store.setConnection('live');
  assert.equal(store.get().connected, true);

  store.setConnection('reconnecting');
  assert.equal(store.get().connected, false);

  store.setConnection('offline');
  assert.equal(store.get().connected, false);
});

test('the same connection does not wake anybody up', () => {
  let wakes = 0;
  const stop = store.subscribe(() => {
    wakes += 1;
  });
  store.setConnection('live');
  store.setConnection('live');
  stop();
  assert.equal(wakes, 1);
});

test('the selection is remembered and can be cleared', () => {
  store.select('session:a');
  assert.equal(store.get().selectedId, 'session:a');
  store.select('session:a');
  assert.equal(store.get().selectedId, 'session:a');
  store.select(null);
  assert.equal(store.get().selectedId, null);
});

test('the filter narrows the list down', () => {
  store.setFilter({ status: 'working' });
  assert.equal(store.get().filter.status, 'working');
  store.setFilter({ kind: 'subagent' });
  assert.equal(store.get().filter.kind, 'subagent');
  store.setFilter({ status: 'all', kind: 'all' });
});

test('the panel remembers an agent that is gone', () => {
  store.replaceAgents([agent('session:a', 'finished')]);
  assert.equal(store.get().agents.has('session:a'), true);
  assert.equal(store.get().memory.get('session:a')?.status, 'finished');

  store.removeAgent('session:a');
  assert.equal(store.get().agents.has('session:a'), false);
  // The memory outlives the agent: the panel still says how many finished.
  assert.equal(store.get().memory.get('session:a')?.status, 'finished');
});

test('an agent that comes back is put back', () => {
  store.upsertAgents([agent('session:b', 'working')]);
  assert.equal(store.get().agents.get('session:b')?.status, 'working');
});

test('the address bar carries the agent', () => {
  assert.equal(agentFromSearch('?agent=session%3Aabc'), 'session:abc');
  assert.equal(agentFromSearch(''), null);
  assert.equal(agentFromSearch('?other=1'), null);

  const withAgent = searchWithAgent('', 'session:abc');
  assert.equal(withAgent, '?agent=session%3Aabc');
  assert.equal(agentFromSearch(withAgent), 'session:abc');

  // The other parameters are kept.
  const kept = searchWithAgent('?debug=1', 'session:abc');
  assert.equal(kept.includes('debug=1'), true);
  assert.equal(agentFromSearch(kept), 'session:abc');

  // And the agent can be taken out again.
  const without = searchWithAgent(kept, null);
  assert.equal(without.includes('agent='), false);
  assert.equal(without.includes('debug=1'), true);
});
