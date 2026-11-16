/**
 * What an agent's character does on the 3D deck, frame by frame.
 *
 * The backend says what it wants (swim, lounge, wait, leave); this turns
 * that into walking round the pool, climbing down the ladder, swimming
 * lengths, climbing out and sitting down. It is pure: no Three.js, no
 * drawing. The scene keeps one `Body` per agent, hands it the presentation
 * when it changes, steps it every frame and then puts the rig where the body
 * says it is.
 *
 * The 2D scene has its own state machine, tangled up with its drawing; it is
 * left as it is, and this one is written to be tested.
 */

import type { AgentPresentation } from '../../net/types';
import type { SwimStyle } from '../characters/spec';
import type { ActionKind } from '../motion/actions';
import type { CharState, PropKind } from '../motion/driver';
import { clearSegment, planPath, steer, type Walker } from './nav';
import {
  chooseEntry,
  entryApproach,
  entryOpen,
  entrySplash,
  pointAt,
  slideTable,
  swimDirAfter,
  tangentAt,
  type EntryBusy,
  type EntryKind,
  type EntryState,
} from './entries';
import {
  startSwim,
  swimStep,
  swimToward,
  normaliseNear,
  TURN_SECONDS,
  type SwimOptions,
  type SwimState,
} from './swim';
import {
  floorDepthAt,
  gateOutside,
  insideFence,
  ladderFoot,
  ladderTop,
  loungerApproach,
  queueSpot,
  swimZ,
  type Ladder,
  type Vec2,
  type Vec3,
  type World,
} from './world';
import { carryFor, errandDraw, rallyLoser, type ErrandContext, type ErrandKind, type ErrandState } from './errands';
import type { WorkKind } from './work';

export type Desired = 'swim' | 'lounge' | 'waiting' | 'exiting' | 'leaving' | 'offscreen' | 'unknown';

/** Where a body is headed, as a key that can be compared. */
type Goal =
  | { kind: 'ladder'; index: number }
  | { kind: 'lounger'; index: number }
  | { kind: 'waiting'; index: number }
  | { kind: 'queue'; place: number }
  | { kind: 'gate' }
  | { kind: 'entry'; x: number; z: number }
  | { kind: 'errand'; x: number; z: number };

/** Something the scene shows: a splash, a bounce on the board, a race won. */
export interface BodyEvent {
  name: string;
  x: number;
  z: number;
}

/** A way out over the edge of the pool, instead of the ladder. */
export interface EdgeOut {
  phase: 'swim' | 'reach' | 'push' | 'swing' | 'stand';
  /** Seconds into the phase. */
  t: number;
  /** The place on the coping the swimmer comes out at, in the water. */
  edgeZ: number;
  /** +1 when the pool is at -z of the coping, -1 when it is at +z. */
  outward: 1 | -1;
}

/** Walking speed on the deck, metres a second. */
export const WALK_SPEED = 1.25;
/** The speed up of a walker in the rain. */
const HURRY_SPEED = 1.2;
/** The errands that are done outdoors: they end when it rains. */
const OUTDOOR_ERRANDS: ReadonlySet<ErrandKind> = new Set<ErrandKind>(['ballGame', 'pingPong', 'stroll', 'chat']);
/** Swimming speed before the character's own speed scale. */
export const SWIM_SPEED = 0.85;
/** How long the climb down or up the ladder takes. */
export const CLIMB_SECONDS = 1.6;
/** How long it takes to sit down on a lounger or get up from it. */
const SIT_SECONDS = 0.7;
/** How far one stride takes a character, per metre of its height. */
const STRIDE_PER_HEIGHT = 0.95;
import { HIP_BACK } from './world';
export { HIP_BACK };
/** The speed of a swimmer while it glides after an entry, as a factor. */
const GLIDE_SPEED = 1.3;
/** How far the walk round the edge goes up the wall when a swimmer gets out over it, in metres. */
const EDGE_OUT_WAIT_M = 3;
/** The chance, in percent, that a swimmer at a long wall gets out over the edge. */
const EDGE_OUT_PERCENT = 30;
/** The height of the diving board's bounce, and of the cannonball's jump, in metres. */
const BOUNCE_UP = 0.18;
const CANNONBALL_UP = 0.6;
/** How long an errand takes to get into the hot tub, and out of it, in seconds. */
const TUB_IN_S = 1.0;
const TUB_OUT_S = 1.0;
/** How long the errands that stay in place take to leave, in seconds. */
const LEAVE_S = 1.0;
/** When the kiosk's customer has the drink in hand, in seconds from the counter. */
const KIOSK_CARRY_S = 1.4;
/** The chance, in percent, that a customer at the kiosk takes an ice cream rather than a drink. */
const ICE_CREAM_PERCENT = 40;

export interface Body {
  readonly id: string;
  /** The height of the character, in metres. */
  readonly height: number;
  /** The height of its hip above its feet when it stands, in metres. */
  readonly hipHeight: number;
  /** The character's own speed, from its spec. */
  readonly speedScale: number;

  // What the backend wants.
  desired: Desired;
  lane: number;
  laneOffset: number;
  direction: 1 | -1;
  lounger: number | null;
  waiting: number | null;
  queue: number;
  exitTo: string;

  // Where it is. The feet, on the deck or in the water.
  x: number;
  y: number;
  z: number;
  /** The heading it wants, about y (0 is +z). */
  yaw: number;
  /** What the pose driver should be doing. */
  state: CharState;
  /** How far it walked in the last step, for the stride. */
  strideCycles: number;

  // Internal.
  inWater: boolean;
  goal: Goal | null;
  path: Vec2[];
  swim: SwimState | null;
  /** -1 going down the ladder, +1 coming up, 0 not on it. */
  climbing: -1 | 0 | 1;
  /** The ladder it is on, or making for. */
  ladder: number;
  climbT: number;
  /** True while it swims to a ladder to get out. */
  exitingWater: boolean;
  /** The lounger it sits on, and how far it has sat down (0 to 1). */
  seat: number | null;
  sitT: number;
  /** True once it has told the backend it walked out through the gate. */
  exited: boolean;

  // What it is doing, from the work the scene reads off its tool.
  /** The kind of work the agent is doing, as shown (after smoothing). */
  work: WorkKind;
  /** True while the agent's session waits for the person. */
  needsYou: boolean;
  /** For the read dive: seconds to the next dive, and the dive in progress (0..1, 0 none). */
  diveIn: number;
  diveT: number;
  /** How many dives the agent has made; the next one is timed from it. */
  dives: number;
  /** The stroke the work asks for, or null for the spec's own. */
  swimStyle: SwimStyle | null;
  /** Multiplies the stroke cadence the work asks for. */
  tempo: number;
  /** How much slower the swimmer is for having worked too long, 0 to 0.25. */
  fatigue: number;
  /** Seconds until a walker that is stopped by equipment may plan again. */
  replanIn: number;

  // The ways into the water (Sprint 24).
  /** The number from the id: the choices of this body follow it. */
  readonly seed: number;
  /** The entry in progress; null while the body walks and swims as usual. */
  entry: EntryState | null;
  /** How many ways into the water have been chosen; the next choice differs. */
  entriesMade: number;
  /** The way chosen for the walk to the water, or null before the choice. */
  pendingEntry: EntryKind | null;
  /** Where the walk for the chosen way ends, or null for the ladder. */
  entryAt: Vec2 | null;
  /** The way the debug hooks asked for: the next choice takes it. */
  forcedEntry: EntryKind | null;
  /** What happened that the scene shows; the scene empties it every frame. */
  events: BodyEvent[];
  /** How far the diving board is bent at the tip, set by the scene. */
  boardFlex: number;
  /** The glide after an entry: seconds left, its length and how deep it sinks. */
  glideLeft: number;
  glideTotal: number;
  glideSink: number;
  /** The speed factor of a race, 1 when the swimmer is not racing. */
  raceBoost: number;
  /** The swimmer this one is racing, or null. */
  racePartner: string | null;
  /** Seconds to tread water for, after a race is won. */
  celebrate: number;
  /** A way out over the edge of the pool; null for the ladder. */
  edgeOut: EdgeOut | null;

  // The errands (Sprint 25).
  /** The errand in progress, or null: the body is on its lounger or on its way. */
  errand: ErrandState | null;
  /** The scene time of the next errand; negative until the first sit-down sets it. */
  nextErrandAt: number;
  /** How many errands the body has finished or dropped; the next one differs. */
  errandsDone: number;
  /** The scene time the body last left the water, or null. */
  leftWaterAt: number | null;
  /** Seconds the body has sat on its lounger without a break. */
  seatedFor: number;
  /** The prop in the hand for an errand, or null. */
  carry: PropKind | null;
  /** Multiplies the walking speed: 0.75 on a stroll, 1 otherwise. */
  walkScale: number;
  /** True while it rains: a walker hurries, and the errands outdoors end. */
  hurry: boolean;
}

