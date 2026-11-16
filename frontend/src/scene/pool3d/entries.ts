/**
 * The ways into the water, and the curve of the water slide.
 *
 * A swimmer used to climb down the ladder every time. Now it can dive off
 * the starting block of its lane, dive off the board, come down the slide,
 * or jump off the edge of the pool as a cannonball. This module decides which
 * way, and says where each way starts. It is pure: no Three.js, and the
 * choice is a function of the body and the pool, so the same inputs give the
 * same pool.
 *
 * The steps of each entry are in `flow.ts`, which owns the body.
 */

import { mulberry32 } from '../characters/spec';
import { reachable } from './nav';
import type { Body } from './flow';
import type { Vec2, Vec3, World } from './world';

export type EntryKind = 'ladder' | 'block' | 'board' | 'slide' | 'cannonball';

/** The kinds in the order the choice counts them. */
export const ENTRY_KINDS: readonly EntryKind[] = ['ladder', 'block', 'board', 'slide', 'cannonball'];

/** The step of an entry in progress: each kind has its own phases. */
export interface EntryState {
  kind: EntryKind;
  phase: string;
  /** Seconds into the phase. On the slide's ride it is the distance ridden, in metres. */
  t: number;
  /** Where the body lands in the water. */
  splash: Vec2;
  /** The way it will swim after the entry. */
  dir: 1 | -1;
  /** The place on the deck the walk ended at, on the ground. */
  origin: Vec2;
  /** Where the body was when it was told to stop, for walking back to the deck. */
  from: Vec3;
}

/** What is going on at the entries, as the choice sees it. */
export interface EntryBusy {
  /** Someone is on the slide's stairs, its platform or in its chute. */
  slide: boolean;
  /** Someone is on the board or walking along it. */
  board: boolean;
  /** Someone is standing on (or diving from) this lane's starting block. */
  block(lane: number): boolean;
  /** A swimmer is within this radius of the point, in the water. */
  waterNear(x: number, z: number, radius: number): boolean;
}

/** The weights of the choice. A kind that is not allowed counts as 0. */
export const ENTRY_WEIGHTS: Record<EntryKind, number> = {
  ladder: 40,
  block: 22,
  board: 14,
  slide: 14,
  cannonball: 10,
};

/** No other swimmer may be this close to where a new entry splashes. */
export const ENTRY_CLEAR_M = 2.5;
/** How far in front of the starting block a dive from it is checked, in metres. */
const BLOCK_FRONT = 1.15;
/** How far a cannonball carries the body out over the water, in metres. */
export const CANNONBALL_OUT = 1.3;
/** The seed mix of the choice: a golden-ratio constant, as in the other channels. */
const CHOICE_MIX = 0x9e3779b9;

/**
 * Where the walk for an entry ends, on the deck. Null for the ladder, which
 * has its own walk, and for a cannonball on a lane that is not at a wall.
 *
 * The cannonball's coping point is taken from the body's x, once, when the
 * walk starts: the goal must not move with the body.
 */
export function entryApproach(world: World, kind: EntryKind, body: Pick<Body, 'lane' | 'x'>): Vec2 | null {
  const e = world.equipment;
  switch (kind) {
    case 'ladder':
      return null;
    case 'block': {
      const lane = world.lanes[body.lane];
      return lane ? blockApproach(world, lane.index) : null;
    }
    case 'board':
      return { x: e.board.base.x, z: e.board.base.z };
    case 'slide':
      return { x: e.slide.stairsFoot.x, z: e.slide.stairsFoot.z };
    case 'cannonball':
      return copingPoint(world, body.lane, body.x);
  }
}

/** The place behind the starting block of a lane, where a diver stands to take off. */
export function blockApproach(world: World, lane: number): Vec2 {
  return { x: world.pool.minX - 0.75, z: world.lanes[lane].z };
}

/** The point on the coping a cannonball is jumped from, or null when the lane is not at a wall. */
export function copingPoint(world: World, lane: number, x: number): Vec2 | null {
  const last = world.lanes.length - 1;
  const cx = Math.max(world.pool.minX + 2, Math.min(world.pool.maxX - 2, x));
  if (lane === 0) return { x: cx, z: world.pool.maxZ + 0.25 };
  if (lane === last) return { x: cx, z: world.pool.minZ - 0.25 };
  return null;
}

