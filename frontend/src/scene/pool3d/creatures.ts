/**
 * The creatures of the pool: a cat, a duck, two birds and two butterflies,
 * and never more than four of them on the screen at once.
 *
 * Pure, like the other decisions of the pool: where a creature is and what it
 * does is worked out here from the clock, the light, the weather and the
 * people, and the drawing only shows it. Every choice comes from a seeded
 * stream, so the same inputs give the same pool.
 *
 * The limit is the user's: the only humans in the scene are the agents, and
 * animals are allowed, but only a few. `MAX_CREATURES` is checked by the
 * tests over a long simulated day.
 */

import { fbm } from '../characters/noise';
import { rngFor } from '../characters/spec';
import { findPath, segmentHitsArea } from './nav';
import type { Area, Vec2, Vec3, World } from './world';

/** At most this many creatures are on the screen at once, all kinds together. */
export const MAX_CREATURES = 4;

export type CreatureKind = 'cat' | 'duck' | 'bird' | 'butterfly';

export interface Creature {
  id: string;
  kind: CreatureKind;
  x: number;
  y: number;
  z: number;
  /** The way it faces: 0 is +z, π/2 is +x. */
  yaw: number;
  /** What it is doing. The names are per kind; see the director. */
  state: string;
  /** Seconds in the state. */
  t: number;
  /** Where it is going, or null. */
  target: Vec3 | null;
  /** The walk cycle, the wing beat or the paddle, in cycles. */
  cycle: number;
}

/** A person, for the creatures to keep away from. */
export interface CreaturePerson {
  x: number;
  z: number;
  /** The way the person faces: the way it walks or swims, when it moves. */
  yaw: number;
  moving: boolean;
  inWater: boolean;
}

/** A splash that just happened: a body landing, a cannonball, a slide. */
export interface CreatureSplash {
  x: number;
  z: number;
  size: number;
}

/** Everything the director is told about the world, once a frame. */
export interface CreatureWorld {
  world: World;
  /** The hour of the day, 0..24. */
  hour: number;
  /** How bright the day is (the palette's light): 0 at midnight, 1 at noon. */
  light: number;
  raining: boolean;
  reducedMotion: boolean;
  /** The pool has been quiet for a while (step 26.7). */
  calm: boolean;
  /** Whether the sprinkler on the lawn is running now. */
  sprinkler: boolean;
  people: ReadonlyArray<CreaturePerson>;
  splashes: ReadonlyArray<CreatureSplash>;
  /** Where the errands stand: the cat keeps off them. */
  avoid: ReadonlyArray<Vec2>;
  /** The places behind the occupied loungers, where the cat naps next to an agent. */
  naps: ReadonlyArray<Vec2>;
}

// --- the clock, the light and the weather ----------------------------------

/** Below this light it is night for the creatures: only the cat is out. */
export const NIGHT_LIGHT = 0.25;

/** The light above which the duck may come, and the birds and butterflies may fly. */
const DUCK_LIGHT = 0.4;
const BIRD_LIGHT = 0.35;
const BUTTERFLY_LIGHT = 0.5;

/**
 * How much night it is, from 0 by day to 1 at the dead of night, eased. It
 * is the same ramp the lamps use: they come on as the light falls.
 */
export function nightAmount(light: number): number {
  const t = Math.min(1, Math.max(0, (0.45 - light) / 0.35));
  return t * t * (3 - 2 * t);
}

/**
 * Whether the sprinkler on the lawn runs now: from 07:00 to 09:00, for ten
 * minutes of every half hour. Never in the rain, and never with reduced motion.
 */
export function sprinklerOn(hour: number, raining: boolean, reducedMotion: boolean): boolean {
  if (raining || reducedMotion) return false;
  if (hour < 7 || hour >= 9) return false;
  return (hour * 60) % 30 < 10;
}

/**
 * How hard the wind blows, from 0 to 1. The sway of the parasols, the flags,
 * the clouds and the duck's drift all follow it, so they move together.
 */
export function windAt(time: number): number {
  return 0.5 + 0.5 * fbm(time / 90, 777);
}

/** Seconds until the next whole hour, at least a minute, at most an hour. */
function secondsToNextHour(hour: number): number {
  const left = (Math.floor(hour) + 1 - hour) * 3600;
  return Math.min(3600, Math.max(60, left));
}

// --- the places ----------------------------------------------------------------

/** How far outside the fence the cat may go: the garden. */
const GARDEN_REACH = 6;
/** The cat keeps this far from the water and from every piece of equipment. */
const CAT_CLEAR = 0.3;
/** The cat never comes this close to a tree trunk. */
const TRUNK_CLEAR = 0.8;

function inArea(x: number, z: number, area: Area, by: number): boolean {
  return x > area.minX - by && x < area.maxX + by && z > area.minZ - by && z < area.maxZ + by;
}

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az);
}

/** The distance from a point to a segment on the ground. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(a.x + dx * u - p.x, a.z + dz * u - p.z);
}

/** True when a point is in the garden, or on the deck, or in the strip between them. */
export function inCatRange(world: World, p: Vec2): boolean {
  const d = world.deck;
  return (
    p.x > d.minX - GARDEN_REACH &&
    p.x < d.maxX + GARDEN_REACH &&
    p.z > d.minZ - GARDEN_REACH &&
    p.z < d.maxZ + GARDEN_REACH
  );
}

/**
 * True when the cat may stand at a point: in range, `margin` clear of the
 * water and the equipment, off the hut, and off the trunks of the trees.
 */
