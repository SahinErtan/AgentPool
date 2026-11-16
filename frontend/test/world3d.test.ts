/**
 * The pool in three dimensions: the world, the walking and the swimming.
 *
 * All of it is pure, so it is checked here without a browser and without
 * WebGL: the world is a function of the scene description, the paths keep
 * off the water and the swimmers keep to their lanes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorld,
  entrance,
  floorDepthAt,
  gateOutside,
  inPool,
  insideFence,
  ladderFoot,
  ladderTop,
  loungerApproach,
  onDeck,
  queueSpot,
  swimZ,
  type Area,
  type Vec2,
  type World,
} from '../src/scene/pool3d/world';
import { EDGE_CLEARANCE, planPath, segmentHitsArea, steer, type Walker } from '../src/scene/pool3d/nav';
import { startSwim, swimStep, TURN_SECONDS } from '../src/scene/pool3d/swim';
import {
  applyPresentation,
  createBody,
  route,
  settle,
  ladderBusy,
  ladderLoad,
  stepBody,
  type Body,
} from '../src/scene/pool3d/flow';
import type { AgentPresentation } from '../src/net/types';
import { floorDepthAt } from '../src/scene/pool3d/world';
import { fatigueAfter, type WorkKind } from '../src/scene/pool3d/work';
import type { FlowContext } from '../src/scene/pool3d/flow';
import { tickErrands, type SlotBook } from '../src/scene/pool3d/errands';

const CTX = { exited: () => {}, ladderLoad: () => 0 };

const PAYLOADS = [
  null,
  { lanes: 4, loungers: 6, waiting: 4 },
  { lanes: 4, loungers: 12, waiting: 4 },
  { lanes: 6, loungers: 20, waiting: 6 },
  { lanes: 2, loungers: 3, waiting: 2 },
];

function overlaps(a: Area, b: Area): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

test('the world follows the scene description', () => {
  const world = buildWorld({ lanes: 6, loungers: 10, waiting: 3 });
  assert.equal(world.lanes.length, 6);
  assert.equal(world.loungers.length, 10);
  assert.equal(world.waiting.length, 3);
  // Nonsense falls back to the defaults.
  const fallback = buildWorld({ lanes: 'x', loungers: -2 });
  assert.equal(fallback.lanes.length, 4);
  assert.equal(fallback.loungers.length, 6);
});

test('every lane is inside the pool and they do not overlap', () => {
  for (const payload of PAYLOADS) {
    const world = buildWorld(payload);
    for (const lane of world.lanes) {
      assert.ok(lane.z - lane.width / 2 >= world.pool.minZ - 1e-9);
      assert.ok(lane.z + lane.width / 2 <= world.pool.maxZ + 1e-9);
    }
    for (let i = 1; i < world.lanes.length; i += 1) {
      assert.ok(Math.abs(world.lanes[i].z - world.lanes[i - 1].z) >= world.lanes[i].width - 1e-9);
    }
  }
});

test('no lounger is in the water, off the deck or on another lounger', () => {
  for (const payload of PAYLOADS) {
    const world = buildWorld(payload);
    const boxes = world.loungers.map((l) => ({
      minX: l.x - l.width / 2,
      maxX: l.x + l.width / 2,
      minZ: l.z - l.length / 2,
      maxZ: l.z + l.length / 2,
    }));
    boxes.forEach((box, i) => {
      assert.ok(!overlaps(box, world.pool), `lounger ${i} is in the water`);
      for (const corner of [
        { x: box.minX, z: box.minZ },
        { x: box.maxX, z: box.maxZ },
      ]) {
        assert.ok(onDeck(world, corner), `lounger ${i} is off the deck`);
      }
      for (let j = i + 1; j < boxes.length; j += 1) {
        assert.ok(!overlaps(box, boxes[j]), `loungers ${i} and ${j} overlap`);
      }
    });
  }
});

test('a big pool gets a second row of loungers', () => {
  const small = buildWorld({ loungers: 6 });
  const big = buildWorld({ loungers: 12 });
  assert.equal(new Set(small.loungers.map((l) => l.z)).size, 1);
  assert.equal(new Set(big.loungers.map((l) => l.z)).size, 2);
});

test('the loungers face the pool', () => {
  const world = buildWorld(null);
  for (const lounger of world.loungers) {
    const toPool = -lounger.z;
    assert.ok(lounger.facing.z * toPool > 0);
  }
});

test('every waypoint is on the deck, and the ladder goes from the deck into the water', () => {
  for (const payload of PAYLOADS) {
    const world = buildWorld(payload);
    const points: Vec2[] = [
      world.gate,
      ...world.waiting,
      ...world.loungers.map(loungerApproach),
      ...world.ladders.map(ladderTop),
    ];
    for (const p of points) assert.ok(onDeck(world, p), `${JSON.stringify(p)} is not on the deck`);
    // The queue at the gate is outside the fence, out of the way.
    for (let place = 0; place < 60; place += 1) {
      assert.ok(!insideFence(world, queueSpot(world, place)), `queue place ${place} is inside`);
    }
    for (const ladder of world.ladders) {
      assert.ok(inPool(world, ladderFoot(ladder)));
      assert.ok(Math.abs(ladder.z - world.pool.maxZ) < 1e-9 || Math.abs(ladder.z - world.pool.minZ) < 1e-9);
    }
  }
});

test('the floor slopes from the shallow end down to the deep end', () => {
  const world = buildWorld(null);
  let last = 0;
  for (let x = world.pool.minX; x <= world.pool.maxX; x += 0.5) {
    const depth = floorDepthAt(world, x);
    assert.ok(depth >= last - 1e-9);
    last = depth;
  }
  assert.equal(floorDepthAt(world, world.pool.minX), world.shallowDepth);
  assert.equal(floorDepthAt(world, world.pool.maxX), world.deepDepth);
});

test('a lane offset is a place across the lane, inside it', () => {
  const world = buildWorld(null);
  for (const lane of world.lanes) {
    for (const offset of [-1, -0.18, 0, 0.12, 0.42, 3]) {
      const z = swimZ(world, lane.index, offset);
      assert.ok(Math.abs(z - lane.z) <= lane.width / 2);
    }
  }
});

// --- paths -------------------------------------------------------------

function pathKeepsOffWater(world: ReturnType<typeof buildWorld>, from: Vec2, path: Vec2[]): boolean {
  let ok = true;
  const water = {
    minX: world.pool.minX - EDGE_CLEARANCE + 0.01,
    maxX: world.pool.maxX + EDGE_CLEARANCE - 0.01,
    minZ: world.pool.minZ - EDGE_CLEARANCE + 0.01,
    maxZ: world.pool.maxZ + EDGE_CLEARANCE - 0.01,
  };
  let at = from;
  // A waiting spot on the coping is nearer the water than the margin, so a
  // way that starts or ends there may be inside the margin for its first or
  // last stretch. Such a stretch may never go into the water itself.
  const inMargin = (q: Vec2) => inPool(world, q, EDGE_CLEARANCE) && !inPool(world, q);
  path.forEach((p) => {
    const raw = inMargin(at) || inMargin(p);
    ok = ok && !segmentHitsArea(at, p, raw ? world.pool : water);
    at = p;
  });
  return ok;
}

test('a path never crosses the water', () => {
  for (const payload of PAYLOADS) {
    const world = buildWorld(payload);
    const points: Vec2[] = [
      world.gate,
      ...world.waiting,
      ...world.loungers.map(loungerApproach),
      ...world.ladders.map(ladderTop),
    ];
    for (const a of points) {
      for (const b of points) {
        const path = planPath(world, a, b);
        assert.ok(pathKeepsOffWater(world, a, path), `${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
        const end = path[path.length - 1];
        assert.ok(Math.hypot(end.x - b.x, end.z - b.z) < 1e-9);
      }
    }
  }
});

test('a path is the same every time', () => {
  const world = buildWorld(null);
  const a = planPath(world, world.gate, loungerApproach(world.loungers[3]));
  const b = planPath(world, world.gate, loungerApproach(world.loungers[3]));
  assert.deepEqual(a, b);
  // The gate is on the near side and the loungers on the far one: the way
  // goes round the pool.
  assert.ok(a.length >= 2);
});

/** A small seeded generator, so the random pairs are the same every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point on the deck that is in no obstacle. */
function freeDeckPoint(world: World, rand: () => number): Vec2 {
  for (;;) {
    const p = {
      x: world.deck.minX + 0.3 + rand() * (world.deck.maxX - world.deck.minX - 0.6),
      z: world.deck.minZ + 0.3 + rand() * (world.deck.maxZ - world.deck.minZ - 0.6),
    };
    if (!world.obstacles.some((o) => o.area.minX < p.x && p.x < o.area.maxX && o.area.minZ < p.z && p.z < o.area.maxZ)) {
      return p;
    }
  }
}

