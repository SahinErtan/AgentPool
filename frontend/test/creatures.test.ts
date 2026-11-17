/**
 * The creatures: a cat, a duck, two birds and two butterflies, and never more
 * than four of them at once. All of it is pure, so it is checked here in node
 * with a simulated day: the clock runs from six in the morning to ten at night,
 * and a spell of rain comes at noon.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paletteFor } from '../src/scene/pool3d/daylight';
import {
  CreatureDirector,
  MAX_CREATURES,
  catMayStand,
  inCatRange,
  gardenSpots,
  nightAmount,
  sprinklerOn,
  sunnySpots,
  windAt,
  type Creature,
  type CreatureWorld,
  type CreaturePerson,
} from '../src/scene/pool3d/creatures';
import { findPath } from '../src/scene/pool3d/nav';
import { buildWorld, inPool, type World } from '../src/scene/pool3d/world';

/** The simulated step, in seconds. */
const DT = 0.1;
/** How many scene seconds one hour of the clock takes in the simulation. */
const HOUR_S = 900;
const START_HOUR = 6;
const DAY_S = 16 * HOUR_S;
const RAIN_FROM_S = (12 - START_HOUR) * HOUR_S;
const RAIN_TO_S = (12.5 - START_HOUR) * HOUR_S;

function hourAt(t: number): number {
  return START_HOUR + t / HOUR_S;
}

function rainingAt(t: number): boolean {
  return t >= RAIN_FROM_S && t < RAIN_TO_S;
}

/**
 * Ten people: five swimming up and down their lanes, five walking along the
 * near side of the deck. Their paths are a triangle wave of time, so the
 * same time always gives the same place.
 */
function crowd(world: World, t: number, into: CreaturePerson[]): CreaturePerson[] {
  const pool = world.pool;
  const lanes = world.lanes;
  for (let i = 0; i < 5; i += 1) {
    const phase = i * 0.37;
    const u = ((t / 9 + phase) % 2 + 2) % 2;
    const tri = u < 1 ? u : 2 - u;
    const forward = u < 1;
    into[i] = {
      x: pool.minX + 1.5 + (pool.maxX - pool.minX - 3) * tri,
      z: lanes[i % lanes.length].z,
      yaw: forward ? Math.PI / 2 : -Math.PI / 2,
      moving: true,
      inWater: true,
    };
  }
  for (let i = 0; i < 5; i += 1) {
    const phase = i * 0.61;
    const u = ((t / 22 + phase) % 2 + 2) % 2;
    const tri = u < 1 ? u : 2 - u;
    const forward = u < 1;
    into[5 + i] = {
      x: pool.minX + 1 + (pool.maxX - pool.minX - 2) * tri,
      z: pool.maxZ + 1.0 + i * 0.25,
      yaw: forward ? Math.PI / 2 : -Math.PI / 2,
      moving: true,
      inWater: false,
    };
  }
  return into;
}

function envFor(
  world: World,
  t: number,
  people: CreaturePerson[],
  extra: Partial<CreatureWorld> = {},
): CreatureWorld {
  const hour = hourAt(t);
  const light = paletteFor(hour).light;
  return {
    world,
    hour,
    light,
    raining: rainingAt(t),
    reducedMotion: false,
    calm: false,
    sprinkler: false,
    people,
    splashes: [],
    avoid: [],
    naps: [],
    ...extra,
  };
}

function swimmersOf(people: readonly CreaturePerson[]): CreaturePerson[] {
  return people.filter((p) => p.inWater);
}

const SEED = 26;