export function catMayStand(world: World, p: Vec2, margin = CAT_CLEAR): boolean {
  if (!inCatRange(world, p)) return false;
  for (const o of world.obstacles) if (inArea(p.x, p.z, o.area, margin)) return false;
  if (inArea(p.x, p.z, world.hut.area, margin)) return false;
  for (const t of world.trees) if (dist(p.x, p.z, t.x, t.z) < TRUNK_CLEAR) return false;
  return true;
}

/**
 * True when a walk from `from` through `path` keeps off the hut and the
 * trunks. The planner keeps off the water and the equipment by itself.
 */
function wayIsClear(world: World, from: Vec2, path: readonly Vec2[]): boolean {
  const h = world.hut.area;
  const hut: Area = { minX: h.minX - CAT_CLEAR, maxX: h.maxX + CAT_CLEAR, minZ: h.minZ - CAT_CLEAR, maxZ: h.maxZ + CAT_CLEAR };
  let a = from;
  for (const b of path) {
    if (segmentHitsArea(a, b, hut)) return false;
    for (const t of world.trees) if (distToSegment(t, a, b) < TRUNK_CLEAR) return false;
    a = b;
  }
  return true;
}

/** The places the cat goes to, worked out once per world. */
interface Places {
  sunny: Vec2[];
  garden: Vec2[];
  porch: Vec2;
}

const placesCache = new WeakMap<World, Places>();

function placesFor(world: World): Places {
  const cached = placesCache.get(world);
  if (cached) return cached;
  const d = world.deck;
  // The sunny spots: a grid over the deck, clear of the loungers and of each other.
  const sunny: Vec2[] = [];
  for (let j = 0; j < 5 && sunny.length < 8; j += 1) {
    for (let i = 0; i < 7 && sunny.length < 8; i += 1) {
      const p = { x: d.minX + 1 + ((d.maxX - d.minX - 2) * i) / 6, z: d.minZ + 1 + ((d.maxZ - d.minZ - 2) * j) / 4 };
      if (!catMayStand(world, p, 0.6)) continue;
      if (world.loungers.some((l) => inArea(p.x, p.z, { minX: l.x - 0.6, maxX: l.x + 0.6, minZ: l.z - 1.1, maxZ: l.z + 1.1 }, 0))) {
        continue;
      }
      if (sunny.some((s) => dist(s.x, s.z, p.x, p.z) < 3.5)) continue;
      sunny.push(p);
    }
  }
  // The garden spots: the first three of a short list that are clear.
  const candidates: Vec2[] = [
    { x: d.minX - 3.5, z: d.minZ + 2.5 },
    { x: d.maxX + 3, z: d.minZ - 2 },
    { x: d.maxX + 3, z: d.maxZ + 2 },
    { x: d.minX - 4, z: d.maxZ - 2.5 },
    { x: (d.minX + d.maxX) / 2, z: d.minZ - 4.5 },
  ];
  const garden = candidates.filter((p) => catMayStand(world, p, 0.5)).slice(0, 3);
  const out: Places = { sunny, garden, porch: { x: world.hut.porch.x, z: world.hut.porch.z } };
  placesCache.set(world, out);
  return out;
}

/** The sunny spots on the deck, where the cat lies in the sun. */
export function sunnySpots(world: World): readonly Vec2[] {
  return placesFor(world).sunny;
}

/** The garden spots, outside the fence. */
export function gardenSpots(world: World): readonly Vec2[] {
  return placesFor(world).garden;
}

/**
 * A place on the coping, outside the water, that looks at the pool from the
 * edge nearest to `p`. It slides along the edge until it is clear of the
 * equipment; null when no place on that edge is.
 */
function copingNear(world: World, p: Vec2): Vec2 | null {
  const pool = world.pool;
  const cx = Math.min(pool.maxX, Math.max(pool.minX, p.x));
  const cz = Math.min(pool.maxZ, Math.max(pool.minZ, p.z));
  const edges = [
    { d: cz - pool.minZ, along: 'x' as const, fixed: pool.minZ - 0.6, at: cx },
    { d: pool.maxZ - cz, along: 'x' as const, fixed: pool.maxZ + 0.6, at: cx },
    { d: cx - pool.minX, along: 'z' as const, fixed: pool.minX - 0.6, at: cz },
    { d: pool.maxX - cx, along: 'z' as const, fixed: pool.maxX + 0.6, at: cz },
  ];
  edges.sort((a, b) => a.d - b.d);
  const edge = edges[0];
  for (const k of [0, 0.6, -0.6, 1.2, -1.2, 2, -2]) {
    const q: Vec2 =
      edge.along === 'x'
        ? { x: Math.min(pool.maxX - 0.4, Math.max(pool.minX + 0.4, edge.at + k)), z: edge.fixed }
        : { x: edge.fixed, z: Math.min(pool.maxZ - 0.4, Math.max(pool.minZ + 0.4, edge.at + k)) };
    if (catMayStand(world, q, 0.45)) return q;
  }
  return null;
}

// --- the director ----------------------------------------------------------------

const CAT_SPEED = 0.6;
const FLEE_SPEED = 1.8;
const FLEE_DISTANCE = 4;
const SCARE_PERSON = 1.0;
const SCARE_SPLASH = 1.4;
const SCARE_SPLASH_RANGE = 4;
const SCARE_SPRINKLER = 3;
const AVOID_RANGE = 1.0;
const DUCK_SPEED = 0.25;
const DUCK_LAND_S = 6;
const DUCK_TAKEOFF_S = 1;
const DUCK_RUN_SPEED = 2.2;
const DUCK_LEAVE_S = 8;
const DUCK_SWIMMER_FEAR = 1.8;
const DUCK_SPLASH_FEAR = 5;
const DUCK_SWIMMER_KEEP = 2.5;
const DUCK_WALL_KEEP = 0.5;
const DUCK_HEIGHT = 8;
const BIRD_SPACING = 6;
const BIRD_PERCH_CHANCE = 0.3;
const BIRD_DEPART_S = 8;
const BUTTERFLY_SPEED = 0.5;
/** The top of a parasol's canopy, where a bird may land; and a flower's top. */
const PARASOL_TOP = 2.55;
const FLOWER_TOP = 0.45;

