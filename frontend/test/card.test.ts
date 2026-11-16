/**
 * The card under the pointer: which rows it has, and what they say.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AgentView } from '../src/net/types';
import { cardContent, elapsedText, PROMPT_LIMIT } from '../src/scene/card';
import { agentNames } from '../src/scene/names';

const NOW = 1_700_000_000;

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
    created_at: NOW - 240,
    last_event_at: NOW,
    started_at: NOW - 240,
    finished_at: null,
    event_count: 0,
    leaving_deadline: null,
    scene: 'pool',
    presentation: { mode: 'swim', slot: null, props: {} },
    ...over,
  };
}

test('elapsed time is said in seconds, minutes and hours', () => {
  assert.equal(elapsedText(12.4), '12 s');
  assert.equal(elapsedText(240), '4 min');
  assert.equal(elapsedText(3_900), '1 h 5 min');
  assert.equal(elapsedText(-3), '0 s');
});

test('a session card names the session in full, its project, its activity and its prompt', () => {
  const session = agent({
    id: 'session:abc',
    kind: 'session',
    session_id: 'abc',
    label: 'pool-scene-3d-sprint',
    project: 'AgentPool',
    activity: 'Bash: npm test',
    prompt: 'check how far Sprint 21 got',
  });
  const names = agentNames([session]);
  const card = cardContent(session, names.get(session.id), null, NOW, false);
  assert.equal(card.title, 'pool-scene-3d-sprint');
  const text = card.lines.map((line) => line.text);
  assert.deepEqual(text, [
    'session · AgentPool',
    'now: Bash: npm test',
    'working for 4 min',
    '"check how far Sprint 21 got"',
  ]);
});

test('a subagent card says its description uncut, its parent, and its type as the kind', () => {
  const parent = agent({ id: 'session:p', kind: 'session', session_id: 'p', label: 'pool-sprint', project: 'AgentPool' });
  const description = 'Implement Sprint 21 for the naming table and check every row of it against the code';
  const sub = agent({
    id: 'sub:1',
    kind: 'subagent',
    parent_id: parent.id,
    session_id: 'p',
    subagent_type: 'Explore',
    description,
    activity: 'Grep: displayNames',
  });
  const names = agentNames([parent, sub]);
  const card = cardContent(sub, names.get(sub.id), names.get(parent.id)?.full ?? null, NOW, false);
  assert.equal(card.lines[0].text, 'Explore');
  // The title is the description uncut, so no line says it a second time.
  assert.equal(card.title, description);
  assert.ok(!card.lines.some((line) => line.text.startsWith('in: ')));
  assert.ok(card.lines.some((line) => line.text === 'of: pool-sprint · AgentPool' || line.text === 'of: pool-sprint'));
  assert.ok(!card.lines.some((line) => line.text.startsWith('"')), 'a subagent has no prompt');
});

test('an idle agent says so, and a session that needs the person says so first, in its own line', () => {
  const session = agent({ id: 'session:q', kind: 'session', status: 'idle', session_id: 'q', label: 'docs-pass', project: 'AgentPool' });
  const names = agentNames([session]);
  const card = cardContent(session, names.get(session.id), null, NOW, true);
  assert.deepEqual(card.lines[0], { text: 'needs you', attention: true });
  assert.ok(card.lines.some((line) => line.text === 'now: idle'));
  assert.equal(card.lines.filter((line) => line.attention).length, 1);
});

test('the prompt is kept to about two lines, cut at a word', () => {
  const prompt = 'x '.repeat(200).trim();
  const session = agent({ id: 'session:r', kind: 'session', session_id: 'r', label: 'a', prompt });
  const card = cardContent(session, agentNames([session]).get(session.id), null, NOW, false);
  const line = card.lines[card.lines.length - 1].text;
  assert.ok(line.startsWith('"') && line.endsWith('…"'), line);
  assert.ok(line.length <= PROMPT_LIMIT + 3, `${line.length}`);
});

test('a card for an agent the names do not know still has a title', () => {
  const sub = agent({ id: 'sub:9', kind: 'subagent', subagent_type: 'Plan', label: 'Plan' });
  const card = cardContent(sub, undefined, null, NOW, false);
  assert.equal(card.title, 'Plan');
});

test('a working agent whose tool is not known yet does not say it is idle', () => {
  const session = agent({ id: 'session:r', kind: 'session', session_id: 'r', label: 'warm-up' });
  const card = cardContent(session, agentNames([session]).get(session.id), null, NOW, false);
  assert.ok(!card.lines.some((line) => line.text.startsWith('now: ')));
  assert.ok(card.lines.some((line) => line.text.startsWith('working for ')));
});

test('a subagent whose session has left the pool still says whose it is', () => {
  const sub = agent({
    id: 'sub:9',
    kind: 'subagent',
    parent_id: 'session:gone',
    session_id: 'gone',
    description: 'Olguları doğrula',
    session_name: 'mediaorganizer-77',
  });
  const names = agentNames([sub]);
  const card = cardContent(sub, names.get(sub.id), sub.session_name ?? null, NOW, false);
  assert.ok(card.lines.some((line) => line.text === 'of: mediaorganizer-77'));
});

test('an idle agent on its lounger says what it rests at, in its own line after the state', () => {
  const session = agent({ id: 'session:lounge', kind: 'session', status: 'idle', session_id: 'lounge', label: 'docs-pass', project: 'AgentPool' });
  const names = agentNames([session]);
  const card = cardContent(session, names.get(session.id), null, NOW, false, 'reading');
  const text = card.lines.map((line) => line.text);
  assert.ok(text.includes('resting: reading'));
  assert.ok(text.indexOf('resting: reading') === text.indexOf('now: idle') + 1, 'it follows the state line');
});

test('a nap says how long the agent has been idle', () => {
  const session = agent({ id: 'session:nap', kind: 'session', status: 'idle', session_id: 'nap', label: 'nightly' });
  const card = cardContent(session, agentNames([session]).get(session.id), null, NOW, false, 'asleep (32 min idle)');
  assert.ok(card.lines.some((line) => line.text === 'resting: asleep (32 min idle)'));
});

test('the resting line is absent for a working agent, even when it is given one', () => {
  const session = agent({ id: 'session:busy', kind: 'session', status: 'working', session_id: 'busy', label: 'busy', activity: 'Bash: npm test' });
  const card = cardContent(session, agentNames([session]).get(session.id), null, NOW, false, 'tea');
  assert.ok(!card.lines.some((line) => line.text.startsWith('resting: ')));
});

test('without a resting line, the card is what it was', () => {
  const session = agent({ id: 'session:plain', kind: 'session', status: 'idle', session_id: 'plain', label: 'plain' });
  const names = agentNames([session]);
  const plain = cardContent(session, names.get(session.id), null, NOW, false);
  assert.ok(!plain.lines.some((line) => line.text.startsWith('resting: ')));
  assert.deepEqual(plain, cardContent(session, names.get(session.id), null, NOW, false, null));
});
