/**
 * The camera tour (step 27.4): a slow orbit round the deck, which turns to
 * look at whatever happens in the pool.
 *
 * Pure, like the other decisions of the pool. The scene reports the things
 * worth a look as `Interest`s, and each frame asks where the camera should
 * be; the scene only moves the camera there. The orbit keeps the distance
 * and the angle of the default view, so the tour starts from where the
 * person is looking.
 */

import { MAX_DISTANCE, MAX_POLAR, MIN_DISTANCE, MIN_POLAR, clampTarget } from './camera';
import type { Vec3, World } from './world';

/** The tour: where the camera is in its orbit, and what it is looking at. */
export interface TourState {
  /** Angle about y, as in `CameraView`. It only grows: the orbit is never reset. */
  azimuth: number;
  /** The point the camera looks at now; it glides to the orbit or to the focus. */
  look: Vec3;
  /** The thing the tour is looking at, or null for the orbit. */
  focus: Vec3 | null;
  /** The weight of the focus, and the scene time the focus is given up at. */
  focusWeight: number;
  focusUntil: number;
  /** The time of the last interest that was looked at; older ones are old news. */
  seenAt: number;
  /** 1 for the whole speed of the tour, 0.5 when the pool is quiet. */
  speed: number;
  /** The polar angle and the distance the orbit keeps. */
  polar: number;
  distance: number;
}

/** Something worth a look: where, how much it matters, and when it happened. */
export interface Interest {
  x: number;
  y: number;
  z: number;
  weight: number;
  at: number;
}

/** Where the camera is for this frame: the same shape as the camera's own view. */
export interface TourView {
  target: Vec3;
  azimuth: number;
  polar: number;
  distance: number;
}

/** How fast the orbit turns, in radians a second at full speed. */
export const TOUR_ORBIT_RATE = 0.035;
/** How long the camera stays on an interest, in seconds. */
export const FOCUS_S = 7;
/** The least weight that takes the camera off the orbit. */
export const FOCUS_MIN_WEIGHT = 1;
/** How much more a new interest must weigh than the focus, to take it while the focus is held. */
export const TAKEOVER_MARGIN = 1;
/** How fast the look glides to a new place, per second (an exponential rate). */
const GLIDE_RATE = 2.5;
/** How close the camera comes to the focus, as a fraction of the orbit's distance. */
const FOCUS_DISTANCE_FACTOR = 0.75;

/** A tour that starts from the given view. The look is copied from the target, not shared with it. */
export function createTourState(polar: number, distance: number, azimuth: number, look: Vec3): TourState {
  return {
    azimuth,
    look: { x: look.x, y: look.y, z: look.z },
    focus: null,
    focusWeight: 0,
    focusUntil: 0,
    seenAt: 0,
    speed: 1,
    polar,
    distance,
  };
}

/** A view for the tour to write into, so that a frame does not allocate. */
export function createTourView(): TourView {
  return { target: { x: 0, y: 0, z: 0 }, azimuth: 0, polar: 0, distance: 0 };
}

/**
 * Move the tour on by `dt` seconds, and say where the camera is now.
 *
 * An interest that is newer than the last one looked at takes the focus when
 * no focus is held, or when it weighs at least `TAKEOVER_MARGIN` more than the
 * focus that is held. The focus lasts `FOCUS_S` seconds.
 *
 * @param out The view the answer is written into, and returned.
 */
export function tourStep(
  state: TourState,
  dt: number,
  now: number,
  interests: readonly Interest[],
  world: World,
  out: TourView = createTourView(),
): TourView {
  if (state.focus !== null && now >= state.focusUntil) {
    state.focus = null;
    state.focusWeight = 0;
  }
  for (const it of interests) {
    if (it.at <= state.seenAt || it.weight < FOCUS_MIN_WEIGHT) continue;
    const free = state.focus === null;
    if (free || it.weight - state.focusWeight >= TAKEOVER_MARGIN) {
      state.focus = { x: it.x, y: it.y, z: it.z };
      state.focusWeight = it.weight;
      state.focusUntil = now + FOCUS_S;
    }
  }
  for (const it of interests) {
    if (it.at > state.seenAt) state.seenAt = it.at;
  }

  // The orbit turns; a focus holds the camera on the thing that happened.
  state.azimuth += TOUR_ORBIT_RATE * state.speed * dt;
  const deck = world.deck;
  const aim = state.focus ?? { x: (deck.minX + deck.maxX) / 2, y: 0.3, z: (deck.minZ + deck.maxZ) / 2 };
  const k = 1 - Math.exp(-GLIDE_RATE * dt);
  state.look.x += (aim.x - state.look.x) * k;
  state.look.y += (aim.y - state.look.y) * k;
  state.look.z += (aim.z - state.look.z) * k;

  out.target.x = state.look.x;
  out.target.y = state.look.y;
  out.target.z = state.look.z;
  clampTarget(world, out.target);
  out.azimuth = state.azimuth;
  out.polar = Math.min(MAX_POLAR, Math.max(MIN_POLAR, state.polar));
  const near = state.focus !== null ? state.distance * FOCUS_DISTANCE_FACTOR : state.distance;
  out.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, near));
  return out;
}