export function createBody(
  id: string,
  height: number,
  hipHeight: number,
  speedScale: number,
  at: Vec2,
): Body {
  return {
    id,
    height,
    hipHeight,
    speedScale,
    seed: hashOf(id),
    entry: null,
    entriesMade: 0,
    pendingEntry: null,
    entryAt: null,
    forcedEntry: null,
    events: [],
    boardFlex: 0,
    glideLeft: 0,
    glideTotal: 0,
    glideSink: 0,
    raceBoost: 1,
    racePartner: null,
    celebrate: 0,
    edgeOut: null,
    errand: null,
    nextErrandAt: -1,
    errandsDone: 0,
    leftWaterAt: null,
    seatedFor: 0,
    carry: null,
    walkScale: 1,
    hurry: false,
    desired: 'unknown',
    lane: 0,
    laneOffset: 0,
    direction: 1,
    lounger: null,
    waiting: null,
    queue: 0,
    exitTo: 'gate',
    x: at.x,
    y: 0,
    z: at.z,
    yaw: Math.PI,
    state: 'resting',
    strideCycles: 0,
    inWater: false,
    goal: null,
    path: [],
    swim: null,
    climbing: 0,
    ladder: 0,
    climbT: 0,
    exitingWater: false,
    seat: null,
    sitT: 0,
    exited: false,
    work: 'other',
    needsYou: false,
    diveIn: 6 + (hashOf(id) % 6),
    diveT: 0,
    dives: 0,
    swimStyle: null,
    tempo: 1,
    fatigue: 0,
    replanIn: 0,
  };
}

/**
 * Record what the backend wants.
 *
 * `freeWaiting` is asked for a free spot at the edge of the pool when the
 * backend hands out a lounger the deck does not have.
 */
export function applyPresentation(
  body: Body,
  presentation: AgentPresentation,
  world: World,
  freeWaiting: () => number | null,
  gateQueue: () => number,
): void {
  const mode = presentation.mode;
  const props = presentation.props;
  body.desired =
    mode === 'swim' ||
    mode === 'lounge' ||
    mode === 'waiting' ||
    mode === 'exiting' ||
    mode === 'leaving' ||
    mode === 'offscreen'
      ? mode
      : 'unknown';

  if (body.desired === 'swim') {
    body.lane = Math.max(0, Number(props.lane ?? 0) | 0);
    body.laneOffset = Number(props.lane_offset ?? 0) || 0;
    body.direction = Number(props.direction ?? 1) >= 0 ? 1 : -1;
    return;
  }

  if (body.desired === 'lounge') {
    const lounger = Number(props.lounger ?? -1);
    if (world.loungers[lounger]) {
      body.lounger = lounger;
      body.waiting = null;
      return;
    }
    // The deck has fewer loungers than the backend gave out: the agent
    // waits at the edge of the pool, or at the gate when that is full.
    body.desired = 'waiting';
    body.lounger = null;
    if (body.waiting === null) body.waiting = freeWaiting();
    body.queue = gateQueue();
    return;
  }

  if (body.desired === 'waiting') {
    const slot = Number(props.waiting ?? -1);
    body.lounger = null;
    if (slot >= 0 && world.waiting[slot]) {
      body.waiting = slot;
    } else {
      body.waiting = null;
      body.queue = Math.max(0, Number(props.queue ?? 0) | 0);
    }
    return;
  }

  if (body.desired === 'exiting') {
    body.exitTo = String(props.to ?? 'gate');
  }
}

/** The goal a body that is on the deck should be walking to. */
function deckGoal(body: Body, world: World, ctx: FlowContext): Goal | null {
  // A body that is no longer going in forgets the way it chose.
  if (body.desired !== 'swim') {
    body.pendingEntry = null;
    body.entryAt = null;
  }
  switch (body.desired) {
    case 'swim': {
      if (body.pendingEntry === null) chooseWay(body, world, ctx);
      if (body.pendingEntry === null || body.pendingEntry === 'ladder' || body.entryAt === null) {
        // Keep the ladder it chose, so it does not dither between two.
        if (body.goal?.kind === 'ladder') return body.goal;
        return { kind: 'ladder', index: chooseLadder(world, body, body, ctx, (l) => ladderTop(l)) };
      }
      return { kind: 'entry', x: body.entryAt.x, z: body.entryAt.z };
    }
    case 'lounge': {
      // On its way to an errand's place, the body walks there; a body that is
      // doing its errand stays where it is, and stepErrand has it.
      const e = body.errand;
      if (e !== null && (e.phase === 'going' || e.phase === 'queued')) {
        return { kind: 'errand', x: e.spot.x, z: e.spot.z };
      }
      return body.lounger === null ? null : { kind: 'lounger', index: body.lounger };
    }
    case 'waiting':
      return body.waiting === null
        ? { kind: 'queue', place: body.queue }
        : { kind: 'waiting', index: body.waiting };
    case 'exiting': {
      const match = /^lounger:(\d+)/.exec(body.exitTo);
      if (match) return { kind: 'lounger', index: Number(match[1]) };
      const wait = /^waiting:(\d+)/.exec(body.exitTo);
      if (wait) return { kind: 'waiting', index: Number(wait[1]) };
      return { kind: 'gate' };
    }
    case 'leaving':
      return { kind: 'gate' };
    default:
      return null;
  }
}

/**
 * Choose the way into the water, once, when the walk to it starts.
 *
 * The choice is kept in `pendingEntry`, and the walk goes to its approach.
 * Only the body's own entries count towards the next choice.
 */
function chooseWay(body: Body, world: World, ctx: FlowContext): void {
  let kind: EntryKind = 'ladder';
  if (body.forcedEntry !== null) {
    kind = body.forcedEntry;
    body.forcedEntry = null;
  } else if (ctx.entries) {
    kind = chooseEntry(body, world, ctx.entries.busy(body), ctx.entries.reducedMotion);
  }
  body.entriesMade += 1;
  const at = entryApproach(world, kind, body);
  body.pendingEntry = at === null ? 'ladder' : kind;
  body.entryAt = at;
}

function sameGoal(a: Goal | null, b: Goal | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'entry' && b.kind === 'entry') return a.x === b.x && a.z === b.z;
  if (a.kind === 'errand' && b.kind === 'errand') return a.x === b.x && a.z === b.z;
  if (a.kind === 'lounger' && b.kind === 'lounger') return a.index === b.index;
  if (a.kind === 'waiting' && b.kind === 'waiting') return a.index === b.index;
  if (a.kind === 'queue' && b.kind === 'queue') return a.place === b.place;
  if (a.kind === 'ladder' && b.kind === 'ladder') return a.index === b.index;
  return true;
}

function goalPoint(world: World, goal: Goal): Vec2 {
  switch (goal.kind) {
    case 'entry':
    case 'errand':
      return { x: goal.x, z: goal.z };
    case 'ladder':
      return ladderTop(world.ladders[goal.index] ?? world.ladders[0]);
    case 'lounger': {
      const lounger = world.loungers[goal.index] ?? world.loungers[0];
      return lounger ? loungerApproach(lounger) : world.gate;
    }
    case 'waiting':
      return world.waiting[goal.index] ?? world.gate;
    case 'queue':
      return queueSpot(world, goal.place);
    case 'gate':
      return world.gate;
  }
}

/**
 * The way from one point to another: round the pool, and through the gate
 * when one of the two is outside the fence.
 */
export function route(world: World, from: Vec2, to: Vec2): Vec2[] {
  const fromIn = insideFence(world, from);
  const toIn = insideFence(world, to);
  if (fromIn && toIn) return planPath(world, from, to);
  const gateIn = { x: world.gate.x, z: world.gate.z };
  const gateOut = gateOutside(world);
  if (!fromIn && toIn) return [gateOut, gateIn, ...planPath(world, gateIn, to)];
  if (fromIn && !toIn) return [...planPath(world, from, gateIn), gateOut, { x: to.x, z: to.z }];
  return [{ x: to.x, z: to.z }];
}

/** The yaw that looks from `a` towards `b`. */
function yawTowards(a: Vec2, b: Vec2): number {
  return Math.atan2(b.x - a.x, b.z - a.z);
}

export interface FlowContext {
  /** The character walked out through the gate. Called once. */
  exited(id: string): void;
  /**
   * The ways into the water: what is busy, and whether reduced motion
   * forces the ladder. Without it every swimmer takes the ladder, as it did
   * before the entries.
   */
  entries?: { busy(self: Body): EntryBusy; reducedMotion: boolean };
  /** How many other bodies are on this ladder or making for it. */
  ladderLoad(index: number, self: Body): number;
  /**
   * How far ahead the nearest swimmer is that swims the same way in the
   * same lane, in metres; Infinity when there is none.
   */
  swimGap?(self: Body): number;
  /**
   * The errands: the slots they hold, the clock, and the other bodies (the
   * partners of a group errand). Without it no body goes on an errand.
   */
  errands?: ErrandContext;
}

/**
 * Put a body straight where the backend wants it, without the walk there.
 *
 * For the agents that are already in the pool when the page opens: a
 * swimmer that has been swimming for hours used to walk in through the
 * gate again after every reload.
 */
export function settle(body: Body, world: World): void {
  const h = hashOf(body.id);
  if (body.desired === 'swim') {
    const dir: 1 | -1 = body.direction;
    const span = world.pool.maxX - world.pool.minX - body.height * 2.6;
    const x = world.pool.minX + body.height * 1.3 + (h % 1000) / 1000 * span;
    body.swim = startSwim(x, swimZ(world, body.lane, body.laneOffset, dir), dir);
    body.inWater = true;
    body.state = 'swimming';
    body.yaw = body.swim.yaw;
    const half = body.height * 0.5;
    body.x = body.swim.x - Math.sin(body.swim.yaw) * half;
    body.z = body.swim.z - Math.cos(body.swim.yaw) * half;
    body.y = world.waterY - 0.06;
    return;
  }
  if (body.desired === 'lounge' && body.lounger !== null && world.loungers[body.lounger]) {
    const lounger = world.loungers[body.lounger];
    body.seat = body.lounger;
    body.sitT = 1;
    placeOnSeat(body, world, body.lounger);
    body.yaw = Math.atan2(lounger.facing.x, lounger.facing.z);
    body.state = 'lounging';
    return;
  }
  if (body.desired === 'waiting') {
    const spot = body.waiting !== null ? world.waiting[body.waiting] : queueSpot(world, body.queue);
    if (spot) {
      body.x = spot.x;
      body.z = spot.z;
      body.y = 0;
      body.goal = body.waiting !== null ? { kind: 'waiting', index: body.waiting } : { kind: 'queue', place: body.queue };
      body.path = [];
      body.yaw = yawTowards(body, { x: (world.pool.minX + world.pool.maxX) / 2, z: 0 });
      body.state = 'resting';
      // The spots on the coping: the feet are in the water.
      if (body.waiting !== null && world.waiting[body.waiting]?.edge) sitOnEdge(body);
    }
  }
}

function hashOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The ladder to use: the nearest one, counting a body already on it or
 * making for it as a few metres more of walking.
 */
function chooseLadder(
  world: World,
  from: Vec2,
  body: Body,
  ctx: FlowContext,
  point: (l: Ladder) => Vec2,
): number {
  let best = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const ladder of world.ladders) {
    const p = point(ladder);
    const cost = Math.hypot(p.x - from.x, p.z - from.z) + 4 * ctx.ladderLoad(ladder.index, body);
    if (cost < bestCost) {
      bestCost = cost;
      best = ladder.index;
    }
  }
  return best;
}

/** True when another body is on this ladder right now. */
export function ladderBusy(bodies: Iterable<Body>, index: number, self: Body): boolean {
  for (const other of bodies) {
    if (other !== self && other.climbing !== 0 && other.ladder === index) return true;
  }
  return false;
}

/** How many other bodies are on a ladder or making for it. */
export function ladderLoad(bodies: Iterable<Body>, index: number, self: Body): number {
  let n = 0;
  for (const other of bodies) {
    if (other === self) continue;
    // A body walking to a ladder has not stepped on it yet, so its
    // \`ladder\` is still the old one: the goal says where it is going. All
    // of a crowd used to choose the ladder nearest the gate.
    if (other.goal?.kind === 'ladder') {
      if (other.goal.index === index) n += 1;
      continue;
    }
    if (other.ladder !== index) continue;
    if (other.climbing !== 0 || (other.inWater && other.desired !== 'swim')) n += 1;
  }
  return n;
}

/** How close a body has to come to a corner of its way to go on to the next. */
const WAYPOINT_REACH = 0.7;

/**
 * How close a walker may come to equipment. The planned paths keep 0.5 m
 * off it; a step that would come nearer than this is pushed back to this
 * distance, so the walker never reaches the edge of a piece of equipment.
 */
const EQUIPMENT_CLEARANCE = 0.12;

/** True when a point is inside obstacle `index`, grown by `by`. */
function insideObstacle(world: World, index: number, x: number, z: number, by: number): boolean {
  const a = world.obstacles[index].area;
  return x > a.minX - by && x < a.maxX + by && z > a.minZ - by && z < a.maxZ + by;
}

/** Where a step that comes too near the equipment is put instead. */
const pushed = { x: 0, z: 0 };

/**
 * Keep a step off the equipment, and say whether it was possible.
 *
 * A step that would bring a walker into a piece of equipment's margin is
 * pushed back out of it, on the side it is nearest to, so a walker walking
 * along a piece slides along it instead of stopping dead against it. The
 * point the step ends at is left in `pushed`. Returns false when the push
 * does not clear every piece (a walker in a corner): the step is refused.
 *
 * The pool is the first obstacle and keeps its own handling, so it is
 * left out. A walker that already stands inside a margin is not pushed: it
 * may walk out of it, and it is not made to walk further in.
 */
function clearOfEquipment(world: World, fromX: number, fromZ: number, x: number, z: number): boolean {
  pushed.x = x;
  pushed.z = z;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 1; i < world.obstacles.length; i += 1) {
      if (!insideObstacle(world, i, pushed.x, pushed.z, EQUIPMENT_CLEARANCE)) continue;
      if (insideObstacle(world, i, fromX, fromZ, EQUIPMENT_CLEARANCE)) continue;
      const a = world.obstacles[i].area;
      const left = pushed.x - (a.minX - EQUIPMENT_CLEARANCE);
      const right = a.maxX + EQUIPMENT_CLEARANCE - pushed.x;
      const down = pushed.z - (a.minZ - EQUIPMENT_CLEARANCE);
      const up = a.maxZ + EQUIPMENT_CLEARANCE - pushed.z;
      const least = Math.min(left, right, down, up);
      if (least === left) pushed.x = a.minX - EQUIPMENT_CLEARANCE;
      else if (least === right) pushed.x = a.maxX + EQUIPMENT_CLEARANCE;
      else if (least === down) pushed.z = a.minZ - EQUIPMENT_CLEARANCE;
      else pushed.z = a.maxZ + EQUIPMENT_CLEARANCE;
    }
  }
  for (let i = 1; i < world.obstacles.length; i += 1) {
    if (!insideObstacle(world, i, pushed.x, pushed.z, EQUIPMENT_CLEARANCE)) continue;
    if (!insideObstacle(world, i, fromX, fromZ, EQUIPMENT_CLEARANCE)) return false;
  }
  return true;
}

/** The radius in which a body at the top of a ladder may step onto it. */
const LADDER_REACH = 0.6;

/**
 * Bring a body one frame further.
 *
 * @param others The other bodies, for keeping out of each other's way.
 */
export function stepBody(
  body: Body,
  world: World,
  dt: number,
  others: readonly Walker[],
  ctx: FlowContext,
  busy: (index: number) => boolean = () => false,
): void {
  body.strideCycles = 0;

  // An errand never hides work: the moment the agent wants anything but the
  // lounger, or its session needs the person, the errand is dropped (a body in
  // the hot tub climbs out first).
  if (body.errand !== null && (body.desired !== 'lounge' || body.needsYou || (body.hurry && OUTDOOR_ERRANDS.has(body.errand.kind)))) {
    abortErrand(body, ctx);
  }

  // --- on the ladder ---------------------------------------------------
  if (body.climbing !== 0) {
    stepClimb(body, world, dt, ctx);
    return;
  }

  // --- an entry in progress: the block, the board, the slide, the cannonball
  if (body.entry !== null) {
    stepEntry(body, world, dt, ctx);
    return;
  }

  // --- out over the edge of the pool ------------------------------------
  if (body.edgeOut !== null) {
    stepEdgeOut(body, world, dt, ctx);
    return;
  }

  // --- in the water ----------------------------------------------------
  if (body.inWater) {
    stepWater(body, world, dt, ctx, busy);
    return;
  }

  // --- not in the water --------------------------------------------------
  // The stroke is only asked for by a swimmer; the next one asks again.
  body.swimStyle = null;
  body.tempo = 1;

  // --- on a lounger ----------------------------------------------------
  if (body.seat !== null) {
    // An errand lets go of the lounger, except the sunscreen, which is put on
    // lying down.
    const onLounger = body.errand === null || body.errand.kind === 'sunscreen';
    const stay = body.desired === 'lounge' && body.lounger === body.seat && onLounger;
    const lounger = world.loungers[body.seat];
    if (stay && lounger) {
      body.sitT = Math.min(1, body.sitT + dt / SIT_SECONDS);
      body.seatedFor += dt;
      placeOnSeat(body, world, body.seat);
      body.state = body.sitT >= 1 ? lounging(body) : 'lounging';
      if (body.errand !== null) tickSunscreen(body, dt, ctx);
      return;
    }
    // Get up, and then walk wherever it is going next.
    body.sitT = Math.max(0, body.sitT - dt / SIT_SECONDS);
    if (lounger) placeOnSeat(body, world, body.seat);
    body.state = 'resting';
    if (body.sitT > 0) return;
    const foot = lounger ? loungerApproach(lounger) : { x: body.x, z: body.z };
    body.x = foot.x;
    body.z = foot.z;
    body.y = 0;
    body.seat = null;
    body.goal = null;
  }

  // --- on the deck -----------------------------------------------------
  body.seatedFor = 0;
  // A drink that was never drunk (the errand was dropped on the way back)
  // goes back where it came from.
  if (body.carry !== null && body.errand === null && body.desired !== 'lounge') body.carry = null;
  // An errand in its place (the hot tub, the shower, the table) is done by
  // stepErrand, and the walk back is the usual goal.
  if (body.errand !== null && stepErrand(body, world, dt, ctx)) return;

  const goal = deckGoal(body, world, ctx);
  if (goal === null) {
    body.state = 'resting';
    body.path = [];
    body.goal = null;
    return;
  }
  if (!sameGoal(goal, body.goal)) {
    body.goal = goal;
    body.path = route(world, body, goalPoint(world, goal));
  }

  // At a ladder, the top is reached from a step or two away, and only
  // when nobody else is on it: a crowd at the top used to stand round it
  // for ever, each waiting for the other to move.
  if (goal.kind === 'ladder') {
    const top = goalPoint(world, goal);
    if (Math.hypot(top.x - body.x, top.z - body.z) < LADDER_REACH) {
      body.path = [];
      if (busy(goal.index)) {
        body.state = 'resting';
        return;
      }
      arrive(body, world, goal, ctx);
      return;
    }
  }

  const next = body.path[0];
  if (!next) {
    if (goal.kind === 'ladder' && busy(goal.index)) {
      body.state = 'resting';
      return;
    }
    arrive(body, world, goal, ctx);
    return;
  }

  const self: Walker = { id: body.id, x: body.x, z: body.z, moving: true };
  const speed = WALK_SPEED * (0.9 + 0.2 * body.speedScale) * body.walkScale * (body.hurry ? HURRY_SPEED : 1);
  const step = steer(self, next, speed, dt, others);
  // Equipment is never walked into. A step that would is pushed out of it;
  // if no push clears it, the walker slides along the equipment, one axis at
  // a time, and only when that fails too is the step refused, the legs stop,
  // and a walker that stays stuck plans its way again, at most once a second.
  // (A walker pressed against a face, heading into it, used to be pushed
  // back to the same spot for ever: the slide lets it go along the face.)
  const clear =
    clearOfEquipment(world, body.x, body.z, step.x, step.z) ||
    clearOfEquipment(world, body.x, body.z, step.x, body.z) ||
    clearOfEquipment(world, body.x, body.z, body.x, step.z);
  if (!clear) {
    body.state = 'resting';
    body.replanIn -= dt;
    if (body.replanIn <= 0) {
      body.replanIn = 1;
      body.path = [];
      body.goal = null;
    }
    return;
  }
  if (pushed.x !== step.x || pushed.z !== step.z) {
    step.x = pushed.x;
    step.z = pushed.z;
    step.covered = Math.hypot(step.x - body.x, step.z - body.z);
  }
  body.x = step.x;
  body.z = step.z;
  body.y = 0;
  if (Number.isFinite(step.heading) && step.covered > 1e-4) {
    body.yaw = normaliseNear(step.heading, body.yaw);
  }
  // The stride follows the ground covered: a character that is held up by
  // another one stops walking its legs.
  body.strideCycles = step.covered / (body.height * STRIDE_PER_HEIGHT);
  body.state = step.covered > 1e-4 ? 'walking' : 'resting';

  // Somebody stands on the very spot it was going to: it stops next to
  // them, and that is where it has arrived.
  if (step.taken && body.path.length === 1 && goal.kind !== 'ladder') {
    body.path = [];
    body.state = 'resting';
    arrive(body, world, goal, ctx);
    return;
  }

  // A corner on the way is passed, not stood on: a crowd that all had to
  // stand on the point outside the gate could never get past it.
  // A corner is passed on the way round it only when the walk on from here
  // keeps the margins: a walker that cut the corner of a piece of equipment
  // was pushed back against its face, and could stay there for minutes.
  const reach = body.path.length > 1 ? WAYPOINT_REACH : 0.06;
  const cutsCorner = body.path.length > 1 && !clearSegment(world, body, body.path[1]);
  if (Math.hypot(next.x - body.x, next.z - body.z) < reach && !cutsCorner) {
    body.path.shift();
    if (body.path.length === 0 && !(goal.kind === 'ladder' && busy(goal.index))) {
      arrive(body, world, goal, ctx);
    }
  }
}

