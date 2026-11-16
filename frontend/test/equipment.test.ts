/**
 * The new equipment on the terrace and at the shallow end: where it stands,
 * and that nobody is put on top of it.
 *
 * Pure data, so it is checked in node. The drawing is checked by eye in the
 * browser (Sprint 23's screenshots).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildWorld, insideFence, onDeck, inPool, ladderTop, loungerApproach, queueSpot, backRest, gateOutside, type Area, type Spot, type Vec2, type World } from '../src/scene/pool3d/world';
import { troughGeometry } from '../src/scene/pool3d/build';
import { CatmullRomCurve3, Vector3 } from 'three';

const LANE_COUNTS = [1, 2, 4, 8];
const LOUNGER_COUNTS = [6, 12];

function worlds(): { label: string; world: World }[] {
  const out: { label: string; world: World }[] = [];
  for (const lanes of LANE_COUNTS) {
    for (const loungers of LOUNGER_COUNTS) {
      out.push({ label: `${lanes} lanes, ${loungers} loungers`, world: buildWorld({ lanes, loungers, waiting: 4 }) });
    }
  }
  return out;
}

function overlaps(a: Area, b: Area): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

function inside(p: Vec2, a: Area): boolean {
  return p.x > a.minX && p.x < a.maxX && p.z > a.minZ && p.z < a.maxZ;
}

function insideAny(world: World, p: Vec2): string | null {
  for (const o of world.obstacles) if (inside(p, o.area)) return o.name;
  return null;
}

/** Every spot people stand on in the new equipment. */
function standingSpots(world: World): { name: string; spot: Vec2 }[] {
  const e = world.equipment;
  return [
    { name: 'stairsFoot', spot: e.slide.stairsFoot },
    // On one lane the diver's place is on the low chute (see ONE_LANE).
    ...(world.lanes.length === 1 ? [] : [{ name: 'board.base', spot: e.board.base }]),
    { name: 'hotTub.step', spot: e.hotTub.step },
    { name: 'kiosk.use', spot: e.kiosk.use },
    { name: 'pingPong.ends[0]', spot: e.pingPong.ends[0] },
    { name: 'pingPong.ends[1]', spot: e.pingPong.ends[1] },
    { name: 'shower.stand', spot: e.shower.stand },
  ];
}

// The pairs that touch on purpose, by name in sorted order: the low run of
// the chute and the board reach over the coping of the pool, and the two
// parts of the chute share a corner of their boxes.
const TOUCHING = new Set(['board+pool', 'chuteLow+pool', 'chuteHigh+chuteLow']);
// A one-lane pool is too small for the far corner of the deck: the board
// shares its lane with the low chute, and the table reaches the kiosk. The
// plan's formulas are kept, and these few pairs are accepted there only.
const ONE_LANE = new Set(['board+chuteLow', 'kiosk+pingPong']);
function allowedOverlap(a: string, b: string, lanes: number): boolean {
  const pair = [a, b].sort().join('+');
  if (TOUCHING.has(pair)) return true;
  return lanes === 1 && ONE_LANE.has(pair);
}

test('every obstacle is on the deck, and the kiosk is the only one that may touch the fence', () => {
  for (const { label, world } of worlds()) {
    for (const o of world.obstacles) {
      const a = o.area;
      assert.ok(a.minX >= world.deck.minX && a.maxX <= world.deck.maxX, `${label}: ${o.name} is off the deck in x`);
      assert.ok(a.minZ >= world.deck.minZ && a.maxZ <= world.deck.maxZ, `${label}: ${o.name} is off the deck in z`);
      if (o.name === 'kiosk' || o.name === 'pool') continue;
      const margin = Math.min(a.minX - world.deck.minX, world.deck.maxX - a.maxX, a.minZ - world.deck.minZ, world.deck.maxZ - a.maxZ);
      assert.ok(margin >= 0.3 - 1e-9, `${label}: ${o.name} is ${margin.toFixed(2)} m from the fence`);
    }
  }
});

test('no two obstacles overlap, except the ones that touch on purpose', () => {
  for (const { label, world } of worlds()) {
    const lanes = world.lanes.length;
    for (let i = 0; i < world.obstacles.length; i += 1) {
      for (let j = i + 1; j < world.obstacles.length; j += 1) {
        const a = world.obstacles[i];
        const b = world.obstacles[j];
        if (!overlaps(a.area, b.area)) continue;
        if (allowedOverlap(a.name, b.name, lanes)) continue;
        assert.fail(`${label}: ${a.name} and ${b.name} overlap`);
      }
    }
  }
});

