/**
 * The filter of the agent list.
 *
 * The list holds everything; the filter is what makes it readable when
 * there are twenty agents in it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matches, rowAccessibleName, rowDescription } from '../src/ui/AgentList';
import { cutAtWord, plainText } from '../src/ui/Inspector';
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

/**
 * The second line of a row.
 *
 * The label of a subagent is its kind, so seven rows can say
 * "general-purpose" and nothing tells them apart. The description is the
 * one thing that does.
 */
function subagent(overrides: Partial<AgentView>): AgentView {
  return {
    ...agent('a', 'subagent', 'working'),
    label: 'general-purpose',
    ...overrides,
  };
}

test('the description of an agent is what the row says', () => {
  const row = subagent({
    detail: 'Reviews a batch of Alice session digests and extracts the non-code deliverables',
    tool_name: 'Bash',
    presentation: { mode: 'lounge', slot: 'slot:3', props: {} },
  });
  // The description wins over the tool and the slot, and it is cut at a
  // word boundary: a cut in the middle of a word is unreadable.
  assert.equal(rowDescription(row), 'Reviews a batch of Alice session digests…');
});

test('a description of a few words is shown as it is', () => {
  const row = subagent({ detail: 'Reads the memory files' });
  assert.equal(rowDescription(row), 'Reads the memory files');
});

test('an agent with only a tool says the tool', () => {
  const row = subagent({ tool_name: 'Bash' });
  assert.equal(rowDescription(row), 'Bash');
});

test('the tool of the last event is the tool of the row', () => {
  const row = subagent({
    tool_name: 'Bash',
    events: [
      { ts: 1, type: 'tool', tool: 'Read', detail: null },
      { ts: 2, type: 'tool', tool: 'Grep', detail: null },
    ],
  });
  assert.equal(rowDescription(row), 'Grep');
});

test('an agent with only a slot says the slot', () => {
  const row = subagent({ presentation: { mode: 'lounge', slot: 'slot:7', props: {} } });
  assert.equal(rowDescription(row), 'slot:7');
});

test('an agent with nothing to say says a dash', () => {
  assert.equal(rowDescription(subagent({})), '—');
});

test('a folder is not a description', () => {
  // The path belongs to the "Folder" row of the inspector: as the second
  // line of a row it would tell nothing about the agent.
  const row = subagent({
    detail: '/home/alice/code/src',
    tool_name: 'Bash',
  });
  assert.equal(rowDescription(row), 'Bash');
});

test('a windows path is a folder as well', () => {
  const row = subagent({
    detail: 'C:\\Users\\alice\\project',
    presentation: { mode: 'lounge', slot: 'slot:2', props: {} },
  });
  assert.equal(rowDescription(row), 'slot:2');
});

test('the screen reader hears which agent the row is', () => {
  const row = subagent({
    detail: 'Reads the memory files',
    created_at: 1_700_000_000,
    started_at: 1_700_000_000,
  });
  const name = rowAccessibleName(row, 1_700_000_060_000);
  assert.equal(name, 'general-purpose, working, Reads the memory files, 1m 0s');
});

test('the long detail of an agent is plain text and cut at a word', () => {
  const prompt = '# Title\n\n**Do** the thing with `code`.\n\nAnd then some more words.';
  const text = plainText(prompt);
  assert.equal(text, 'Title Do the thing with code. And then some more words.');
  const cut = cutAtWord(text, 40);
  assert.equal(cut, 'Title Do the thing with code. And then…');
  // The cut never happens in the middle of a word: the text before the
  // ellipsis ends with a whole word.
  assert.equal(text.startsWith(cut.slice(0, -1)), true);
});

test('a single long word is not cut in half', () => {
  const cut = cutAtWord('Donaudampfschifffahrtselektrizitaetenhauptbetriebswerkbauunterbeamtengesellschaft', 20);
  assert.equal(cut, 'Donaudampfschifffahrtselektrizitaetenhauptbetriebswerkbauunterbeamtengesellschaft');
});