/** How long the read dive takes, in seconds. */
const DIVE_SECONDS = 2.8;
/** The deepest a dive goes below the water, at most, in metres. */
const DIVE_MAX_SINK = 0.75;

/** What a swimmer does while it does one kind of work. */
export interface WaterPlan {
  /** The stroke, or null for the spec's own. */
  style: SwimStyle | null;
  /** Multiplies the stroke cadence. */
  tempo: number;
  /** Multiplies the swimming speed. */
  speed: number;
  options: SwimOptions;
}

/** A swimmer with nothing to say for itself swims as it always did. */
const OWN_STROKE: WaterPlan = { style: null, tempo: 1, speed: 1, options: { rest: true } };

/** The swimmer that has just won a race treads water for a while. */
const TREAD_WIN: WaterPlan = { style: null, tempo: 1, speed: 1, options: { hold: true } };

/**
 * The stroke, the speed and the options for each kind of work.
 *
 * A sprint is a crawl at a faster tempo; reading is a breaststroke that
 * dives now and then; a delegating session holds still, treading water,
 * until its sub-agent is done.
 */
const PLAN_BY_WORK: Record<WorkKind, WaterPlan> = {
  // A run flips at every wall; an edit flips at every other one.
  run: { style: 'crawl', tempo: 1.3, speed: 1.4, options: { flip: 'always', rest: true } },
  edit: { style: 'butterfly', tempo: 1, speed: 1, options: { flip: 'alternate', rest: true } },
  read: { style: 'breaststroke', tempo: 1, speed: 0.6, options: { rest: true } },
  web: { style: 'backstroke', tempo: 1, speed: 0.8, options: { rest: true } },
  delegate: { style: null, tempo: 1, speed: 1, options: { hold: true } },
  plan: { style: 'float', tempo: 1, speed: 0.15, options: { rest: true } },
  other: OWN_STROKE,
};

/** A session that waits for the person swims to the wall and holds there. */
const ASK_FOR_YOU: WaterPlan = { style: null, tempo: 1, speed: 1, options: { stopAtWall: true } };

/** The plan for a swimmer doing this work, and whether its session waits. */
export function waterPlan(work: WorkKind, needsYou: boolean): WaterPlan {
  if (needsYou) return ASK_FOR_YOU;
  return PLAN_BY_WORK[work] ?? OWN_STROKE;
}

/** The lounging state, or the activity once the driver has started one. */
function lounging(body: Body): CharState {
  return body.state === 'activity' ? 'activity' : 'lounging';
}

/** What happens at the end of a walk. */
function arrive(body: Body, world: World, goal: Goal, ctx: FlowContext): void {
  switch (goal.kind) {
    case 'entry':
      startEntry(body, world, ctx);
      return;
    case 'errand':
      arriveErrand(body, ctx);
      return;
    case 'ladder': {
      // Climb down into the water, facing the wall.
      body.pendingEntry = null;
      body.entryAt = null;
      const ladder = world.ladders[goal.index] ?? world.ladders[0];
      body.ladder = ladder.index;
      body.climbing = -1;
      body.climbT = 0;
      body.state = 'climbing';
      const top = ladderTop(ladder);
      body.x = top.x;
      body.z = top.z;
      body.yaw = normaliseNear(yawTowards(ladderFoot(ladder), top), body.yaw);
      body.goal = null;
      return;
    }
    case 'lounger': {
      if (body.desired === 'lounge' && body.lounger === goal.index) {
        body.seat = goal.index;
        body.sitT = 0;
        body.state = 'lounging';
        const lounger = world.loungers[goal.index];
        if (lounger) {
          body.yaw = normaliseNear(Math.atan2(lounger.facing.x, lounger.facing.z), body.yaw);
        }
        // A customer of the kiosk sits down with the drink, and drinks it.
        if (body.carry === 'icecream' || body.carry === 'bottle') {
          body.events.push({ name: `drink:${body.carry}`, x: lounger?.x ?? body.x, z: lounger?.z ?? body.z });
          body.carry = null;
        }
        return;
      }
      body.state = 'resting';
      return;
    }
    case 'waiting':
    case 'queue': {
      // Wait looking at the pool.
      body.state = 'resting';
      body.yaw = normaliseNear(
        yawTowards(body, { x: (world.pool.minX + world.pool.maxX) / 2, z: 0 }),
        body.yaw,
      );
      if (goal.kind === 'waiting' && world.waiting[goal.index]?.edge) sitOnEdge(body);
      return;
    }
    case 'gate': {
      body.state = 'resting';
      if (!body.exited && (body.desired === 'leaving' || body.desired === 'exiting')) {
        body.exited = true;
        ctx.exited(body.id);
      }
      return;
    }
  }
}

/**
 * Sit on a lounger: the hips go onto the seat, at the back of it.
 *
 * The lounge pose leans the body back and lays the thighs along the seat,
 * so the feet end up in front of the hips; the root of the figure is at its
 * feet in the standing pose, which is straight under the hips.
 */
function placeOnSeat(body: Body, world: World, index: number): void {
  const lounger = world.loungers[index];
  if (!lounger) return;
  const foot = loungerApproach(lounger);
  // The hips sit a fifth of the way from the back of the lounger.
  const hipX = lounger.x - lounger.facing.x * lounger.length * HIP_BACK;
  const hipZ = lounger.z - lounger.facing.z * lounger.length * HIP_BACK;
  const seatY = lounger.seatHeight - body.hipHeight;
  const s = body.sitT * body.sitT * (3 - 2 * body.sitT);
  body.x = foot.x + (hipX - foot.x) * s;
  body.z = foot.z + (hipZ - foot.z) * s;
  // Up onto the seat: the root goes down by the length of the leg less
  // the height of the seat, because the hip goes onto the seat.
  body.y = seatY * s;
}

function stepClimb(body: Body, world: World, dt: number, ctx: FlowContext): void {
  body.state = 'climbing';
  body.climbT = Math.min(1, body.climbT + dt / CLIMB_SECONDS);
  const ladder = world.ladders[body.ladder] ?? world.ladders[0];
  const top = ladderTop(ladder);
  const foot = ladderFoot(ladder);
  // Going down, u runs from the top to the foot; coming up, the other way.
  const u = body.climbing < 0 ? body.climbT : 1 - body.climbT;
  // Over the edge first, then down: the path bends at the coping.
  const over = Math.min(1, u / 0.35);
  const down = Math.max(0, (u - 0.35) / 0.65);
  body.x = top.x + (foot.x - top.x) * over;
  body.z = top.z + (foot.z - top.z) * over;
  body.y = (world.waterY - body.hipHeight * 1.15) * down;

  if (body.climbT < 1) return;
  if (body.climbing < 0) {
    // In the water: push off away from the wall.
    body.climbing = 0;
    body.inWater = true;
    const dir: 1 | -1 = foot.x > (world.pool.minX + world.pool.maxX) / 2 ? -1 : 1;
    body.swim = startSwim(foot.x, foot.z, dir);
    body.swim.yaw = normaliseNear(body.swim.yaw, body.yaw);
    body.swim.turnFrom = body.swim.yaw;
    body.state = 'swimming';
  } else {
    // Out on the deck.
    body.climbing = 0;
    body.inWater = false;
    body.swim = null;
    body.x = top.x;
    body.z = top.z;
    body.y = 0;
    body.goal = null;
    body.state = 'resting';
    markLeftWater(body, ctx);
  }
}

