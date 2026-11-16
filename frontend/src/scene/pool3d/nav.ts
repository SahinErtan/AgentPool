/**
 * Walking round the pool.
 *
 * The 2D characters walked along one line, so the only question was how far
 * ahead the next one stood. On a 3D deck there is a pool in the middle, and
 * a character that walks from the gate to a lounger on the far side has to
 * go round it, not through it. And there are other people on the deck.
 *
 * Two pure pieces:
 *
 * - `planPath`: the shortest way from one point to another that keeps off
 *   the water and off the equipment. Every obstacle is a rectangle, so the
 *   way round them is through their corners: a visibility graph, searched
 *   with Dijkstra.
 * - `steer`: one step along that path, slowed down by the people in front.
 */

import { insideFence, type Area, type Vec2, type World } from './world';

/** How far from the edge of the water, or of any equipment, a path keeps. */
export const EDGE_CLEARANCE = 0.5;
/** The corners of the way round are a little further out than that. */
const CORNER_CLEARANCE = 0.8;
/**
 * The margin at the two ends of a path, when an end is already inside an
 * obstacle's margin (the top of a ladder, the step of the hot tub): such an
 * end may walk out of the margin, but not into the obstacle itself.
 *
 * It is zero, not a few centimetres: an end that is closer than any margin
 * to the water could never leave it, since the first part of every way out
 * would be inside the margin.
 */
const END_CLEARANCE = 0;

/** True when the segment from `a` to `b` passes through the area. */
export function segmentHitsArea(a: Vec2, b: Vec2, area: Area): boolean {
  // Liang–Barsky clipping of the segment against the rectangle.
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, a.x - area.minX)) return false;
  if (!clip(dx, area.maxX - a.x)) return false;
  if (!clip(-dz, a.z - area.minZ)) return false;
  if (!clip(dz, area.maxZ - a.z)) return false;
  // Touching the boundary in a single point is not passing through.
  return t1 - t0 > 1e-9;
}

function grow(area: Area, by: number): Area {
  return {
    minX: area.minX - by,
    maxX: area.maxX + by,
    minZ: area.minZ - by,
    maxZ: area.maxZ + by,
  };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function inside(p: Vec2, area: Area): boolean {
  return p.x > area.minX && p.x < area.maxX && p.z > area.minZ && p.z < area.maxZ;
}

/** The obstacles grown by each margin, worked out once per world. */
interface Grown {
  edge: Area[];
  end: Area[];
  corner: Area[];
}

const grownCache = new WeakMap<World, Grown>();

function grownFor(world: World): Grown {
  let g = grownCache.get(world);
  if (!g) {
    g = {
      edge: world.obstacles.map((o) => grow(o.area, EDGE_CLEARANCE)),
      end: world.obstacles.map((o) => grow(o.area, END_CLEARANCE)),
      corner: world.obstacles.map((o) => grow(o.area, CORNER_CLEARANCE)),
    };
    grownCache.set(world, g);
  }
  return g;
}

/**
 * True when the segment from `a` to `b` comes too close to an obstacle.
 *
 * `ends` are the points the path starts and finishes at. One of them that
 * is inside an obstacle's margin, but not in the obstacle itself, is tested
 * against a much smaller margin: it is already there, and has to be able to
 * leave.
 */
function blocked(world: World, a: Vec2, b: Vec2, ends: readonly Vec2[]): boolean {
  const g = grownFor(world);
  for (let i = 0; i < world.obstacles.length; i += 1) {
    if (!segmentHitsArea(a, b, g.edge[i])) continue;
    const raw = world.obstacles[i].area;
    let atEnd = false;
    for (const end of ends) {
      if ((end === a || end === b) && inside(end, g.edge[i]) && !inside(end, raw)) atEnd = true;
    }
    if (!atEnd) return true;
    if (segmentHitsArea(a, b, g.end[i])) return true;
  }
  return false;
}

/**
 * The shortest way from `from` to `to` that keeps off the water and the
 * equipment.
 *
 * Returns the points to walk through, `to` included and `from` left out. A
 * point that is itself too close to the water or to a piece of equipment
 * (the top of the ladder, the step of the hot tub) is fine as an end: only
 * the stretches in between have to keep clear.
 */
export function planPath(world: World, from: Vec2, to: Vec2): Vec2[] {
  return findPath(world, from, to) ?? [{ x: to.x, z: to.z }];
}

/**
 * True when the straight way from `a` to `b` keeps the margins of the water
 * and of the equipment, so a walker may walk it without a corner in between.
 */
export function clearSegment(world: World, a: Vec2, b: Vec2): boolean {
  return !blocked(world, a, b, [a, b]);
}

/**
 * True when there is a way from one point to another that keeps off the
 * water and the equipment. A sealed pocket is not reachable.
 */
export function reachable(world: World, from: Vec2, to: Vec2): boolean {
  return findPath(world, from, to) !== null;
}

/**
 * The way `planPath` gives, or null when there is none.
 *
 * `planPath` falls back to a straight line when the search fails, which is
 * the right thing for a walker that is already in a corner, but not for
 * deciding whether a place can be reached at all.
 */
export function findPath(world: World, from: Vec2, to: Vec2): Vec2[] | null {
  const ends = [from, to];
  if (!blocked(world, from, to, ends)) return [{ x: to.x, z: to.z }];

  // The corners of every obstacle, out at the corner margin, are the points
  // to go round. A corner inside another obstacle's margin is no use: it is
  // in the way, and the corner of that one takes its place.
  const g = grownFor(world);
  const nodes: Vec2[] = [from, to];
  for (const c of g.corner) {
    const corners: Vec2[] = [
      { x: c.minX, z: c.minZ },
      { x: c.maxX, z: c.minZ },
      { x: c.maxX, z: c.maxZ },
      { x: c.minX, z: c.maxZ },
    ];
    for (const p of corners) {
      if (!insideFence(world, p)) continue;
      if (g.corner.some((other) => inside(p, other))) continue;
      nodes.push(p);
    }
  }
  const n = nodes.length;
  const best = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  best[0] = 0;

  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i += 1) {
      if (!done[i] && (u < 0 || best[i] < best[u])) u = i;
    }
    if (u < 0 || best[u] === Number.POSITIVE_INFINITY) break;
    done[u] = true;
    if (u === 1) break;
    for (let v = 0; v < n; v += 1) {
      if (done[v] || v === u) continue;
      if (blocked(world, nodes[u], nodes[v], ends)) continue;
      const d = best[u] + distance(nodes[u], nodes[v]);
      if (d < best[v]) {
        best[v] = d;
        prev[v] = u;
      }
    }
  }

  if (prev[1] < 0) return null;
  const path: Vec2[] = [];
  for (let v = 1; v !== 0 && v >= 0; v = prev[v]) path.push({ x: nodes[v].x, z: nodes[v].z });
  return path.reverse();
}

