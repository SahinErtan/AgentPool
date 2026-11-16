/**
 * The names on the screen: the naming rule, the placeholders, and the
 * duplicates. Pure, so it is checked here without a browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AgentView } from '../src/net/types';
import {
  agentNames,
  displayNames,
  fullName,
  isPlaceholder,
  lastFolder,
  MAX_NAME,
  tidyName,
} from '../src/scene/names';

/** An agent as the backend sends it; the fields that a test does not care about are empty. */
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
    created_at: 1_700_000_000,
    last_event_at: 1_700_000_000,
    started_at: 1_700_000_000,
    finished_at: null,
    event_count: 0,
    leaving_deadline: null,
    scene: 'pool',
    presentation: { mode: 'swim', slot: null, props: {} },
    ...over,
  };
}

function session(id: string, over: Partial<AgentView> = {}): AgentView {
  return agent({ id: `session:${id}`, kind: 'session', session_id: id, label: 'main', ...over });
}

function subagent(id: string, parent: AgentView, over: Partial<AgentView> = {}): AgentView {
  return agent({
    id: `sub:${id}`,
    kind: 'subagent',
    parent_id: parent.id,
    session_id: parent.session_id,
    subagent_type: 'Explore',
    label: 'Explore',
    ...over,
  });
}

test('tidyName collapses whitespace and cuts at a word boundary', () => {
  assert.equal(tidyName('  pool   sprint \n now '), 'pool sprint now');
  assert.equal(tidyName('short'), 'short');
  const long = 'Check how far Sprint 21 got and what is still open in the pool';
  const cut = tidyName(long);
  assert.ok(cut.length <= MAX_NAME, cut);
  assert.ok(cut.endsWith('…'));
  assert.ok(long.startsWith(cut.slice(0, -1).trimEnd()), cut);
});

test('a single word longer than the limit is cut inside it, never longer', () => {
  const word = 'pool-scene-3d-sprint-with-a-very-long-name';
  const cut = tidyName(word);
  assert.equal(cut.length, MAX_NAME);
  assert.ok(cut.endsWith('…'));
});

test('a placeholder is never a name, and the empty string is one too', () => {
  for (const text of ['main', 'session', 'subagent', 'task', '', '  ', 'Main']) {
    assert.ok(isPlaceholder(text), JSON.stringify(text));
  }
  assert.ok(!isPlaceholder('pool-sprint'));
});

test('the folder of a cwd is its last part, on either separator', () => {
  assert.equal(lastFolder('/home/me/src/AgentPool/'), 'AgentPool');
  assert.equal(lastFolder('C:\\work\\forecast'), 'forecast');
  assert.equal(lastFolder('/'), null);
  assert.equal(lastFolder(null), null);
});

test('a session is named on the disk, then by its project, then by its id', () => {
  assert.equal(fullName(session('abcdef12', { label: 'pool-sprint' })), 'pool-sprint');
  // The label is the placeholder the backend writes when the disk has no name.
  assert.equal(fullName(session('abcdef12', { label: 'main', project: 'AgentPool' })), 'AgentPool');
  // No project either: the folder of the cwd, then the id.
  assert.equal(fullName(session('abcdef12', { label: 'main', cwd: '/x/y/forecast' })), 'forecast');
  assert.equal(fullName(session('abcdef12', { label: 'main' })), 'session abcd');
});

test('a subagent is named by its description, then its type, then the subagent placeholder', () => {
  const parent = session('p1', { label: 'pool-sprint' });
  assert.equal(
    fullName(subagent('a', parent, { description: 'Implement Sprint 21', subagent_type: 'Explore' })),
    'Implement Sprint 21',
  );
  assert.equal(fullName(subagent('b', parent, { subagent_type: 'Plan' })), 'Plan');
  assert.equal(fullName(subagent('c', parent, { subagent_type: null, label: 'general-purpose' })), 'general-purpose');
  assert.equal(fullName(subagent('d', parent, { subagent_type: null, label: 'subagent' })), 'subagent');
});

test('a workflow is named by its description, then its name or type, then the task placeholder', () => {
  const wf = (over: Partial<AgentView>) => agent({ id: 'wf:x', kind: 'workflow', label: 'task', ...over });
  assert.equal(fullName(wf({ description: 'Sweep the lint warnings' })), 'Sweep the lint warnings');
  assert.equal(fullName(wf({ subagent_type: 'Sweep' })), 'Sweep');
  assert.equal(fullName(wf({})), 'task');
});