/** A waiting body on the coping: the hips on the coping, the feet in the water. */
function sitOnEdge(body: Body): void {
  body.state = 'edgeSitting';
  body.y = -body.hipHeight + 0.05;
}

function stepWater(
  body: Body,
  world: World,
  dt: number,
  ctx: FlowContext,
  busy: (index: number) => boolean,
): void {
  const swim = body.swim ?? (body.swim = startSwim(body.x, body.z, body.direction, body.seed));
  if (body.glideLeft > 0) body.glideLeft = Math.max(0, body.glideLeft - dt);
  // A racer that reaches the wall first has won: the scene is told at once,
  // and the race is over for this swimmer.
  if (swim.turning > 0 && body.raceBoost > 1) {
    body.raceBoost = 1;
    body.events.push({ name: 'race:wall', x: swim.x, z: swim.z });
  }

  if (body.desired === 'swim') {
    body.exitingWater = false;
    const won = body.celebrate > 0;
    if (won) body.celebrate = Math.max(0, body.celebrate - dt);
    const plan = won ? TREAD_WIN : waterPlan(body.work, body.needsYou);
    body.swimStyle = plan.style;
    body.tempo = plan.tempo;
    // Somebody slower ahead in the lane: drop in behind them instead of
    // swimming through them.
    const gap = swim.turning > 0 ? Number.POSITIVE_INFINITY : (ctx.swimGap?.(body) ?? Number.POSITIVE_INFINITY);
    const follow = Math.max(0.3, Math.min(1, (gap - body.height * 1.15) / 1.2));
    const glide = body.glideLeft > 0 ? GLIDE_SPEED : 1;
    const speed =
      SWIM_SPEED * body.speedScale * plan.speed * (1 - body.fatigue) * follow * glide * body.raceBoost;
    swimStep(swim, world, swimZ(world, body.lane, body.laneOffset, swim.dir), speed, body.height, dt, plan.options);
    // Treading water: held still with the chest at the surface.
    const treading =
      plan.options.hold === true || (plan.options.stopAtWall === true && swim.holding) || swim.resting > 0;
    body.state = treading ? 'treading' : 'swimming';
    stepDive(body, swim, dt);
  } else {
    // Anything else starts with getting out: swim to a ladder and climb, or,
    // at a long wall and now and then, out over the edge.
    if (!body.exitingWater) {
      body.exitingWater = true;
      body.ladder = chooseLadder(world, swim, body, ctx, (l) => ladderFoot(l));
      if (chooseEdgeOut(body, world, swim)) {
        const outward: 1 | -1 = body.lane === 0 ? 1 : -1;
        body.edgeOut = {
          phase: 'swim',
          t: 0,
          edgeZ: outward > 0 ? world.pool.maxZ : world.pool.minZ,
          outward,
        };
        body.exitingWater = false;
        swim.holding = false;
        swim.resting = 0;
        return;
      }
    }
    body.swimStyle = null;
    body.tempo = 1;
    body.diveT = 0;
    swim.holding = false;
    swim.resting = 0;
    const ladder = world.ladders[body.ladder] ?? world.ladders[0];
    const foot = ladderFoot(ladder);
    const speed = SWIM_SPEED * body.speedScale * (1 - body.fatigue);
    const arrived = swimToward(swim, foot.x, foot.z, speed, dt);
    body.state = 'swimming';
    if (arrived && !busy(ladder.index)) {
      body.exitingWater = false;
      body.climbing = 1;
      body.climbT = 0;
      body.state = 'climbing';
      body.yaw = normaliseNear(yawTowards(foot, ladderTop(ladder)), swim.yaw);
      body.x = foot.x;
      body.z = foot.z;
      return;
    }
  }

  body.yaw = swim.yaw;
  if (body.state === 'treading') {
    // The chest is at the waterline and the figure stands upright, the way
    // a swimmer treads water.
    body.x = swim.x;
    body.z = swim.z;
    body.y = world.waterY - body.height * 0.62;
    return;
  }
  // The swimmer lies along its heading with its feet at the root, so the
  // root is half a body behind the middle of the swimmer.
  const half = body.height * 0.5;
  body.x = swim.x - Math.sin(swim.yaw) * half;
  body.z = swim.z - Math.cos(swim.yaw) * half;
  let sink = body.diveT > 0 ? diveSink(world, swim.x, body.diveT) : 0;
  // The glide after an entry sinks the swimmer a little, and comes up again.
  if (body.glideLeft > 0) {
    const u = 1 - body.glideLeft / body.glideTotal;
    sink = Math.max(sink, body.glideSink * Math.sin(Math.PI * u));
  }
  // A flip turn dips the swimmer under the water as it rolls.
  if (swim.turning > 0 && swim.turnKind === 'flip') {
    const u = 1 - swim.turning / TURN_SECONDS;
    sink = Math.max(sink, FLIP_DIP * Math.sin(Math.PI * u));
  }
  body.y = world.waterY - 0.06 - sink;
}

/** How deep a flip turn takes the swimmer, in metres. */
const FLIP_DIP = 0.3;

/**
 * Whether a swimmer that gets out goes over the edge rather than to a ladder.
 *
 * Only in the two outside lanes, which are at the long walls, and only when
 * no ladder is within three metres of it. Then, with a seeded 30 per cent
 * chance, it does.
 */
function chooseEdgeOut(body: Body, world: World, swim: SwimState): boolean {
  if (body.lane !== 0 && body.lane !== world.lanes.length - 1) return false;
  let nearest = Number.POSITIVE_INFINITY;
  for (const ladder of world.ladders) {
    const foot = ladderFoot(ladder);
    nearest = Math.min(nearest, Math.hypot(foot.x - swim.x, foot.z - swim.z));
  }
  if (nearest < EDGE_OUT_WAIT_M) return false;
  return hashOf(`${body.id}#edge#${body.entriesMade}`) % 100 < EDGE_OUT_PERCENT;
}

/**
 * Getting out over the edge: swim to the wall next to the swimmer, hang on
 * the coping, push up to sit on the edge, swing the legs out and stand up on
 * the deck. The timings are the plan's.
 */
function stepEdgeOut(body: Body, world: World, dt: number, ctx: FlowContext): void {
  const out = body.edgeOut as EdgeOut;
  const sitY = -body.hipHeight + 0.05;
  const poolYaw = out.outward > 0 ? Math.PI : 0;
  const awayYaw = out.outward > 0 ? 0 : Math.PI;
  const wallZ = out.edgeZ - out.outward * EDGE_WALL_M;
  const sitZ = out.edgeZ + out.outward * 0.15;
  const deckZ = out.edgeZ + out.outward * 0.8;
  out.t += dt;
  const u = (length: number) => Math.min(1, out.t / length);
  const next = (phase: EdgeOut['phase']) => {
    out.phase = phase;
    out.t = 0;
  };

  if (out.phase === 'swim') {
    const swim = body.swim ?? (body.swim = startSwim(body.x, body.z, body.direction, body.seed));
    const speed = SWIM_SPEED * body.speedScale * (1 - body.fatigue);
    const arrived = swimToward(swim, swim.x, wallZ, speed, dt);
    body.state = 'swimming';
    body.x = swim.x;
    body.z = swim.z;
    body.y = world.waterY - 0.06;
    body.yaw = normaliseNear(poolYaw, body.yaw);
    if (arrived) next('reach');
    return;
  }
  if (out.phase === 'reach') {
    const swim = body.swim;
    if (swim) {
      body.x = swim.x;
      body.z = swim.z;
    }
    body.state = 'treading';
    body.y = world.waterY - body.height * 0.62;
    body.yaw = normaliseNear(poolYaw, body.yaw);
    if (u(0.4) >= 1) {
      // Out of the water: the body is on the coping from now on.
      body.inWater = false;
      body.swim = null;
      body.state = 'resting';
      body.events.push({ name: 'splash:small', x: body.x, z: wallZ });
      body.events.push({ name: 'drip', x: body.x, z: wallZ });
      next('push');
    }
    return;
  }
  if (out.phase === 'push') {
    const s = smoothStep(u(1.0));
    body.state = 'resting';
    body.z = wallZ + (sitZ - wallZ) * s;
    body.y = (world.waterY - 0.9) + (sitY - (world.waterY - 0.9)) * s;
    body.yaw = normaliseNear(poolYaw, body.yaw);
    if (out.t >= 1) next('swing');
    return;
  }
  if (out.phase === 'swing') {
    const s = smoothStep(u(0.6));
    body.state = 'edgeSitting';
    body.z = sitZ;
    body.y = sitY;
    body.yaw = normaliseNear(poolYaw + (awayYaw - poolYaw) * s, body.yaw);
    if (out.t >= 0.6) next('stand');
    return;
  }
  // stand
  const s = smoothStep(u(0.6));
  body.state = 'resting';
  body.z = sitZ + (deckZ - sitZ) * s;
  body.y = sitY * (1 - s);
  body.yaw = normaliseNear(awayYaw, body.yaw);
  if (out.t >= 0.6) {
    body.edgeOut = null;
    body.exitingWater = false;
    body.y = 0;
    body.z = deckZ;
    body.goal = null;
    body.path = [];
    body.state = 'resting';
    markLeftWater(body, ctx);
  }
}