/** A walker as `steer` sees it. */
export interface Walker {
  id: string;
  x: number;
  z: number;
  /**
   * True while it is going somewhere. A walker that has arrived stands
   * still and is in the way; one that is held up still wants to go, and
   * the ones behind it can count on it moving on.
   */
  moving: boolean;
}

export interface SteerResult {
  x: number;
  z: number;
  /** How far the walker got in this step. */
  covered: number;
  /** The heading it walked in, in radians about y (0 is +z). */
  heading: number;
  /** True when somebody stands on the target and the walker stopped short of it. */
  taken?: boolean;
}

/** The personal space of a walker: closer than this and it waits. */
export const PERSONAL_SPACE = 0.55;
/** Nobody ever steps closer than this to somebody else. */
export const MIN_DISTANCE = 0.45;

/**
 * One step of a walker towards `target`, at `speed` metres a second.
 *
 * A walker that has somebody close in front of it slows down and stops
 * short of them, and it sidesteps a little so two people walking at each
 * other pass instead of standing nose to nose. When two stop in front of
 * each other, the one with the larger id gives way, so the pair never waits
 * for ever.
 */
export function steer(
  self: Walker,
  target: Vec2,
  speed: number,
  dt: number,
  others: readonly Walker[],
): SteerResult {
  const dx = target.x - self.x;
  const dz = target.z - self.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return separateOnly(self, dt, others);
  let ux = dx / dist;
  let uz = dz / dist;

  // Somebody already stands where the walker is going: it stops close by
  // and waits, instead of walking circles round them.
  if (dist < MIN_DISTANCE + 0.4) {
    for (const other of others) {
      if (other.id === self.id || other.moving) continue;
      if (Math.hypot(other.x - target.x, other.z - target.z) < MIN_DISTANCE) {
        return { x: self.x, z: self.z, covered: 0, heading: Math.atan2(ux, uz), taken: true };
      }
    }
  }

  let factor = 1;
  let side = 0;
  for (const other of others) {
    if (other.id === self.id) continue;
    const ox = other.x - self.x;
    const oz = other.z - self.z;
    const d = Math.hypot(ox, oz);
    if (d > PERSONAL_SPACE * 2.2 || d < 1e-6) continue;
    // Only the people ahead count; the ones behind will wait for us.
    const ahead = (ox * ux + oz * uz) / d;
    if (ahead < 0.3) continue;
    const room = Math.max(0, (d - PERSONAL_SPACE) / (PERSONAL_SPACE * 1.2));
    const yieldTo = other.moving && self.id > other.id ? 0.6 : 1;
    factor = Math.min(factor, Math.min(1, room) * yieldTo);
    // Step to the side that is away from the other one.
    const cross = ux * oz - uz * ox;
    side += (cross >= 0 ? -1 : 1) * (1 - d / (PERSONAL_SPACE * 2.2));
  }

  // The ways to try, in order: straight on (turned a little by the
  // sidestep), then more and more to the side. Two people face to face
  // each turn to their own side and pass.
  const sign = side > 0 ? 1 : side < 0 ? -1 : 0;
  // When the way straight on is shut (somebody close at the side, not
  // quite ahead), the walker tries to the sides as well, its own side
  // first: one that only ever tried straight on stood next to a person
  // for ever.
  const first = sign === 0 ? 1 : sign;
  const turns =
    sign === 0
      ? [0, first * 0.7, -first * 0.7, first * 1.3, -first * 1.3]
      : [Math.max(-0.9, Math.min(0.9, side * 0.9)), sign * 1.3, sign * 1.75, -sign * 0.7];

  let step = 0;
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const dirX = ux * c - uz * s;
    const dirZ = ux * s + uz * c;
    // Going round is allowed even when going straight is not.
    const pace = sign !== 0 || i > 0 ? Math.max(factor, 0.35) : factor;
    const taken = clearStep(self, dirX, dirZ, Math.min(dist, speed * dt * pace), others);
    if (taken > 0) {
      ux = dirX;
      uz = dirZ;
      step = taken;
      break;
    }
  }
  let x = self.x + ux * step;
  let z = self.z + uz * step;
  // Two that already stand inside each other's space (they came in at the
  // same spot, or one was put there) are pushed apart. Without this they
  // stayed one inside the other for ever, since no step may bring them
  // closer and none is needed to keep them where they are. Only the one
  // that gives way is pushed: pushing both, a crowd pushed itself to a
  // standstill.
  for (const other of others) {
    if (other.id === self.id || !yieldsTo(self, other)) continue;
    let ox = x - other.x;
    let oz = z - other.z;
    let d = Math.hypot(ox, oz);
    if (d >= MIN_DISTANCE * 0.95) continue;
    if (d < 1e-6) {
      // Exactly on top of each other: the ids decide who goes which way.
      const a = (hashId(self.id) % 628) / 100;
      ox = Math.cos(a);
      oz = Math.sin(a);
      d = 1;
    }
    const push = Math.min(MIN_DISTANCE * 0.95 - Math.min(d, MIN_DISTANCE), 2.5 * dt);
    x += (ox / d) * push;
    z += (oz / d) * push;
  }
  return {
    x,
    z,
    covered: step,
    heading: Math.atan2(ux, uz),
  };
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * True when `self` has to keep out of `other`'s way.
 *
 * Everybody keeps out of the way of the people who stand still. Between
 * two that are both going somewhere, the one with the smaller id goes
 * first and the other gives way. In a crowd where each was waiting for the
 * one next to it, nobody moved at all; with an order, somebody always can,
 * and then the next one.
 */
