/**
 * The hot path.
 *
 * The scene used to walk over every character for every character, build a
 * new list of hit areas for every pointer move, and make a new pose for
 * every character on every frame. These tests are the proof that the fast
 * way gives the same answers as the slow one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ClearanceIndex,
  FOAM_AMPLITUDE,
  FOAM_PERIOD,
  FOAM_STEP,
  foamPoints,
  foamShift,
  foamY,
  type ClearanceAgent,
} from '../src/scene/perf';
import { characterBox, hitTest, HitBoxCache } from '../src/scene/pool/hittest';
import { computeLayout, swimYFor } from '../src/scene/pool/layout';
import { blendPose, loungePose, resetPose, restPose, zeroPose } from '../src/scene/characters/poses';

/* ------------------------------------------------------------------ */
/* The clearance                                                       */
/* ------------------------------------------------------------------ */

/**
 * The old way.
 *
 * Every character looks at every other character. It is the yardstick the
 * fast check is measured against, so it is written out here exactly as it
 * was.
 */
function clearanceAheadSlow(
  agents: readonly ClearanceAgent[],
  agent: ClearanceAgent,
  direction: number,
  gap: number,
  tolerance: number,
): number {
  if (direction === 0) return Number.POSITIVE_INFINITY;
  let nearest = Number.POSITIVE_INFINITY;

  for (const other of agents) {
    if (other.id === agent.id) continue;
    if (!other.moving) continue;
    if (!other.hasTarget) continue;
    if (other.moveDir !== 0 && other.moveDir !== direction) continue;
    if (Math.abs(other.y - agent.y) > tolerance) continue;

    const ahead = (other.x - agent.x) * direction;
    if (ahead > 0.5) {
      nearest = Math.min(nearest, Math.max(0, ahead - gap));
    } else if (Math.abs(ahead) <= 2 && other.id > agent.id) {
      nearest = 0;
    }
  }

  return nearest;
}

interface TestAgent extends ClearanceAgent {
  id: string;
  x: number;
  y: number;
  moveDir: number;
  moving: boolean;
  hasTarget: boolean;
}

function makeAgent(
  id: string,
  x: number,
  y: number,
  moveDir: number,
  moving = true,
  hasTarget = true,
): TestAgent {
  return { id, x, y, moveDir, moving, hasTarget };
}

