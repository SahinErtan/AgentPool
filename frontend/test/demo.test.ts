/**
 * The demo crowd: the scripted fake agents that `?demo` puts in the pool.
 *
 * Everything here is pure, so the crowd can be watched without a browser:
 * the same ids and the same clock give the same pool every time.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AgentView } from '../src/net/types';
import {
  createDemoState,
  demoAgents,
  demoCount,
  demoEvents,
  DEMO_LANES,
} from '../src/scene/demo/demoFeed';

const MODES = new Set(['swim', 'lounge', 'waiting', 'exiting', 'leaving', 'offscreen']);

test('the demo is asked for with ?demo, and the number is read from it', () => {
  assert.equal(demoCount(''), 0);
  assert.equal(demoCount('?demo'), 12);
  assert.equal(demoCount('?demo=5'), 5);
  assert.equal(demoCount('?demo=999'), 60);
  assert.equal(demoCount('?x=1&demo=3'), 3);
  assert.equal(demoCount('?debug'), 0);
  assert.equal(demoCount('?demo=0'), 1);
});

test('the same crowd at the same moment is the same crowd', () => {
  const t = 1_700_000_000;
  const first = demoAgents(12, t, createDemoState(12, t));
  const second = demoAgents(12, t, createDemoState(12, t));
  assert.deepEqual(first, second);
  assert.equal(first.length, 12);
});

test('the crowd keeps its shape over ten minutes', () => {
  const start = 1_700_000_000;
  const state = createDemoState(12, start);
  const seenEvents = new Set<string>();
  const seenIds = new Set<string>();
  let finished = 0;
  let generations = 0;

  for (let t = 0; t < 600; t += 0.5) {
    const now = start + t;
    const agents = demoAgents(12, now, state);
    assert.ok(agents.length > 0, 'the pool went empty');

    // Every agent is somewhere the scene knows about.
    for (const agent of agents) {
      assert.ok(MODES.has(agent.presentation.mode), `${agent.id} is ${agent.presentation.mode}`);
      assert.equal(agent.scene, 'pool');
      if (agent.status === 'finished') finished += 1;
    }

    // No two swimmers in one lane are in the same place across it.
    const offsets = new Map<string, Set<string>>();
    const loungers = new Map<string, string>();
    const waiting = new Map<string, string>();
    for (const agent of agents) {
      const props = agent.presentation.props;
      if (agent.presentation.mode === 'swim') {
        const lane = String(props.lane);
        const offset = String(props.lane_offset);
        if (!offsets.has(lane)) offsets.set(lane, new Set());
        const set = offsets.get(lane)!;
        assert.ok(!set.has(offset), `two swimmers in lane ${lane} share an offset`);
        set.add(offset);
      }
      if (agent.presentation.mode === 'lounge') {
        const lounger = String(props.lounger);
        assert.ok(!loungers.has(lounger), `two agents on lounger ${lounger}`);
        loungers.set(lounger, agent.id);
      }
      if (agent.presentation.mode === 'waiting' && props.waiting !== null) {
        const spot = String(props.waiting);
        assert.ok(!waiting.has(spot), `two agents on waiting spot ${spot}`);
        waiting.set(spot, agent.id);
      }
      // A sub-agent carries its generation in its id.
      if (agent.id.startsWith('sub:')) {
        const gen = Number(agent.id.split('-').pop());
        assert.ok(Number.isFinite(gen), agent.id);
        if (gen > 0) generations += 1;
        seenIds.add(agent.id);
      }
    }

    for (const event of demoEvents(12, now, state)) {
      assert.equal(event.type, 'permission');
      assert.ok(!seenEvents.has(event.event_id), 'the same event twice');
      seenEvents.add(event.event_id);
    }
  }

  assert.ok(seenEvents.size > 0, 'nobody ever asked for anything');
  assert.ok(finished > 0, 'nothing ever finished');
  assert.ok(generations > 0, 'no new generation ever turned up');
});

test('a session ends in the demo, so that the gate celebration can be seen', () => {
  // The gate celebration needs a session that ends. Without one the demo
  // can never show the confetti or the fireworks.
  const start = 1_700_000_000;
  const state = createDemoState(12, start);
  const ids = new Set<string>();
  let leaving = 0;
  let finished = 0;
  for (let t = 0; t < 900; t += 0.5) {
    for (const agent of demoAgents(12, start + t, state)) {
      if (agent.kind !== 'session') continue;
      ids.add(agent.id);
      if (agent.status === 'leaving') leaving += 1;
      if (agent.status === 'finished') finished += 1;
    }
  }
  assert.ok(finished > 0, 'no session ever finished');
  assert.ok(leaving > 0, 'no session ever left');
  assert.ok(ids.size > 1, 'the session never changed its id');
});

test('the crowd has sessions, a workflow and sub-agents, and no MCP server', () => {
  const start = 1_700_000_000;
  const agents = demoAgents(12, start + 5, createDemoState(12, start));
  const kinds = new Set(agents.map((a) => a.kind));
  assert.ok(kinds.has('session'));
  assert.ok(kinds.has('workflow'));
  assert.ok(kinds.has('subagent'));
  // An MCP server is not a character any more: its calls belong to a session.
  assert.ok(!kinds.has('mcp' as AgentView['kind']));
  // Every sub-agent belongs to a session of the crowd.
  const sessions = new Set(agents.filter((a) => a.kind === 'session').map((a) => a.id));
  for (const agent of agents) {
    if (agent.kind !== 'subagent') continue;
    assert.ok(agent.parent_id && sessions.has(agent.parent_id), agent.id);
    assert.ok(agent.subagent_type, agent.id);
  }
});

test('the scene description grows with the crowd of idle agents', () => {
  const start = 1_700_000_000;
  const state = createDemoState(12, start);
  demoAgents(12, start, state);
  const payload = state.payload;
  assert.ok(payload);
  assert.equal(payload.lanes, DEMO_LANES);
  assert.equal(payload.waiting, 4);
  assert.ok(Number(payload.loungers) >= 6 && Number(payload.loungers) <= 12);
});

test('the crowd at 24 and at 60 shows no two agents under one name', async () => {
  const { agentNames } = await import('../src/scene/names');
  for (const n of [12, 24, 60]) {
    const start = 1_700_000_000;
    const agents = demoAgents(n, start + 30, createDemoState(n, start));
    const names = agentNames(agents);
    const seen = new Set<string>();
    for (const agent of agents) {
      const name = names.get(agent.id)?.short ?? '';
      assert.ok(name.length > 0 && name.length <= 24, `${agent.id}: "${name}"`);
      assert.ok(!seen.has(name), `${n} agents: two are called "${name}"`);
      seen.add(name);
    }
  }
});

test('the demo has two sessions called pool-sprint, in two projects, and no MCP name', async () => {
  const { displayNames } = await import('../src/scene/names');
  const start = 1_700_000_000;
  const agents = demoAgents(24, start, createDemoState(24, start));
  const names = [...displayNames(agents).values()];
  assert.ok(names.includes('pool-sprint · AgentPool'));
  assert.ok(names.includes('pool-sprint · forecast'));
  assert.ok(!names.some((name) => name.includes('playwright')));
  // Every working agent has something to say it is doing.
  for (const agent of agents) {
    if (agent.status === 'working') assert.ok(agent.activity, agent.id);
    else assert.equal(agent.activity, null, agent.id);
  }
});