function yieldsTo(self: Walker, other: Walker): boolean {
  return !other.moving || other.id < self.id;
}

/**
 * The longest part of a step that does not take the walker closer than
 * `MIN_DISTANCE` to anybody it has to give way to.
 *
 * The hard rule under the soft ones: steering goes round people, and this
 * is the floor under it.
 */
function clearStep(
  self: Walker,
  ux: number,
  uz: number,
  wanted: number,
  others: readonly Walker[],
): number {
  let step = wanted;
  for (let tries = 0; tries < 4 && step > 0; tries += 1) {
    const nx = self.x + ux * step;
    const nz = self.z + uz * step;
    let blocked = false;
    for (const other of others) {
      if (other.id === self.id || !yieldsTo(self, other)) continue;
      const after = Math.hypot(other.x - nx, other.z - nz);
      if (after >= MIN_DISTANCE) continue;
      const before = Math.hypot(other.x - self.x, other.z - self.z);
      if (after < before) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return step;
    step *= 0.5;
  }
  return 0;
}

/** No step to take, but still out of anybody else's space. */
function separateOnly(self: Walker, dt: number, others: readonly Walker[]): SteerResult {
  let x = self.x;
  let z = self.z;
  for (const other of others) {
    if (other.id === self.id || !yieldsTo(self, other)) continue;
    let ox = x - other.x;
    let oz = z - other.z;
    let d = Math.hypot(ox, oz);
    if (d >= MIN_DISTANCE * 0.95) continue;
    if (d < 1e-6) {
      const a = (hashId(self.id) % 628) / 100;
      ox = Math.cos(a);
      oz = Math.sin(a);
      d = 1;
    }
    const push = Math.min(MIN_DISTANCE * 0.95 - Math.min(d, MIN_DISTANCE), 2.5 * dt);
    x += (ox / d) * push;
    z += (oz / d) * push;
  }
  return { x, z, covered: 0, heading: Number.NaN };
}