/** A small, repeatable stream of numbers. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const TOLERANCE = 90;
const GAP = 38;

test('the fast clearance gives the same answers as the slow one', () => {
  const random = rng(20240115);
  const agents: TestAgent[] = [];
  for (let i = 0; i < 80; i += 1) {
    agents.push(
      makeAgent(
        `agent-${i}`,
        Math.round(random() * 1400),
        Math.round(300 + random() * 120),
        [-1, 0, 1][Math.floor(random() * 3)],
        random() > 0.2,
        random() > 0.15,
      ),
    );
  }

  const index = new ClearanceIndex(TOLERANCE);
  for (const agent of agents) index.add(agent);

  for (const agent of agents) {
    for (const direction of [-1, 0, 1]) {
      assert.equal(
        index.clearanceAhead(agent, direction, GAP, TOLERANCE),
        clearanceAheadSlow(agents, agent, direction, GAP, TOLERANCE),
        `${agent.id} walking ${direction}`,
      );
    }
  }
});

test('the fast clearance gives the same answers while the characters move', () => {
  // The scene asks for the clearance in the middle of its loop: the
  // characters before it have already moved and the ones after it have
  // not. The grid has to answer for that same moment.
  const random = rng(981237);
  const agents: TestAgent[] = [];
  for (let i = 0; i < 40; i += 1) {
    agents.push(
      makeAgent(
        `agent-${i}`,
        Math.round(random() * 900),
        Math.round(300 + random() * 40),
        [-1, 0, 1][Math.floor(random() * 3)],
        random() > 0.3,
        random() > 0.2,
      ),
    );
  }

  const index = new ClearanceIndex(TOLERANCE);
  for (const agent of agents) index.add(agent);

  for (let round = 0; round < 12; round += 1) {
    for (const agent of agents) {
      for (const direction of [-1, 1]) {
        assert.equal(
          index.clearanceAhead(agent, direction, GAP, TOLERANCE),
          clearanceAheadSlow(agents, agent, direction, GAP, TOLERANCE),
          `${agent.id} walking ${direction} in round ${round}`,
        );
      }
      // The character takes a step and the grid is told about it.
      agent.x += Math.round((random() - 0.5) * 12);
      agent.y += Math.round((random() - 0.5) * 4);
      index.update(agent);
    }
  }
});

test('a character that stands still is not blocked by anything', () => {
  const index = new ClearanceIndex(TOLERANCE);
  const agent = makeAgent('a', 100, 300, 0);
  const other = makeAgent('b', 160, 300, 1);
  index.add(agent);
  index.add(other);

  assert.equal(index.clearanceAhead(agent, 0, GAP, TOLERANCE), Number.POSITIVE_INFINITY);
  assert.equal(
    index.clearanceAhead(agent, 1, GAP, TOLERANCE),
    clearanceAheadSlow([agent, other], agent, 1, GAP, TOLERANCE),
  );
});

test('two characters on top of each other do not deadlock', () => {
  // The higher id yields, so the pair walks apart again.
  const agents = [makeAgent('aaa', 200, 300, 1), makeAgent('bbb', 200, 300, 1)];
  const index = new ClearanceIndex(TOLERANCE);
  for (const agent of agents) index.add(agent);

  assert.equal(index.clearanceAhead(agents[0], 1, GAP, TOLERANCE), 0);
  assert.equal(index.clearanceAhead(agents[1], 1, GAP, TOLERANCE), Number.POSITIVE_INFINITY);
});

test('a character that has nowhere to go does not block the queue', () => {
  const agents = [
    makeAgent('aaa', 100, 300, 1, true, false),
    makeAgent('bbb', 180, 300, 1, true, true),
  ];
  const index = new ClearanceIndex(TOLERANCE);
  for (const agent of agents) index.add(agent);

  // The one that stands still has nowhere to go, so it does not hold up
  // the one behind it.
  assert.equal(
    index.clearanceAhead(agents[1], 1, GAP, TOLERANCE),
    clearanceAheadSlow(agents, agents[1], 1, GAP, TOLERANCE),
  );
  assert.equal(index.clearanceAhead(agents[1], 1, GAP, TOLERANCE), Number.POSITIVE_INFINITY);
  // The one that is walking is held up by the one in front of it.
  assert.equal(index.clearanceAhead(agents[0], 1, GAP, TOLERANCE), 180 - 100 - GAP);
});

test('two characters walking towards each other pass by', () => {
  const agents = [makeAgent('aaa', 100, 300, 1), makeAgent('bbb', 200, 300, -1)];
  const index = new ClearanceIndex(TOLERANCE);
  for (const agent of agents) index.add(agent);

  assert.equal(
    index.clearanceAhead(agents[0], 1, GAP, TOLERANCE),
    clearanceAheadSlow(agents, agents[0], 1, GAP, TOLERANCE),
  );
  assert.equal(index.clearanceAhead(agents[0], 1, GAP, TOLERANCE), Number.POSITIVE_INFINITY);
});

test('the grid finds a character that is far away', () => {
  // The grid only looks at the cells around a character, so a character
  // that is far in front has to be found as well.
  const agents = [makeAgent('aaa', 100, 300, 1), makeAgent('bbb', 5000, 300, 1)];
  const index = new ClearanceIndex(TOLERANCE);
  for (const agent of agents) index.add(agent);

  assert.equal(index.clearanceAhead(agents[0], 1, GAP, TOLERANCE), 5000 - 100 - GAP);
});

test('a character that is out of reach does not block', () => {
  const agents = [makeAgent('aaa', 100, 300, 1), makeAgent('bbb', 160, 300 + TOLERANCE + 1, 1)];
  const index = new ClearanceIndex(TOLERANCE);
  for (const agent of agents) index.add(agent);

  assert.equal(index.clearanceAhead(agents[0], 1, GAP, TOLERANCE), Number.POSITIVE_INFINITY);
});

/* ------------------------------------------------------------------ */
/* The pose that is used again and again                                */
/* ------------------------------------------------------------------ */

test('resetPose puts every angle back to zero', () => {
  const pose = zeroPose();
  restPose(pose, 0.4);
  loungePose(pose, 0.8);
  assert.ok(pose.armR !== 0 || pose.headPitch !== 0, 'the pose was not filled');

  resetPose(pose);
  for (const [key, value] of Object.entries(pose)) {
    assert.equal(value, 0, `${key} was left at ${value}`);
  }
});