test('an older backend that sends only the label still gets the rule', () => {
  const parent = session('p2', { label: 'docs-pass' });
  assert.equal(fullName(agent({ id: 'session:p9', kind: 'session', label: 'docs-pass' })), 'docs-pass');
  assert.equal(fullName(subagent('old', parent, { subagent_type: null, label: 'Explore' })), 'Explore');
});

test('a session that is a placeholder never wins over its project', () => {
  const names = agentNames([session('abcdef12', { label: 'session', project: 'billing' })]);
  assert.equal(names.get('session:abcdef12')?.short, 'billing');
});

test('two sessions with one name in different projects get their projects', () => {
  const a = session('a1', { label: 'pool-sprint', project: 'AgentPool', created_at: 1 });
  const b = session('b2', { label: 'pool-sprint', project: 'forecast', created_at: 2 });
  const names = displayNames([a, b]);
  assert.equal(names.get(a.id), 'pool-sprint · AgentPool');
  assert.equal(names.get(b.id), 'pool-sprint · forecast');
});

test('two sessions with one name in one project are numbered, the oldest first', () => {
  const a = session('a1', { label: 'pool-sprint', project: 'AgentPool', created_at: 1 });
  const b = session('b2', { label: 'pool-sprint', project: 'AgentPool', created_at: 2 });
  const names = displayNames([b, a]);
  // The project does not tell them apart, so the context is left out.
  assert.equal(names.get(a.id), 'pool-sprint');
  assert.equal(names.get(b.id), 'pool-sprint 2');
});

test('three Explore subagents in one session are Explore, Explore 2 and Explore 3', () => {
  const parent = session('p1', { label: 'docs-pass', created_at: 1 });
  const first = subagent('e1', parent, { created_at: 10 });
  const second = subagent('e2', parent, { created_at: 11 });
  const third = subagent('e3', parent, { created_at: 12 });
  const names = displayNames([third, parent, first, second]);
  assert.equal(names.get(first.id), 'Explore');
  assert.equal(names.get(second.id), 'Explore 2');
  assert.equal(names.get(third.id), 'Explore 3');
});

test('the names stay the same when a fourth Explore arrives', () => {
  const parent = session('p1', { label: 'docs-pass', created_at: 1 });
  const three = [1, 2, 3].map((n) => subagent(`e${n}`, parent, { created_at: 9 + n }));
  const before = displayNames([parent, ...three]);
  const fourth = subagent('e4', parent, { created_at: 50 });
  const after = displayNames([parent, ...three, fourth]);
  for (const a of three) assert.equal(after.get(a.id), before.get(a.id));
  assert.equal(after.get(fourth.id), 'Explore 4');
});

test('subagents with one type in two sessions are told apart by their parent session', () => {
  const pa = session('pa', { label: 'alpha', created_at: 1 });
  const pb = session('pb', { label: 'beta', created_at: 2 });
  const a = subagent('a', pa, { created_at: 5 });
  const b = subagent('b', pb, { created_at: 6 });
  const names = displayNames([pa, pb, a, b]);
  assert.equal(names.get(a.id), 'Explore · alpha');
  assert.equal(names.get(b.id), 'Explore · beta');
});

test('a context that does not split a group is left out, and the numbers take over', () => {
  // Two subagents, both in the same session: the session cannot tell them apart.
  const parent = session('p1', { label: 'alpha', created_at: 1 });
  const x = subagent('x', parent, { created_at: 2 });
  const y = subagent('y', parent, { created_at: 3 });
  const names = displayNames([parent, x, y]);
  assert.equal(names.get(x.id), 'Explore');
  assert.equal(names.get(y.id), 'Explore 2');
});

test('a description of sixty characters is cut at a word and is never longer than the limit', () => {
  const parent = session('p1', { label: 'docs-pass' });
  const description = 'Read the naming table and check every row of the sprint plan against the code';
  const names = agentNames([parent, subagent('d', parent, { description })]);
  const got = names.get('sub:d');
  assert.ok(got);
  assert.ok(got.short.length <= MAX_NAME, got.short);
  assert.ok(got.short.endsWith('…'));
  assert.equal(got.full, description);
});