test('the creatures never number more than four, over a simulated day', () => {
  const world = buildWorld(null);
  const director = new CreatureDirector(SEED);
  const people: CreaturePerson[] = [];
  const kinds = new Set<string>();
  let most = 0;
  for (let t = 0; t <= DAY_S; t += DT) {
    crowd(world, t, people);
    director.step(DT, t, envFor(world, t, people));
    const n = director.creatures.length;
    most = Math.max(most, n);
    assert.ok(n <= MAX_CREATURES, `${n} creatures at t=${t.toFixed(1)}`);
    for (const c of director.creatures) kinds.add(c.kind);
  }
  assert.equal(MAX_CREATURES, 4);
  assert.ok(most >= 2, 'more than the cat is seen over the day');
  assert.ok(kinds.has('cat'));
  assert.ok(kinds.has('duck'), 'the duck visits by day');
  assert.ok(kinds.has('butterfly'), 'the butterflies come out by day');
});

test('the cat is always there, and it is never in the water or inside an obstacle', () => {
  const world = buildWorld(null);
  const director = new CreatureDirector(SEED);
  const people: CreaturePerson[] = [];
  let cat: Creature | undefined;
  for (let t = 0; t <= DAY_S; t += DT) {
    crowd(world, t, people);
    director.step(DT, t, envFor(world, t, people));
    cat = director.creatures.find((c) => c.kind === 'cat');
    assert.ok(cat, `the cat is there at t=${t.toFixed(1)}`);
    assert.equal(inPool(world, cat), false, `the cat is in the pool at t=${t.toFixed(1)}`);
    for (const o of world.obstacles) {
      const inside = cat.x > o.area.minX && cat.x < o.area.maxX && cat.z > o.area.minZ && cat.z < o.area.maxZ;
      assert.equal(inside, false, `the cat is inside ${o.name} at t=${t.toFixed(1)}`);
    }
    assert.ok(inCatRange(world, cat), 'the cat stays in the garden and on the deck');
  }
});

test('in the rain the cat reaches the porch within a minute, and stays there', () => {
  const world = buildWorld(null);
  const director = new CreatureDirector(SEED);
  const people: CreaturePerson[] = [];
  const porch = world.hut.porch;
  let arrivedAt = -1;
  for (let t = 0; t <= RAIN_TO_S + 30; t += DT) {
    crowd(world, t, people);
    director.step(DT, t, envFor(world, t, people));
    const cat = director.creatures.find((c) => c.kind === 'cat');
    assert.ok(cat);
    if (t >= RAIN_FROM_S && t < RAIN_TO_S) {
      if (arrivedAt < 0 && Math.hypot(cat.x - porch.x, cat.z - porch.z) < 0.5) arrivedAt = t;
      if (arrivedAt >= 0) {
        assert.ok(Math.hypot(cat.x - porch.x, cat.z - porch.z) < 1.0, `the cat leaves the porch in the rain at t=${t.toFixed(1)}`);
      }
    }
  }
  assert.ok(arrivedAt >= 0, 'the cat got to the porch at all');
  assert.ok(arrivedAt - RAIN_FROM_S <= 60, `the cat reached the porch ${arrivedAt - RAIN_FROM_S}s after the rain began`);
});

test('a person walking straight at the cat makes it run within half a second', () => {
  const world = buildWorld(null);
  const director = new CreatureDirector(SEED);
  const people: CreaturePerson[] = [];
  // Let the cat settle first, on its first spot.
  let t = 0;
  for (; t < 30; t += DT) director.step(DT, t, envFor(world, t, people));
  const cat = director.creatures.find((c) => c.kind === 'cat');
  assert.ok(cat);
  // A person a metre off, walking straight at it.
  const from = { x: cat.x, z: cat.z - 1.0 };
  people.length = 0;
  people.push({ x: from.x, z: from.z, yaw: 0, moving: true, inWater: false });
  let fled = -1;
  for (let k = 0; k < 5; k += 1) {
    director.step(DT, t, envFor(world, t, people));
    t += DT;
    const now = director.creatures.find((c) => c.kind === 'cat');
    if (now?.state === 'flee') {
      fled = k * DT;
      break;
    }
  }
  assert.ok(fled >= 0 && fled <= 0.5, `the cat fled after ${fled}s`);
});

