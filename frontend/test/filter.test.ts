/**
 * The filter of the agent list.
 *
 * The list holds everything; the filter is what makes it readable when
 * there are twenty agents in it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matches } from '../src/ui/AgentList';
import type { AgentView } from '../src/net/types';

function agent(id: string, kind: AgentView['kind'], status: AgentView['status']): AgentView {
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
    event_count: 0,
    leaving_deadline: null,
    scene: 'pool',
    presentation: { mode: 'lounge', slot: null, props: {} },
  };
}

const ALL = { status: 'all', kind: 'all' } as const;

test('without a filter every agent is shown', () => {
  assert.equal(matches(agent('a', 'session', 'working'), ALL), true);
  assert.equal(matches(agent('b', 'subagent', 'idle'), ALL), true);
});

test('the working filter only shows the working ones', () => {
  const filter = { status: 'working', kind: 'all' } as const;
  assert.equal(matches(agent('a', 'session', 'working'), filter), true);
  assert.equal(matches(agent('b', 'subagent', 'idle'), filter), false);
});

test('the done filter counts the ones that are on their way out too', () => {
  const filter = { status: 'done', kind: 'all' } as const;
  assert.equal(matches(agent('a', 'session', 'finished'), filter), true);
  assert.equal(matches(agent('b', 'session', 'leaving'), filter), true);
  assert.equal(matches(agent('c', 'session', 'working'), filter), false);
});

test('the kind filter narrows the list down', () => {
  const filter = { status: 'all', kind: 'subagent' } as const;
  assert.equal(matches(agent('a', 'subagent', 'working'), filter), true);
  assert.equal(matches(agent('b', 'session', 'working'), filter), false);
});

test('the two filters work together', () => {
  const filter = { status: 'working', kind: 'subagent' } as const;
  assert.equal(matches(agent('a', 'subagent', 'working'), filter), true);
  assert.equal(matches(agent('b', 'subagent', 'idle'), filter), false);
  assert.equal(matches(agent('c', 'session', 'working'), filter), false);
});
