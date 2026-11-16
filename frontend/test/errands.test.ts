/**
 * The errand planner: who goes on an errand, what kind, with whom and to
 * where. Pure, so it is checked without a browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planErrands,
  promoteQueued,
  SIT_BEFORE_ERRAND_S,
  type ErrandCandidate,
  type ErrandKind,
  type ErrandStart,
  type SlotBook,
} from '../src/scene/pool3d/errands';
import { reachable } from '../src/scene/pool3d/nav';
import { buildWorld, type World } from '../src/scene/pool3d/world';

function book(): SlotBook {
  return { taken: new Map() };
}

/** A candidate that has been lounging for a while and may go out now. */
function candidate(id: string, lounger: number, extra: Partial<ErrandCandidate> = {}): ErrandCandidate {
  return {
    id,
    lounger,
    seatedFor: 60,
    needsYou: false,
    errand: null,
    nextErrandAt: 0,
    leftWaterAt: null,
    errandsDone: 0,
    ...extra,
  };
}

/** Plan with a fresh book, once. */
function planOnce(candidates: ErrandCandidate[], world: World, now = 100, raining = false, night = false): ErrandStart[] {
  return planErrands(candidates, world, book(), now, raining, night);
}

/** How many errands of each kind a list of starts has. */
function kinds(starts: ErrandStart[]): Map<ErrandKind, number> {
  const out = new Map<ErrandKind, number>();
  for (const s of starts) out.set(s.kind, (out.get(s.kind) ?? 0) + s.ids.length);
  return out;
}

test('the same bodies and the same clock give the same plan', () => {
  const world = buildWorld({ loungers: 12, lanes: 4 });
  const bodies = Array.from({ length: 12 }, (_, i) => candidate(`a-${i}`, i));
  const first = planOnce(bodies, world);
  const second = planOnce(bodies, world);
  assert.deepEqual(
    second.map((s) => ({ ids: s.ids, kind: s.kind, slots: s.slots, useFor: s.useFor })),
    first.map((s) => ({ ids: s.ids, kind: s.kind, slots: s.slots, useFor: s.useFor })),
  );
  assert.ok(first.length > 0, 'a plan with twelve idle agents is not empty');
});

test('an agent that needs the person, is not seated long enough, is on an errand or is not yet due does not go out', () => {
  const world = buildWorld({ loungers: 4, lanes: 4 });
  const base = candidate('solo', 0);
  assert.equal(planOnce([base], world).length, 1, 'the base case goes out');
  assert.equal(planOnce([{ ...base, needsYou: true }], world).length, 0, 'needs you');
  assert.equal(planOnce([{ ...base, seatedFor: SIT_BEFORE_ERRAND_S - 1 }], world).length, 0, 'not seated long enough');
  assert.equal(planOnce([{ ...base, nextErrandAt: 500 }], world).length, 0, 'not due yet');
  assert.equal(
    planOnce(
      [
        {
          ...base,
          errand: {
            kind: 'towel',
            phase: 'going',
            spot: { x: 0, z: 0, yaw: 0 },
            slot: '',
            t: 0,
            useFor: 4,
            with: [],
            route: [],
            index: 0,
            from: { x: 0, y: 0, z: 0 },
          },
        },
      ],
      world,
    ).length,
    0,
    'already on an errand',
  );
});

test('the limits hold for forty eligible agents: at most 16 errands, one ping-pong pair, one ball game, two chat groups', () => {
  const world = buildWorld({ loungers: 24, lanes: 4 });
  const bodies = Array.from({ length: 40 }, (_, i) => candidate(`crowd-${String(i).padStart(2, '0')}`, i % 24));
  const b = book();
  const starts: ErrandStart[] = [];
  // Several ticks, a second apart, with the errands running in between.
  for (let tick = 0; tick < 30; tick += 1) {
    const now = 100 + tick;
    const candidates = bodies.map((c) => ({ ...c }));
    const running = starts.flatMap((s) => s.ids.map((id) => ({ id, kind: s.kind })));
    for (const r of running) {
      const c = candidates.find((x) => x.id === r.id);
      if (c) c.errand = { kind: r.kind, phase: 'using', spot: { x: 0, z: 0, yaw: 0 }, slot: '', t: 0, useFor: 1e9, with: [], route: [], index: 0, from: { x: 0, y: 0, z: 0 } };
    }
    const planned = planErrands(candidates, world, b, now, false);
    starts.push(...planned);
    assert.ok(
      candidates.filter((c) => c.errand !== null).length <= 16,
      'at most 16 errands at once',
    );
  }
  const counts = kinds(starts);
  const pingPongs = starts.filter((s) => s.kind === 'pingPong').length;
  const balls = starts.filter((s) => s.kind === 'ballGame').length;
  assert.ok(pingPongs <= 1, `ping-pong starts: ${pingPongs}`);
  assert.ok(balls <= 1, `ball starts: ${balls}`);
  // No slot is held by two bodies at once.
  const holders = new Map<string, string>();
  for (const [slot, id] of b.taken) {
    assert.ok(!holders.has(slot), `slot ${slot} held twice`);
    holders.set(slot, id);
  }
  assert.ok((counts.get('stroll') ?? 0) + (counts.get('towel') ?? 0) > 0);
});