/** Where the body lands in the water for an entry, from the place it started at. */
export function entrySplash(world: World, kind: EntryKind, lane: number, at: Vec2): Vec2 {
  const e = world.equipment;
  switch (kind) {
    case 'ladder':
      return { x: at.x, z: at.z };
    case 'block':
      return { x: world.pool.minX + 2.4, z: world.lanes[lane].z };
    case 'board':
      return { x: e.board.splash.x, z: e.board.splash.z };
    case 'slide':
      return { x: e.slide.splash.x, z: e.slide.splash.z };
    case 'cannonball': {
      // Out over the water, straight in from the wall.
      const inward = at.z > (world.pool.minZ + world.pool.maxZ) / 2 ? -1 : 1;
      return { x: at.x, z: at.z + inward * CANNONBALL_OUT };
    }
  }
}

/** The way a swimmer swims after it has entered: away from the nearer end. */
export function swimDirAfter(world: World, splash: Vec2): 1 | -1 {
  return splash.x > (world.pool.minX + world.pool.maxX) / 2 ? -1 : 1;
}

/** Reachability from the gate, cached per world: the deck is one piece, so the gate stands for it. */
const reachCache = new WeakMap<World, Map<string, boolean>>();

/**
 * True when the approach of an entry can be walked to from the deck.
 *
 * A place in a sealed pocket (the two-lane pocket of Sprint 23) is not, and
 * the entry is simply not offered there.
 */
export function approachReachable(world: World, approach: Vec2): boolean {
  let cache = reachCache.get(world);
  if (!cache) {
    cache = new Map();
    reachCache.set(world, cache);
  }
  const key = `${approach.x.toFixed(2)},${approach.z.toFixed(2)}`;
  let ok = cache.get(key);
  if (ok === undefined) {
    ok = reachable(world, world.gate, approach);
    cache.set(key, ok);
  }
  return ok;
}

/**
 * Whether the entry is open for this body now: nobody in the way, and the
 * approach can be reached. The ladder is always open.
 */
export function entryOpen(kind: EntryKind, body: Pick<Body, 'lane' | 'x'>, world: World, busy: EntryBusy): boolean {
  const e = world.equipment;
  const lanes = world.lanes.length;
  switch (kind) {
    case 'ladder':
      return true;
    case 'block': {
      const lane = world.lanes[body.lane];
      if (!lane || busy.block(body.lane)) return false;
      if (busy.waterNear(world.pool.minX + BLOCK_FRONT, lane.z, ENTRY_CLEAR_M)) return false;
      return approachReachable(world, blockApproach(world, body.lane));
    }
    case 'board':
      if (busy.board) return false;
      if (busy.waterNear(e.board.splash.x, e.board.splash.z, ENTRY_CLEAR_M)) return false;
      return approachReachable(world, { x: e.board.base.x, z: e.board.base.z });
    case 'slide':
      if (busy.slide) return false;
      if (busy.waterNear(e.slide.splash.x, e.slide.splash.z, ENTRY_CLEAR_M)) return false;
      return approachReachable(world, { x: e.slide.stairsFoot.x, z: e.slide.stairsFoot.z });
    case 'cannonball': {
      // Only the swimmers of the two outside lanes can jump from the walls.
      if (body.lane !== 0 && body.lane !== lanes - 1) return false;
      const at = copingPoint(world, body.lane, body.x);
      if (!at) return false;
      const splash = entrySplash(world, 'cannonball', body.lane, at);
      if (busy.waterNear(splash.x, splash.z, ENTRY_CLEAR_M)) return false;
      return approachReachable(world, at);
    }
  }
}

/**
 * The way a body goes into the water, drawn from a seeded generator.
 *
 * The draw depends on the body and on how many entries it has made, so the
 * same body gets the same choice every time, and the next one differs. A kind
 * that is not open counts as 0. With reduced motion it is always the ladder.
 */