test('blending into the pose that is also the first input gives the same answer', () => {
  // The animator blends the layers into the pose it already holds, so the
  // pose is both the input and the output.
  const first = zeroPose();
  restPose(first, 0.3);
  const second = zeroPose();
  restPose(second, 0.3);
  const layer = zeroPose();
  loungePose(layer, 0.7);

  const expected = blendPose(zeroPose(), first, 0.4, layer, 0.6);
  const actual = blendPose(second, second, 0.4, layer, 0.6);

  assert.deepEqual(actual, expected);
});

test('a pose that is reused does not keep the values of the frame before', () => {
  // The animator holds one pose and blends the layers into it, frame after
  // frame. The result of a frame has to be the same as the result of a
  // frame that started with an empty pose.
  const reused = zeroPose();
  const rest = zeroPose();
  const lounge = zeroPose();

  restPose(rest, 0.2);
  loungePose(lounge, 0.9);

  // The first frame.
  resetPose(reused);
  blendPose(reused, rest, 0.5, lounge, 0.5);
  const first = blendPose(zeroPose(), rest, 0.5, lounge, 0.5);

  // The second frame, with a different layer.
  restPose(rest, 0.8);
  resetPose(reused);
  blendPose(reused, rest, 0.2, lounge, 0.8);
  const second = blendPose(zeroPose(), rest, 0.2, lounge, 0.8);

  assert.deepEqual(reused, second);
  assert.notDeepEqual(first, second);
});

/* ------------------------------------------------------------------ */
/* The hit areas                                                       */
/* ------------------------------------------------------------------ */

test('the hit areas are the same as the ones that were built on the spot', () => {
  const cache = new HitBoxCache();
  const height = 100;
  const poses = ['stand', 'swim', 'lie'] as const;

  cache.add('a', 200, 500, height, 'stand');
  cache.add('b', 400, 500, height, 'stand');
  cache.add('c', 600, 500, height, 'stand');

  for (const pose of poses) {
    cache.update('a', 200, 500, height, pose);
    cache.update('b', 400, 500, height, pose);
    cache.update('c', 600, 500, height, pose);

    const built = [
      characterBox('a', 200, 500, height, pose),
      characterBox('b', 400, 500, height, pose),
      characterBox('c', 600, 500, height, pose),
    ];
    const kept = cache.list;
    for (let i = 0; i < built.length; i += 1) {
      assert.deepEqual(kept[i], built[i], `the area of ${built[i].id} changed`);
    }
  }
});

test('the hit areas follow the characters without making new ones', () => {
  const cache = new HitBoxCache();
  cache.add('a', 200, 500, 100, 'stand');
  const box = cache.list[0];

  cache.update('a', 260, 480, 120, 'swim');

  assert.equal(cache.list[0], box, 'the area was built again');
  assert.equal(cache.list.length, 1);
  assert.equal(box.x, 260);
  assert.equal(box.y, 480);
  assert.equal(box.halfWidth, 120 * 0.8);
  assert.equal(box.top, 480 - 120 * 0.95);
  assert.equal(box.bottom, 480 + 120 * 0.1);
});

test('the pointer picks the same character as before', () => {
  const cache = new HitBoxCache();
  cache.add('a', 200, 500, 100, 'stand');
  cache.add('b', 215, 500, 100, 'stand');

  const built = [
    characterBox('a', 200, 500, 100, 'stand'),
    characterBox('b', 215, 500, 100, 'stand'),
  ];

  for (const x of [195, 205, 214, 220]) {
    assert.equal(hitTest(cache.list, x, 480), hitTest(built, x, 480));
  }
});

test('a character that is gone is gone from the cache', () => {
  const cache = new HitBoxCache();
  cache.add('a', 200, 500, 100, 'stand');
  cache.add('b', 400, 500, 100, 'stand');
  cache.remove('a');

  assert.equal(cache.list.length, 1);
  assert.equal(cache.list[0].id, 'b');
  assert.equal(hitTest(cache.list, 200, 480), null);
});

/* ------------------------------------------------------------------ */
/* The swimmers                                                        */
/* ------------------------------------------------------------------ */

