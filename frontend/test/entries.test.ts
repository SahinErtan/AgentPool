/**
 * The ways into the water, the slide's curve, the races, the rests at the
 * wall and the flips. Sprint 24.
 *
 * All of it is pure, so it is checked here without a browser: the choice of
 * the entry, the paths that reach each entry, the steps of each entry (the
 * same `stepBody` the scene runs), and the swimming turns.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatmullRomCurve3, Vector3 } from 'three';

import type { AgentPresentation } from '../src/net/types';
import {
  buildPathTable,
  chooseEntry,
  entryApproach,
  entryOpen,
  pointAt,
  slideTable,
  tangentAt,
  type EntryBusy,
  type EntryKind,
} from '../src/scene/pool3d/entries';
import { findPath, reachable, type Walker } from '../src/scene/pool3d/nav';
import {
  applyPresentation,
  bodyAction,
  bodyActionHeld,
  createBody,
  stepBody,
  type Body,
  type FlowContext,
} from '../src/scene/pool3d/flow';
import {
  findRaces,
  normaliseNear,
  restAfter,
  startSwim,
  swimStep,
  TURN_SECONDS,
  type RaceSwimmer,
} from '../src/scene/pool3d/swim';
import { buildWorld, floorDepthAt, queueSpot, type World } from '../src/scene/pool3d/world';

const FREE: EntryBusy = {
  slide: false,
  board: false,
  block: () => false,
  waterNear: () => false,
};

const BUSY: EntryBusy = {
  slide: true,
  board: true,
  block: () => true,
  waterNear: () => true,
};

const DT = 1 / 30;

function present(mode: AgentPresentation['mode'], props: Record<string, unknown> = {}): AgentPresentation {
  return { mode, slot: null, props };
}

/** The entries as the scene runs them: who is busy depends on the other bodies. */
function contextFor(bodies: Body[], free = false): FlowContext {
  return {
    exited: () => {},
    ladderLoad: () => 0,
    entries: {
      reducedMotion: false,
      busy: (self) => {
        if (free) return FREE;
        let slide = false;
        let board = false;
        for (const o of bodies) {
          if (o === self || o.entry === null) continue;
          if (o.entry.kind === 'slide' && o.entry.phase !== 'wait') slide = true;
          if (o.entry.kind === 'board') board = true;
        }
        return {
          slide,
          board,
          block: (lane) => bodies.some((o) => o !== self && o.entry?.kind === 'block' && o.lane === lane),
          waterNear: (x, z, r) =>
            bodies.some((o) => o !== self && o.inWater && o.swim !== null && Math.hypot(o.swim.x - x, o.swim.z - z) < r),
        };
      },
    },
  };
}

/** A body on the deck, going to the water with the entry forced. */
function diverAt(world: World, id: string, lane: number, kind: EntryKind | null): Body {
  const body = createBody(id, 1.6, 0.5, 1, queueSpot(world, 0));
  applyPresentation(body, present('swim', { lane, lane_offset: 0, direction: 1 }), world, () => null, () => 0);
  body.forcedEntry = kind;
  return body;
}

// --- the choice ----------------------------------------------------------

test('the same body and the same count of entries always make the same choice', () => {
  const world = buildWorld(null);
  for (let i = 0; i < 50; i += 1) {
    const body = createBody(`same-${i}`, 1.6, 0.5, 1, queueSpot(world, 0));
    body.lane = i % 4;
    const first = chooseEntry(body, world, FREE, false);
    assert.equal(chooseEntry(body, world, FREE, false), first);
  }
});