test('the duck is only there by day, and never near a swimmer for more than a second', () => {
  const world = buildWorld(null);
  const director = new CreatureDirector(SEED);
  const people: CreaturePerson[] = [];
  let nearFor = 0;
  let duckSeen = 0;
  for (let t = 0; t <= DAY_S; t += DT) {
    crowd(world, t, people);
    const env = envFor(world, t, people);
    director.step(DT, t, env);
    const duck = director.creatures.find((c) => c.kind === 'duck');
    if (!duck) {
      nearFor = 0;
      continue;
    }
    duckSeen += 1;
    assert.ok(env.light > 0.35, `the duck is there at light ${env.light.toFixed(2)} (t=${t.toFixed(1)})`);
    assert.equal(env.raining, false, 'the duck is not there in the rain');
    // Only on the water: once it is in the air it is over the swimmers' heads.
    const onWater = duck.state !== 'leave' && duck.state !== 'flyIn';
    const close = onWater && swimmersOf(people).some((p) => Math.hypot(p.x - duck.x, p.z - duck.z) < 1.5);
    nearFor = close ? nearFor + DT : 0;
    assert.ok(nearFor <= 1.0 + 1e-9, `the duck was within 1.5 m of a swimmer for ${nearFor.toFixed(1)}s`);
    if (duck.state === 'paddle') {
      const pool = world.pool;
      assert.ok(duck.x > pool.minX + 0.49 && duck.x < pool.maxX - 0.49, 'the duck paddles inside the walls');
      assert.ok(duck.z > pool.minZ + 0.49 && duck.z < pool.maxZ - 0.49, 'the duck paddles inside the walls');
    }
  }
  assert.ok(duckSeen > 0, 'the duck came at least once');
});

test('the birds and the butterflies are only there by day, and not in the rain', () => {
  const world = buildWorld(null);
  const director = new CreatureDirector(SEED);
  const people: CreaturePerson[] = [];
  let birds = 0;
  let butterflies = 0;
  for (let t = 0; t <= DAY_S; t += DT) {
    crowd(world, t, people);
    const env = envFor(world, t, people);
    director.step(DT, t, env);
    for (const c of director.creatures) {
      if (c.kind === 'bird') {
        birds += 1;
        assert.ok(env.light > 0.35, 'a bird is up only by day');
        assert.equal(env.raining, false, 'a bird is not up in the rain');
      }
      if (c.kind === 'butterfly') {
        butterflies += 1;
        assert.ok(env.light > 0.5, 'a butterfly is out only in the day');
        assert.equal(env.raining, false, 'a butterfly is not out in the rain');
        assert.equal(inPool(world, c), false, 'a butterfly is never over the water');
      }
    }
  }
  assert.ok(birds > 0, 'the birds crossed the sky at least once');
  assert.ok(butterflies > 0, 'the butterflies flew at least once');
});

test('with reduced motion only the cat is there, and it does not run', () => {
  const world = buildWorld(null);
  const director = new CreatureDirector(SEED);
  const people: CreaturePerson[] = [];
  let last: { x: number; z: number } | null = null;
  let lastT = 0;
  for (let t = 0; t <= 4 * HOUR_S; t += DT) {
    crowd(world, t, people);
    director.step(DT, t, envFor(world, t, people, { reducedMotion: true }));
    const creatures = director.creatures;
    assert.equal(creatures.length, 1, 'only the cat');
    assert.equal(creatures[0].kind, 'cat');
    if (last !== null && t - lastT >= 1) {
      const speed = Math.hypot(creatures[0].x - last.x, creatures[0].z - last.z) / (t - lastT);
      assert.ok(speed <= 0.05 + 1e-9, `the cat moved at ${speed.toFixed(3)} m/s`);
      last = { x: creatures[0].x, z: creatures[0].z };
      lastT = t;
    } else if (last === null) {
      last = { x: creatures[0].x, z: creatures[0].z };
      lastT = t;
    }
  }
});

