/**
 * The order of the agent list: sessions with their subagents under them,
 * and the agents whose session is not in the list under "Other".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AgentView } from '../src/net/types';
import { arrangeAgents, familyColour, OTHER_HEADING } from '../src/ui/agentTree';

function agent(over: Partial<AgentView> & { id: string; kind: AgentView['kind'] }): AgentView {
  return {
    status: 'working',
    label: '',
    session_id: null,
    parent_id: null,
    tool_use_id: null,
    subagent_type: null,
    tool_name: null,
    detail: null,
    cwd: null,
    created_at: 1,
    last_event_at: 1,
    started_at: 1,
    finished_at: null,
    event_count: 0,
    leaving_deadline: null,
    scene: 'pool',
    presentation: { mode: 'swim', slot: null, props: {} },
    ...over,
  };
}

/** The rows as "id@depth", with the headings as "[text]". */
function shape(items: ReturnType<typeof arrangeAgents>): string[] {
  return items.map((item) => (item.kind === 'heading' ? `[${item.text}]` : `${item.agent.id}@${item.depth}`));
}

test('a session comes first and its subagents are listed under it, indented', () => {
  const s1 = agent({ id: 'session:s1', kind: 'session', created_at: 1 });
  const s2 = agent({ id: 'session:s2', kind: 'session', created_at: 2 });
  const a = agent({ id: 'sub:a', kind: 'subagent', parent_id: 'session:s1', created_at: 5 });
  const b = agent({ id: 'sub:b', kind: 'subagent', parent_id: 'session:s2', created_at: 4 });
  const c = agent({ id: 'sub:c', kind: 'subagent', parent_id: 'session:s1', created_at: 3 });
  assert.deepEqual(shape(arrangeAgents([b, a, s2, c, s1])), [
    'session:s1@0',
    'sub:c@1',
    'sub:a@1',
    'session:s2@0',
    'sub:b@1',
  ]);
});

test('an agent whose session is not in the list goes under Other, after the sessions', () => {
  const s1 = agent({ id: 'session:s1', kind: 'session', created_at: 1 });
  const lost = agent({ id: 'sub:lost', kind: 'subagent', parent_id: 'session:gone', created_at: 2 });
  const flow = agent({ id: 'wf:x', kind: 'workflow', parent_id: null, created_at: 3 });
  assert.deepEqual(shape(arrangeAgents([flow, lost, s1])), [
    'session:s1@0',
    `[${OTHER_HEADING}]`,
    'sub:lost@0',
    'wf:x@0',
  ]);
});

test('without any session in the list the list is flat, in id order, as before', () => {
  const x = agent({ id: 'sub:x', kind: 'subagent', parent_id: 'session:gone' });
  const y = agent({ id: 'sub:b', kind: 'subagent' });
  assert.deepEqual(shape(arrangeAgents([x, y])), ['sub:b@0', 'sub:x@0']);
  assert.deepEqual(arrangeAgents([]), []);
});

test('the family colour is a session\'s own, and a subagent\'s parent colour', () => {
  const s = agent({ id: 'session:fam', kind: 'session', session_id: 'fam' });
  const sub = agent({ id: 'sub:fam', kind: 'subagent', parent_id: 'session:fam' });
  const colour = familyColour(s);
  assert.ok(colour && /^#[0-9a-f]{6}$/i.test(colour), String(colour));
  assert.equal(familyColour(sub), colour);
  assert.equal(familyColour(agent({ id: 'wf:x', kind: 'workflow' })), null);
});

test('the subagents of a session that has left are listed under its remembered name', () => {
  const s1 = agent({ id: 'session:s1', kind: 'session', created_at: 1 });
  const a = agent({ id: 'sub:a', kind: 'subagent', parent_id: 'session:m', session_id: 'm', session_name: 'mediaorganizer-77', created_at: 2 });
  const b = agent({ id: 'sub:b', kind: 'subagent', parent_id: 'session:m', session_id: 'm', session_name: 'mediaorganizer-77', created_at: 3 });
  const flow = agent({ id: 'wf:x', kind: 'workflow', parent_id: null, created_at: 4 });
  assert.deepEqual(shape(arrangeAgents([flow, b, a, s1])), [
    'session:s1@0',
    '[mediaorganizer-77]',
    'sub:a@1',
    'sub:b@1',
    `[${OTHER_HEADING}]`,
    'wf:x@0',
  ]);
  // With no session in the pool at all, the remembered name still groups them.
  assert.deepEqual(shape(arrangeAgents([b, a])), ['[mediaorganizer-77]', 'sub:a@1', 'sub:b@1']);
});