test('the full name is never cut, and it carries the context the short one has', () => {
  const a = session('a1', { label: 'pool-sprint', project: 'AgentPool', created_at: 1 });
  const b = session('b2', { label: 'pool-sprint', project: 'forecast', created_at: 2 });
  const names = agentNames([a, b]);
  assert.equal(names.get(a.id)?.full, 'pool-sprint · AgentPool');
  const long = session('c3', { label: 'pool-scene-3d-sprint-with-a-long-name', created_at: 3 });
  const longNames = agentNames([long]);
  assert.equal(longNames.get(long.id)?.full, 'pool-scene-3d-sprint-with-a-long-name');
  assert.ok((longNames.get(long.id)?.short.length ?? 0) <= MAX_NAME);
});

test('a long project keeps the base name readable', () => {
  const a = session('a1', { label: 'pool-sprint', project: 'a-very-long-project-folder-name', created_at: 1 });
  const b = session('b2', { label: 'pool-sprint', project: 'forecast', created_at: 2 });
  const names = displayNames([a, b]);
  const shortA = names.get(a.id) ?? '';
  assert.ok(shortA.length <= MAX_NAME, shortA);
  assert.ok(shortA.startsWith('pool-sprint'), shortA);
});

test('the names do not depend on the order the agents arrive in', () => {
  const pa = session('pa', { label: 'pool-sprint', project: 'AgentPool', created_at: 1 });
  const pb = session('pb', { label: 'pool-sprint', project: 'forecast', created_at: 2 });
  const subs = [3, 4, 5].map((n) => subagent(`s${n}`, pa, { created_at: n + 10 }));
  const forward = displayNames([pa, pb, ...subs]);
  const backward = displayNames([...subs].reverse().concat([pb, pa]));
  for (const [id, name] of forward) assert.equal(backward.get(id), name);
});

test('for any set of agents the names are all different, with deliberate collisions', () => {
  const agents: AgentView[] = [];
  const projects = ['AgentPool', 'forecast', 'shop', 'AgentPool', 'docs'];
  for (let s = 0; s < 12; s += 1) {
    const label = s % 3 === 0 ? 'pool-sprint' : s % 3 === 1 ? 'docs-pass' : 'main';
    const parent = session(`s${s}`, {
      label,
      project: s % 4 === 0 ? null : projects[s % projects.length],
      created_at: 100 + s,
    });
    agents.push(parent);
    for (let k = 0; k < 4; k += 1) {
      const sub = subagent(`s${s}-${k}`, parent, {
        created_at: 200 + s * 10 + k,
        description: k % 2 === 0 ? null : 'Implement Sprint 21',
        subagent_type: k === 3 ? 'Plan' : 'Explore',
      });
      agents.push(sub);
    }
  }
  assert.equal(agents.length, 60);

  const names = displayNames(agents);
  assert.equal(names.size, 60);
  const seen = new Set<string>();
  for (const [id, name] of names) {
    assert.ok(name.length <= MAX_NAME, `${id}: ${name}`);
    assert.ok(!seen.has(name), `two agents are called ${name}`);
    seen.add(name);
  }
});

test('a name never changes when the rule is run again on the same agents', () => {
  const agents = [
    session('a1', { label: 'pool-sprint', project: 'AgentPool', created_at: 1 }),
    session('b2', { label: 'pool-sprint', project: 'forecast', created_at: 2 }),
  ];
  assert.deepEqual([...displayNames(agents)], [...displayNames(agents)]);
});

test('two subagents whose session has left are told apart by the session the backend remembers', () => {
  const make = (id: string, session: string, created: number): AgentView =>
    agent({
      id,
      kind: 'subagent',
      parent_id: `session:${session}`,
      session_id: session,
      subagent_type: 'Explore',
      session_name: session === 'a' ? 'pool-sprint' : 'media-77',
      created_at: created,
    });
  const names = agentNames([make('sub:1', 'a', 1), make('sub:2', 'b', 2)]);
  const shown = [names.get('sub:1')?.short, names.get('sub:2')?.short];
  assert.notEqual(shown[0], shown[1]);
  assert.ok(shown.some((name) => name?.includes('media-77')), String(shown));
});