/** The state of one bird: the part of its way it is in, and the time left in it. */
interface BirdPart {
  from: Vec2;
  /** Where this part of the way ends. */
  to: Vec2;
  /** Where the bird is going in the end. */
  end: Vec2;
  part: 'crossing' | 'toPerch' | 'perched' | 'depart' | 'done';
  /** Seconds left in this part, and its length. */
  left: number;
  span: number;
}

export class CreatureDirector {
  private readonly rngCat: () => number;
  private readonly rngDuck: () => number;
  private readonly rngBird: () => number;
  private readonly rngButterfly: () => number;

  private readonly cat = this.make('cat', 'cat');
  private readonly duck = this.make('duck', 'duck');
  private readonly bird0 = this.make('bird-0', 'bird');
  private readonly bird1 = this.make('bird-1', 'bird');
  private readonly butterfly0 = this.make('butterfly-0', 'butterfly');
  private readonly butterfly1 = this.make('butterfly-1', 'butterfly');
  /** Whether each creature is on the screen now. */
  private readonly present = new Map<Creature, boolean>();
  private readonly shown: Creature[] = [];

  /** The cat's way: the points still to walk through, and the kind of spot it is for. */
  private catPath: Vec2[] = [];
  private catSpot: 'sun' | 'nap' | 'garden' | 'porch' | 'coping' | 'flee' | 'none' = 'none';
  /** How long the cat stays in a timed state, in seconds. */
  private catLimit = 10;

  /** The duck's schedule and its moves. */
  private duckAt: number;
  private duckFrom: Vec2 = { x: 0, z: 0 };
  private duckLanding: Vec2 = { x: 0, z: 0 };
  private duckTarget: Vec2 | null = null;
  private duckTargetIn = 0;
  private duckPaddleLeft = 0;
  private duckDabbleIn = 0;
  private duckAway: Vec2 = { x: 0, z: 1 };

  /** A frightening spot the pointer made, for the cat to run from on its next step. */
  private pendingScare: { x: number; z: number } | null = null;

  /** The birds: their schedule, and the two flights while they are up. */
  private birdsAt: number;
  private birdsFlight: { a: BirdPart; b: BirdPart; y0: number; perchY: number | null } | null = null;

  /** The butterflies: when each may come, and when each next lands. */
  private readonly butterflyAt: [number, number];
  private readonly butterflyLandAt: [number, number] = [0, 0];
  /** How long each butterfly keeps its wings closed on a flower, when it lands. */
  private readonly butterflyLandFor: [number, number] = [4, 4];

  private world: World | null = null;
  private time = 0;

  constructor(seed: number) {
    const key = `creatures-${seed}`;
    this.rngCat = rngFor(key, 'cat');
    this.rngDuck = rngFor(key, 'duck');
    this.rngBird = rngFor(key, 'birds');
    this.rngButterfly = rngFor(key, 'butterflies');
    this.duckAt = 480 + this.rngDuck() * 420;
    this.birdsAt = 180 + this.rngBird() * 180;
    this.butterflyAt = [this.rngButterfly() * 20, this.rngButterfly() * 20];
    for (const c of [this.cat, this.duck, this.bird0, this.bird1, this.butterfly0, this.butterfly1]) {
      this.present.set(c, false);
    }
    // The cat is always there.
    this.present.set(this.cat, true);
  }

  private make(id: string, kind: CreatureKind): Creature {
    return { id, kind, x: 0, y: 0, z: 0, yaw: 0, state: 'none', t: 0, target: null, cycle: 0 };
  }

  /** The creatures on the screen now, in a fixed order: cat, duck, birds, butterflies. */
  get creatures(): readonly Creature[] {
    this.shown.length = 0;
    for (const c of [this.cat, this.duck, this.bird0, this.bird1, this.butterfly0, this.butterfly1]) {
      if (this.present.get(c)) this.shown.push(c);
    }
    return this.shown;
  }

  /** How many creatures are on the screen. */
  private count(): number {
    let n = 0;
    for (const on of this.present.values()) if (on) n += 1;
    return n;
  }

  /** True when `n` more creatures fit under the limit. */
  private room(n: number): boolean {
    return this.count() + n <= MAX_CREATURES;
  }

  private show(c: Creature, on: boolean): void {
    this.present.set(c, on);
  }

  /** Call the duck in now, if it can come (the debug hooks use this). */
  callDuck(): void {
    this.duckAt = this.time;
  }

  /** Call the birds over now, if they can come (the debug hooks use this). */
  callBirds(): void {
    this.birdsAt = this.time;
  }

  /** A pointer on the cat frightens it: it runs off, as from a person (step 27.5). */
  scare(x: number, z: number): void {
    this.pendingScare = { x, z };
  }

  /** A cat asleep within `range` of a person wakes up and stretches (step 27.2). */
  wakeNear(x: number, z: number, range: number): void {
    const c = this.cat;
    if (c.state !== 'sleep' || dist(c.x, c.z, x, z) > range) return;
    this.setCat('stretch', 2);
  }

