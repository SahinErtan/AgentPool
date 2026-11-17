/**
 * Swimming lengths.
 *
 * A swimmer that reached the end of its lane and appeared again at the other
 * end would be a glitch, and the pool is seen from above, so anybody would
 * see it. A swimmer here turns at the wall: it slows down, turns round and
 * pushes off the other way.
 *
 * Some turns are flip turns, which the scene draws as a roll; some lengths
 * end in a rest at the wall; and two swimmers in neighbouring lanes may race.
 * Pure: the scene keeps one `SwimState` per swimmer and calls `swimStep`.
 */

import type { SwimStyle } from '../characters/spec';
import type { WorkKind } from './work';
import type { World } from './world';

/** How a turn at the wall looks: a plain turn, or a roll over the water. */
export type TurnKind = 'open' | 'flip';

export interface SwimState {
  /** The middle of the body, on the water. */
  x: number;
  z: number;
  /** The way it swims along the lane: +1 towards the deep end, -1 back. */
  dir: 1 | -1;
  /** The heading, in radians about y (0 is +z, π/2 is +x). Continuous. */
  yaw: number;
  /** Seconds left of the turn at the wall, 0 when swimming straight. */
  turning: number;
  /** The yaw the turn started from. */
  turnFrom: number;
  /** True while the swimmer stays where it is instead of swimming on. */
  holding: boolean;
  /** How the turn that is under way looks. */
  turnKind: TurnKind;
  /** A number of the swimmer's own, from its id: the rest and the flip depend on it. */
  seed: number;
  /** The lengths swum since the last rest. */
  lengths: number;
  /** How many rests the swimmer has taken. */
  restCount: number;
  /** True when the turn that is under way ends in a rest at the wall. */
  restPending: boolean;
  /** Seconds left of the rest at the wall, 0 when not resting. */
  resting: number;
}

/** What a swimmer is asked to do besides swimming its lengths. */
export interface SwimOptions {
  /** Swim to the wall ahead, turn, and stay there with the back to it. */
  stopAtWall?: boolean;
  /** Stay where you are (treading water). */
  hold?: boolean;
  /**
   * Whether the turns are flips: `always` for a run, `alternate` for every
   * other turn, `never` (or nothing) for an open turn.
   */
  flip?: 'never' | 'always' | 'alternate';
  /** True when the swimmer may take a rest at a wall now and then. */
  rest?: boolean;
}

/** How long a turn at the wall takes. */
export const TURN_SECONDS = 1.1;
/** How long a flip turn is drawn for, the same as the turn. */
export const FLIP_SECONDS = TURN_SECONDS;

/** The yaw of a swimmer going one way or the other along the pool. */
export function yawFor(dir: 1 | -1): number {
  return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
}

export function startSwim(x: number, z: number, dir: 1 | -1, seed = 0): SwimState {
  return {
    x,
    z,
    dir,
    yaw: yawFor(dir),
    turning: 0,
    turnFrom: yawFor(dir),
    holding: false,
    turnKind: 'open',
    seed,
    lengths: 0,
    restCount: 0,
    restPending: false,
    resting: 0,
  };
}

/** The lengths a swimmer swims before it rests: three to six. */
export function restAfter(state: SwimState): number {
  return 3 + ((state.seed + state.restCount) % 4);
}