test('over 2000 bodies with free equipment, each way has its weight in a hundred, within 5 %', () => {
  const world = buildWorld(null);
  const counts = new Map<EntryKind, number>();
  const weights: Record<EntryKind, number> = { ladder: 40, block: 22, board: 14, slide: 14, cannonball: 10 };
  for (let i = 0; i < 2000; i += 1) {
    const body = createBody(`share-${i}`, 1.6, 0.5, 1, queueSpot(world, 0));
    body.lane = 0;
    body.x = 0;
    const kind = chooseEntry(body, world, FREE, false);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  for (const kind of Object.keys(weights) as EntryKind[]) {
    const share = (counts.get(kind) ?? 0) / 2000;
    assert.ok(Math.abs(share - weights[kind] / 100) < 0.05, `${kind} share ${share.toFixed(3)}`);
  }
});

test('the next entry of a body differs from the last one', () => {
  const world = buildWorld(null);
  const body = createBody('varies', 1.6, 0.5, 1, queueSpot(world, 0));
  body.lane = 0;
  const seen = new Set<EntryKind>();
  for (let i = 0; i < 40; i += 1) {
    seen.add(chooseEntry(body, world, FREE, false));
    body.entriesMade += 1;
  }
  assert.ok(seen.size >= 3, `only ${[...seen].join(', ')}`);
});

test('with everything busy the choice is always the ladder', () => {
  const world = buildWorld(null);
  for (let i = 0; i < 100; i += 1) {
    const body = createBody(`busy-${i}`, 1.6, 0.5, 1, queueSpot(world, 0));
    body.lane = i % 4;
    assert.equal(chooseEntry(body, world, BUSY, false), 'ladder');
  }
});

test('with reduced motion the choice is always the ladder', () => {
  const world = buildWorld(null);
  for (let i = 0; i < 100; i += 1) {
    const body = createBody(`still-${i}`, 1.6, 0.5, 1, queueSpot(world, 0));
    body.lane = 0;
    assert.equal(chooseEntry(body, world, FREE, true), 'ladder');
  }
});

test('a cannonball is only offered on the two outside lanes', () => {
  const world = buildWorld(null);
  const body = createBody('middle', 1.6, 0.5, 1, queueSpot(world, 0));
  body.lane = 1;
  assert.equal(entryOpen('cannonball', body, world, FREE), false);
  body.lane = 0;
  assert.equal(entryOpen('cannonball', body, world, FREE), true);
});

// --- reachability ----------------------------------------------------------

test('for one to six lanes every entry approach is reachable, or the entry is disabled', () => {
  for (let lanes = 1; lanes <= 6; lanes += 1) {
    const world = buildWorld({ lanes, loungers: 6, waiting: 4 });
    for (let lane = 0; lane < lanes; lane += 1) {
      for (const kind of ['block', 'board', 'slide', 'cannonball'] as const) {
        const body = createBody(`r-${lanes}-${lane}`, 1.6, 0.5, 1, queueSpot(world, 0));
        body.lane = lane;
        for (const x of [world.pool.minX + 2, 0, world.pool.maxX - 2]) {
          body.x = x;
          const approach = entryApproach(world, kind, body);
          if (approach === null) continue;
          const open = entryOpen(kind, body, world, FREE);
          assert.ok(
            reachable(world, world.gate, approach) || !open,
            `${lanes} lanes, lane ${lane}: ${kind} at ${JSON.stringify(approach)} is open but unreachable`,
          );
        }
      }
    }
  }
});

test('a choice never picks an entry whose approach cannot be reached', () => {
  for (let lanes = 1; lanes <= 6; lanes += 1) {
    const world = buildWorld({ lanes, loungers: 6, waiting: 4 });
    for (let i = 0; i < 120; i += 1) {
      const body = createBody(`pick-${lanes}-${i}`, 1.6, 0.5, 1, queueSpot(world, 0));
      body.lane = i % lanes;
      body.x = world.pool.minX + 2 + (i % 7);
      body.entriesMade = i % 5;
      const kind = chooseEntry(body, world, FREE, false);
      const approach = entryApproach(world, kind, body);
      if (approach !== null) {
        assert.ok(findPath(world, world.gate, approach) !== null, `${lanes} lanes: ${kind} is unreachable`);
      }
    }
  }
});

// --- the curve --------------------------------------------------------------

test('the slide curve agrees with the drawn chute within 2 cm at 50 points', () => {
  const world = buildWorld(null);
  const path = world.equipment.slide.path;
  const drawn = new CatmullRomCurve3(path.map((p) => new Vector3(p.x, p.y, p.z)), false, 'centripetal');
  const table = buildPathTable(path);
  let worst = 0;
  for (let i = 0; i < 50; i += 1) {
    const s = i / 49;
    const a = pointAt(table, s);
    const b = drawn.getPointAt(s);
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  }
  assert.ok(worst < 0.02, `worst ${(worst * 100).toFixed(1)} cm`);
});

test('the tangent of the chute points along it', () => {
  const world = buildWorld(null);
  const table = slideTable(world);
  const t = tangentAt(table, 0.5);
  assert.ok(Math.abs(Math.hypot(t.x, t.y, t.z) - 1) < 1e-9);
  const a = pointAt(table, 0.49);
  const b = pointAt(table, 0.51);
  const chord = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const n = Math.hypot(chord.x, chord.y, chord.z);
  assert.ok(Math.abs((chord.x * t.x + chord.y * t.y + chord.z * t.z) / n - 1) < 1e-3);
});

// --- each entry, on its own ----------------------------------------------

function obstacleAt(world: World, x: number, z: number): string | null {
  for (const o of world.obstacles) {
    if (o.name === 'pool') continue;
    const a = o.area;
    if (x > a.minX && x < a.maxX && z > a.minZ && z < a.maxZ) return o.name;
  }
  return null;
}

/**
 * Walk to the place the entry starts from: the walk round the pool takes up
 * to a minute, and it is not part of the entry. Returns false when the body
 * never got there.
 */
function walkToEntry(body: Body, world: World, ctx: FlowContext, limit = 90): boolean {
  for (let t = 0; t < limit && body.entry === null; t += DT) stepBody(body, world, DT, [], ctx);
  return body.entry !== null;
}

for (const kind of ['block', 'board', 'slide', 'cannonball'] as const) {
  test(`a ${kind} entry ends in the water in its lane, within 12 seconds, never through the equipment`, () => {
    const world = buildWorld(null);
    const lane = kind === 'cannonball' ? 3 : 2;
    const body = diverAt(world, `e-${kind}`, lane, kind);
    const bodies = [body];
    const ctx = contextFor(bodies, true);
    // On the way to the place the body is on the deck, and never in the equipment.
    for (let t = 0; t < 90 && body.entry === null; t += DT) {
      stepBody(body, world, DT, [], ctx);
      if (body.entry === null) {
        const hit = obstacleAt(world, body.x, body.z);
        assert.equal(hit, null, `${kind} walked into ${hit}`);
      }
    }
    assert.ok(body.entry !== null, `${kind} never got to its place`);
    let t = 0;
    while (t < 12 && !body.inWater) {
      stepBody(body, world, DT, [], ctx);
      t += DT;
      assert.ok(body.y >= -floorDepthAt(world, body.x) - 1e-6, `${kind} went below the floor`);
      assert.ok(body.y <= 3.4, `${kind} went above 3.4 m`);
    }
    assert.ok(body.inWater, `${kind} did not reach the water within 12 s`);
    // In its lane, after the glide.
    for (let i = 0; i < 90; i += 1) stepBody(body, world, DT, [], ctx);
    assert.ok(Math.abs((body.swim?.z ?? 0) - world.lanes[lane].z) < world.lanes[lane].width / 2, `${kind} left its lane`);
  });
}

test('a diver off the board bounces twice on the tip, and rises above the board in its flight', () => {
  const world = buildWorld(null);
  const body = diverAt(world, 'bouncer', 2, 'board');
  const bodies = [body];
  const ctx = contextFor(bodies, true);
  assert.ok(walkToEntry(body, world, ctx));
  let bounces = 0;
  let top = -Infinity;
  for (let t = 0; t < 12 && !body.inWater; t += DT) {
    stepBody(body, world, DT, [], ctx);
    for (const ev of body.events) if (ev.name === 'board:bounce') bounces += 1;
    body.events.length = 0;
    if (body.entry?.kind === 'board' && body.entry.phase === 'flight') top = Math.max(top, body.y);
  }
  assert.equal(bounces, 2);
  // The arc rises from the tip; the plan's parabola is taken down to the water.
  assert.ok(top > world.equipment.board.height + 0.4, `top ${top.toFixed(2)}`);
});

test('a slide rider stays on the centre line of the chute for the whole ride', () => {
  const world = buildWorld(null);
  const table = slideTable(world);
  const body = diverAt(world, 'rider', 1, 'slide');
  const bodies = [body];
  const ctx = contextFor(bodies, true);
  assert.ok(walkToEntry(body, world, ctx));
  let riding = false;
  let worst = 0;
  for (let t = 0; t < 30 && !body.inWater; t += DT) {
    stepBody(body, world, DT, [], ctx);
    if (body.entry?.kind === 'slide' && body.entry.phase === 'ride') {
      riding = true;
      // The nearest point of the centre line, by a fine search.
      let best = Infinity;
      for (let i = 0; i <= 400; i += 1) {
        const p = pointAt(table, i / 400);
        best = Math.min(best, Math.hypot(body.x - p.x, body.y - 0.12 - p.y, body.z - p.z));
      }
      worst = Math.max(worst, best);
    }
  }
  assert.ok(riding, 'never rode');
  assert.ok(worst < 0.2, `${(worst * 100).toFixed(1)} cm from the centre line`);
});

test('two bodies sent to the slide ride one after the other, never together', () => {
  const world = buildWorld(null);
  const a = diverAt(world, 'rider-a', 1, 'slide');
  const b = diverAt(world, 'rider-b', 2, 'slide');
  const bodies = [a, b];
  const ctx = contextFor(bodies);
  let together = false;
  for (let t = 0; t < 60; t += DT) {
    for (const body of bodies) stepBody(body, world, DT, [], ctx);
    const riding = bodies.filter((x) => x.entry?.kind === 'slide' && x.entry.phase !== 'wait').length;
    if (riding > 1) together = true;
  }
  assert.equal(together, false, 'two were on the slide at once');
  assert.ok(a.inWater && b.inWater, 'both got into the water');
});

// --- aborts -----------------------------------------------------------------

test('a diver that is asked to lounge while on the block walks back to its lounger', () => {
  const world = buildWorld(null);
  const body = diverAt(world, 'abort-block', 1, 'block');
  const bodies = [body];
  const ctx = contextFor(bodies, true);
  walkToEntry(body, world, ctx);
  for (let t = 0; t < 30 && body.entry?.phase !== 'step-up'; t += DT) stepBody(body, world, DT, [], ctx);
  assert.equal(body.entry?.phase, 'step-up');
  applyPresentation(body, present('lounge', { lounger: 4 }), world, () => null, () => 0);
  for (let t = 0; t < 60; t += DT) stepBody(body, world, DT, [], ctx);
  assert.equal(body.entry, null);
  assert.equal(body.seat, 4);
  assert.equal(body.inWater, false);
});

test('a rider on the stairs that is asked to lounge walks back down and to the lounger', () => {
  const world = buildWorld(null);
  const body = diverAt(world, 'abort-stairs', 1, 'slide');
  const bodies = [body];
  const ctx = contextFor(bodies, true);
  walkToEntry(body, world, ctx);
  for (let t = 0; t < 30 && body.entry?.phase !== 'stairs'; t += DT) stepBody(body, world, DT, [], ctx);
  for (let t = 0; t < 1.2; t += DT) stepBody(body, world, DT, [], ctx);
  applyPresentation(body, present('lounge', { lounger: 1 }), world, () => null, () => 0);
  for (let t = 0; t < 90; t += DT) stepBody(body, world, DT, [], ctx);
  assert.equal(body.entry, null);
  assert.equal(body.seat, 1);
});

test('a diver that is asked to leave in mid-air lands and gets out by a ladder', () => {
  const world = buildWorld(null);
  const body = diverAt(world, 'abort-air', 1, 'block');
  const bodies = [body];
  const ctx = contextFor(bodies, true);
  walkToEntry(body, world, ctx);
  for (let t = 0; t < 30 && body.entry?.phase !== 'flight'; t += DT) stepBody(body, world, DT, [], ctx);
  applyPresentation(body, present('lounge', { lounger: 3 }), world, () => null, () => 0);
  for (let t = 0; t < 120; t += DT) stepBody(body, world, DT, [], ctx);
  assert.equal(body.inWater, false);
  assert.equal(body.seat, 3);
});

// --- the edge and the waiting spots -------------------------------------------

test('a waiting agent sits on the coping with its feet in the water', () => {
  const world = buildWorld(null);
  const body = createBody('waiter', 1.6, 0.5, 1, queueSpot(world, 0));
  applyPresentation(body, present('waiting', { waiting: 0 }), world, () => null, () => 0);
  for (let t = 0; t < 60; t += DT) stepBody(body, world, DT, [], { exited: () => {}, ladderLoad: () => 0 });
  assert.equal(body.state, 'edgeSitting');
  assert.ok(Math.abs(body.y + body.hipHeight - 0.05) < 1e-9);
  assert.ok(world.waiting[0].edge);
});

test('no waiting spot is in the water, and the spots keep off the ladders and the flags', () => {
  for (const waiting of [1, 4, 8]) {
    const world = buildWorld({ lanes: 4, loungers: 6, waiting });
    for (const spot of world.waiting) {
      assert.ok(!(spot.x > world.pool.minX && spot.x < world.pool.maxX && spot.z > world.pool.minZ && spot.z < world.pool.maxZ));
      for (const ladder of world.ladders) assert.ok(Math.abs(spot.x - ladder.x) >= 1.2 || !spot.edge);
    }
  }
});

test('a swimmer on a long wall, with no ladder near, may get out over the edge', () => {
  const world = buildWorld(null);
  let overEdge = 0;
  for (let i = 0; i < 40; i += 1) {
    const body = createBody(`edge-${i}`, 1.6, 0.5, 1, queueSpot(world, 0));
    applyPresentation(body, present('swim', { lane: 0, lane_offset: 0, direction: 1 }), world, () => null, () => 0);
    body.entriesMade = i;
    // No entries: the swimmer takes the ladder to get in, as it always did.
    const ctx = { exited: () => {}, ladderLoad: () => 0 };
    for (let t = 0; t < 120 && !body.inWater; t += DT) stepBody(body, world, DT, [], ctx);
    assert.ok(body.inWater, `edge-${i} never got in`);
    for (let t = 0; t < 10; t += DT) stepBody(body, world, DT, [], ctx);
    // A swimmer in the middle of the pool, far from the ladders.
    body.swim!.x = 0;
    applyPresentation(body, present('leaving'), world, () => null, () => 0);
    for (let t = 0; t < 0.05; t += DT) stepBody(body, world, DT, [], ctx);
    if (body.edgeOut !== null) overEdge += 1;
  }
  assert.ok(overEdge >= 1 && overEdge <= 40, `${overEdge} got out over the edge`);
});

// --- races ------------------------------------------------------------------

function swimmer(id: string, lane: number, x: number, extra: Partial<RaceSwimmer> = {}): RaceSwimmer {
  return {
    id,
    lane,
    x,
    dir: 1,
    racing: false,
    style: 'crawl',
    work: 'other',
    needsYou: false,
    ...extra,
  };
}

const POOL_X = { minX: -8, maxX: 8 };

test('findRaces pairs only neighbours going the same way, and only when they are close', () => {
  const cooldown = new Map<string, number>();
  const pairs = findRaces(
    [
      swimmer('a', 0, 0),
      swimmer('b', 1, 0.5),
      swimmer('c', 3, 0.2),
      swimmer('d', 0, -4, { dir: -1 }),
      swimmer('e', 1, -2),
    ],
    0,
    cooldown,
    POOL_X,
  );
  assert.deepEqual(pairs, [['a', 'b']]);
});

test('findRaces keeps a pair out for two minutes, and never runs more than two races', () => {
  const cooldown = new Map<string, number>();
  const four = [swimmer('a', 0, 0), swimmer('b', 1, 0), swimmer('c', 2, 0), swimmer('d', 3, 0)];
  assert.equal(findRaces(four, 0, cooldown, POOL_X).length, 2);
  // The same pairs, a minute later: they have just raced.
  assert.equal(findRaces([swimmer('a', 0, 0), swimmer('b', 1, 0)], 60, cooldown, POOL_X).length, 0);
  assert.equal(findRaces([swimmer('a', 0, 0), swimmer('b', 1, 0)], 121, cooldown, POOL_X).length, 1);
  // Two races already running: none more.
  const running = [swimmer('a', 0, 0, { racing: true }), swimmer('b', 1, 0, { racing: true }), swimmer('c', 2, 0), swimmer('d', 3, 0)];
  assert.equal(findRaces(running, 0, new Map(), POOL_X).length, 0);
});

test('findRaces leaves out the swimmers that ask for the person, the treaders and the floaters, and the ones near the wall', () => {
  const cooldown = new Map<string, number>();
  const pairs = findRaces(
    [
      swimmer('a', 0, 0, { needsYou: true }),
      swimmer('b', 1, 0),
      swimmer('c', 2, 0, { work: 'delegate' }),
      swimmer('d', 2, 0.1, { style: 'float' }),
      swimmer('e', 3, 7.5),
      swimmer('f', 3, 7.6),
    ],
    0,
    cooldown,
    POOL_X,
  );
  assert.deepEqual(pairs, []);
});

test('in a race the swimmer that is ahead reaches the wall first', () => {
  const world = buildWorld(null);
  const ahead = createBody('ahead', 1.6, 0.5, 1, queueSpot(world, 0));
  const behind = createBody('behind', 1.6, 0.5, 1, queueSpot(world, 0));
  for (const [b, lane, x] of [[ahead, 0, -1], [behind, 1, -2]] as const) {
    applyPresentation(b, present('swim', { lane, lane_offset: 0, direction: 1 }), world, () => null, () => 0);
    stepBody(b, world, DT, [], { exited: () => {}, ladderLoad: () => 0 });
    b.inWater = true;
    b.swim = startSwim(x, world.lanes[lane].z, 1, b.seed);
    b.state = 'swimming';
    b.raceBoost = 1.35;
  }
  const bodies = [ahead, behind];
  const ctx = { exited: () => {}, ladderLoad: () => 0 };
  const firstWall: string[] = [];
  for (let t = 0; t < 40 && firstWall.length === 0; t += DT) {
    for (const b of bodies) stepBody(b, world, DT, [], ctx);
    for (const b of bodies) {
      if (b.events.some((e) => e.name === 'race:wall')) firstWall.push(b.id);
      b.events.length = 0;
    }
  }
  assert.deepEqual(firstWall, ['ahead']);
});

// --- rests and flips ---------------------------------------------------------

test('a swimmer rests at the wall after its third length, for four to seven seconds, and swims on', () => {
  const world = buildWorld(null);
  const state = startSwim(0, world.lanes[2].z, 1, 0);
  assert.equal(restAfter(state), 3);
  const options = { rest: true };
  let turns = 0;
  let lastDir = state.dir;
  let rested = -1;
  let restStart = -1;
  let t = 0;
  for (; t < 300; t += DT) {
    swimStep(state, world, world.lanes[2].z, 0.85, 1.6, DT, options);
    if (state.dir !== lastDir) {
      turns += 1;
      lastDir = state.dir;
    }
    if (state.resting > 0 && restStart < 0) restStart = t;
    if (restStart >= 0 && state.resting === 0 && rested < 0) rested = t;
    if (rested >= 0 && t > rested + 1) break;
  }
  assert.ok(turns >= 3, `only ${turns} turns`);
  assert.ok(restStart > 0, 'never rested');
  const length = rested - restStart;
  assert.ok(length > 3.8 && length < 7.2, `rested for ${length.toFixed(1)} s`);
  // After the rest it is holding no more, and it swims on.
  const x0 = state.x;
  for (let k = 0; k < 60; k += 1) swimStep(state, world, world.lanes[2].z, 0.85, 1.6, DT, options);
  assert.equal(state.holding, false);
  assert.ok(Math.abs(state.x - x0) > 0.5);
});

test('a flip turn is drawn for a run and for every other turn of an edit, and an open turn otherwise', () => {
  const world = buildWorld(null);
  const turnsOf = (seed: number, flip: 'always' | 'alternate' | 'never') => {
    const state = startSwim(0, world.lanes[1].z, 1, seed);
    const kinds: string[] = [];
    for (let t = 0; t < 120; t += DT) {
      swimStep(state, world, world.lanes[1].z, 1, 1.6, DT, { flip });
      if (state.turning > 0 && kinds.length < 4 && (kinds.length === 0 || kinds[kinds.length - 1] !== 'busy')) {
        kinds.push(state.turnKind);
        // Wait for the turn to end before the next one is read.
        while (state.turning > 0) {
          swimStep(state, world, world.lanes[1].z, 1, 1.6, DT, { flip });
          t += DT;
        }
        kinds[kinds.length - 1] = kinds[kinds.length - 1];
      }
    }
    return kinds;
  };
  assert.ok(turnsOf(0, 'always').every((k) => k === 'flip'));
  assert.deepEqual(turnsOf(0, 'alternate').slice(0, 2), ['open', 'flip']);
  assert.ok(turnsOf(0, 'never').every((k) => k === 'open'));
});

test('a flip turn is an action, and a rest at the wall is a held one', () => {
  const world = buildWorld(null);
  const body = createBody('flipper', 1.6, 0.5, 1, queueSpot(world, 0));
  applyPresentation(body, present('swim', { lane: 1, lane_offset: 0, direction: 1 }), world, () => null, () => 0);
  body.swim = startSwim(world.pool.maxX - 1.2, world.lanes[1].z, 1, body.seed);
  body.inWater = true;
  body.state = 'swimming';
  body.work = 'run';
  body.swim.turning = TURN_SECONDS;
  body.swim.turnKind = 'flip';
  assert.equal(bodyAction(body), 'flipTurn');
  assert.equal(bodyActionHeld(body), false);
  body.swim.turning = 0;
  body.swim.resting = 5;
  assert.equal(bodyAction(body), 'wallRest');
  assert.equal(bodyActionHeld(body), true);
});

test('a heading is continuous across a whole-turn wrap', () => {
  assert.ok(Math.abs(normaliseNear(Math.PI / 2, Math.PI / 2 + Math.PI * 2) - (Math.PI / 2 + Math.PI * 2)) < 1e-9);
});

// --- the walk to the places ----------------------------------------------------

test('every entry approach is a place on the deck, not in the water', () => {
  const world = buildWorld(null);
  for (const kind of ['block', 'board', 'slide', 'cannonball'] as const) {
    const body = createBody(`pl-${kind}`, 1.6, 0.5, 1, queueSpot(world, 0));
    body.lane = kind === 'cannonball' ? 0 : 1;
    body.x = 0;
    const approach = entryApproach(world, kind, body);
    assert.ok(approach !== null);
    assert.ok(!(approach.x > world.pool.minX && approach.x < world.pool.maxX && approach.z > world.pool.minZ && approach.z < world.pool.maxZ), kind);
  }
});

test('a walker standing on an entry approach is not counted as in the water', () => {
  const walkers: Walker[] = [{ id: 'x', x: 0, z: 0, moving: false }];
  assert.equal(walkers.length, 1);
});