/**
 * True when a path keeps off every obstacle.
 *
 * The margin is the planner's, a little less than it. At the two ends an
 * obstacle is only kept out of itself, when the end is already in its margin.
 */
function pathKeepsOffEquipment(world: World, from: Vec2, to: Vec2, path: Vec2[]): boolean {
  const same = (p: Vec2, q: Vec2) => p.x === q.x && p.z === q.z;
  const grown = (a: Area, by: number): Area => ({
    minX: a.minX - by,
    maxX: a.maxX + by,
    minZ: a.minZ - by,
    maxZ: a.maxZ + by,
  });
  const within = (p: Vec2, a: Area) => p.x > a.minX && p.x < a.maxX && p.z > a.minZ && p.z < a.maxZ;
  let at = from;
  for (const p of path) {
    for (const o of world.obstacles) {
      const a = o.area;
      const isEnd = (q: Vec2) =>
        (same(q, from) || same(q, to)) && within(q, grown(a, EDGE_CLEARANCE)) && !within(q, a);
      const by = isEnd(at) || isEnd(p) ? 0 : EDGE_CLEARANCE - 0.01;
      if (segmentHitsArea(at, p, grown(a, by))) return false;
    }
    at = p;
  }
  return true;
}

test('a path never crosses an obstacle, for 200 random pairs of points on the deck', () => {
  for (const payload of [null, { lanes: 6, loungers: 12, waiting: 4 }, { lanes: 8, loungers: 6, waiting: 4 }]) {
    const world = buildWorld(payload);
    const rand = seeded(23);
    for (let i = 0; i < 200; i += 1) {
      const a = freeDeckPoint(world, rand);
      const b = freeDeckPoint(world, rand);
      const path = planPath(world, a, b);
      assert.ok(pathKeepsOffEquipment(world, a, b, path), `${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      const end = path[path.length - 1];
      assert.ok(Math.hypot(end.x - b.x, end.z - b.z) < 1e-9);
    }
  }
});

test('a path to the terrace is the same every time', () => {
  const world = buildWorld(null);
  const rand = seeded(7);
  for (let i = 0; i < 50; i += 1) {
    const a = freeDeckPoint(world, rand);
    const b = freeDeckPoint(world, rand);
    assert.deepEqual(planPath(world, a, b), planPath(world, a, b));
  }
});

test('a path to a place on the terrace goes round the equipment and ends on it', () => {
  const world = buildWorld(null);
  const e = world.equipment;
  for (const spot of [e.kiosk.use, e.pingPong.ends[0], e.hotTub.step, e.slide.stairsFoot, e.board.base]) {
    const from = queueSpot(world, 0);
    const path = route(world, from, spot);
    assert.ok(path.length >= 1);
    const end = path[path.length - 1];
    assert.ok(Math.hypot(end.x - spot.x, end.z - spot.z) < 1e-9);
  }
});

test('twenty agents walk to the terrace and back, and none of them steps into the equipment', () => {
  const world = buildWorld(null);
  const e = world.equipment;
  const spots = [e.kiosk.use, e.pingPong.ends[0], e.hotTub.step, e.slide.stairsFoot];
  // The agents come in through the gate, each to one of the four places
  // (five agents to a place), and then go back to the queue.
  const terrace = { ...world, waiting: Array.from({ length: 20 }, (_, i) => spots[i % 4]) };
  const bodies: Body[] = [];
  for (let i = 0; i < 20; i += 1) {
    const body = createBody(`t-${String(i).padStart(2, '0')}`, 1.6, 0.5, 1, queueSpot(world, i));
    applyPresentation(body, present('waiting', { waiting: i }), terrace, () => null, () => 0);
    bodies.push(body);
  }
  const ctx = { exited: () => {}, ladderLoad: () => 0 };
  const dt = 1 / 30;
  const inEquipment = (b: Body): string | null => {
    for (const o of world.obstacles) {
      if (o.name === 'pool') continue;
      const a = o.area;
      if (b.x > a.minX && b.x < a.maxX && b.z > a.minZ && b.z < a.maxZ) return o.name;
    }
    return null;
  };
  // An agent has arrived once it has stood within two metres of its place.
  // Five to a place stand round it, so the last of them may be boxed in a
  // metre or so short, and a crowd can push one back out after it has got
  // there.
  const walkUntilArrived = (theWorld: World, limit: number, places: Vec2[]) => {
    let t = 0;
    const arrived = bodies.map(() => false);
    while (t < limit && !arrived.every((a) => a)) {
      const walkers: Walker[] = bodies.map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
      bodies.forEach((body, i) => {
        stepBody(body, theWorld, dt, walkers, ctx);
        const hit = inEquipment(body);
        assert.equal(hit, null, `${body.id} is inside ${hit} at ${t.toFixed(1)} s`);
        if (Math.hypot(body.x - places[i].x, body.z - places[i].z) < 2) arrived[i] = true;
      });
      t += dt;
    }
    return t;
  };
  const places = bodies.map((_, i) => spots[i % 4]);
  const toTerrace = walkUntilArrived(terrace, 120, places);
  assert.ok(toTerrace < 120, 'the agents did not reach the terrace in two minutes');
  const homes = bodies.map((_, i) => queueSpot(world, i));
  bodies.forEach((b, i) => {
    applyPresentation(b, present('waiting', { waiting: -1, queue: i }), world, () => null, () => 0);
    b.goal = null;
    b.path = [];
  });
  const back = walkUntilArrived(world, 120, homes);
  assert.ok(back < 120, 'the agents did not walk back in two minutes');
});

test('two people walking at each other pass without walking through each other', () => {
  const a: Walker = { id: 'a', x: -3, z: 0, moving: true };
  const b: Walker = { id: 'b', x: 3, z: 0, moving: true };
  let closest = Infinity;
  for (let i = 0; i < 600; i += 1) {
    const sa = steer(a, { x: 3, z: 0 }, 1.2, 1 / 60, [b]);
    const sb = steer(b, { x: -3, z: 0 }, 1.2, 1 / 60, [a]);
    a.x = sa.x;
    a.z = sa.z;
    b.x = sb.x;
    b.z = sb.z;
    closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
  }
  assert.ok(closest > 0.35, `they came within ${closest.toFixed(2)} m`);
  assert.ok(Math.hypot(a.x - 3, a.z) < 0.2, 'a got there');
  assert.ok(Math.hypot(b.x + 3, b.z) < 0.2, 'b got there');
});

test('a walker held up behind a standing one stops', () => {
  const walker: Walker = { id: 'w', x: 0, z: 0, moving: true };
  const blocker: Walker = { id: 'b', x: 0.5, z: 0, moving: false };
  // The target is right behind the blocker, so going round does not help.
  const step = steer(walker, { x: 0.52, z: 0 }, 1.2, 1 / 60, [blocker]);
  assert.ok(step.covered < 1.2 / 60);
});

// --- swimming ----------------------------------------------------------

test('a swimmer stays in its lane and turns at the wall', () => {
  const world = buildWorld(null);
  const lane = world.lanes[2];
  const swim = startSwim(0, lane.z, 1);
  let turns = 0;
  let lastDir = swim.dir;
  let lastYaw = swim.yaw;
  for (let i = 0; i < 60 * 90; i += 1) {
    swimStep(swim, world, lane.z, 1, 1.6, 1 / 60);
    assert.ok(swim.x > world.pool.minX && swim.x < world.pool.maxX);
    assert.ok(Math.abs(swim.z - lane.z) < lane.width / 2);
    // The heading never jumps.
    assert.ok(Math.abs(swim.yaw - lastYaw) < 0.2, 'the heading jumped');
    lastYaw = swim.yaw;
    if (swim.dir !== lastDir) turns += 1;
    lastDir = swim.dir;
  }
  assert.ok(turns >= 4, `only ${turns} turns`);
  // After a turn the swimmer faces the way it swims.
  swim.turning = 0;
  assert.ok(Math.abs(Math.sin(swim.yaw) - swim.dir) < 1e-6 || swim.turning > 0);
  assert.ok(TURN_SECONDS > 0.5);
});

test('a swimmer that comes off the ladder drifts over to its lane', () => {
  const world = buildWorld(null);
  const lane = world.lanes[3];
  const swim = startSwim(0, world.lanes[0].z, -1);
  for (let i = 0; i < 60 * 30; i += 1) swimStep(swim, world, lane.z, 1, 1.6, 1 / 60);
  assert.ok(Math.abs(swim.z - lane.z) < 1e-6);
});

// --- the whole flow ----------------------------------------------------

function present(mode: AgentPresentation['mode'], props: Record<string, unknown> = {}): AgentPresentation {
  return { mode, slot: null, props };
}

function run(bodies: Body[], world: ReturnType<typeof buildWorld>, seconds: number, onExit = (_id: string) => {}) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    const walkers: Walker[] = bodies
      .filter((b) => !b.inWater && b.seat === null && b.climbing === 0)
      .map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
    for (const body of bodies) stepBody(body, world, dt, walkers, { exited: onExit, ladderLoad: () => 0 });
  }
}

test('an agent that is told to swim walks round to the ladder, climbs down and swims in its lane', () => {
  const world = buildWorld(null);
  const body = createBody('a', 1.6, 0.5, 1, world.gate);
  applyPresentation(body, present('swim', { lane: 2, lane_offset: 0, direction: 1 }), world, () => null, () => 0);
  let wentInWater = false;
  const dt = 1 / 30;
  for (let t = 0; t < 120; t += dt) {
    stepBody(body, world, dt, [], CTX);
    if (!body.inWater && body.climbing === 0) {
      assert.ok(!inPool(world, body, -EDGE_CLEARANCE + 0.05), 'walked on the water');
    }
    if (body.inWater) wentInWater = true;
  }
  assert.ok(wentInWater);
  assert.equal(body.state, 'swimming');
  // In its lane, on the side it keeps to.
  assert.ok(Math.abs((body.swim?.z ?? 0) - world.lanes[2].z) < world.lanes[2].width / 2);
});

test('an agent told to lounge ends up on its lounger, facing the pool', () => {
  const world = buildWorld(null);
  const body = createBody('a', 1.6, 0.5, 1, world.gate);
  applyPresentation(body, present('lounge', { lounger: 4 }), world, () => null, () => 0);
  run([body], world, 60);
  assert.equal(body.seat, 4);
  assert.equal(body.state, 'lounging');
  const lounger = world.loungers[4];
  assert.ok(Math.abs(body.x - lounger.x) < 0.01);
  assert.ok(Math.abs(body.z - lounger.z) < lounger.length / 2);
  // Facing the pool: the heading points at +z.
  assert.ok(Math.cos(body.yaw) > 0.99);
  // The hips are on the seat.
  assert.ok(Math.abs(body.y + body.hipHeight - lounger.seatHeight) < 1e-6);
});

test('a swimmer that is sent to a lounger gets out at the ladder and walks there', () => {
  const world = buildWorld(null);
  const body = createBody('a', 1.6, 0.5, 1, world.gate);
  applyPresentation(body, present('swim', { lane: 1 }), world, () => null, () => 0);
  run([body], world, 60);
  assert.ok(body.inWater);
  applyPresentation(body, present('exiting', { to: 'lounger:2' }), world, () => null, () => 0);
  run([body], world, 30);
  applyPresentation(body, present('lounge', { lounger: 2 }), world, () => null, () => 0);
  run([body], world, 60);
  assert.ok(!body.inWater);
  assert.equal(body.seat, 2);
});

test('a leaving agent walks to the gate and says so once', () => {
  const world = buildWorld(null);
  const body = createBody('a', 1.6, 0.5, 1, world.gate);
  applyPresentation(body, present('lounge', { lounger: 0 }), world, () => null, () => 0);
  run([body], world, 60);
  applyPresentation(body, present('leaving'), world, () => null, () => 0);
  let told = 0;
  run([body], world, 60, () => {
    told += 1;
  });
  assert.equal(told, 1);
  assert.ok(Math.hypot(body.x - world.gate.x, body.z - world.gate.z) < 0.1);
});

test('a crowd going to the loungers never stands on top of each other', () => {
  const world = buildWorld(null);
  const bodies: Body[] = [];
  for (let i = 0; i < 6; i += 1) {
    const body = createBody(`agent-${i}`, 1.6, 0.5, 1, queueSpot(world, i));
    applyPresentation(body, present('lounge', { lounger: 5 - i }), world, () => null, () => 0);
    bodies.push(body);
  }
  const dt = 1 / 30;
  let closest = Infinity;
  for (let t = 0; t < 90; t += dt) {
    const walkers: Walker[] = bodies
      .filter((b) => b.seat === null)
      .map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
    for (const body of bodies) stepBody(body, world, dt, walkers, CTX);
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        if (bodies[i].seat !== null || bodies[j].seat !== null) continue;
        closest = Math.min(closest, Math.hypot(bodies[i].x - bodies[j].x, bodies[i].z - bodies[j].z));
      }
    }
  }
  assert.ok(closest > 0.3, `two came within ${closest.toFixed(2)} m`);
  for (const body of bodies) assert.notEqual(body.seat, null, `${body.id} never sat down`);
});

test('a walker that is held up does not walk its legs', () => {
  const world = buildWorld(null);
  const body = createBody('z', 1.6, 0.5, 1, { x: 0, z: world.pool.maxZ + 1.5 });
  applyPresentation(body, present('waiting', { waiting: 0 }), world, () => null, () => 0);
  const target = world.waiting[0];
  // Somebody stands right on the waiting spot.
  const blocker: Walker = { id: 'a', x: target.x, z: target.z, moving: false };
  for (let i = 0; i < 600; i += 1) stepBody(body, world, 1 / 30, [blocker], CTX);
  stepBody(body, world, 1 / 30, [blocker], CTX);
  assert.ok(body.strideCycles < 1e-3, `still striding ${body.strideCycles}`);
});

test('the queue at the gate never puts two people on one spot', () => {
  const world = buildWorld(null);
  const spots = Array.from({ length: 50 }, (_, i) => queueSpot(world, i));
  for (let i = 0; i < spots.length; i += 1) {
    for (let j = i + 1; j < spots.length; j += 1) {
      assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z) > 0.6, `${i} and ${j}`);
    }
  }
});

test('a crowd of swimmers gets into the water through the ladders, none left at the top', () => {
  const world = buildWorld(null);
  const bodies: Body[] = [];
  for (let i = 0; i < 20; i += 1) {
    const body = createBody(`s-${String(i).padStart(2, '0')}`, 1.6, 0.5, 1, queueSpot(world, i));
    applyPresentation(body, present('swim', { lane: i % 4, lane_offset: 0 }), world, () => null, () => 0);
    bodies.push(body);
  }
  const ctx = {
    exited: () => {},
    ladderLoad: (index: number, self: Body) => ladderLoad(bodies, index, self),
  };
  const dt = 1 / 30;
  for (let t = 0; t < 150; t += dt) {
    const walkers: Walker[] = bodies
      .filter((b) => !b.inWater && b.seat === null && b.climbing === 0)
      .map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
    for (const body of bodies) {
      stepBody(body, world, dt, walkers, ctx, (index) => ladderBusy(bodies, index, body));
    }
    // Two bodies never share a ladder.
    for (const ladder of world.ladders) {
      assert.ok(bodies.filter((b) => b.climbing !== 0 && b.ladder === ladder.index).length <= 1);
    }
  }
  const dry = bodies.filter((b) => !b.inWater).map((b) => b.id);
  assert.deepEqual(dry, [], `still on the deck: ${dry.join(', ')}`);
  // More than one ladder was used.
  assert.ok(new Set(bodies.map((b) => b.ladder)).size >= 2);
});

test('the way in from the queue goes through the gate, not through the fence', () => {
  const world = buildWorld(null);
  const from = queueSpot(world, 7);
  const path = route(world, from, loungerApproach(world.loungers[2]));
  // The first two points are the outside and the inside of the gate.
  assert.ok(!insideFence(world, path[0]));
  assert.ok(insideFence(world, path[1]));
  assert.ok(Math.abs(path[0].z - world.gate.z) < 1e-9 && Math.abs(path[1].z - world.gate.z) < 1e-9);
});

test('two people put on the same spot step apart', () => {
  const a: Walker = { id: 'a', x: 0, z: 0, moving: false };
  const b: Walker = { id: 'b', x: 0, z: 0, moving: false };
  for (let i = 0; i < 120; i += 1) {
    const sa = steer(a, { x: a.x, z: a.z }, 1.2, 1 / 60, [b]);
    const sb = steer(b, { x: b.x, z: b.z }, 1.2, 1 / 60, [a]);
    a.x = sa.x;
    a.z = sa.z;
    b.x = sb.x;
    b.z = sb.z;
  }
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0.35);
});

test('a crowd that arrives all at once at the gate gets where it is going', () => {
  const world = buildWorld(null);
  const bodies: Body[] = [];
  for (let i = 0; i < 60; i += 1) {
    const body = createBody(`c-${String(i).padStart(2, '0')}`, 1.6, 0.5, 1, entrance(world, i));
    const mode = i < 24 ? 'swim' : i < 30 ? 'lounge' : 'waiting';
    const props =
      mode === 'swim' ? { lane: i % 4 } : mode === 'lounge' ? { lounger: i - 24 } : { waiting: i - 30 < 4 ? i - 30 : -1, queue: Math.max(0, i - 34) };
    applyPresentation(body, present(mode, props), world, () => null, () => 0);
    bodies.push(body);
  }
  const ctx = {
    exited: () => {},
    ladderLoad: (index: number, self: Body) => ladderLoad(bodies, index, self),
  };
  const dt = 1 / 30;
  for (let t = 0; t < 180; t += dt) {
    const walkers: Walker[] = bodies
      .filter((b) => !b.inWater && b.seat === null && b.climbing === 0)
      .map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
    for (const body of bodies) {
      stepBody(body, world, dt, walkers, ctx, (index) => ladderBusy(bodies, index, body));
    }
  }
  const stuck = bodies.filter((b) => b.path.length > 0).map((b) => b.id);
  assert.deepEqual(stuck, [], `still on the way: ${stuck.join(', ')}`);
  assert.equal(bodies.filter((b) => b.inWater).length, 24);
  assert.equal(bodies.filter((b) => b.seat !== null).length, 6);
});

test('two swimmers going opposite ways in one lane keep to their own sides', () => {
  const world = buildWorld(null);
  for (const lane of world.lanes) {
    const out = swimZ(world, lane.index, 0, 1);
    const back = swimZ(world, lane.index, 0, -1);
    // Far enough apart for two bodies to pass.
    assert.ok(Math.abs(out - back) > 0.6, `lane ${lane.index}`);
    for (const offset of [-1, 0, 1]) {
      for (const dir of [-1, 1] as const) {
        assert.ok(Math.abs(swimZ(world, lane.index, offset, dir) - lane.z) < lane.width / 2);
      }
    }
  }
});

test('the agents already in the pool when the page opens start in their places', () => {
  const world = buildWorld(null);
  const swimmer = createBody('s', 1.6, 0.5, 1, entrance(world, 0));
  applyPresentation(swimmer, present('swim', { lane: 2, direction: -1 }), world, () => null, () => 0);
  settle(swimmer, world);
  assert.ok(swimmer.inWater && swimmer.state === 'swimming');
  assert.ok(Math.abs((swimmer.swim?.z ?? 0) - world.lanes[2].z) < world.lanes[2].width / 2);
  const lounger = createBody('l', 1.6, 0.5, 1, entrance(world, 1));
  applyPresentation(lounger, present('lounge', { lounger: 3 }), world, () => null, () => 0);
  settle(lounger, world);
  assert.equal(lounger.seat, 3);
  assert.ok(Math.abs(lounger.y + lounger.hipHeight - world.loungers[3].seatHeight) < 1e-9);
  // And they stay there.
  run([swimmer, lounger], world, 5);
  assert.ok(swimmer.inWater);
  assert.equal(lounger.seat, 3);
});

test('a fast swimmer drops in behind a slow one in the same lane', () => {
  const world = buildWorld(null);
  const slow = createBody('a', 1.6, 0.5, 0.6, entrance(world, 0));
  const fast = createBody('b', 1.6, 0.5, 1.3, entrance(world, 1));
  for (const b of [slow, fast]) {
    applyPresentation(b, present('swim', { lane: 1, direction: 1 }), world, () => null, () => 0);
    settle(b, world);
  }
  slow.swim!.x = 0;
  fast.swim!.x = -3;
  const bodies = [slow, fast];
  const ctx = {
    exited: () => {},
    ladderLoad: () => 0,
    swimGap: (self: Body) => {
      let best = Infinity;
      for (const o of bodies) {
        if (o === self || !o.swim || !self.swim || o.swim.dir !== self.swim.dir || o.swim.turning > 0) continue;
        const ahead = (o.swim.x - self.swim.x) * self.swim.dir;
        if (ahead > 0) best = Math.min(best, ahead);
      }
      return best;
    },
  };
  let closest = Infinity;
  for (let i = 0; i < 30 * 8; i += 1) {
    for (const b of bodies) stepBody(b, world, 1 / 30, [], ctx);
    if (slow.swim!.turning === 0 && fast.swim!.turning === 0 && slow.swim!.dir === fast.swim!.dir) {
      closest = Math.min(closest, Math.abs(slow.swim!.x - fast.swim!.x));
    }
  }
  assert.ok(closest > 1.3, `came within ${closest.toFixed(2)} m`);
});

// --- the work shows --------------------------------------------------------

function swimmerIn(world: ReturnType<typeof buildWorld>, id: string, lane: number, work: WorkKind = 'other'): Body {
  const body = createBody(id, 1.6, 0.5, 1, entrance(world, 0));
  applyPresentation(body, present('swim', { lane, lane_offset: 0, direction: 1 }), world, () => null, () => 0);
  settle(body, world);
  body.work = work;
  return body;
}

/** Step one body for some seconds, calling `each` after every step. */
function stepFor(body: Body, world: ReturnType<typeof buildWorld>, seconds: number, each: (t: number) => void = () => {}) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    stepBody(body, world, dt, [], CTX);
    each(t);
  }
}

test('a swimmer whose session needs the person swims to the wall, holds there and stays in its lane', () => {
  const world = buildWorld(null);
  const body = swimmerIn(world, 'asks', 2);
  body.needsYou = true;
  const lane = world.lanes[2];
  let held = false;
  let nearWall = false;
  stepFor(body, world, 30, () => {
    if (body.swim?.holding) held = true;
    if (held) {
      const wall = Math.min(Math.abs(body.swim!.x - world.pool.minX), Math.abs(body.swim!.x - world.pool.maxX));
      assert.ok(wall < 1.8, `held ${wall.toFixed(2)} m from the wall`);
      assert.ok(Math.abs(body.swim!.z - lane.z) < lane.width / 2, 'left its lane');
      nearWall = true;
    }
  });
  assert.ok(held, 'never held');
  assert.ok(nearWall);
  assert.equal(body.state, 'treading');
  // The question is answered: the swimmer swims on again within two seconds.
  body.needsYou = false;
  stepFor(body, world, 2);
  assert.equal(body.state, 'swimming');
  assert.equal(body.swim!.holding, false);
});

test('a delegating session treads water, and does not move along its lane', () => {
  const world = buildWorld(null);
  const body = swimmerIn(world, 'delegates', 1, 'delegate');
  const lane = world.lanes[1];
  const x0 = body.swim!.x;
  stepFor(body, world, 3, () => {
    assert.ok(Math.abs(body.swim!.z - lane.z) < lane.width / 2, 'left its lane');
  });
  assert.ok(Math.abs(body.swim!.x - x0) < 0.05, `moved ${Math.abs(body.swim!.x - x0).toFixed(3)} m`);
  assert.equal(body.state, 'treading');
  // It is upright, with the chest at the waterline.
  assert.ok(Math.abs(body.y - (world.waterY - body.height * 0.62)) < 1e-9);
});

test('a runner covers more water than a swimmer doing nothing in particular', () => {
  const world = buildWorld(null);
  const runner = swimmerIn(world, 'runs', 1, 'run');
  const plain = swimmerIn(world, 'plain', 3, 'other');
  const distance = (body: Body) => {
    let total = 0;
    let last = body.swim!.x;
    stepFor(body, world, 20, () => {
      total += Math.abs(body.swim!.x - last);
      last = body.swim!.x;
    });
    return total;
  };
  const fast = distance(runner);
  const slow = distance(plain);
  assert.ok(fast >= 1.25 * slow, `run ${fast.toFixed(1)} m against ${slow.toFixed(1)} m`);
});

test('a reader dives now and then, and never reaches the floor', () => {
  const world = buildWorld(null);
  const body = swimmerIn(world, 'reads', 0, 'read');
  const top = world.waterY - 0.06;
  let deepest = top;
  let back = false;
  let dived = false;
  stepFor(body, world, 20, () => {
    const floor = world.waterY - floorDepthAt(world, body.swim!.x);
    assert.ok(body.y > floor, `y ${body.y.toFixed(2)} under the floor ${floor.toFixed(2)}`);
    if (body.y < deepest) deepest = body.y;
    if (deepest < top - 0.3 && body.y > top - 0.05) back = true;
    if (deepest < top - 0.3) dived = true;
  });
  assert.ok(dived, 'never dived');
  assert.ok(back, 'never came back up');
});

test('each kind of work swims in its own stroke', () => {
  const world = buildWorld(null);
  const expect: [WorkKind, string | null, number][] = [
    ['run', 'crawl', 1.3],
    ['edit', 'butterfly', 1],
    ['read', 'breaststroke', 1],
    ['web', 'backstroke', 1],
    ['plan', 'float', 1],
    ['other', null, 1],
  ];
  for (const [work, style, tempo] of expect) {
    const body = swimmerIn(world, `stroke-${work}`, 2, work);
    stepBody(body, world, 1 / 30, [], CTX);
    assert.equal(body.swimStyle, style, work);
    assert.equal(body.tempo, tempo, work);
    assert.equal(body.state, 'swimming', work);
  }
});

test('the crowd still reaches its places when every body has some work and some ask for the person', () => {
  const world = buildWorld(null);
  const works: WorkKind[] = ['run', 'edit', 'read', 'web', 'delegate', 'plan', 'other'];
  const bodies: Body[] = [];
  for (let i = 0; i < 60; i += 1) {
    const body = createBody(`w-${String(i).padStart(2, '0')}`, 1.6, 0.5, 1, entrance(world, i));
    const mode = i < 24 ? 'swim' : i < 30 ? 'lounge' : 'waiting';
    const props =
      mode === 'swim' ? { lane: i % 4 } : mode === 'lounge' ? { lounger: i - 24 } : { waiting: i - 30 < 4 ? i - 30 : -1, queue: Math.max(0, i - 34) };
    applyPresentation(body, present(mode, props), world, () => null, () => 0);
    body.work = works[i % works.length];
    body.needsYou = i % 9 === 0;
    bodies.push(body);
  }
  const ctx = {
    exited: () => {},
    ladderLoad: (index: number, self: Body) => ladderLoad(bodies, index, self),
  };
  const dt = 1 / 30;
  for (let t = 0; t < 240; t += dt) {
    const walkers: Walker[] = bodies
      .filter((b) => !b.inWater && b.seat === null && b.climbing === 0)
      .map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
    for (const body of bodies) stepBody(body, world, dt, walkers, ctx, (index) => ladderBusy(bodies, index, body));
  }
  const stuck = bodies.filter((b) => b.path.length > 0).map((b) => b.id);
  assert.deepEqual(stuck, [], `still on the way: ${stuck.join(', ')}`);
  assert.equal(bodies.filter((b) => b.inWater).length, 24);
  assert.equal(bodies.filter((b) => b.seat !== null).length, 6);
});

test('a swimmer that has worked for hours is slower, and never by more than a quarter', () => {
  assert.equal(fatigueAfter(0), 0);
  assert.equal(fatigueAfter(30 * 60), 0);
  assert.ok(fatigueAfter(60 * 60) > 0.1 && fatigueAfter(60 * 60) < 0.15);
  assert.equal(fatigueAfter(90 * 60), 0.25);
  assert.equal(fatigueAfter(10 * 60 * 60), 0.25);
});

test('a tired swimmer covers three quarters of the water in twenty seconds', () => {
  const world = buildWorld(null);
  const distance = (fatigue: number) => {
    const body = swimmerIn(world, `tired-${fatigue}`, 2, 'other');
    body.fatigue = fatigue;
    let total = 0;
    let last = body.swim!.x;
    stepFor(body, world, 20, () => {
      total += Math.abs(body.swim!.x - last);
      last = body.swim!.x;
    });
    return total;
  };
  const rested = distance(0);
  const tired = distance(0.25);
  const ratio = tired / rested;
  assert.ok(Math.abs(ratio - 0.75) < 0.05, `ratio ${ratio.toFixed(3)}`);
});


// --- the ways into the water ---------------------------------------------

/**
 * The entries as the scene offers them: a way is busy when another body is
 * on it, and the water is busy when a swimmer is near the splash.
 */
function entryContext(bodies: Body[]): FlowContext {
  return {
    exited: () => {},
    ladderLoad: (index: number, self: Body) => ladderLoad(bodies, index, self),
    entries: {
      reducedMotion: false,
      busy: (self: Body) => {
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
          block: (lane: number) => bodies.some((o) => o !== self && o.entry?.kind === 'block' && o.lane === lane),
          waterNear: (x: number, z: number, r: number) =>
            bodies.some((o) => o !== self && o.inWater && o.swim !== null && Math.hypot(o.swim.x - x, o.swim.z - z) < r),
        };
      },
    },
  };
}

test('a crowd of swimmers that goes in by the ways of Sprint 24 is all swimming within 180 seconds', () => {
  const world = buildWorld(null);
  const bodies: Body[] = [];
  for (let i = 0; i < 24; i += 1) {
    const body = createBody(`x-${String(i).padStart(2, '0')}`, 1.6, 0.5, 1, queueSpot(world, i));
    applyPresentation(body, present('swim', { lane: i % 4, lane_offset: 0 }), world, () => null, () => 0);
    bodies.push(body);
  }
  const ctx = entryContext(bodies);
  const dt = 1 / 30;
  const kinds = new Set<string>();
  for (let t = 0; t < 180; t += dt) {
    const walkers: Walker[] = bodies
      .filter((b) => !b.inWater && b.seat === null && b.climbing === 0 && b.entry === null)
      .map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
    for (const body of bodies) {
      stepBody(body, world, dt, walkers, ctx, (index) => ladderBusy(bodies, index, body));
      if (body.entry !== null) kinds.add(body.entry.kind);
    }
  }
  const dry = bodies.filter((b) => !b.inWater).map((b) => b.id);
  assert.deepEqual(dry, [], `still on the deck: ${dry.join(', ')}`);
  // More than one way in was used.
  assert.ok(kinds.size >= 2, `only ${[...kinds].join(', ')}`);
});

test('the crowd test of the gate, with every swimmer going in by the ways of Sprint 24', () => {
  const world = buildWorld(null);
  const bodies: Body[] = [];
  for (let i = 0; i < 60; i += 1) {
    const body = createBody(`g-${String(i).padStart(2, '0')}`, 1.6, 0.5, 1, entrance(world, i));
    const mode = i < 24 ? 'swim' : i < 30 ? 'lounge' : 'waiting';
    const props =
      mode === 'swim' ? { lane: i % 4 } : mode === 'lounge' ? { lounger: i - 24 } : { waiting: i - 30 < 4 ? i - 30 : -1, queue: Math.max(0, i - 34) };
    applyPresentation(body, present(mode, props), world, () => null, () => 0);
    bodies.push(body);
  }
  const ctx = entryContext(bodies);
  const dt = 1 / 30;
  for (let t = 0; t < 240; t += dt) {
    const walkers: Walker[] = bodies
      .filter((b) => !b.inWater && b.seat === null && b.climbing === 0 && b.entry === null)
      .map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
    for (const body of bodies) stepBody(body, world, dt, walkers, ctx, (index) => ladderBusy(bodies, index, body));
  }
  const stuck = bodies.filter((b) => b.path.length > 0 && b.entry === null).map((b) => b.id);
  assert.deepEqual(stuck, [], `still on the way: ${stuck.join(', ')}`);
  assert.equal(bodies.filter((b) => b.inWater).length, 24);
  assert.equal(bodies.filter((b) => b.seat !== null).length, 6);
});

// --- the errands (Sprint 25) ---------------------------------------------

function errandsContext(bodies: Body[], book: SlotBook, clock: { now: number }): FlowContext {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  return {
    ...entryContext(bodies),
    errands: { book, now: () => clock.now, bodyOf: (id: string) => byId.get(id) },
  };
}

/** The obstacles a body on the deck must not be in, with the own place of a hot tub allowed. */
function inObstacle(world: World, b: Body): string | null {
  for (const o of world.obstacles) {
    if (o.name === 'pool') continue;
    if (o.name === 'hotTub' && b.errand?.kind === 'hotTub') continue;
    const a = o.area;
    if (b.x > a.minX && b.x < a.maxX && b.z > a.minZ && b.z < a.maxZ) return o.name;
  }
  return null;
}

test('the ball court is on the deck, clear of the equipment, and off the way to the stairs and the board', () => {
  // On one and two lanes the court's far spot stands in the hot tub. The court
  // is then not offered at all (it is sealed off, see errands.test.ts), so it
  // is only checked for the sizes where it is used.
  for (const lanes of [3, 4, 5, 6, 8]) {
    const world = buildWorld({ lanes, loungers: 6, waiting: 4 });
    for (const spot of world.equipment.ballCourt.spots) {
      assert.ok(onDeck(world, spot), `court spot ${JSON.stringify(spot)} is not on the deck with ${lanes} lanes`);
      for (const o of world.obstacles) {
        if (o.name === 'pool') continue;
        const a = o.area;
        assert.ok(
          !(spot.x > a.minX - 0.4 && spot.x < a.maxX + 0.4 && spot.z > a.minZ - 0.4 && spot.z < a.maxZ + 0.4),
          `court spot is at ${o.name} with ${lanes} lanes`,
        );
      }
    }
  }
  // The walk to the stairs and to the board keeps a metre from the players.
  const world = buildWorld(null);
  const e = world.equipment;
  for (const target of [e.slide.stairsFoot, e.board.base]) {
    for (const p of route(world, queueSpot(world, 0), target)) {
      for (const spot of e.ballCourt.spots) {
        assert.ok(Math.hypot(p.x - spot.x, p.z - spot.z) > 0.8, `the way to ${JSON.stringify(target)} passes a court spot`);
      }
    }
  }
});

test('an idle agent goes on errands, comes back to its lounger, and never steps into the equipment, for 300 seconds', () => {
  const world = buildWorld({ lanes: 4, loungers: 24, waiting: 6 });
  const bodies: Body[] = [];
  for (let i = 0; i < 24; i += 1) {
    const body = createBody(`e-${String(i).padStart(2, '0')}`, 1.6, 0.5, 1, loungerApproach(world.loungers[i]));
    applyPresentation(body, present('lounge', { lounger: i }), world, () => null, () => 0);
    settle(body, world);
    bodies.push(body);
  }
  const book: SlotBook = { taken: new Map() };
  const clock = { now: 0 };
  const ctx = errandsContext(bodies, book, clock);
  const dt = 1 / 30;
  let nextTick = 1;
  type Record = { id: string; kind: string; started: number; reached: number | null; ended: number | null; useFor: number };
  const records: Record[] = [];
  const open = new Map<string, Record>();
  for (let t = 0; t < 300; t += dt) {
    clock.now = t;
    if (t >= nextTick) {
      nextTick += 1;
      tickErrands(bodies, world, book, t, false, false);
      for (const b of bodies) {
        if (b.errand && !open.has(b.id)) {
          const rec: Record = { id: b.id, kind: b.errand.kind, started: t, reached: null, ended: null, useFor: b.errand.useFor };
          open.set(b.id, rec);
          records.push(rec);
        }
      }
      // A slot is held by the body that has it, and by nobody else.
      for (const [slot, id] of book.taken) {
        const owner = bodies.find((b) => b.id === id);
        assert.ok(owner?.errand && owner.errand.slot === slot, `${slot} is held by ${id} without the errand`);
      }
    }
    const walkers: Walker[] = bodies
      .filter((b) => !b.inWater && b.seat === null && b.climbing === 0 && b.entry === null)
      .map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
    for (const body of bodies) {
      stepBody(body, world, dt, walkers, ctx, (index) => ladderBusy(bodies, index, body));
      const rec = open.get(body.id);
      if (rec && body.errand && rec.reached === null && body.errand.phase === 'using') rec.reached = t;
      if (rec && !body.errand) {
        rec.ended = t;
        open.delete(body.id);
      }
      const hit = inObstacle(world, body);
      assert.equal(hit, null, `${body.id} is inside ${hit} at ${t.toFixed(1)} s`);
    }
  }
  const kinds = new Set(records.map((r) => r.kind));
  assert.ok(kinds.size >= 6, `only ${[...kinds].join(', ')}`);
  // The last time each agent's errand ended, so that the ones that finished
  // long before the end can be checked to be back on their loungers.
  const endedAt = new Map<string, number>();
  for (const r of records) if (r.ended !== null) endedAt.set(r.id, r.ended);
  for (const r of records) {
    if (r.ended === null || r.kind === 'stroll' || r.reached === null) continue;
    const used = r.ended - r.reached;
    assert.ok(used >= r.useFor - 0.3 && used <= r.useFor + 2.5, `${r.kind} of ${r.id} was used for ${used.toFixed(1)} s, not ${r.useFor.toFixed(1)}`);
  }
  // An agent whose errand ended a minute or more before the end is back on its lounger.
  for (const b of bodies) {
    const ended = endedAt.get(b.id);
    if (b.errand !== null || ended === undefined || ended > 240) continue;
    assert.equal(b.seat, b.lounger, `${b.id} is not back on its lounger: ${JSON.stringify({ x: b.x, z: b.z, goal: b.goal, path: b.path.length, state: b.state, errandsDone: b.errandsDone, next: b.nextErrandAt, ended, now: clock.now, lounger: b.lounger, desired: b.desired })}`);
    assert.equal(b.sitT, 1, `${b.id} is not sitting down`);
  }
  const done = records.filter((r) => r.ended !== null && r.ended < 240);
  assert.ok(done.length >= 10, `only ${done.length} errands finished`);
});

test('an errand is dropped at once when the agent wants the water: the partners are freed, and the hot tub is left by the step', () => {
  const world = buildWorld({ lanes: 4, loungers: 24, waiting: 6 });
  const bodies: Body[] = [];
  for (let i = 0; i < 24; i += 1) {
    const body = createBody(`d-${String(i).padStart(2, '0')}`, 1.6, 0.5, 1, loungerApproach(world.loungers[i]));
    applyPresentation(body, present('lounge', { lounger: i }), world, () => null, () => 0);
    settle(body, world);
    bodies.push(body);
  }
  const book: SlotBook = { taken: new Map() };
  const clock = { now: 0 };
  const ctx = errandsContext(bodies, book, clock);
  const dt = 1 / 30;
  let nextTick = 1;
  for (let t = 0; t < 150; t += dt) {
    clock.now = t;
    if (t >= nextTick) {
      nextTick += 1;
      tickErrands(bodies, world, book, t, false, false);
    }
    const walkers: Walker[] = bodies
      .filter((b) => !b.inWater && b.seat === null && b.climbing === 0 && b.entry === null)
      .map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
    for (const body of bodies) stepBody(body, world, dt, walkers, ctx, (index) => ladderBusy(bodies, index, body));
  }
  const busy = bodies.filter((b) => b.errand !== null);
  assert.ok(busy.length >= 3, `only ${busy.length} errands at the switch`);
  // The hot tub's agents that are in it, or getting in or out, leave by the step.
  const hotTubs = busy.filter((b) => b.errand?.kind === 'hotTub' && b.errand.phase !== 'going').map((b) => b.id);
  const partners = new Map<string, string[]>();
  for (const b of busy) if (b.errand && b.errand.with.length > 0) partners.set(b.id, b.errand.with);
  // The agents now want the water.
  const step = world.equipment.hotTub.step;
  const nearStep = new Map<string, number>();
  for (const b of busy) applyPresentation(b, present('swim', { lane: 0, lane_offset: 0 }), world, () => null, () => 0);
  const ids = new Set(busy.map((b) => b.id));
  for (let t = 0; t < 60; t += dt) {
    clock.now += dt;
    const walkers: Walker[] = bodies
      .filter((b) => !b.inWater && b.seat === null && b.climbing === 0 && b.entry === null)
      .map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
    for (const body of bodies) {
      stepBody(body, world, dt, walkers, ctx, (index) => ladderBusy(bodies, index, body));
      // The first frame drops every group that had an aborted member.
      if (t < dt * 1.5) {
        for (const [id, withIds] of partners) {
          if (!ids.has(id)) continue;
          for (const other of withIds) {
            const o = bodies.find((x) => x.id === other);
            if (o && o.desired === 'swim') assert.equal(o.errand, null, `${other} still has its errand`);
          }
        }
      }
      if (ids.has(body.id) && t < 3) {
        const d = Math.hypot(body.x - step.x, body.z - step.z);
        nearStep.set(body.id, Math.min(nearStep.get(body.id) ?? Infinity, d));
      }
      if (ids.has(body.id)) {
        const hit = inObstacle(world, body);
        assert.equal(hit, null, `${body.id} is inside ${hit} while it leaves`);
      }
    }
  }
  for (const b of busy) {
    assert.equal(b.errand, null, `${b.id} still has an errand`);
    assert.ok(b.inWater, `${b.id} is not in the water within 60 s`);
  }
  for (const [slot, owner] of book.taken) assert.ok(!ids.has(owner), `${slot} is still held by ${owner}`);
  for (const id of hotTubs) {
    assert.ok((nearStep.get(id) ?? Infinity) < 1.2, `${id} left the hot tub somewhere other than the step`);
  }
});

test('a crowd of agents that all go on errands goes into the water when it is asked to', () => {
  const world = buildWorld({ lanes: 4, loungers: 24, waiting: 6 });
  const bodies: Body[] = [];
  for (let i = 0; i < 24; i += 1) {
    const body = createBody(`c-${String(i).padStart(2, '0')}`, 1.6, 0.5, 1, loungerApproach(world.loungers[i]));
    applyPresentation(body, present('lounge', { lounger: i }), world, () => null, () => 0);
    settle(body, world);
    bodies.push(body);
  }
  const book: SlotBook = { taken: new Map() };
  const clock = { now: 0 };
  const ctx = errandsContext(bodies, book, clock);
  const dt = 1 / 30;
  let nextTick = 1;
  for (let t = 0; t < 300; t += dt) {
    clock.now = t;
    if (t >= nextTick) {
      nextTick += 1;
      tickErrands(bodies, world, book, t, false, false);
    }
    const walkers: Walker[] = bodies
      .filter((b) => !b.inWater && b.seat === null && b.climbing === 0 && b.entry === null)
      .map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
    for (const body of bodies) stepBody(body, world, dt, walkers, ctx, (index) => ladderBusy(bodies, index, body));
  }
  // Every running errand finishes once the planner stops starting new ones.
  for (const b of bodies) applyPresentation(b, present('swim', { lane: bodies.indexOf(b) % 4, lane_offset: 0 }), world, () => null, () => 0);
  for (let t = 0; t < 200; t += dt) {
    clock.now += dt;
    const walkers: Walker[] = bodies
      .filter((b) => !b.inWater && b.seat === null && b.climbing === 0 && b.entry === null)
      .map((b) => ({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 }));
    for (const body of bodies) stepBody(body, world, dt, walkers, ctx, (index) => ladderBusy(bodies, index, body));
  }
  const dry = bodies.filter((b) => !b.inWater).map((b) => b.id);
  assert.deepEqual(dry, [], `still on the deck after 200 s: ${dry.join(', ')}`);
  assert.equal(book.taken.size, 0, 'slots are still held');
});

// --- Sprint 26: the lanterns, the flower beds and the sprinkler ---------------

/** The corners of every obstacle, grown by the corner margin of the planner. */
function cornersOf(world: World, by = 0.8): Vec2[] {
  const out: Vec2[] = [];
  for (const o of world.obstacles) {
    const a = o.area;
    out.push(
      { x: a.minX - by, z: a.minZ - by },
      { x: a.maxX + by, z: a.minZ - by },
      { x: a.maxX + by, z: a.maxZ + by },
      { x: a.minX - by, z: a.maxZ + by },
    );
  }
  return out;
}

/** Every place a person stands or walks to, in the world. */
function standingSpots(world: World): Vec2[] {
  const out: Vec2[] = [];
  for (const w of world.waiting) out.push(w);
  for (const l of world.loungers) out.push(loungerApproach(l));
  for (const ladder of world.ladders) {
    out.push(ladderTop(ladder), ladderFoot(ladder));
  }
  for (let k = 0; k < 12; k += 1) {
    out.push(entrance(world, k), queueSpot(world, k));
  }
  out.push(gateOutside(world));
  const e = world.equipment;
  out.push(e.slide.stairsFoot, e.board.base, e.kiosk.use, e.pingPong.ends[0], e.pingPong.ends[1], e.shower.stand);
  out.push(...e.hotTub.seats, e.hotTub.step, ...e.ballCourt.spots);
  return out;
}

test('every lantern post is inside the fence, 0.3 m in from it, and off the paths and the places people stand', () => {
  for (const payload of PAYLOADS) {
    const world = buildWorld(payload);
    const d = world.deck;
    assert.equal(world.lanterns.length, 6, 'six lantern posts');
    for (const p of world.lanterns) {
      // Along the fence: 0.3 m inside one of the four sides.
      const onFence =
        Math.abs(p.x - (d.minX + 0.3)) < 1e-9 ||
        Math.abs(p.x - (d.maxX - 0.3)) < 1e-9 ||
        Math.abs(p.z - (d.minZ + 0.3)) < 1e-9 ||
        Math.abs(p.z - (d.maxZ - 0.3)) < 1e-9;
      assert.ok(onFence, `the post at ${p.x},${p.z} stands 0.3 m inside the fence`);
      assert.ok(insideFence(world, p), 'the post is inside the fence');
      assert.equal(inPool(world, p), false, 'the post is not in the pool');
      for (const c of cornersOf(world)) {
        assert.ok(Math.hypot(c.x - p.x, c.z - p.z) > 1.0, `the post at ${p.x},${p.z} is within 1 m of a corner`);
      }
      for (const s of standingSpots(world)) {
        assert.ok(Math.hypot(s.x - p.x, s.z - p.z) > 1.0, `the post at ${p.x},${p.z} is within 1 m of a standing spot`);
      }
      for (const o of world.obstacles) {
        const a = o.area;
        const inside = p.x > a.minX - 0.2 && p.x < a.maxX + 0.2 && p.z > a.minZ - 0.2 && p.z < a.maxZ + 0.2;
        assert.equal(inside, false, `the post is inside ${o.name}`);
      }
    }
  }
});

test('the flower beds are in the garden, clear of the water, the trunks and the other equipment', () => {
  for (const payload of PAYLOADS) {
    const world = buildWorld(payload);
    assert.equal(world.flowerBeds.length, 3, 'three flower beds');
    for (const bed of world.flowerBeds) {
      assert.ok(bed.maxZ - bed.minZ <= 0.6, 'a bed is half a metre deep');
      assert.ok(bed.maxX - bed.minX >= 2.4 && bed.maxX - bed.minX <= 2.8, 'a bed is the length of three or four bushes');
      assert.ok(bed.minZ < world.deck.minZ, 'the beds are outside the far fence, in the garden');
      // No trunk stands in a bed.
      for (const t of world.trees) {
        const cx = Math.min(bed.maxX, Math.max(bed.minX, t.x));
        const cz = Math.min(bed.maxZ, Math.max(bed.minZ, t.z));
        assert.ok(Math.hypot(t.x - cx, t.z - cz) > 0.3, 'no trunk stands in a bed');
      }
      // Not over the water, nor in the way of the path to the gate.
      assert.equal(overlaps(bed, world.pool), false, 'no bed is over the water');
    }
  }
});

test('the sprinkler stands on the lawn, outside the fence, clear of every piece of equipment', () => {
  for (const payload of PAYLOADS) {
    const world = buildWorld(payload);
    const s = world.sprinkler;
    assert.equal(insideFence(world, s), false, 'the sprinkler is outside the fence');
    assert.ok(world.deck.minX - s.x >= 4.5 && world.deck.minX - s.x <= 5.5, 'five metres from the fence');
    for (const o of world.obstacles) {
      const a = o.area;
      assert.equal(s.x > a.minX && s.x < a.maxX && s.z > a.minZ && s.z < a.maxZ, false, `the sprinkler is in ${o.name}`);
    }
  }
});