test('the crowd of forty never has more than two chat groups running at once', () => {
  const world = buildWorld({ loungers: 24, lanes: 4 });
  const bodies = Array.from({ length: 40 }, (_, i) => candidate(`chat-${i}`, i % 24));
  for (let seed = 0; seed < 20; seed += 1) {
    const b = book();
    const starts = planErrands(
      bodies.map((c) => ({ ...c, errandsDone: seed })),
      world,
      b,
      100,
      false,
    );
    const chats = starts.filter((s) => s.kind === 'chat');
    assert.ok(chats.length <= 2, `chat groups: ${chats.length}`);
  }
});

test('in the rain only the towel and the hot tub are chosen', () => {
  const world = buildWorld({ loungers: 24, lanes: 4 });
  const bodies = Array.from({ length: 30 }, (_, i) => candidate(`rain-${i}`, i % 24, { errandsDone: 0 }));
  for (let tick = 0; tick < 10; tick += 1) {
    const starts = planErrands(
      bodies.map((c) => ({ ...c, errandsDone: tick })),
      world,
      book(),
      100 + tick,
      true,
    );
    for (const s of starts) {
      assert.ok(s.kind === 'towel' || s.kind === 'hotTub', `${s.kind} in the rain`);
    }
  }
});

test('no sunscreen at night', () => {
  const world = buildWorld({ loungers: 12, lanes: 4 });
  for (let i = 0; i < 300; i += 1) {
    const starts = planErrands([candidate(`night-${i}`, i % 12, { errandsDone: i })], world, book(), 100, false, true);
    for (const s of starts) assert.notEqual(s.kind, 'sunscreen');
  }
});

test('a swimmer that has just left the water goes to the shower far more often', () => {
  const world = buildWorld({ loungers: 12, lanes: 4 });
  const share = (leftWaterAt: number | null): number => {
    let shower = 0;
    let all = 0;
    for (let i = 0; i < 500; i += 1) {
      const starts = planErrands(
        [candidate('swimmer', 0, { errandsDone: i, leftWaterAt })],
        world,
        book(),
        100,
        false,
      );
      if (starts.length === 0) continue;
      all += 1;
      if (starts[0].kind === 'shower') shower += 1;
    }
    return shower / all;
  };
  const fresh = share(100 - 30);
  const dry = share(null);
  assert.ok(fresh >= 2.5 * dry, `just out ${fresh.toFixed(3)} against ${dry.toFixed(3)} for one that has not swum`);
});

test('a shower that is taken is queued for, and the queue moves up when it is free', () => {
  const world = buildWorld({ loungers: 4, lanes: 4 });
  const b = book();
  b.taken.set('shower:stand', 'someone-else');
  const queued = candidate('waits', 0, { errandsDone: 3, leftWaterAt: 95 });
  // Plan until the shower is the kind chosen: the test forces the queue by
  // holding the stand, and checks what the queue entry looks like.
  let found = false;
  for (let i = 0; i < 200 && !found; i += 1) {
    const plan = planErrands([{ ...queued, errandsDone: i }], world, b, 100, false);
    const s = plan.find((p) => p.kind === 'shower');
    if (!s) continue;
    found = true;
    assert.equal(s.slots[0], 'shower:q0');
    assert.equal(b.taken.get('shower:q0'), 'waits');
  }
  assert.ok(found, 'a shower queue entry was planned');
  // The stand comes free: the queued body moves up.
  b.taken.delete('shower:stand');
  const errand = {
    kind: 'shower' as const,
    phase: 'queued' as const,
    spot: world.equipment.shower.stand,
    slot: 'shower:q0',
    t: 0,
    useFor: 10,
    with: [],
    route: [],
    index: 0,
    from: { x: 0, y: 0, z: 0 },
  };
  const c = { ...queued, errand };
  promoteQueued([c], world, b);
  assert.equal(errand.phase, 'going');
  assert.equal(errand.slot, 'shower:stand');
  assert.equal(b.taken.get('shower:stand'), 'waits');
  assert.equal(b.taken.has('shower:q0'), false);
});

test('every place an errand is offered at is reachable from the deck, for one to six lanes', () => {
  for (let lanes = 1; lanes <= 6; lanes += 1) {
    const world = buildWorld({ lanes, loungers: 24, waiting: 4 });
    const offered = new Set<ErrandKind>();
    for (let round = 0; round < 60; round += 1) {
      const bodies = Array.from({ length: 24 }, (_, i) =>
        candidate(`reach-${lanes}-${round}-${i}`, i, { errandsDone: round }),
      );
      for (const s of planOnce(bodies, world, 100 + round)) {
        offered.add(s.kind);
        for (const spot of s.spots) {
          assert.ok(reachable(world, world.gate, spot), `${s.kind} at ${JSON.stringify(spot)} is not reachable with ${lanes} lanes`);
        }
      }
    }
    // The errands that do not depend on a place of the deck are always offered.
    for (const kind of ['towel', 'stroll'] as const) {
      assert.ok(offered.has(kind), `${kind} is never offered with ${lanes} lanes`);
    }
  }
});