/** How far a swimmer that gets out over the edge stops from the coping, in metres. */
const EDGE_WALL_M = 0.3;

function smoothStep(u: number): number {
  return u * u * (3 - 2 * u);
}

// --- the ways into the water ----------------------------------------------

/** The glide under the water after a dive or a jump: seconds, and how deep. */
const GLIDE_SECONDS = 0.9;

/** The phases of each kind; the first is where the entry starts. */
function firstPhase(kind: EntryKind, waits: boolean): string {
  switch (kind) {
    case 'block':
      return 'step-up';
    case 'board':
      return 'climb';
    case 'slide':
      return waits ? 'wait' : 'stairs';
    case 'cannonball':
      return 'run-up';
    default:
      return 'step-up';
  }
}

/** The phases an entry may be given up in, before the body has left the deck. */
function abortable(e: EntryState): boolean {
  switch (e.kind) {
    case 'block':
      return e.phase === 'step-up' || e.phase === 'ready';
    case 'board':
      return e.phase === 'climb' || e.phase === 'walk' || e.phase === 'bounce';
    case 'slide':
      return e.phase === 'wait' || e.phase === 'stairs' || e.phase === 'sit';
    case 'cannonball':
      return e.phase === 'run-up';
    default:
      return false;
  }
}

/** The way an entry starts, when the body reaches its approach. */
function startEntry(body: Body, world: World, ctx: FlowContext): void {
  const kind = body.pendingEntry;
  const at = body.entryAt;
  if (kind === null || kind === 'ladder' || at === null) {
    takeLadder(body);
    return;
  }
  const busy = ctx.entries?.busy(body);
  // The slide takes one rider at a time: the others wait at the foot of the
  // stairs. The other ways are checked again, and the ladder is taken if one
  // has become busy since the choice.
  if (kind !== 'slide' && busy && !entryOpen(kind, body, world, busy)) {
    takeLadder(body);
    return;
  }
  const splash = entrySplash(world, kind, body.lane, at);
  body.entry = {
    kind,
    phase: firstPhase(kind, busy?.slide === true),
    t: 0,
    splash,
    dir: swimDirAfter(world, splash),
    origin: { x: body.x, z: body.z },
    from: { x: body.x, y: body.y, z: body.z },
  };
  body.path = [];
  body.goal = null;
  body.yaw = normaliseNear(facingFor(kind, body.lane), body.yaw);
}

/** Where a body faces when it starts the entry. */
function facingFor(kind: EntryKind, lane: number): number {
  switch (kind) {
    case 'block':
      return Math.PI / 2;
    case 'board':
      return -Math.PI / 2;
    case 'slide':
      return Math.PI;
    case 'cannonball':
      return lane === 0 ? Math.PI : 0;
    default:
      return 0;
  }
}

/** Give up the way, and go to the ladder instead. */
function takeLadder(body: Body): void {
  body.pendingEntry = 'ladder';
  body.entryAt = null;
  body.goal = null;
  body.path = [];
  body.state = 'resting';
}

/** Forget the entry: the body is on the deck, and walks on as usual. */
function clearEntry(body: Body): void {
  body.entry = null;
  body.pendingEntry = null;
  body.entryAt = null;
  body.y = 0;
  body.goal = null;
  body.path = [];
  body.state = 'resting';
}

/** Advance an entry's clock; returns the progress of the phase, 0 to 1. */
function clock(e: EntryState, dt: number, length: number): number {
  e.t += dt;
  return Math.min(1, e.t / length);
}

function nextPhase(e: EntryState, phase: string): void {
  e.phase = phase;
  e.t = 0;
}

/**
 * The walk back to the deck, after an entry was given up while the body was
 * still on the ground: the body lowers itself to where it was, and then the
 * deck takes it on.
 */
function beginDown(body: Body, e: EntryState): void {
  if (body.y < 0.01) {
    clearEntry(body);
    return;
  }
  e.phase = 'down';
  e.t = 0;
  e.from = { x: body.x, y: body.y, z: body.z };
}

/**
 * Finish an entry: the body is in the water at (x, z), heading `dir`.
 *
 * `sink` is how deep it goes after it lands, and `glide` how long it takes
 * to come up again.
 */
function enterWater(body: Body, world: World, x: number, z: number, dir: 1 | -1, sink: number, glide: number): void {
  body.entry = null;
  body.pendingEntry = null;
  body.entryAt = null;
  body.climbing = 0;
  body.inWater = true;
  body.exitingWater = false;
  body.swim = startSwim(x, z, dir, body.seed);
  body.swim.yaw = normaliseNear(body.swim.yaw, body.yaw);
  body.swim.turnFrom = body.swim.yaw;
  body.yaw = body.swim.yaw;
  body.goal = null;
  body.path = [];
  body.diveT = 0;
  body.glideTotal = glide;
  body.glideLeft = glide;
  body.glideSink = sink;
  body.state = 'swimming';
  body.x = x;
  body.z = z;
  body.y = world.waterY - 0.06;
}

/** Land in the water at the entry's splash, with the splash shown. */
function landing(body: Body, world: World, e: EntryState, sink: number, glide: number): void {
  body.events.push({ name: 'splash:big', x: e.splash.x, z: e.splash.z });
  enterWater(body, world, e.splash.x, e.splash.z, e.dir, sink, glide);
}

/** Put the body where the entry says, on the ground or in the air. */
function setAt(body: Body, x: number, y: number, z: number): void {
  body.x = x;
  body.y = y;
  body.z = z;
}

/** Scratch points for the slide's curve; the frame does not allocate them. */
const chutePoint: Vec3 = { x: 0, y: 0, z: 0 };
const chuteTangent: Vec3 = { x: 0, y: 0, z: 0 };

/** One step of an entry in progress. */
function stepEntry(body: Body, world: World, dt: number, ctx: FlowContext): void {
  const e = body.entry as EntryState;
  body.strideCycles = 0;
  body.swimStyle = null;
  body.tempo = 1;
  if (e.phase === 'down') {
    const u = clock(e, dt, DOWN_SECONDS);
    const s = smoothStep(u);
    setAt(body, e.from.x + (e.origin.x - e.from.x) * s, e.from.y * (1 - s), e.from.z + (e.origin.z - e.from.z) * s);
    body.state = 'resting';
    if (u >= 1) clearEntry(body);
    return;
  }
  if (body.desired !== 'swim' && abortable(e)) {
    beginDown(body, e);
    return;
  }
  switch (e.kind) {
    case 'block':
      stepBlock(body, world, dt, e);
      return;
    case 'board':
      stepBoard(body, world, dt, e);
      return;
    case 'slide':
      stepSlide(body, world, dt, e, ctx);
      return;
    case 'cannonball':
      stepCannonball(body, world, dt, e);
      return;
    default:
      clearEntry(body);
  }
}

/** How long it takes to walk back down after an entry was given up. */
const DOWN_SECONDS = 0.8;

/** The racing dive from the starting block: step up, crouch, fly, and glide. */
function stepBlock(body: Body, world: World, dt: number, e: EntryState): void {
  const top = 0.42;
  const centre = world.pool.minX - 0.3;
  switch (e.phase) {
    case 'step-up': {
      const u = clock(e, dt, 0.6);
      const s = smoothStep(u);
      setAt(body, e.origin.x + (centre - e.origin.x) * s, top * s, e.origin.z);
      body.state = 'resting';
      if (u >= 1) nextPhase(e, 'ready');
      return;
    }
    case 'ready': {
      const u = clock(e, dt, 0.8);
      setAt(body, centre, top, e.origin.z);
      body.state = 'resting';
      if (u >= 1) nextPhase(e, 'flight');
      return;
    }
    case 'flight': {
      const u = clock(e, dt, 0.7);
      const x = centre + (e.splash.x - centre) * u;
      const y = top + 0.55 * Math.sin(Math.PI * u) * (1 - u) - (top - world.waterY + 0.1) * u * u;
      setAt(body, x, y, e.splash.z);
      body.state = 'resting';
      if (u >= 1) landing(body, world, e, 0.35, GLIDE_SECONDS);
      return;
    }
    default:
      clearEntry(body);
  }
}

/**
 * The dive off the board: up the base onto the board, along it to the tip,
 * two bounces, and a flight that is a pike or a pencil.
 */