test('no obstacle overlaps a lounger, a ladder top, a waiting spot, the gate or the way to it', () => {
  for (const { label, world } of worlds()) {
    const gate = gateOutside(world);
    const corner = nearestPoolCorner(world, world.gate);
    for (const o of world.obstacles) {
      if (o.name === 'pool') continue;
      const a = o.area;
      for (const [i, lounger] of world.loungers.entries()) {
        const box: Area = {
          minX: lounger.x - lounger.width / 2,
          maxX: lounger.x + lounger.width / 2,
          minZ: lounger.z - lounger.length / 2,
          maxZ: lounger.z + lounger.length / 2,
        };
        assert.ok(!overlaps(a, box), `${label}: ${o.name} overlaps lounger ${i}`);
      }
      for (const ladder of world.ladders) {
        const p = ladderTop(ladder);
        assert.ok(!inside(p, a), `${label}: ${o.name} is on the top of ladder ${ladder.index}`);
      }
      for (const w of world.waiting) assert.ok(!inside(w, a), `${label}: ${o.name} is on a waiting spot`);
      assert.ok(!inside(world.gate, a), `${label}: ${o.name} is on the gate`);
      assert.ok(!inside(gate, a), `${label}: ${o.name} is on gateOutside`);
      for (let k = 0; k <= 20; k += 1) {
        const t = k / 20;
        const p = { x: gate.x + (corner.x - gate.x) * t, z: gate.z + (corner.z - gate.z) * t };
        assert.ok(!inside(p, a), `${label}: ${o.name} is on the way from the gate to the pool`);
      }
    }
  }
});

function nearestPoolCorner(world: World, from: Vec2): Vec2 {
  const p = world.pool;
  const corners = [
    { x: p.minX, z: p.minZ },
    { x: p.maxX, z: p.minZ },
    { x: p.maxX, z: p.maxZ },
    { x: p.minX, z: p.maxZ },
  ];
  let best = corners[0];
  for (const c of corners) {
    if (Math.hypot(c.x - from.x, c.z - from.z) < Math.hypot(best.x - from.x, best.z - from.z)) best = c;
  }
  return best;
}

test('every place people stand is on the deck and outside every obstacle', () => {
  for (const { label, world } of worlds()) {
    for (const { name, spot } of standingSpots(world)) {
      assert.ok(onDeck(world, spot), `${label}: ${name} is not on the deck`);
      assert.equal(insideAny(world, spot), null, `${label}: ${name} is inside an obstacle`);
    }
    // The stairs are climbed from the foot, so the foot is the lowest step
    // of the way up and the stairs' top is at the platform.
    assert.ok(Math.abs(world.equipment.slide.stairsTop.y - world.equipment.slide.top.y) < 1e-9);
  }
});

test('the hot tub seats are inside the tub, and its step is outside the rim', () => {
  for (const { label, world } of worlds()) {
    const tub = world.equipment.hotTub;
    for (const seat of tub.seats) {
      const d = Math.hypot(seat.x - tub.centre.x, seat.z - tub.centre.z);
      assert.ok(d < tub.radius - 0.3, `${label}: a seat is ${d.toFixed(2)} m from the centre`);
    }
    const step = tub.step;
    assert.ok(Math.hypot(step.x - tub.centre.x, step.z - tub.centre.z) > tub.radius);
  }
});

test('the slide and the board splash in the water, away from the walls, in their own lanes', () => {
  for (const { label, world } of worlds()) {
    const e = world.equipment;
    const pool = world.pool;
    for (const [name, p, lane] of [
      ['slide', e.slide.splash, e.slide.lane],
      ['board', e.board.splash, e.board.lane],
    ] as const) {
      assert.ok(inPool(world, p), `${label}: the ${name} splash is not in the pool`);
      assert.ok(p.x - pool.minX >= 0.5 && pool.maxX - p.x >= 0.5, `${label}: the ${name} splash is by a wall`);
      assert.ok(pool.maxZ - p.z >= 0.5 && p.z - pool.minZ >= 0.5, `${label}: the ${name} splash is by a wall`);
      const l = world.lanes[lane];
      assert.ok(Math.abs(p.z - l.z) < l.width / 2, `${label}: the ${name} splash is out of lane ${lane}`);
    }
    const tip = e.board.tip;
    assert.ok(inPool(world, { x: tip.x, z: tip.z }), `${label}: the board tip is not over the water`);
  }
});