test('the same seed and the same inputs give the same creatures at an hour', () => {
  const world = buildWorld(null);
  const a = new CreatureDirector(SEED);
  const b = new CreatureDirector(SEED);
  const people: CreaturePerson[] = [];
  for (let t = 0; t <= 3600; t += DT) {
    crowd(world, t, people);
    const env = envFor(world, t, people);
    a.step(DT, t, env);
    b.step(DT, t, env);
  }
  const ca = a.creatures.map((c) => [c.kind, c.x, c.z, c.state]);
  const cb = b.creatures.map((c) => [c.kind, c.x, c.z, c.state]);
  assert.deepEqual(cb, ca);
});

test('the cat sleeps at night and only wakes once an hour', () => {
  const world = buildWorld(null);
  const director = new CreatureDirector(SEED);
  const people: CreaturePerson[] = [];
  // From 23:00 for an hour of the clock: the cat should be asleep most of it.
  let sleeping = 0;
  let total = 0;
  const start = (23 - START_HOUR) * HOUR_S;
  for (let t = start; t < start + HOUR_S; t += DT) {
    crowd(world, t, people);
    const env = envFor(world, t, people);
    director.step(DT, t, env);
    if (t < start + 0.1 * HOUR_S) continue;
    const cat = director.creatures.find((c) => c.kind === 'cat');
    total += 1;
    if (cat?.state === 'sleep') sleeping += 1;
  }
  assert.ok(sleeping / total > 0.7, `the cat slept ${(100 * sleeping) / total}% of the night hour`);
});

test('the sprinkler runs from seven to nine, ten minutes of every half hour, never in the rain', () => {
  assert.equal(sprinklerOn(7, false, false), true);
  assert.equal(sprinklerOn(7 + 5 / 60, false, false), true);
  assert.equal(sprinklerOn(7 + 15 / 60, false, false), false);
  assert.equal(sprinklerOn(8 + 35 / 60, false, false), true);
  assert.equal(sprinklerOn(9, false, false), false);
  assert.equal(sprinklerOn(6.9, false, false), false);
  assert.equal(sprinklerOn(7, true, false), false, 'not in the rain');
  assert.equal(sprinklerOn(7, false, true), false, 'not with reduced motion');
});

test('the night and the wind are in their ranges', () => {
  assert.equal(nightAmount(1), 0);
  assert.equal(nightAmount(0), 1);
  let last = 1;
  for (let light = 0; light <= 1.0001; light += 0.01) {
    const n = nightAmount(light);
    assert.ok(n >= 0 && n <= 1);
    assert.ok(n <= last + 1e-9, 'the night only grows as the light falls');
    last = n;
  }
  for (let t = 0; t < 3600; t += 37) {
    const w = windAt(t);
    assert.ok(w >= 0 && w <= 1);
  }
});

test('the cat has places to lie in the sun, and places to sit in the garden, and can reach the porch', () => {
  for (const payload of [null, { lanes: 2, loungers: 3, waiting: 2 }, { lanes: 6, loungers: 20, waiting: 6 }]) {
    const world = buildWorld(payload);
    const sunny = sunnySpots(world);
    assert.ok(sunny.length >= 4, `${sunny.length} sunny spots`);
    for (const p of sunny) assert.ok(catMayStand(world, p, 0.6), 'a sunny spot is clear');
    assert.ok(gardenSpots(world).length >= 2, 'there are garden spots');
    assert.ok(catMayStand(world, world.hut.porch, 0.3), 'the porch is clear');
    const from = sunny[0];
    assert.ok(findPath(world, from, world.hut.porch) !== null, 'the porch is reachable from the deck');
  }
});

test('with nobody in the pool at all, the budget still holds over the day', () => {
  const world = buildWorld(null);
  const director = new CreatureDirector(SEED);
  const empty: CreaturePerson[] = [];
  for (let t = 0; t <= DAY_S; t += DT) {
    director.step(DT, t, envFor(world, t, empty));
    assert.ok(director.creatures.length <= MAX_CREATURES);
  }
});