  /**
   * Move the creatures on by `dt` seconds.
   *
   * @param now The scene's clock in seconds; the schedules are read from it.
   */
  step(dt: number, now: number, env: CreatureWorld): void {
    if (this.world !== env.world) {
      this.world = env.world;
      this.catPath = [];
      this.catSpot = 'none';
    }
    this.time = now;
    this.stepCat(dt, env);
    this.stepDuck(dt, now, env);
    this.stepBirds(dt, now, env);
    this.stepButterflies(dt, now, env);
  }

  // -- the cat -----------------------------------------------------------------

  private stepCat(dt: number, env: CreatureWorld): void {
    const c = this.cat;
    const world = env.world;
    const places = placesFor(world);
    c.t += dt;

    if (c.state === 'none') {
      // The cat is born on the first sunny spot, sitting.
      const at = places.sunny[0] ?? places.porch;
      c.x = at.x;
      c.z = at.z;
      c.yaw = 0;
      this.setCat('sit', 10 + this.rngCat() * 10);
      this.catSpot = 'sun';
      return;
    }

    if (env.reducedMotion) {
      // Reduced motion: the cat sits and sleeps where it is, and does not walk.
      this.pendingScare = null;
      if (c.t >= this.catLimit) {
        if (c.state === 'sit') this.setCat('sleep', 60 + this.rngCat() * 120);
        else this.setCat('sit', 8 + this.rngCat() * 12);
      }
      return;
    }

    // Fear comes before anything else, and it can come in any state.
    if (this.pendingScare !== null) {
      const cause = this.pendingScare;
      this.pendingScare = null;
      this.startFlee(world, cause);
      return;
    }
    if (c.state !== 'flee') {
      const cause = this.scareFrom(env);
      if (cause !== null) {
        this.startFlee(world, cause);
        return;
      }
    }
    if (c.state === 'flee') {
      if (this.walkCat(dt, FLEE_SPEED)) this.setCat('sit', 8 + this.rngCat() * 12);
      return;
    }

    if (env.raining) {
      // Under the hut's roof, the cat sits out the rain. If there is no way
      // to the porch it sits where it is, rather than planning again each frame.
      if (c.state !== 'shelter') {
        if (!this.walkTo(world, places.porch, 'porch', 'shelter')) this.setCat('shelter', 0);
      } else {
        this.walkCat(dt, CAT_SPEED);
      }
      return;
    }
    if (c.state === 'shelter') {
      // The rain has stopped: the cat walks off again.
      this.pickWander(env);
      return;
    }

    if (env.light < NIGHT_LIGHT) {
      this.stepCatNight(dt, env);
      return;
    }

    switch (c.state) {
      case 'wander':
        if (this.walkCat(dt, CAT_SPEED)) this.arriveCat(env);
        break;
      case 'sit':
      case 'groom':
        if (c.t >= this.catLimit) {
          if (c.state === 'groom' && this.rngCat() < 0.5) this.setCat('sit', 8 + this.rngCat() * 12);
          else this.pickWander(env);
        }
        break;
      case 'sleep':
        if (c.t >= this.catLimit) this.setCat('stretch', 2);
        break;
      case 'stretch':
        if (c.t >= 2) this.pickWander(env);
        break;
      case 'watch': {
        const near = this.nearestSwimmer(env);
        if (near !== null) c.yaw = Math.atan2(near.x - c.x, near.z - c.z);
        if (c.t >= this.catLimit) this.pickWander(env);
        break;
      }
      default:
        this.pickWander(env);
    }
  }

  /** At night the cat sleeps on the porch, and wakes once an hour to stretch and come back. */
  private stepCatNight(dt: number, env: CreatureWorld): void {
    const c = this.cat;
    if (c.state === 'sleep') {
      if (c.t >= this.catLimit) this.setCat('stretch', 2);
      return;
    }
    if (c.state === 'stretch') {
      if (c.t >= 2) this.walkTo(env.world, placesFor(env.world).porch, 'porch', 'wander');
      return;
    }
    if (c.state === 'wander') {
      if (this.walkCat(dt, CAT_SPEED)) this.setCat('sleep', secondsToNextHour(env.hour));
      return;
    }
    // Anything else, at night, goes back to the porch.
    if (!this.walkTo(env.world, placesFor(env.world).porch, 'porch', 'wander')) {
      this.setCat('sleep', secondsToNextHour(env.hour));
    }
  }

  private setCat(state: string, seconds: number): void {
    this.cat.state = state;
    this.cat.t = 0;
    this.catLimit = seconds;
    this.catPath = [];
  }

  /**
   * Walk the cat along its way, at `speed`. Returns true when it has arrived,
   * or when there is no way left to walk.
   */
  private walkCat(dt: number, speed: number): boolean {
    const c = this.cat;
    while (this.catPath.length > 0 && dist(c.x, c.z, this.catPath[0].x, this.catPath[0].z) < 0.08) {
      this.catPath.shift();
    }
    if (this.catPath.length === 0) return true;
    const to = this.catPath[0];
    const d = dist(c.x, c.z, to.x, to.z);
    const step = Math.min(speed * dt, d);
    const ux = (to.x - c.x) / d;
    const uz = (to.z - c.z) / d;
    c.x += ux * step;
    c.z += uz * step;
    c.yaw = Math.atan2(ux, uz);
    // A stride every 0.6 m, and a trot covers the same ground in half the strides.
    c.cycle += step * (speed > CAT_SPEED ? 0.8 : 1.6);
    return false;
  }

