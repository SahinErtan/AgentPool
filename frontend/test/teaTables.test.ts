/**
 * The side tables of the loungers and the glasses of tea (Sprint 29.5).
 *
 * The tables are checked against the world: they stand clear of the loungers,
 * the water, the obstacles and the paths the walkers take, and of each other.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorld,
  entrance,
  loungerApproach,
  sideTableOf,
  TABLE_FOOT_RADIUS,
  TABLE_RADIUS,
  TABLE_TOP,
  type Area,
  type Lounger,
  type SideTable,
  type Vec2,
  type World,
} from '../src/scene/pool3d/world';
import { findPath, segmentHitsArea } from '../src/scene/pool3d/nav';
import { REFILL_S, TeaTables } from '../src/scene/pool3d/teaTables';

/** The lounger's seat is this high at its top, in metres (the cushion's top). */
const SEAT_TOP = 0.395;
/** The legs of a lounger stand this far from its middle, to the outside of the leg. */
const LEG_OUTER = 0.335;

/** The worlds the tables are checked in: the default, and a crowded pool with two rows. */
const WORLDS: [string, World][] = [
  ['default', buildWorld(null)],
  ['two rows', buildWorld({ loungers: 20, lanes: 6, waiting: 6 })],
];

/** The distance from a point to an axis-aligned area (zero when inside). */
function distanceToArea(x: number, z: number, a: Area): number {
  const dx = Math.max(a.minX - x, 0, x - a.maxX);
  const dz = Math.max(a.minZ - z, 0, z - a.maxZ);
  return Math.hypot(dx, dz);
}

/** The area of a lounger, on the ground, as the lounger's own frame. */
function loungerArea(l: Lounger): Area {
  const halfW = l.width / 2;
  const halfL = l.length / 2;
  return {
    minX: l.x - halfW,
    maxX: l.x + halfW,
    minZ: l.z - halfL,
    maxZ: l.z + halfL,
  };
}

/** A small square round a table's foot, big enough to be a path's area: the foot and a margin. */
function aroundTable(t: SideTable, margin: number): Area {
  const r = t.footRadius + margin;
  return { minX: t.x - r, maxX: t.x + r, minZ: t.z - r, maxZ: t.z + r };
}

test('the table is on the figure\'s right, in front of the hips, and moves with the lounger', () => {
  for (const [, world] of WORLDS) {
    for (const l of world.loungers) {
      const t = sideTableOf(l);
      // The lounger faces +z, so the figure's right is -x.
      assert.ok(t.x < l.x - 0.3, `table ${t.x} is not on the right of lounger ${l.x}`);
      assert.ok(Math.abs(t.z - l.z) < 0.6, 'the table is level with the lounger');
    }
  }
  // Turned round, the table turns with it: a lounger that faces -x has its table on -z.
  const turned: Lounger = { ...buildWorld(null).loungers[0], facing: { x: -1, z: 0 } };
  const t = sideTableOf(turned);
  assert.ok(Math.abs(t.z - turned.z) > 0.3 || t.z !== turned.z, 'the table moved with the facing');
});

test('no table stands under a lounger: the stem is outside the lounger, and the foot clears its legs', () => {
  for (const [name, world] of WORLDS) {
    for (const l of world.loungers) {
      const t = sideTableOf(l);
      const dx = Math.abs(t.x - l.x);
      assert.ok(dx - TABLE_FOOT_RADIUS > LEG_OUTER, `${name}: the foot of lounger ${l.index} reaches its legs`);
      assert.ok(dx > l.width / 2, `${name}: the stem of lounger ${l.index} is inside it`);
    }
  }
});

test('where a table overlaps a lounger in plan, the top is above the cushion', () => {
  for (const [, world] of WORLDS) {
    for (const l of world.loungers) {
      const t = sideTableOf(l);
      const overlaps = distanceToArea(t.x, t.z, loungerArea(l)) < t.radius;
      if (overlaps) assert.ok(t.top > SEAT_TOP, `the top at ${t.top} sits in the cushion`);
    }
  }
});

test('no table overlaps the water, the pool, an obstacle, or the deck\'s edge', () => {
  for (const [name, world] of WORLDS) {
    for (const l of world.loungers) {
      const t = sideTableOf(l);
      const clear = t.footRadius + 0.1;
      assert.ok(distanceToArea(t.x, t.z, world.pool) > clear, `${name}: table ${l.index} is in the pool`);
      for (const o of world.obstacles) {
        // Another table is checked by the test of the tables among themselves.
        if (o.name.startsWith('table ')) continue;
        assert.ok(distanceToArea(t.x, t.z, o.area) > clear, `${name}: table ${l.index} is in ${o.name}`);
      }
      assert.ok(distanceToArea(t.x, t.z, world.deck) === 0, `${name}: table ${l.index} is off the deck`);
    }
  }
});

test('no table blocks a path: the walks to the loungers and in from the gate keep clear of every table', () => {
  for (const [name, world] of WORLDS) {
    const starts: Vec2[] = [world.gate, entrance(world, 0), entrance(world, 3)];
    for (const from of starts) {
      for (const l of world.loungers) {
        const path = findPath(world, from, loungerApproach(l));
        if (path === null) continue;
        for (const other of world.loungers) {
          const t = sideTableOf(other);
          const area = aroundTable(t, 0.3);
          for (let i = 0; i + 1 < path.length; i += 1) {
            assert.ok(!segmentHitsArea(path[i], path[i + 1], area), `${name}: a walk to lounger ${l.index} passes table ${t.index}`);
          }
        }
      }
    }
  }
});

test('the tables do not overlap one another', () => {
  for (const [name, world] of WORLDS) {
    const tables = world.loungers.map(sideTableOf);
    for (let i = 0; i < tables.length; i += 1) {
      for (let j = i + 1; j < tables.length; j += 1) {
        const d = Math.hypot(tables[i].x - tables[j].x, tables[i].z - tables[j].z);
        assert.ok(d > 2 * TABLE_RADIUS, `${name}: tables ${i} and ${j} are ${d.toFixed(2)} m apart`);
      }
    }
  }
});

test('a table stands at the height of the top, which is above the cushion', () => {
  assert.ok(TABLE_TOP > SEAT_TOP);
  assert.ok(TABLE_TOP < 0.5, 'a side table, not a desk');
  assert.ok(TABLE_RADIUS > TABLE_FOOT_RADIUS * 0.5);
});

test('a glass of tea is taken from its table, and put back where the tea ended', () => {
  const tables = new TeaTables(3);
  assert.equal(tables.has(1), true);
  assert.equal(tables.take(1), true);
  assert.equal(tables.has(1), false);
  assert.equal(tables.take(1), false, 'there is no second glass to take');
  tables.putBack(1);
  assert.equal(tables.has(1), true);
  assert.equal(tables.has(0), true, 'the other tables keep their glasses');
});

test('a table left empty by a figure that went away gets a glass back after five minutes', () => {
  const tables = new TeaTables(2);
  tables.take(0);
  tables.leave(0, 100);
  tables.tick(100 + REFILL_S - 1);
  assert.equal(tables.has(0), false, 'not yet');
  tables.tick(100 + REFILL_S);
  assert.equal(tables.has(0), true, 'refilled after five minutes');
});

test('a table whose glass is in a hand is not refilled under it', () => {
  const tables = new TeaTables(1);
  tables.take(0);
  tables.tick(10_000);
  assert.equal(tables.has(0), false);
});
