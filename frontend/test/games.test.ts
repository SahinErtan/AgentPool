/**
 * The paths of the balls: the ping-pong ball over the table and the beach
 * ball thrown round the court. Pure, so checked without a browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ballFlight, nextCatcher, pingPongBall } from '../src/scene/pool3d/games';
import { buildWorld } from '../src/scene/pool3d/world';

const TABLE_TOP = 0.76;

test('the ping-pong ball is continuous: no jump between two samples a sixtieth of a second apart', () => {
  const { ends } = buildWorld(null).equipment.pingPong;
  const dt = 1 / 60;
  let worst = 0;
  let prev = pingPongBall(0, ends);
  for (let t = dt; t < 6; t += dt) {
    const p = pingPongBall(t, ends);
    worst = Math.max(worst, Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z));
    prev = p;
  }
  // The rally is fast: a hit covers about 2.3 m in 0.6 s, so the ball moves up
  // to about 0.15 m a sixtieth of a second. A jump would be far more.
  assert.ok(worst < 0.16, `the ball jumps ${worst.toFixed(3)} m between two samples`);
});

test('the ping-pong ball never goes below the table over the table, and touches it once per half of the rally', () => {
  const { ends } = buildWorld(null).equipment.pingPong;
  let touches = 0;
  let last = -1;
  for (let i = 0; i <= 1200; i += 1) {
    const t = (i / 1200) * 1.2 * 3;
    const p = pingPongBall(t, ends);
    assert.ok(p.y >= TABLE_TOP - 1e-9, `the ball is at ${p.y.toFixed(3)} m, under the table`);
    if (Math.abs(p.y - TABLE_TOP) < 1e-6 && i - last > 5) {
      touches += 1;
      last = i;
    }
  }
  // Three rallies: two bounces each, one on each half.
  assert.equal(touches, 6);
});

test('a ball flight starts at its first hand, ends at the second, and rises to the apex', () => {
  const a = { x: 0, y: 1.2, z: 0 };
  const b = { x: 3, y: 1.2, z: 4 };
  // ballFlight writes into one shared point, so the first is copied.
  const first = ballFlight(a, b, 0);
  const start = { ...first };
  const end = ballFlight(a, b, 1);
  assert.ok(Math.hypot(start.x - a.x, start.y - a.y, start.z - a.z) < 1e-9);
  assert.ok(Math.hypot(end.x - b.x, end.y - b.y, end.z - b.z) < 1e-9);
  let top = -Infinity;
  for (let i = 0; i <= 200; i += 1) top = Math.max(top, ballFlight(a, b, i / 200).y);
  assert.ok(Math.abs(top - (Math.max(a.y, b.y) + 2.4)) < 0.05, `the top is ${top.toFixed(3)}`);
});

test('the next catcher is never the thrower, and both of the others get the ball', () => {
  for (let thrower = 0; thrower < 3; thrower += 1) {
    const seen = new Set<number>();
    for (let count = 0; count < 200; count += 1) {
      const next = nextCatcher(thrower, count, 12345);
      assert.notEqual(next, thrower);
      seen.add(next);
    }
    assert.equal(seen.size, 2, `thrower ${thrower} never throws to one of the others`);
  }
});