  /**
   * Set the cat walking to a place, in `state`, by a way that keeps off the
   * hut and the trees. Returns false, and leaves the cat as it was, when
   * there is no such way.
   */
  private walkTo(world: World, to: Vec2, spot: 'sun' | 'nap' | 'garden' | 'porch' | 'coping' | 'flee', state: string): boolean {
    const c = this.cat;
    const path = findPath(world, c, to);
    if (path === null || !wayIsClear(world, c, path)) return false;
    this.catPath = path;
    this.catSpot = spot;
    c.state = state;
    c.t = 0;
    c.target = { x: to.x, y: 0, z: to.z };
    return true;
  }

  /** The cat has reached its place: it does what the place is for. */
  private arriveCat(env: CreatureWorld): void {
    if (this.catSpot === 'coping') {
      this.setCat('watch', 15 + this.rngCat() * 25);
      return;
    }
    if (this.catSpot === 'sun' || this.catSpot === 'nap') {
      const pick = this.rngCat();
      if (env.calm) {
        // Calm water: it watches the still pool, or it sleeps.
        if (pick < 0.3) this.setCat('sleep', 60 + this.rngCat() * 120);
        else if (pick < 0.6) this.startWatch(env);
        else this.setCat('sit', 8 + this.rngCat() * 12);
        return;
      }
      if (pick < 0.4) this.setCat('sit', 8 + this.rngCat() * 12);
      else if (pick < 0.6) this.setCat('groom', 5 + this.rngCat() * 4);
      else if (pick < 0.8) this.setCat('sleep', 60 + this.rngCat() * 120);
      else this.startWatch(env);
      return;
    }
    this.setCat('sit', 8 + this.rngCat() * 12);
  }

  /** Walk to the coping by the nearest swimmer, to watch it; sit where it is when there is none. */
  private startWatch(env: CreatureWorld): void {
    const near = this.nearestSwimmer(env);
    const spot = near === null ? null : copingNear(env.world, near);
    if (spot !== null && this.walkTo(env.world, spot, 'coping', 'wander')) return;
    this.setCat('sit', 8 + this.rngCat() * 12);
  }