test('the chute ends at the water by the far wall', () => {
  for (const { label, world } of worlds()) {
    const path = world.equipment.slide.path;
    const end = path[path.length - 1];
    assert.ok(world.pool.maxX - end.x <= 1.2, `${label}: the chute ends ${(world.pool.maxX - end.x).toFixed(2)} m from the wall`);
    assert.equal(path.length, 7);
  }
});

test('the slide and the board are in different lanes when there are two or more', () => {
  for (const { label, world } of worlds()) {
    if (world.lanes.length < 2) continue;
    assert.notEqual(world.equipment.slide.lane, world.equipment.board.lane, label);
  }
});

test('the places of the equipment and the walks round it keep off the queue, ladders and loungers', () => {
  for (const { label, world } of worlds()) {
    const e = world.equipment;
    const spots: Vec2[] = [e.kiosk.centre, e.pingPong.centre, e.shower.post, e.slide.tower, e.board.block];
    for (const p of spots) assert.ok(insideFence(world, p), `${label}: equipment is outside the fence`);
    for (let place = 0; place < 40; place += 1) {
      assert.equal(insideAny(world, queueSpot(world, place)), null, `${label}: queue ${place} is in an obstacle`);
    }
    for (const ladder of world.ladders) {
      assert.equal(insideAny(world, ladderTop(ladder)), null, `${label}: ladder top is in an obstacle`);
    }
    for (const lounger of world.loungers) {
      assert.equal(insideAny(world, loungerApproach(lounger)), null, `${label}: a lounger's foot is in an obstacle`);
      const back = backRest(lounger);
      assert.equal(insideAny(world, { x: lounger.x, z: back.z }), null, `${label}: a back rest is in an obstacle`);
    }
  }
});

test('the fountains are on the coping at the shallow end', () => {
  for (const { label, world } of worlds()) {
    assert.equal(world.equipment.fountains.length, 2, label);
    for (const f of world.equipment.fountains) {
      assert.ok(f.x < world.pool.minX && f.x > world.pool.minX - 0.4, `${label}: a fountain is off the coping`);
      assert.ok(f.z > world.pool.minZ && f.z < world.pool.maxZ, `${label}: a fountain is outside the pool's sides`);
    }
  }
});

test('every spot has a finite facing', () => {
  const world = buildWorld(null);
  const spots: Spot[] = [...world.equipment.hotTub.seats, world.equipment.slide.stairsFoot, world.equipment.board.base];
  for (const s of spots) assert.ok(Number.isFinite(s.yaw), 'bad yaw');
});

// --- the trough ----------------------------------------------------------------

test('a trough on a straight curve is open at the top and every vertex is on its radius', () => {
  const radius = 0.42;
  const curve = new CatmullRomCurve3([new Vector3(0, 1, 0), new Vector3(2, 1, 0), new Vector3(4, 1, 0)]);
  const g = troughGeometry(curve, 40, radius);
  const pos = g.getAttribute('position');
  let highest = -Infinity;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // The distance from the centre line, which is the line y = 1, z = 0.
    const d = Math.hypot(y - 1, z);
    assert.ok(Math.abs(d - radius) < 1e-6, `vertex ${i} is ${d} from the curve`);
    assert.ok(x >= -1e-9 && x <= 4 + 1e-9);
    highest = Math.max(highest, y);
  }
  // Nothing rises above the centre line: the trough is a U, open at the top.
  assert.ok(highest <= 1 + 1e-6, `a vertex is ${highest - 1} above the centre line`);
  g.dispose();
});

test('a trough that follows a spiral keeps its width: up stays up', () => {
  const radius = 0.4;
  const world = buildWorld(null);
  const path = world.equipment.slide.path.map((p) => new Vector3(p.x, p.y, p.z));
  const curve = new CatmullRomCurve3(path);
  const g = troughGeometry(curve, 120, radius);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i += 1) {
    const v = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    // Every vertex is within a radius of some point of the curve.
    let nearest = Infinity;
    for (let k = 0; k <= 400; k += 1) nearest = Math.min(nearest, v.distanceTo(curve.getPointAt(k / 400)));
    assert.ok(nearest <= radius + 0.02, `vertex ${i} is ${nearest.toFixed(3)} from the chute`);
  }
  g.dispose();
});
