/**
 * The paths of the balls in the games of the deck: the ping-pong ball over
 * the table, and the beach ball thrown round the court.
 *
 * Pure, like the rest of the pool's decisions: where a ball is depends on the
 * time into the rally or the throw and on nothing else, so the same game is
 * drawn the same way every time.
 */

import { mulberry32 } from '../characters/spec';
import type { Spot, Vec3 } from './world';

/** How long one hit takes to reach the other player's, in seconds. */
const HIT_S = 0.6;
/** The paddle's point, from the end of the table, in metres, and its height. */
const PADDLE_IN = 0.45;
const PADDLE_Y = 0.95;
/** Where the bounce is, along the table from one player's paddle, as a share of the way. */
const BOUNCE_SHARE = 0.7;
/** How high each part of a flight rises above the higher of its two ends, in metres. */
const RALLY_APEX = 0.25;

/**
 * A point on a flight from `a` to `b`, `u` of the way (0 to 1).
 *
 * The height is a parabola: it is a straight line between the two ends and
 * then an arc over it, so that the highest point is `apex` above the higher
 * end at the middle of the flight.
 */
function arcPoint(a: Vec3, b: Vec3, u: number, apex: number, out: Vec3): Vec3 {
  const high = Math.max(a.y, b.y);
  const mean = (a.y + b.y) / 2;
  out.x = a.x + (b.x - a.x) * u;
  out.z = a.z + (b.z - a.z) * u;
  out.y = a.y + (b.y - a.y) * u + 4 * u * (1 - u) * (high + apex - mean);
  return out;
}

const scratch: Vec3 = { x: 0, y: 0, z: 0 };

/** The points a rally is played between, for one table: built once, then read every frame. */
interface Rally {
  a: Vec3;
  b: Vec3;
  /** The bounce on the far half, from each player's side. */
  bounceAB: Vec3;
  bounceBA: Vec3;
}

const rallies = new WeakMap<Spot[], Map<number, Rally>>();

/** The rally of a table: the paddle points and the bounces, cached per table and height. */
function rallyFor(ends: [Spot, Spot], tableTop: number): Rally {
  let byTop = rallies.get(ends);
  if (!byTop) {
    byTop = new Map();
    rallies.set(ends, byTop);
  }
  let rally = byTop.get(tableTop);
  if (!rally) {
    const a = paddlePoint(ends[0]);
    const b = paddlePoint(ends[1]);
    // The bounce is on the far half: 70 per cent of the way from the one that hits.
    rally = {
      a,
      b,
      bounceAB: { x: a.x + (b.x - a.x) * BOUNCE_SHARE, y: tableTop, z: a.z + (b.z - a.z) * BOUNCE_SHARE },
      bounceBA: { x: b.x + (a.x - b.x) * BOUNCE_SHARE, y: tableTop, z: b.z + (a.z - b.z) * BOUNCE_SHARE },
    };
    byTop.set(tableTop, rally);
  }
  return rally;
}

/** The point at the paddle of one end of the table: the end moved in towards the table. */
function paddlePoint(end: Spot): Vec3 {
  return {
    x: end.x + Math.sin(end.yaw) * PADDLE_IN,
    y: PADDLE_Y,
    z: end.z + Math.cos(end.yaw) * PADDLE_IN,
  };
}

/**
 * Where the ping-pong ball is, `t` seconds into a rally.
 *
 * A rally is two hits a second apart, of 0.6 s each: the ball goes from one
 * player's paddle, bounces on the far half of the table, and reaches the other
 * player's paddle; then it comes back the same way. The rally repeats every
 * 1.2 s. Written into `scratch`, which the caller copies if it keeps it.
 */
export function pingPongBall(t: number, ends: [Spot, Spot], tableTop = 0.76): Vec3 {
  const r = rallyFor(ends, tableTop);
  const period = 2 * HIT_S;
  const u0 = ((t % period) + period) % period;
  const half = HIT_S / 2;
  // Four parts in a rally: A to the bounce, the bounce to B, B to the bounce, and the bounce back to A.
  if (u0 < half) return arcPoint(r.a, r.bounceAB, u0 / half, RALLY_APEX, scratch);
  if (u0 < HIT_S) return arcPoint(r.bounceAB, r.b, (u0 - half) / half, RALLY_APEX, scratch);
  if (u0 < HIT_S + half) return arcPoint(r.b, r.bounceBA, (u0 - HIT_S) / half, RALLY_APEX, scratch);
  return arcPoint(r.bounceBA, r.a, (u0 - HIT_S - half) / half, RALLY_APEX, scratch);
}

/**
 * Where a thrown ball is, `u` (0 to 1) of the way from `a` to `b`.
 *
 * It rises to `apex` above the higher of the two hands, at the middle of the
 * throw. Written into `scratch`, which the caller copies if it keeps it.
 */
export function ballFlight(a: Vec3, b: Vec3, u: number, apex = 2.4): Vec3 {
  return arcPoint(a, b, Math.min(1, Math.max(0, u)), apex, scratch);
}

/**
 * Who gets the ball next, of the three players of a court: never the thrower.
 *
 * The draw depends on the number of throws so far and on the seed of the
 * game, so that the ball does not go round in the same order every time.
 */
export function nextCatcher(thrower: number, throwCount: number, seed: number): number {
  const others = [0, 1, 2].filter((i) => i !== thrower);
  const draw = mulberry32(((seed ^ Math.imul(throwCount, 0x9e3779b9)) >>> 0) || 1)();
  return others[draw < 0.5 ? 0 : 1];
}