  /** Pick a new place to wander to: a sunny spot, a lounger's foot, a garden spot or the porch. */
  private pickWander(env: CreatureWorld): void {
    const places = placesFor(env.world);
    const list: { at: Vec2; spot: 'sun' | 'nap' | 'garden' | 'porch' }[] = [];
    for (const at of places.sunny) list.push({ at, spot: 'sun' });
    for (const at of env.naps) list.push({ at, spot: 'nap' });
    for (const at of places.garden) list.push({ at, spot: 'garden' });
    list.push({ at: places.porch, spot: 'porch' });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const pick = list[Math.min(list.length - 1, Math.floor(this.rngCat() * list.length))];
      if (env.avoid.some((a) => dist(a.x, a.z, pick.at.x, pick.at.z) < AVOID_RANGE)) continue;
      if (this.walkTo(env.world, pick.at, pick.spot, 'wander')) return;
    }
    this.setCat('sit', 4);
  }

  /** The swimmer nearest to the cat, or null when nobody is in the water. */
  private nearestSwimmer(env: CreatureWorld): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const p of env.people) {
      if (!p.inWater) continue;
      const d = dist(this.cat.x, this.cat.z, p.x, p.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /**
   * What frightens the cat now, or null: a person moving at it, a big splash
   * near it, or the sprinkler running close by.
   */
  private scareFrom(env: CreatureWorld): { x: number; z: number } | null {
    const c = this.cat;
    for (const p of env.people) {
      if (!p.moving) continue;
      const d = dist(c.x, c.z, p.x, p.z);
      if (d > SCARE_PERSON || d < 1e-6) continue;
      // Its way points at the cat, to within 45 degrees.
      const towardX = (c.x - p.x) / d;
      const towardZ = (c.z - p.z) / d;
      const dot = Math.sin(p.yaw) * towardX + Math.cos(p.yaw) * towardZ;
      if (dot >= Math.SQRT1_2) return p;
    }
    for (const s of env.splashes) {
      if (s.size >= SCARE_SPLASH && dist(c.x, c.z, s.x, s.z) <= SCARE_SPLASH_RANGE) return s;
    }
    if (env.sprinkler && dist(c.x, c.z, env.world.sprinkler.x, env.world.sprinkler.z) <= SCARE_SPRINKLER) {
      return env.world.sprinkler;
    }
    return null;
  }

  /** Run away from the cause, to a point four metres off, on a way that is clear. */
  private startFlee(world: World, cause: { x: number; z: number }): void {
    const c = this.cat;
    let ax = c.x - cause.x;
    let az = c.z - cause.z;
    const len = Math.hypot(ax, az);
    if (len < 1e-6) {
      ax = 1;
      az = 0;
    } else {
      ax /= len;
      az /= len;
    }
    // Straight away first; then a little to either side, if that is blocked.
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2]) {
      const cs = Math.cos(turn);
      const sn = Math.sin(turn);
      const to = {
        x: c.x + (ax * cs - az * sn) * FLEE_DISTANCE,
        z: c.z + (ax * sn + az * cs) * FLEE_DISTANCE,
      };
      if (!catMayStand(world, to, 0.5)) continue;
      if (this.walkTo(world, to, 'flee', 'flee')) return;
    }
    // Nowhere clear to run to: the cat stays where it is and sits.
    this.setCat('flee', 0);
    this.catPath = [];
  }

  // -- the duck ----------------------------------------------------------------

  private stepDuck(dt: number, now: number, env: CreatureWorld): void {
    const d = this.duck;
    const world = env.world;
    const pool = world.pool;

    if (!this.present.get(d)) {
      if (now < this.duckAt) return;
      // It comes by day, in no rain, when there is room for it and a
      // shallow place with nobody in it.
      if (!env.raining && env.light > DUCK_LIGHT && !env.reducedMotion && this.room(1)) {
        const spot = this.duckSpot(env);
        if (spot !== null) {
          this.startDuck(world, spot);
          return;
        }
      }
      this.duckAt = now + 60;
      return;
    }

    d.t += dt;
    // Too dark, and it goes at once: it is not out at night, and not in the rain.
    if (env.light <= BIRD_LIGHT || env.raining) {
      this.leaveDuck(now);
      return;
    }

    if (d.state === 'flyIn') {
      const u = Math.min(1, d.t / DUCK_LAND_S);
      d.x = this.duckFrom.x + (this.duckLanding.x - this.duckFrom.x) * u;
      d.z = this.duckFrom.z + (this.duckLanding.z - this.duckFrom.z) * u;
      d.y = world.waterY + 0.03 + (DUCK_HEIGHT - world.waterY) * (1 - u) * (1 - u);
      d.cycle += dt * 6;
      if (u >= 1) {
        d.x = this.duckLanding.x;
        d.z = this.duckLanding.z;
        d.y = world.waterY + 0.03;
        this.setDuck('paddle');
        this.duckPaddleLeft = 60 + this.rngDuck() * 60;
        this.duckTargetIn = 6 + this.rngDuck() * 6;
        this.duckDabbleIn = 15 + this.rngDuck() * 15;
        this.duckTarget = this.waterTarget(env);
      }
      return;
    }

    if (d.state === 'paddle' || d.state === 'dabble') {
      // A swimmer that comes close, or a big splash, sends it off.
      const threat = this.swimmerNear(env, DUCK_SWIMMER_FEAR) ?? this.splashNear(env, DUCK_SPLASH_FEAR);
      if (threat !== null) {
        this.startTakeOff(world, threat);
        return;
      }
      if (this.duckPaddleLeft <= 0) {
        this.startTakeOff(world, null);
        return;
      }
      this.duckPaddleLeft -= dt;
      this.duckTargetIn -= dt;
      this.duckDabbleIn -= dt;
      if (d.state === 'dabble') {
        // Head under, tail up: it does not move while it dabbles.
        if (d.t >= 2) this.setDuck('paddle');
        return;
      }
      if (this.duckDabbleIn <= 0) {
        this.setDuck('dabble');
        this.duckDabbleIn = 15 + this.rngDuck() * 15;
        return;
      }
      if (this.duckTarget === null || this.duckTargetIn <= 0 || dist(d.x, d.z, this.duckTarget.x, this.duckTarget.z) < 0.1) {
        this.duckTarget = this.waterTarget(env);
        this.duckTargetIn = 6 + this.rngDuck() * 6;
      }
      if (this.duckTarget !== null) {
        const dx = this.duckTarget.x - d.x;
        const dz = this.duckTarget.z - d.z;
        const len = Math.hypot(dx, dz);
        const step = Math.min(DUCK_SPEED * dt, len);
        if (len > 1e-6) {
          d.x += (dx / len) * step;
          d.z += (dz / len) * step;
          d.yaw = Math.atan2(dx, dz);
        }
        d.cycle += step * 2;
      }
      d.y = world.waterY + 0.03;
      // The paddle is kept inside the walls, whatever the target was.
      d.x = Math.min(pool.maxX - DUCK_WALL_KEEP, Math.max(pool.minX + DUCK_WALL_KEEP, d.x));
      d.z = Math.min(pool.maxZ - DUCK_WALL_KEEP, Math.max(pool.minZ + DUCK_WALL_KEEP, d.z));
      return;
    }

    if (d.state === 'takeOff') {
      // It runs across the water, away from the threat, and then it is in the air.
      // A duck runs faster than it swims: the run is over in a second.
      const step = DUCK_RUN_SPEED * dt;
      d.x += this.duckAway.x * step;
      d.z += this.duckAway.z * step;
      d.y = world.waterY + 0.03;
      d.cycle += dt * 12;
      if (d.t >= DUCK_TAKEOFF_S) {
        this.setDuck('leave');
      }
      return;
    }

    // leave: it climbs and flies off towards the garden.
    d.x += this.duckAway.x * 2.2 * dt;
    d.z += this.duckAway.z * 2.2 * dt;
    d.y = world.waterY + 0.03 + Math.min(9, d.t * 1.4);
    d.cycle += dt * 6;
    if (d.t >= DUCK_LEAVE_S) {
      this.show(d, false);
      this.duckAt = now + 480 + this.rngDuck() * 420;
    }
  }

  private setDuck(state: string): void {
    this.duck.state = state;
    this.duck.t = 0;
  }

  /** Make the duck take off: it runs from the threat, then flies away. */
  private startTakeOff(world: World, threat: { x: number; z: number } | null): void {
    const d = this.duck;
    let ax = d.x - (threat ? threat.x : world.pool.minX + (world.pool.maxX - world.pool.minX) / 2);
    let az = d.z - (threat ? threat.z : 0);
    const len = Math.hypot(ax, az);
    if (len < 1e-6) {
      ax = 0;
      az = 1;
    } else {
      ax /= len;
      az /= len;
    }
    this.duckAway = { x: ax, z: az };
    d.yaw = Math.atan2(ax, az);
    this.setDuck('takeOff');
  }

  /** The duck is gone: it has flown out, or it is too dark for it. */
  private leaveDuck(now: number): void {
    this.show(this.duck, false);
    this.duck.state = 'none';
    this.duckAt = now + 480 + this.rngDuck() * 420;
  }

  /** Where the duck would land: a shallow point with nobody in the water within four metres. */
  private duckSpot(env: CreatureWorld): Vec2 | null {
    const pool = env.world.pool;
    const x0 = pool.minX + 0.8;
    const x1 = pool.minX + (pool.maxX - pool.minX) / 3;
    for (let k = 0; k < 12; k += 1) {
      const x = x0 + (x1 - x0) * this.rngDuck();
      const z = pool.minZ + 0.6 + (pool.maxZ - pool.minZ - 1.2) * this.rngDuck();
      if (this.swimmerNearPoint(env, x, z, 4)) continue;
      return { x, z };
    }
    return null;
  }

  private startDuck(world: World, landing: Vec2): void {
    const d = this.duck;
    this.duckLanding = landing;
    // It comes in from the garden on the west side, high, and comes down on the water.
    this.duckFrom = { x: world.deck.minX - 6, z: landing.z };
    d.x = this.duckFrom.x;
    d.z = this.duckFrom.z;
    d.y = DUCK_HEIGHT;
    d.yaw = Math.atan2(landing.x - this.duckFrom.x, landing.z - this.duckFrom.z);
    this.show(d, true);
    this.setDuck('flyIn');
    this.duckTarget = null;
  }

  /** A point in the water, at least 2.5 m from everybody swimming, or null. */
  private waterTarget(env: CreatureWorld): Vec2 | null {
    const pool = env.world.pool;
    for (let k = 0; k < 8; k += 1) {
      const x = pool.minX + DUCK_WALL_KEEP + (pool.maxX - pool.minX - 2 * DUCK_WALL_KEEP) * this.rngDuck();
      const z = pool.minZ + DUCK_WALL_KEEP + (pool.maxZ - pool.minZ - 2 * DUCK_WALL_KEEP) * this.rngDuck();
      if (this.swimmerNearPoint(env, x, z, DUCK_SWIMMER_KEEP)) continue;
      return { x, z };
    }
    return null;
  }

  private swimmerNear(env: CreatureWorld, range: number): { x: number; z: number } | null {
    for (const p of env.people) {
      if (p.inWater && dist(this.duck.x, this.duck.z, p.x, p.z) <= range) return p;
    }
    return null;
  }

  private swimmerNearPoint(env: CreatureWorld, x: number, z: number, range: number): boolean {
    for (const p of env.people) {
      if (p.inWater && dist(x, z, p.x, p.z) < range) return true;
    }
    return false;
  }

  private splashNear(env: CreatureWorld, range: number): { x: number; z: number } | null {
    for (const s of env.splashes) {
      if (s.size >= SCARE_SPLASH && dist(this.duck.x, this.duck.z, s.x, s.z) <= range) return s;
    }
    return null;
  }

  // -- the birds ---------------------------------------------------------------

  private stepBirds(dt: number, now: number, env: CreatureWorld): void {
    const flight = this.birdsFlight;
    if (flight !== null) {
      // They only fly by day, and not in the rain: they are gone at once when that stops.
      if (env.light <= BIRD_LIGHT || env.raining) {
        this.endBirds(now);
        return;
      }
      this.advanceBird(flight.a, dt, flight.y0, flight.perchY, this.bird0);
      this.advanceBird(flight.b, dt, flight.y0, null, this.bird1);
      if (flight.a.part === 'done' && flight.b.part === 'done') this.endBirds(now);
      return;
    }
    if (now < this.birdsAt) return;
    if (env.light > BIRD_LIGHT && !env.raining && !env.reducedMotion && this.room(2)) {
      this.startBirds(env.world);
      return;
    }
    this.birdsAt = now + 60;
  }

  /**
   * Start a pair of birds across the sky. They fly in line, the second bird
   * six metres behind the first. The first may land on a parasol for a while.
   */
  private startBirds(world: World): void {
    const d = world.deck;
    const side = this.rngBird() < 0.5 ? 1 : -1;
    const z0 = d.minZ + (d.maxZ - d.minZ) * (0.2 + 0.6 * this.rngBird());
    const from: Vec2 = { x: side > 0 ? d.minX - 12 : d.maxX + 12, z: z0 };
    const to: Vec2 = { x: side > 0 ? d.maxX + 12 : d.minX - 12, z: z0 + (this.rngBird() - 0.5) * 8 };
    const y0 = 12 + this.rngBird() * 6;
    const span = 14 + this.rngBird() * 6;
    const len = Math.hypot(to.x - from.x, to.z - from.z);
    const ux = (to.x - from.x) / len;
    const uz = (to.z - from.z) / len;
    const behind = (p: Vec2): Vec2 => ({ x: p.x - ux * BIRD_SPACING, z: p.z - uz * BIRD_SPACING });
    let perchY: number | null = null;
    let perch: Vec2 | null = null;
    if (world.parasols.length > 0 && this.rngBird() < BIRD_PERCH_CHANCE) {
      const p = world.parasols[Math.floor(this.rngBird() * world.parasols.length) % world.parasols.length];
      perch = { x: p.x, z: p.z };
      perchY = PARASOL_TOP;
    }
    const a: BirdPart = perch
      ? { from, to: perch, end: to, part: 'toPerch', left: span * 0.5, span: span * 0.5 }
      : { from, to, end: to, part: 'crossing', left: span, span };
    const b: BirdPart = { from: behind(from), to: behind(to), end: behind(to), part: 'crossing', left: span, span };
    this.birdsFlight = { a, b, y0, perchY };
    this.show(this.bird0, true);
    this.show(this.bird1, true);
  }

  /** Move one bird through its parts of the way, and write it into its creature. */
  private advanceBird(part: BirdPart, dt: number, y0: number, perchY: number | null, c: Creature): void {
    if (part.part === 'done') return;
    part.left -= dt;
    const u = Math.min(1, Math.max(0, 1 - part.left / part.span));
    if (part.part === 'crossing') {
      c.x = part.from.x + (part.to.x - part.from.x) * u;
      c.z = part.from.z + (part.to.z - part.from.z) * u;
      c.y = y0 + 1.2 * Math.sin(Math.PI * u);
      c.state = 'fly';
      if (part.left <= 0) part.part = 'done';
    } else if (part.part === 'toPerch' && perchY !== null) {
      c.x = part.from.x + (part.to.x - part.from.x) * u;
      c.z = part.from.z + (part.to.z - part.from.z) * u;
      c.y = y0 + (perchY - y0) * u;
      c.state = 'fly';
      if (part.left <= 0) {
        // It sits on the parasol, with its wings folded, for a while.
        part.part = 'perched';
        part.from = part.to;
        part.left = 20 + this.rngBird() * 20;
        part.span = part.left;
      }
    } else if (part.part === 'perched' && perchY !== null) {
      c.x = part.from.x;
      c.z = part.from.z;
      c.y = perchY;
      c.state = 'perch';
      if (part.left <= 0) {
        // Then it flies on to the far side, after the other one.
        part.part = 'depart';
        part.to = part.end;
        part.left = BIRD_DEPART_S;
        part.span = BIRD_DEPART_S;
      }
    } else if (part.part === 'depart' && perchY !== null) {
      c.x = part.from.x + (part.to.x - part.from.x) * u;
      c.z = part.from.z + (part.to.z - part.from.z) * u;
      c.y = perchY + (y0 - perchY) * u;
      c.state = 'fly';
      if (part.left <= 0) part.part = 'done';
    }
    c.cycle += dt * (c.state === 'perch' ? 0 : 4);
  }

  private endBirds(now: number): void {
    this.birdsFlight = null;
    this.show(this.bird0, false);
    this.show(this.bird1, false);
    this.birdsAt = now + 180 + this.rngBird() * 180;
  }

  // -- the butterflies ----------------------------------------------------------

  private stepButterflies(dt: number, now: number, env: CreatureWorld): void {
    const flutters = env.light > BUTTERFLY_LIGHT && !env.raining && !env.reducedMotion;
    const pair: [Creature, Creature] = [this.butterfly0, this.butterfly1];
    for (let i = 0; i < 2; i += 1) {
      const b = pair[i];
      if (!flutters) {
        // Gone at night and in the rain: they are not drawn at all.
        this.show(b, false);
        continue;
      }
      if (!this.present.get(b)) {
        if (now < this.butterflyAt[i]) continue;
        if (this.room(1)) {
          this.startButterfly(env, i, now);
        } else {
          this.butterflyAt[i] = now + 10;
        }
        continue;
      }
      b.t += dt;
      b.cycle += dt * 8;
      if (b.state === 'land') {
        // Wings closed on a flower, for a few seconds.
        if (b.t >= this.butterflyLandFor[i]) this.setButterfly(b, 'flutter', i, now);
        continue;
      }
      if (now >= this.butterflyLandAt[i]) {
        this.setButterfly(b, 'land', i, now);
        b.y = FLOWER_TOP;
        b.target = null;
        continue;
      }
      this.flyButterfly(b, dt, env);
    }
  }

  private startButterfly(env: CreatureWorld, i: number, now: number): void {
    const b = i === 0 ? this.butterfly0 : this.butterfly1;
    const p = this.flowerPoint(env);
    b.x = p.x;
    b.y = p.y;
    b.z = p.z;
    b.yaw = 0;
    b.target = null;
    this.show(b, true);
    this.setButterfly(b, 'flutter', i, now);
  }

  /** Set a butterfly's state; a flutter sets when it next lands. */
  private setButterfly(b: Creature, state: string, i: number, now: number): void {
    b.state = state;
    b.t = 0;
    if (state === 'flutter') {
      this.butterflyLandAt[i] = now + 10 + this.rngButterfly() * 10;
    } else {
      this.butterflyLandFor[i] = 3 + this.rngButterfly() * 3;
    }
  }

  /** Fly towards a point over a flower bed. On arrival, the next one is picked. */
  private flyButterfly(b: Creature, dt: number, env: CreatureWorld): void {
    if (b.target === null) b.target = this.flowerPoint(env);
    const t = b.target;
    const dx = t.x - b.x;
    const dy = t.y - b.y;
    const dz = t.z - b.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.05) {
      b.target = null;
      return;
    }
    const step = Math.min(BUTTERFLY_SPEED * dt, len);
    b.x += (dx / len) * step;
    b.y += (dy / len) * step;
    b.z += (dz / len) * step;
    b.yaw = Math.atan2(dx, dz);
  }

  /** A point over a flower bed, at flying height. The beds are in the garden, never over the water. */
  private flowerPoint(env: CreatureWorld): Vec3 {
    const beds = env.world.flowerBeds;
    const bed = beds[Math.min(beds.length - 1, Math.floor(this.rngButterfly() * beds.length))];
    return {
      x: bed.minX - 0.3 + (bed.maxX - bed.minX + 0.6) * this.rngButterfly(),
      y: 0.3 + 1.1 * this.rngButterfly(),
      z: bed.minZ - 0.3 + (bed.maxZ - bed.minZ + 0.6) * this.rngButterfly(),
    };
  }
}