function stepBoard(body: Body, world: World, dt: number, e: EntryState): void {
  const board = world.equipment.board;
  const pivotX = board.block.x - 0.3;
  const tipX = board.tip.x;
  const length = pivotX - tipX;
  const bend = Math.sin(body.boardFlex);
  switch (e.phase) {
    case 'climb': {
      const u = clock(e, dt, 0.5);
      const s = smoothStep(u);
      setAt(body, e.origin.x + (pivotX - e.origin.x) * s, board.height * s, e.origin.z);
      body.state = 'resting';
      if (u >= 1) nextPhase(e, 'walk');
      return;
    }
    case 'walk': {
      // Walking at 0.9 m a second, so the distance is the time times the speed.
      e.t += dt;
      const d = Math.min(length, e.t * BOARD_WALK);
      setAt(body, pivotX - d, board.height - d * bend, e.origin.z);
      body.strideCycles = (BOARD_WALK * dt) / (body.height * STRIDE_PER_HEIGHT);
      body.state = 'walking';
      if (d >= length) nextPhase(e, 'bounce');
      return;
    }
    case 'bounce': {
      // Two bounces at the tip, each one a little hop. The board bends at
      // each landing: the scene is told.
      const period = 0.55;
      const before = Math.floor(e.t / period + 1e-6);
      e.t += dt;
      const now = Math.floor(e.t / period + 1e-6);
      if (now > before && now <= 2) body.events.push({ name: 'board:bounce', x: tipX, z: board.tip.z });
      const f = (e.t % period) / period;
      setAt(body, tipX, board.height - length * bend + BOUNCE_UP * Math.sin(Math.PI * f), board.tip.z);
      body.state = 'resting';
      if (e.t >= 2 * period) nextPhase(e, 'flight');
      return;
    }
    case 'flight': {
      const u = clock(e, dt, 1.0);
      const sp = e.splash;
      const x = tipX + (sp.x - tipX) * u;
      const y = board.height + (world.waterY - 0.3 - board.height) * u + 0.9 * 4 * u * (1 - u);
      setAt(body, x, y, sp.z);
      body.state = 'resting';
      if (u >= 1) landing(body, world, e, 0.6, 1.0);
      return;
    }
    default:
      clearEntry(body);
  }
}

/** The walk along the board, in metres a second. */
const BOARD_WALK = 0.9;

/**
 * The water slide: up the stairs, down the chute and into the pool.
 *
 * The rider's distance along the chute is kept in `e.t`, and the speed
 * grows along it: 1.8 m a second at the top, 4.2 m a second at the end.
 */
function stepSlide(body: Body, world: World, dt: number, e: EntryState, ctx: FlowContext): void {
  const slide = world.equipment.slide;
  const table = slideTable(world);
  switch (e.phase) {
    case 'wait': {
      // One rider at a time: wait at the foot until the chute is free.
      const busy = ctx.entries?.busy(body);
      setAt(body, e.origin.x, 0, e.origin.z);
      body.state = 'resting';
      if (!busy || !busy.slide) nextPhase(e, 'stairs');
      return;
    }
    case 'stairs': {
      const u = clock(e, dt, SLIDE_STAIRS_S);
      setAt(body, slide.stairsTop.x, slide.stairsTop.y * u, e.origin.z + (slide.stairsTop.z - e.origin.z) * u);
      body.state = 'climbing';
      if (u >= 1) nextPhase(e, 'sit');
      return;
    }
    case 'sit': {
      const u = clock(e, dt, 0.7);
      const s = smoothStep(u);
      tangentAt(table, 0, chuteTangent);
      const yaw0 = Math.atan2(chuteTangent.x, chuteTangent.z);
      setAt(body, slide.top.x, slide.top.y, slide.stairsTop.z + (slide.top.z - slide.stairsTop.z) * s);
      body.yaw = normaliseNear(Math.PI + (yaw0 - Math.PI) * s, body.yaw);
      body.state = 'resting';
      if (u >= 1) nextPhase(e, 'ride');
      return;
    }
    case 'ride': {
      const len = table.total;
      const s = Math.min(1, e.t / len);
      e.t += (SLIDE_V0 + SLIDE_V1 * s) * dt;
      pointAt(table, Math.min(1, s), chutePoint);
      tangentAt(table, Math.min(1, s), chuteTangent);
      setAt(body, chutePoint.x, chutePoint.y + 0.12, chutePoint.z);
      body.yaw = normaliseNear(Math.atan2(chuteTangent.x, chuteTangent.z), body.yaw);
      body.state = 'resting';
      if (e.t >= len) {
        pointAt(table, 1, chutePoint);
        e.from = { x: chutePoint.x, y: chutePoint.y + 0.12, z: chutePoint.z };
        nextPhase(e, 'drop');
      }
      return;
    }
    case 'drop': {
      const u = clock(e, dt, 0.35);
      const from = e.from;
      const sp = e.splash;
      const water = world.waterY - 0.06;
      setAt(
        body,
        from.x + (sp.x - from.x) * u,
        from.y + (water - from.y) * u * u,
        from.z + (sp.z - from.z) * u,
      );
      body.state = 'resting';
      if (u >= 1) landing(body, world, e, 0.5, GLIDE_SECONDS + 0.1);
      return;
    }
    default:
      clearEntry(body);
  }
}

/** The stairs, in seconds, and the speeds on the chute in metres a second at the top and the gain along it. */
const SLIDE_STAIRS_S = 3.0;
const SLIDE_V0 = 1.8;
const SLIDE_V1 = 2.4;

/**
 * The cannonball: the run-up on the coping, the jump out over the water, and
 * the splash, with the body going under and coming up.
 */
function stepCannonball(body: Body, world: World, dt: number, e: EntryState): void {
  const at = e.origin;
  switch (e.phase) {
    case 'run-up': {
      const u = clock(e, dt, 0.5);
      setAt(body, at.x, 0, at.z);
      body.state = 'resting';
      if (u >= 1) nextPhase(e, 'flight');
      return;
    }
    case 'flight': {
      const u = clock(e, dt, 0.8);
      const sp = e.splash;
      const y = (world.waterY - 0.06) * u + CANNONBALL_UP * 4 * u * (1 - u);
      setAt(body, at.x, y, at.z + (sp.z - at.z) * u);
      body.state = 'resting';
      if (u >= 1) {
        body.events.push({ name: 'splash:huge', x: sp.x, z: sp.z });
        nextPhase(e, 'splash');
      }
      return;
    }
    case 'splash': {
      const u = clock(e, dt, 1.2);
      const sp = e.splash;
      // The body goes under, and never below the floor under it.
      const y = world.waterY - body.height * 0.62 - 0.7 * Math.sin(Math.PI * u);
      setAt(body, sp.x, Math.max(y, -floorDepthAt(world, sp.x) + 0.3), sp.z);
      body.state = 'treading';
      if (u >= 1) enterWater(body, world, sp.x, sp.z, e.dir, 0, 0);
      return;
    }
    default:
      clearEntry(body);
  }
}

// --- the errands (Sprint 25) -------------------------------------------------

/** Seconds of an errand that stays in place, and how it leaves the place. */
function startLeave(body: Body, e: ErrandState): void {
  e.phase = 'leaving';
  e.t = 0;
  e.from = { x: body.x, y: body.y, z: body.z };
  body.carry = null;
}

/** Give the errand up: its slots are free, and the next one is some time off. */
function endErrand(body: Body, ctx: FlowContext): void {
  const e = body.errand;
  // The kiosk's customer keeps the drink until it sits down with it.
  if (e !== null && e.kind !== 'kiosk') body.carry = null;
  body.errand = null;
  body.walkScale = 1;
  body.errandsDone += 1;
  const book = ctx.errands?.book;
  if (book) {
    for (const [key, owner] of book.taken) if (owner === body.id) book.taken.delete(key);
  }
  const now = ctx.errands?.now() ?? 0;
  body.nextErrandAt = now + 60 + errandDraw(body.id, `next:${body.errandsDone}`) * 120;
  body.goal = null;
  body.path = [];
}

/**
 * Drop an errand because the agent wants something else. The partners of a
 * group end their errand too and walk back. A body in the hot tub climbs out
 * first; the other places are left at once.
 */
function abortErrand(body: Body, ctx: FlowContext): void {
  const e = body.errand;
  if (e === null) return;
  for (const id of e.with) {
    const other = ctx.errands?.bodyOf(id);
    if (other && other.errand !== null && other.errand.with.includes(body.id)) endErrand(other, ctx);
  }
  if (e.kind === 'hotTub' && e.phase === 'leaving') return;
  if (e.kind === 'hotTub' && e.phase === 'using') {
    startLeave(body, e);
    return;
  }
  endErrand(body, ctx);
}

/** The body reached its errand's place: it starts the use, or walks on in a stroll. */
function arriveErrand(body: Body, ctx: FlowContext): void {
  const e = body.errand;
  body.state = 'resting';
  if (e === null || e.phase === 'queued') return;
  if (e.kind === 'stroll') {
    // A corner of the stroll is passed; the last one ends the errand.
    e.route.shift();
    if (e.route.length === 0) {
      endErrand(body, ctx);
      return;
    }
    e.spot = { x: e.route[0].x, z: e.route[0].z, yaw: 0 };
    body.goal = null;
    body.path = [];
    return;
  }
  e.phase = 'using';
  e.t = 0;
  body.path = [];
  body.goal = null;
  body.yaw = normaliseNear(e.spot.yaw, body.yaw);
  if (e.kind === 'towel') body.carry = 'towel';
  if (e.kind === 'pingPong') body.carry = carryFor('pingPong', e.index);
}

/** Put the sunscreen on, lying on the lounger: the errand ends when the time is up. */
function tickSunscreen(body: Body, dt: number, ctx: FlowContext): void {
  const e = body.errand;
  if (e === null) return;
  e.t += dt;
  if (e.t >= e.useFor) endErrand(body, ctx);
}

/** Note that the body has just left the water, for the shower's bonus. */
function markLeftWater(body: Body, ctx: FlowContext): void {
  body.leftWaterAt = ctx.errands?.now() ?? body.leftWaterAt;
}

/**
 * One frame of an errand that is in its place (not walking to it).
 *
 * Returns true when the errand has the body for this frame. An errand that
 * ends returns false, so the body walks back to its lounger in the same frame.
 */
