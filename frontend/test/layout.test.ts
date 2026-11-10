/**
 * The pool layout.
 *
 * The layout is a pure function of the size of the canvas, so it can be
 * checked without a browser: the same size always gives the same world, and
 * the world always fits on the canvas.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cameraLeftFor, computeLayout, resolveWaypoint } from '../src/scene/pool/layout';

const SIZES: [number, number][] = [
  [320, 240],
  [800, 600],
  [1200, 727],
  [1920, 1080],
  [2560, 1440],
];

test('the layout is a pure function of the size', () => {
  for (const [width, height] of SIZES) {
    const first = computeLayout(width, height);
    const second = computeLayout(width, height);
    assert.deepEqual(second, first);
  }
});

test('the world fits on the canvas', () => {
  for (const [width, height] of SIZES) {
    const layout = computeLayout(width, height);
    assert.ok(layout.width >= 320, 'the canvas is too narrow to work with');
    assert.ok(layout.height >= 240, 'the canvas is too short to work with');
    assert.ok(layout.deckY > 0 && layout.deckY < layout.height);
    assert.ok(layout.surfaceY > layout.deckY, 'the water is under the deck');
    assert.ok(layout.surfaceY < layout.height, 'the water is off the canvas');
    assert.ok(layout.water.h > 0, 'the pool has no depth');
    assert.ok(layout.water.x >= 0 && layout.water.x + layout.water.w <= layout.width);
  }
});

test('the loungers are on the deck and do not overlap', () => {
  for (const [width, height] of SIZES) {
    const layout = computeLayout(width, height);
    assert.ok(layout.loungers.length > 0);
    for (const slot of layout.loungers) {
      assert.ok(slot.y > 0, 'a lounger is off the top of the canvas');
      assert.ok(slot.y + slot.h <= layout.deckY + 1, 'a lounger is under the deck line');
      assert.ok(slot.x >= 0 && slot.x + slot.w <= layout.width, 'a lounger is off the canvas');
    }
    for (let index = 1; index < layout.loungers.length; index += 1) {
      const previous = layout.loungers[index - 1];
      const current = layout.loungers[index];
      assert.ok(
        current.x >= previous.x + previous.w,
        `two loungers overlap at ${previous.x} and ${current.x}`,
      );
    }
  }
});

test('the lanes fill the pool', () => {
  const layout = computeLayout(1200, 727);
  assert.equal(layout.lanes.length, 4);
  const first = layout.lanes[0];
  const last = layout.lanes[layout.lanes.length - 1];
  assert.ok(Math.abs(first.x - layout.water.x) < 2, 'the first lane does not start at the edge');
  assert.ok(
    Math.abs(last.x + last.w - (layout.water.x + layout.water.w)) < 2,
    'the last lane does not end at the edge',
  );
});

test('every waypoint resolves to a place on the canvas', () => {
  const layout = computeLayout(1200, 727);
  const waypoints = [
    'gate',
    'gate:0',
    'gate:3',
    'ladder',
    'lane:0',
    'lane:3',
    'lounger:0',
    `lounger:${layout.loungers.length - 1}`,
    'waiting:0',
    `waiting:${layout.waiting.length - 1}`,
  ];

  for (const waypoint of waypoints) {
    const place = resolveWaypoint(layout, waypoint);
    assert.ok(place, `the waypoint ${waypoint} does not resolve`);
    assert.ok(Number.isFinite(place.x) && Number.isFinite(place.y));
  }
});

test('a waypoint that does not exist resolves to nothing', () => {
  const layout = computeLayout(1200, 727);
  assert.equal(resolveWaypoint(layout, 'lounger:99'), null);
  assert.equal(resolveWaypoint(layout, 'lane:99'), null);
  assert.equal(resolveWaypoint(layout, 'waiting:99'), null);
  assert.equal(resolveWaypoint(layout, 'nowhere'), null);
});

test('the number of loungers and waiting spots comes from the scene', () => {
  const layout = computeLayout(1200, 727, 10, 2);
  assert.equal(layout.loungers.length, 10);
  assert.equal(layout.waiting.length, 2);

  // They still fit on the canvas.
  const last = layout.loungers[layout.loungers.length - 1];
  assert.ok(last.x + last.w <= layout.width);
});

test('the pool can have more loungers than it started with', () => {
  // The pool grows with the crowd, so the layout has to hold more of them
  // without letting them overlap.
  for (const count of [6, 9, 12]) {
    const layout = computeLayout(1200, 727, count, 4);
    assert.equal(layout.loungers.length, count);
    for (let index = 1; index < layout.loungers.length; index += 1) {
      const previous = layout.loungers[index - 1];
      const current = layout.loungers[index];
      assert.ok(
        previous.x + previous.w <= current.x,
        `two loungers overlap at ${previous.x} and ${current.x}`,
      );
    }
    for (const slot of layout.loungers) {
      assert.ok(slot.x >= 0 && slot.x + slot.w <= layout.width, 'a lounger is off the canvas');
    }
  }
});

test('the world is wider than the screen, so the camera can move', () => {
  const layout = computeLayout(1200, 727);
  assert.ok(layout.margin > 0, 'the world has no margin');
  assert.ok(layout.worldLeft < 0, 'the world does not reach past the left edge');
  assert.ok(
    layout.worldLeft + layout.worldWidth > layout.width,
    'the world does not reach past the right edge',
  );
});

test('the camera stays inside the world', () => {
  const layout = computeLayout(1200, 727);
  // The camera looks at a character that is far to the left.
  const left = cameraLeftFor(layout, 0, 1.1);
  assert.ok(left >= layout.worldLeft, 'the camera left the world');
  // And at one that is far to the right.
  const right = cameraLeftFor(layout, layout.width, 1.1);
  assert.ok(
    right + layout.width / 1.1 <= layout.worldLeft + layout.worldWidth + 0.001,
    'the camera left the world',
  );
});

test('the camera centres what it looks at', () => {
  const layout = computeLayout(1200, 727);
  const middle = layout.width / 2;
  const left = cameraLeftFor(layout, middle, 1);
  assert.ok(Math.abs(left + middle - layout.width / 2) < 0.001);
});

test('the camera rests where it was', () => {
  // With nothing picked, the view is the screen.
  const layout = computeLayout(1200, 727);
  assert.equal(cameraLeftFor(layout, layout.width / 2, 1), 0);
});
