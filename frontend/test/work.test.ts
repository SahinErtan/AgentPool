/**
 * What an agent is doing, from its tool, and whether its session waits for
 * the person. Pure, so it is checked here without a browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AgentView, SessionEventView } from '../src/net/types';
import { initialWork, needsYou, smoothWork, toolKind, type WorkKind } from '../src/scene/pool3d/work';

test('every tool name gives the kind of work its row in the table says', () => {
  const rows: [WorkKind, string[]][] = [
    ['run', ['Bash', 'BashOutput', 'KillShell', 'KillBash', 'Monitor', 'TaskStop']],
    ['edit', ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']],
    ['read', ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch', 'LSP']],
    ['web', ['WebSearch', 'WebFetch']],
    ['delegate', ['Agent', 'Task', 'Workflow', 'SendMessage']],
    ['plan', ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion']],
  ];
  for (const [kind, names] of rows) {
    for (const name of names) assert.equal(toolKind(name), kind, name);
  }
});

test('no tool, an empty name and an unknown tool are other work', () => {
  assert.equal(toolKind(null), 'other');
  assert.equal(toolKind(undefined), 'other');
  assert.equal(toolKind(''), 'other');
  assert.equal(toolKind('mcp__y__frobnicate'), 'other');
});

test('an MCP browser or search tool is web work, whatever its server is called', () => {
  assert.equal(toolKind('mcp__x__browser_click'), 'web');
  assert.equal(toolKind('mcp__plugin_playwright_playwright__browser_click'), 'web');
  assert.equal(toolKind('mcp__claude-mem__search'), 'web');
  assert.equal(toolKind('mcp__Chrome__open'), 'web');
});

/** Feed a sequence of kinds, one every `gap` seconds, and record what is shown. */
function showing(sequence: [WorkKind, number][]): { at: number; shown: WorkKind }[] {
  let w = initialWork(sequence[0][0], 0);
  const out: { at: number; shown: WorkKind }[] = [];
  let t = 0;
  for (const [kind, seconds] of sequence) {
    for (let s = 0; s < seconds; s += 0.5) {
      t += 0.5;
      out.push({ at: t, shown: smoothWork(w, kind, t) });
    }
  }
  return out;
}

test('reading, editing and reading again with short gaps never leaves read', () => {
  const w = initialWork('read', 0);
  let shown: WorkKind = 'read';
  for (let i = 1; i <= 30; i += 1) {
    const latest: WorkKind = i % 2 === 0 ? 'read' : 'edit';
    shown = smoothWork(w, latest, i);
    if (i % 2 === 1) assert.equal(shown, 'read', `second ${i}`);
  }
  assert.equal(shown, 'read');
});

test('an edit held for 3 s switches the stroke once read has been shown for 10 s', () => {
  const samples = showing([
    ['read', 10],
    ['edit', 3],
  ]);
  const before = samples.filter((s) => s.at <= 10);
  assert.ok(before.every((s) => s.shown === 'read'));
  const after = samples.filter((s) => s.at > 10);
  assert.equal(after[after.length - 1].shown, 'edit');
});

test('nothing switches before 6 s of showing, however long the candidate is held', () => {
  const samples = showing([
    ['read', 1],
    ['run', 8],
  ]);
  const early = samples.filter((s) => s.at < 6);
  assert.ok(early.every((s) => s.shown === 'read'), 'switched before 6 s');
  assert.equal(samples[samples.length - 1].shown, 'run');
});

const SESSION = 'session-1';

function agent(patch: Partial<AgentView> = {}): Pick<AgentView, 'kind' | 'session_id' | 'last_event_at' | 'status'> {
  return { kind: 'session', session_id: SESSION, last_event_at: 1000, status: 'working', ...patch };
}

function event(type: string, ts: number, patch: Partial<SessionEventView> = {}): SessionEventView {
  return { event_id: `${type}-${ts}`, ts, type, session_id: SESSION, detail: null, source: 'hook', ...patch };
}

test('a permission newer than the last own event means the session needs the person', () => {
  assert.equal(needsYou(agent(), [event('permission', 1010)], 1020), true);
});

test('a later event of the agent means the question was answered', () => {
  assert.equal(needsYou(agent({ last_event_at: 1030 }), [event('permission', 1010)], 1040), false);
});

test('another session\'s question does not count', () => {
  assert.equal(needsYou(agent(), [event('permission', 1010, { session_id: 'other' })], 1020), false);
});

test('a sub-agent does not ask the person by itself', () => {
  assert.equal(needsYou(agent({ kind: 'subagent' }), [event('permission', 1010)], 1020), false);
});

test('a question older than 15 minutes does not count', () => {
  assert.equal(needsYou(agent(), [event('permission', 1000)], 1000 + 15 * 60 + 1), false);
});

test('a notification that an agent completed is not a question', () => {
  const done = event('notification', 1010, { detail: 'agent_completed: done' });
  assert.equal(needsYou(agent(), [done], 1020), false);
  const asking = event('notification', 1010, { detail: 'Claude needs your input' });
  assert.equal(needsYou(agent(), [asking], 1020), true);
});

test('a finished agent does not wait for anybody', () => {
  assert.equal(needsYou(agent({ status: 'finished' }), [event('permission', 1010)], 1020), false);
});