test('a swimmer follows the pool when the pool is resized', () => {
  // The bug: the height of a swimmer was worked out once, when the agent
  // was told to swim, and it was never worked out again. A pool that was
  // resized after that left every swimmer in the sky.
  const before = computeLayout(900, 600);
  const after = computeLayout(1500, 900);

  const swimmer = { laneOffset: 0.5, swimY: swimYFor(before, 0.5) };
  assert.equal(swimmer.swimY, swimYFor(before, 0.5));

  // The pool is resized: the swimmer has to follow the new surface.
  swimmer.swimY = swimYFor(after, swimmer.laneOffset);

  assert.equal(swimmer.swimY, swimYFor(after, 0.5));
  assert.notEqual(swimmer.swimY, swimYFor(before, 0.5));
  // The swimmer is in the water of the pool it is in, not in the sky and
  // not in the deep.
  assert.ok(Math.abs(swimmer.swimY - after.surfaceY) < after.characterHeight);
});

test('the height of a swimmer is the surface of its own pool', () => {
  for (const [width, height] of [
    [640, 480],
    [1280, 720],
    [1920, 1080],
  ]) {
    const layout = computeLayout(width, height);
    for (const laneOffset of [-1, -0.5, 0, 0.5, 1]) {
      const swimY = swimYFor(layout, laneOffset);
      assert.ok(
        Math.abs(swimY - layout.surfaceY) < layout.characterHeight,
        `a swimmer at ${width}x${height} is ${swimY} away from the surface ${layout.surfaceY}`,
      );
    }
  }
});

test('the lane moves a swimmer up and down', () => {
  const layout = computeLayout(1280, 720);
  const middle = swimYFor(layout, 0);
  assert.ok(swimYFor(layout, 1) > middle);
  assert.ok(swimYFor(layout, -1) < middle);
  assert.ok(
    Math.abs(swimYFor(layout, 1) - middle - layout.characterHeight * 0.16) < 1e-9,
  );
});

/* ------------------------------------------------------------------ */
/* The foam                                                            */
/* ------------------------------------------------------------------ */

test('the foam line that travels is the line that is drawn again', () => {
  // The line is built once and moved; the wave it makes has to be the
  // same wave as the one that is drawn again every frame.
  for (const time of [0, 0.25, 3.5, 61.75, 3600]) {
    const shift = foamShift(time);
    for (const x of [0, 137.5, 512, 1000.25]) {
      const drawn = foamY(x, time);
      const moved = foamY(x - shift, 0);
      assert.ok(
        Math.abs(drawn - moved) < 1e-9,
        `the foam at ${x} after ${time} s is ${moved} instead of ${drawn}`,
      );
    }
  }
});

test('the foam travels along the pool', () => {
  assert.equal(Math.abs(foamShift(0)), 0);
  // The wave moves to the left, so the line moves to the left as well.
  assert.ok(foamShift(1) < 0);
  assert.ok(foamShift(1) > -FOAM_PERIOD);
  // It keeps travelling, and it comes back to the same place after one
  // wave: the phase turns a full turn in 2 pi / 1.6 seconds.
  const wave = (Math.PI * 2) / 1.6;
  assert.ok(Math.abs(foamShift(wave) - foamShift(0)) < 0.5);
  assert.ok(Math.abs(foamShift(1 + wave) - foamShift(1)) < 0.5);
});

test('the foam line sits on the grid of the pool', () => {
  const anchor = 137;
  const from = anchor - 200;
  const to = anchor + 200;

  const points = foamPoints(anchor, from, to);
  const line: number[] = [];
  for (let i = 0; i < points.length; i += 2) line.push(points[i]);

  assert.ok(line.length > 1);
  assert.ok(line[0] >= from);
  assert.ok(line[line.length - 1] <= to);
  for (const x of line) {
    assert.equal(Math.abs((x - anchor) % FOAM_STEP), 0, `${x} is not on the grid`);
  }
  // The points are the wave itself.
  for (let i = 0; i < points.length; i += 2) {
    assert.equal(points[i + 1], foamY(points[i], 0));
  }
});

test('the foam swings by the amplitude', () => {
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let x = 0; x < 4000; x += 0.5) {
    const y = foamY(x, 0);
    if (y < lowest) lowest = y;
    if (y > highest) highest = y;
  }
  assert.ok(Math.abs(highest - FOAM_AMPLITUDE) < 0.01);
  assert.ok(Math.abs(lowest + FOAM_AMPLITUDE) < 0.01);
});