export function chooseEntry(body: Body, world: World, busy: EntryBusy, reducedMotion: boolean): EntryKind {
  if (reducedMotion) return 'ladder';
  const draw = mulberry32((body.seed ^ Math.imul(body.entriesMade, CHOICE_MIX)) >>> 0)();
  const weights = ENTRY_KINDS.map((kind) => (entryOpen(kind, body, world, busy) ? ENTRY_WEIGHTS[kind] : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = draw * total;
  for (let i = 0; i < ENTRY_KINDS.length; i += 1) {
    r -= weights[i];
    if (r < 0) return ENTRY_KINDS[i];
  }
  return 'ladder';
}

// --- the curve of the slide -------------------------------------------

/** A curve sampled once, with the length up to each sample. */
export interface PathTable {
  points: Vec3[];
  /** The length of the curve up to each point, in metres. */
  lengths: number[];
  total: number;
}

/**
 * Centripetal Catmull–Rom through the points, sampled into a table.
 *
 * The same curve as the chute's `CatmullRomCurve3` in the drawing, so that
 * the rider and the water in the chute are where the eye expects them. The
 * ends are extended by reflection, the way the drawing extends them.
 */
export function buildPathTable(points: Vec3[], samples = 200): PathTable {
  const out: Vec3[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = i / (samples - 1);
    const p = curvePoint(points, t, { x: 0, y: 0, z: 0 });
    if (i > 0) {
      const q = out[i - 1];
      lengths.push((lengths[i - 1] ?? 0) + Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
    } else {
      lengths.push(0);
    }
    out.push(p);
  }
  return { points: out, lengths, total: lengths[lengths.length - 1] ?? 0 };
}

/** The index of the sample that is at the arc length `d`, and how far between it and the next. */
function locate(table: PathTable, s: number): { i: number; f: number } {
  const d = Math.max(0, Math.min(1, s)) * table.total;
  const { lengths } = table;
  let lo = 0;
  let hi = lengths.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = lengths[hi] - lengths[lo];
  return { i: lo, f: span > 1e-9 ? (d - lengths[lo]) / span : 0 };
}

/**
 * The point at the fraction `s` of the length of the curve (0 at the top,
 * 1 at the end). Written into `out`, so the frame does not allocate.
 */
export function pointAt(table: PathTable, s: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const { i, f } = locate(table, s);
  const a = table.points[i];
  const b = table.points[Math.min(i + 1, table.points.length - 1)];
  out.x = a.x + (b.x - a.x) * f;
  out.y = a.y + (b.y - a.y) * f;
  out.z = a.z + (b.z - a.z) * f;
  return out;
}

/** The unit tangent of the curve at the fraction `s`, written into `out`. */
export function tangentAt(table: PathTable, s: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const { i } = locate(table, s);
  const a = table.points[Math.max(0, i - 1)];
  const b = table.points[Math.min(i + 1, table.points.length - 1)];
  const x = b.x - a.x;
  const y = b.y - a.y;
  const z = b.z - a.z;
  const n = Math.hypot(x, y, z) || 1;
  out.x = x / n;
  out.y = y / n;
  out.z = z / n;
  return out;
}

/** The point on the centripetal spline at the parameter t of the whole curve (0..1). */
function curvePoint(points: Vec3[], t: number, out: Vec3): Vec3 {
  const n = points.length - 1;
  const seg = Math.min(n - 1, Math.floor(t * n));
  const u = t * n - seg;
  const at = (k: number): Vec3 => {
    if (k < 0) {
      const p0 = points[0];
      const p1 = points[1];
      return { x: 2 * p0.x - p1.x, y: 2 * p0.y - p1.y, z: 2 * p0.z - p1.z };
    }
    if (k > n) {
      const pn = points[n];
      const pm = points[n - 1];
      return { x: 2 * pn.x - pm.x, y: 2 * pn.y - pm.y, z: 2 * pn.z - pm.z };
    }
    return points[k];
  };
  const p0 = at(seg - 1);
  const p1 = at(seg);
  const p2 = at(seg + 1);
  const p3 = at(seg + 2);
  const knot = (a: Vec3, b: Vec3, prev: number) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    return prev + (d < 1e-4 ? 1 : Math.sqrt(d));
  };
  const t0 = 0;
  const t1 = knot(p0, p1, t0);
  const t2 = knot(p1, p2, t1);
  const t3 = knot(p2, p3, t2);
  const k = t1 + u * (t2 - t1);
  const lerp = (a: Vec3, b: Vec3, ka: number, kb: number): Vec3 => {
    const w = (k - ka) / (kb - ka || 1);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  const c = lerp(b1, b2, t1, t2);
  out.x = c.x;
  out.y = c.y;
  out.z = c.z;
  return out;
}

const slideCache = new WeakMap<World, PathTable>();

/** The slide's chute as a table, built once per world. */
export function slideTable(world: World): PathTable {
  let table = slideCache.get(world);
  if (!table) {
    table = buildPathTable(world.equipment.slide.path);
    slideCache.set(world, table);
  }
  return table;
}