function stepErrand(body: Body, world: World, dt: number, ctx: FlowContext): boolean {
  const e = body.errand as ErrandState;
  if (e.phase === 'going' || e.phase === 'queued') return false;
  // A stroll walks its route, and the sunscreen is put on at the lounger.
  if (e.kind === 'stroll' || e.kind === 'sunscreen') return false;
  e.t += dt;
  body.state = 'resting';
  switch (e.kind) {
    case 'hotTub':
      return stepHotTub(body, world, e, ctx);
    case 'kiosk': {
      // The customer takes an ice cream or a drink from the fridge, then walks back.
      if (e.t >= KIOSK_CARRY_S && body.carry === null) {
        body.carry = errandDraw(body.id, `drink:${body.errandsDone}`) * 100 < ICE_CREAM_PERCENT ? 'icecream' : 'bottle';
      }
      if (e.t >= e.useFor) {
        endErrand(body, ctx);
        return false;
      }
      return true;
    }
    default:
      // Shower, ping-pong, ball, chat and towel: used in place, then left.
      if (e.phase === 'using') {
        if (e.t >= e.useFor) startLeave(body, e);
        return true;
      }
      if (e.t >= LEAVE_S) {
        endErrand(body, ctx);
        return false;
      }
      return true;
  }
}

/** The hot tub: in over the rim, sit, and out again by the step. */
function stepHotTub(body: Body, world: World, e: ErrandState, ctx: FlowContext): boolean {
  const tub = world.equipment.hotTub;
  const seat = tub.seats[e.index] ?? tub.seats[0];
  const seatY = 0.15 - body.hipHeight;
  if (e.phase === 'leaving') {
    if (e.t >= TUB_OUT_S) {
      endErrand(body, ctx);
      return false;
    }
    tubPlace(body, e.from, { x: e.spot.x, y: 0, z: e.spot.z }, e.t / TUB_OUT_S);
    return true;
  }
  if (e.t < TUB_IN_S) {
    tubPlace(body, { x: e.spot.x, y: 0, z: e.spot.z }, { x: seat.x, y: seatY, z: seat.z }, e.t / TUB_IN_S);
    return true;
  }
  body.x = seat.x;
  body.z = seat.z;
  body.y = seatY;
  body.yaw = normaliseNear(seat.yaw, body.yaw);
  if (e.t >= e.useFor) startLeave(body, e);
  return true;
}

/**
 * The body between the step and the seat of the tub: it goes over the rim,
 * which is the lift in the middle of the way, and it faces where it is going.
 */
function tubPlace(body: Body, from: Vec3, to: Vec3, u: number): void {
  const s = smoothStep(Math.min(1, Math.max(0, u)));
  const x = from.x + (to.x - from.x) * s;
  const z = from.z + (to.z - from.z) * s;
  body.x = x;
  body.z = z;
  body.y = from.y + (to.y - from.y) * s + TUB_RIM_LIFT * 4 * s * (1 - s);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) > 1e-6) body.yaw = normaliseNear(Math.atan2(dx, dz), body.yaw);
}

/** How far the body is lifted over the rim of the tub, in metres. */
const TUB_RIM_LIFT = 0.8;

/** What the body does with its arms and legs while it does its errand. */
function errandAction(body: Body): ActionKind | null {
  const e = body.errand as ErrandState;
  switch (e.kind) {
    case 'shower':
      if (e.phase === 'using') return 'shower';
      return e.phase === 'leaving' ? 'headShake' : null;
    case 'kiosk':
      return e.phase === 'using' && e.t < KIOSK_CARRY_S ? 'reach' : null;
    case 'hotTub':
      if (e.phase === 'leaving') return 'stepOver';
      if (e.phase !== 'using') return null;
      return e.t < TUB_IN_S ? 'stepOver' : 'tubSit';
    case 'pingPong':
      if (e.phase === 'using') return 'pingPong';
      // The rally is over: the winner cheers, the loser shakes its head.
      if (e.phase === 'leaving') return e.index === rallyLoser([body.id, ...e.with]) ? 'headShake' : 'cheer';
      return null;
    case 'chat':
      return e.phase === 'using' ? 'chatStand' : null;
    case 'stroll':
      return e.phase === 'going' ? 'stroll' : null;
    case 'towel':
      return e.phase === 'using' ? 'towelShake' : null;
    case 'sunscreen':
      return e.phase === 'using' ? 'sunscreen' : null;
    case 'ballGame':
      // The throws and the catches are played by the scene, from the ball.
      return null;
    default:
      return null;
  }
}

/** True for the errand actions that loop until the errand changes. */
function errandHeld(e: ErrandState): boolean {
  switch (e.kind) {
    case 'shower':
    case 'pingPong':
    case 'chat':
      return e.phase === 'using';
    case 'stroll':
      return e.phase === 'going';
    case 'hotTub':
      return e.phase === 'using' && e.t >= TUB_IN_S;
    default:
      return false;
  }
}

/**
 * The phase a held errand action starts at, so that the two players of a
 * ping-pong rally are half a loop apart, and the members of a chat take turns.
 */
export function bodyActionPhase(body: Body): number {
  const e = body.errand;
  if (e === null) return 0;
  if (e.kind === 'pingPong') return e.index * 0.5;
  if (e.kind === 'chat') return e.index / Math.max(1, e.with.length + 1);
  return 0;
}

/**
 * The way a body is doing its entry or its way out, as an action.
 *
 * The scene plays it when it changes. Null is the posture the body is in.
 */
export function bodyAction(body: Body): ActionKind | null {
  if (body.errand !== null && body.entry === null && !body.inWater && body.edgeOut === null) {
    return errandAction(body);
  }
  const e = body.entry;
  if (e !== null) {
    switch (e.kind) {
      case 'block':
        return e.phase === 'step-up' ? 'stepUp' : e.phase === 'ready' ? 'blockReady' : e.phase === 'flight' ? 'dive' : null;
      case 'board':
        if (e.phase === 'climb') return 'stepUp';
        if (e.phase === 'bounce') return 'hop';
        if (e.phase === 'flight') return body.entriesMade % 2 === 0 ? 'pike' : 'pencil';
        return null;
      case 'slide':
        return e.phase === 'sit' ? 'slideSit' : e.phase === 'ride' ? 'slideRide' : null;
      case 'cannonball':
        return e.phase === 'run-up' ? 'hop' : e.phase === 'flight' ? 'cannonball' : null;
      default:
        return null;
    }
  }
  if (body.edgeOut !== null) return body.edgeOut.phase === 'push' ? 'pushUp' : null;
  const swim = body.swim;
  if (body.inWater && swim !== null) {
    if (swim.turning > 0 && swim.turnKind === 'flip') return 'flipTurn';
    if (swim.resting > 0) return 'wallRest';
  }
  return null;
}

/** True when the action of the body is held, and loops, until it changes. */
export function bodyActionHeld(body: Body): boolean {
  if (body.errand !== null && !body.inWater) return errandHeld(body.errand);
  const e = body.entry;
  if (e !== null && e.kind === 'slide' && e.phase === 'ride') return true;
  return body.inWater && body.swim !== null && body.swim.resting > 0;
}

/**
 * The read dive: a reader that is not busy goes down to the floor now and
 * then, to look at what it is reading, and comes up again.
 *
 * It only happens when the work is reading, the swimmer is not turning and
 * the session is not waiting for the person. Any of those stops a dive that
 * is under way.
 */
function stepDive(body: Body, swim: SwimState, dt: number): void {
  const reading = body.work === 'read' && !body.needsYou && swim.turning === 0 && !swim.holding;
  if (body.diveT > 0) {
    if (!reading) {
      body.diveT = 0;
      body.diveIn = diveGap(body);
      return;
    }
    body.diveT += dt / DIVE_SECONDS;
    if (body.diveT >= 1) {
      body.diveT = 0;
      body.dives += 1;
      body.diveIn = diveGap(body);
    }
    return;
  }
  if (!reading) return;
  body.diveIn -= dt;
  if (body.diveIn <= 0) body.diveT = dt / DIVE_SECONDS;
}

/** How far below the surface the diver is at the progress u (0..1). */
function diveSink(world: World, x: number, u: number): number {
  // The diver keeps 0.45 m of water under it, so it never touches the floor.
  const floorClear = Math.max(0, Math.min(DIVE_MAX_SINK, floorDepthAt(world, x) - 0.45));
  const s = Math.sin(Math.PI * u);
  return floorClear * s * s;
}

/** Seconds to the next dive, after the one that has just ended. */
function diveGap(body: Body): number {
  return 8 + (hashOf(`${body.id}#${body.dives}`) % 7);
}

/** The middle of a swimmer, where the splash and the wake go. */
export function swimCentre(body: Body): Vec2 | null {
  return body.swim && body.inWater ? { x: body.swim.x, z: body.swim.z } : null;
}

/**
 * A spot at the edge of the pool that no other body has taken.
 *
 * The spots at the back are tried first, because the backend hands the
 * ones at the front to the agents it knows are waiting.
 */
export function freeWaitingSpot(world: World, bodies: Iterable<Body>, self: Body): number | null {
  const taken = new Set<number>();
  for (const other of bodies) {
    if (other !== self && other.waiting !== null) taken.add(other.waiting);
  }
  for (let i = world.waiting.length - 1; i >= 0; i -= 1) {
    if (!taken.has(i)) return i;
  }
  return null;
}

/** How many other bodies are already waiting at the gate. */
export function gateQueueLength(bodies: Iterable<Body>, self: Body): number {
  let n = 0;
  for (const other of bodies) {
    if (other !== self && other.desired === 'waiting' && other.waiting === null) n += 1;
  }
  return n;
}