/** How long a rest at the wall lasts: four to seven seconds. */
function restLength(state: SwimState): number {
  return 4 + ((state.seed + state.restCount * 7) % 4);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Whether the turn that has just started is a flip, as the options ask for. */
function turnKindFor(state: SwimState, options: SwimOptions): TurnKind {
  if (options.flip === 'always') return 'flip';
  if (options.flip === 'alternate' && (state.seed + state.lengths) % 2 === 0) return 'flip';
  return 'open';
}

/**
 * One step of a swimmer in its lane.
 *
 * @param bodyLength How long the swimmer is; the turn starts that far
 *   before the wall, so the head never goes into it.
 * @param laneZ Where in the lane it wants to be. It drifts there slowly, so
 *   a swimmer that came off the ladder in another lane crosses over.
 * @param options What else the swimmer is asked to do: stop at the wall,
 *   or stay where it is. With neither, it swims on.
 */
/** The distance across the lane from which a swimmer crosses in a hurry. */
const CROSS_DRIFT_M = 0.9;

export function swimStep(
  state: SwimState,
  world: World,
  laneZ: number,
  speed: number,
  bodyLength: number,
  dt: number,
  options: SwimOptions = {},
): void {
  // The turn starts this far from the wall: half a body for the head, the
  // glide through the turn, and then the legs, which after the turn point
  // at the wall. Starting at half a body put the feet into the tiles.
  const reach = bodyLength * 0.6 + 0.45;
  const near = world.pool.minX + reach;
  const far = world.pool.maxX - reach;

  // Holding is a state of its own. A swimmer that is asked to hold keeps
  // holding until it is asked to swim again; one that is asked to stop at
  // the wall holds only once it has turned there. A rest at the wall holds
  // until the rest is over.
  const stopping = options.stopAtWall === true;
  const staying = options.hold === true;
  if (staying) state.holding = true;
  else if (!stopping && state.resting <= 0) state.holding = false;

  if (state.turning > 0) {
    state.turning = Math.max(0, state.turning - dt);
    const u = 1 - state.turning / TURN_SECONDS;
    // The turn goes round towards the middle of the pool, a half turn in
    // all; the heading never jumps.
    const toward = state.z > (world.pool.minZ + world.pool.maxZ) / 2 ? -1 : 1;
    const sign = state.dir > 0 ? -toward : toward;
    state.yaw = state.turnFrom + sign * Math.PI * smooth(u);
    // The swimmer glides through the turn and pushes off at the end.
    const glide = 0.25 + 0.75 * smooth(u);
    state.x += Math.sin(state.yaw) * speed * glide * dt;
    if (state.turning === 0) {
      state.yaw = normaliseNear(yawFor(state.dir), state.yaw);
      // The turn at the wall is done: the swimmer stops with its back to
      // the wall, facing the pool, when it is asked to stop or to rest.
      if (stopping || state.restPending) state.holding = true;
      if (state.restPending) {
        state.restPending = false;
        state.resting = restLength(state);
      }
    }
  } else if (state.holding) {
    // Stays where it is: the drift below still keeps it in its lane. A rest
    // is over when its time has run out, and the swimmer swims on.
    if (state.resting > 0) {
      state.resting = Math.max(0, state.resting - dt);
      if (state.resting === 0) {
        state.holding = false;
        state.lengths = 0;
      }
    }
  } else {
    state.x += state.dir * speed * dt;
    if ((state.dir > 0 && state.x >= far) || (state.dir < 0 && state.x <= near)) {
      state.x = Math.max(near, Math.min(far, state.x));
      state.dir = state.dir > 0 ? -1 : 1;
      state.turning = TURN_SECONDS;
      state.turnFrom = state.yaw;
      state.lengths += 1;
      state.turnKind = turnKindFor(state, options);
      if (options.rest === true && !stopping && !staying && state.lengths >= restAfter(state)) {
        state.restPending = true;
        state.restCount += 1;
      }
    }
  }

  // The drift across the lane. A swimmer that has to cross more than half a
  // lane — one that comes off a ladder in another lane, or one whose lane the
  // backend has changed — crosses it in a hurry: it is in the traffic of the
  // lanes it passes, and the sooner it is through, the better.
  const dz = laneZ - state.z;
  const across = Math.abs(dz) > CROSS_DRIFT_M ? 1.5 : 0.45;
  const drift = Math.min(Math.abs(dz), across * dt);
  state.z += Math.sign(dz) * drift;
  state.x = Math.max(world.pool.minX + 0.2, Math.min(world.pool.maxX - 0.2, state.x));
}

/**
 * The same angle as `target`, moved by whole turns to be nearest `near`.
 *
 * The yaw is kept continuous, so the spring that follows it never takes
 * the long way round.
 */
export function normaliseNear(target: number, near: number): number {
  const tau = Math.PI * 2;
  return target + Math.round((near - target) / tau) * tau;
}

/**
 * One step of a swimmer making for a point in the water (the foot of the
 * ladder), outside the lanes.
 *
 * @returns true when it has arrived.
 */
export function swimToward(
  state: SwimState,
  x: number,
  z: number,
  speed: number,
  dt: number,
): boolean {
  const dx = x - state.x;
  const dz = z - state.z;
  const d = Math.hypot(dx, dz);
  state.turning = 0;
  if (d < 0.05) return true;
  const step = Math.min(d, speed * dt);
  state.x += (dx / d) * step;
  state.z += (dz / d) * step;
  state.yaw = normaliseNear(Math.atan2(dx, dz), state.yaw);
  return d - step < 0.05;
}

// --- races ---------------------------------------------------------------

/** How long a pair waits before it races again, in seconds. */
export const RACE_COOLDOWN_S = 120;
/** How many races may run at the same time in the whole pool. */
export const MAX_RACES = 2;
/** How close two swimmers must be, in metres, to race. */
const RACE_NEAR_M = 1;
/** How far a swimmer must be from the wall ahead, in metres, to start a race. */
const RACE_WALL_M = 4;

/** What the race finder needs to know about a swimmer. */
export interface RaceSwimmer {
  id: string;
  lane: number;
  x: number;
  dir: 1 | -1;
  /** True while it is already in a race. */
  racing: boolean;
  style: SwimStyle | null;
  work: WorkKind;
  needsYou: boolean;
}

/**
 * The pairs of swimmers that start a race now.
 *
 * Two race when they swim in neighbouring lanes, the same way, close
 * together, and both are well away from the wall ahead. A session that
 * waits for the person, a delegating one, and a swimmer that floats do not
 * race. A pair that raced in the last two minutes does not race again, and
 * at most `MAX_RACES` races run at once. The cooldown is kept in `cooldown`,
 * by the sorted ids of the pair.
 */
export function findRaces(
  swimmers: readonly RaceSwimmer[],
  now: number,
  cooldown: Map<string, number>,
  pool: { minX: number; maxX: number },
): Array<[string, string]> {
  let running = 0;
  for (const s of swimmers) if (s.racing) running += 1;
  const room = MAX_RACES - running;
  const out: Array<[string, string]> = [];
  if (room <= 0) return out;

  const eligible = swimmers
    .filter((s) => {
      if (s.racing || s.needsYou || s.work === 'delegate' || s.style === 'float') return false;
      const wall = s.dir > 0 ? pool.maxX - s.x : s.x - pool.minX;
      return wall > RACE_WALL_M;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const used = new Set<string>();
  for (const a of eligible) {
    if (out.length >= room) break;
    if (used.has(a.id)) continue;
    for (const b of eligible) {
      if (b === a || used.has(b.id)) continue;
      if (Math.abs(b.lane - a.lane) !== 1 || b.dir !== a.dir) continue;
      if (Math.abs(b.x - a.x) >= RACE_NEAR_M) continue;
      const pair: [string, string] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      const key = `${pair[0]}|${pair[1]}`;
      const last = cooldown.get(key);
      if (last !== undefined && now - last < RACE_COOLDOWN_S) continue;
      cooldown.set(key, now);
      used.add(a.id);
      used.add(b.id);
      out.push(pair);
      break;
    }
  }
  return out;
}
