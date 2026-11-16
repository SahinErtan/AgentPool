/**
 * The camera rules: how far it may go, and the view it starts from.
 *
 * The camera orbits the pool, but within limits. It never goes below
 * about 15° above the horizon, so it cannot look up from under the deck
 * or through the water, and it never goes straight overhead either, where
 * the figures turn into the tops of heads. The point it looks at stays over
 * the deck.
 *
 * Pure, so the limits are tested without WebGL.
 */

import type { World } from './world';

/** Measured from straight up: 0 is overhead, π/2 is the horizon. */
export const MIN_POLAR = 0.18;
export const MAX_POLAR = Math.PI / 2 - 0.26;
export const MIN_DISTANCE = 6;
export const MAX_DISTANCE = 46;

export interface CameraView {
  /** The point the camera looks at. */
  target: { x: number; y: number; z: number };
  /** Angle about y, 0 looking from +z towards -z. */
  azimuth: number;
  /** Angle from straight up. */
  polar: number;
  distance: number;
}

/**
 * The view the pool opens with.
 *
 * From the near side, a little to the left, high enough to see into the
 * water and low enough that the people stand up in the picture. The
 * distance fits the whole deck into the width of the screen; a narrow
 * screen (a phone, upright) looks along the pool instead of across it.
 */
export function defaultView(world: World, aspect: number, fovDeg: number): CameraView {
  // The part worth framing: the pool, the loungers behind it and the strip
  // of deck in front, not the whole garden.
  const backOfLoungers = Math.min(...world.loungers.map((l) => l.z - l.length / 2), world.pool.minZ);
  const area = {
    // Enough of the near-left corner to see people come in at the gate.
    minX: world.pool.minX - 2.6,
    // The terrace is in view from the start; the rest is reached by orbiting.
    maxX: world.pool.maxX + 6.0,
    minZ: backOfLoungers - 0.4,
    maxZ: world.pool.maxZ + 2.2,
  };
  const w = area.maxX - area.minX;
  const d = area.maxZ - area.minZ;
  const portrait = aspect < 0.9;
  const azimuth = portrait ? -1.2 : -0.28;
  const polar = portrait ? 0.95 : 0.9;
  // The width the camera has to fit, seen from that side.
  const across = Math.abs(w * Math.cos(azimuth)) + Math.abs(d * Math.sin(azimuth));
  const vfov = (fovDeg * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const fitWidth = (across * 0.5) / Math.tan(hfov / 2);
  // And the depth, foreshortened, has to fit the height of the screen.
  const deep = Math.abs(w * Math.sin(azimuth)) + Math.abs(d * Math.cos(azimuth));
  const fitHeight = (deep * Math.cos(polar) * 0.5 + 1.2) / Math.tan(vfov / 2);
  // On a phone the loungers at the ends were cut off at 0.9.
  const distance = clamp(Math.max(fitWidth, fitHeight) * (portrait ? 1.05 : 0.9), MIN_DISTANCE, MAX_DISTANCE);
  return {
    target: { x: (area.minX + area.maxX) / 2 + 0.3, y: -0.3, z: (area.minZ + area.maxZ) / 2 + 0.3 },
    azimuth,
    polar,
    distance,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Keep the point the camera looks at over the deck. */
export function clampTarget(world: World, t: { x: number; y: number; z: number }): void {
  t.x = clamp(t.x, world.deck.minX, world.deck.maxX);
  t.z = clamp(t.z, world.deck.minZ, world.deck.maxZ);
  t.y = clamp(t.y, -1.2, 2);
}

/** The camera position for a view, in world space. */
export function viewPosition(view: CameraView): { x: number; y: number; z: number } {
  const polar = clamp(view.polar, MIN_POLAR, MAX_POLAR);
  const r = clamp(view.distance, MIN_DISTANCE, MAX_DISTANCE);
  return {
    x: view.target.x + r * Math.sin(polar) * Math.sin(view.azimuth),
    y: view.target.y + r * Math.cos(polar),
    z: view.target.z + r * Math.sin(polar) * Math.cos(view.azimuth),
  };
}
