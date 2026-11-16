/**
 * Where each prop is held (Sprint 29).
 *
 * Pure numbers, so the grips are tested without WebGL. The figure is one
 * unit tall, and it is drawn at 1.7 m times its height, so a length in
 * metres here becomes `metres / METRES_PER_UNIT` units in the rig.
 *
 * A grip is where the prop's own centre sits, measured from the wrist, in
 * the frame of the prop layer. That frame is kept upright by the pose (the
 * layer turns back by the angles of the arm and the body), so +y is up and
 * +z is the way the figure looks. `rx`, `ry` and `rz` turn the prop about
 * its centre: a laptop lies flat on the thighs, for instance.
 *
 * Props held with both hands have a second point: the far edge, where the
 * other hand meets the prop. `reach.test.ts` checks that hand.
 */

import type { PropKind } from '../motion/driver';

/** The height of the figure in metres, for the props' sizes. */
export const METRES_PER_UNIT = 1.7;

export interface Grip {
  /** The prop's centre from the wrist, in metres. */
  x: number;
  y: number;
  z: number;
  /** Turns of the prop about its own centre, in radians. */
  rx: number;
  ry: number;
  rz: number;
}

/**
 * The grip of each prop, in the held poses of `motion/leisure.ts`.
 *
 * The rotation makes a held prop stand the way the world does, so the cup's
 * rim is up and the book's pages face the reader. Sprint 29.3 redrew the
 * activities, and each grip was fitted again: the prop's centre is where the
 * activity holds it, its face is towards the eyes, and the grip position stays
 * within 3 cm of the wrist. A prop that two activities hold has one grip, the
 * best fit of both (the `phone` serves the phone in front of the face and the
 * call at the ear).
 */
export const GRIPS: Record<PropKind, Grip> = {
  cup: { x: -0.021, y: 0.022, z: 0.044, rx: 0.276, ry: -0.706, rz: 0.563 },
  book: { x: 0.168, y: 0.028, z: 0.011, rx: -2.063, ry: -0.112, rz: -0.134 },
  phone: { x: 0.015, y: 0.125, z: 0.055, rx: 1.667, ry: -1.149, rz: 0.641 },
  snack: { x: -0.014, y: 0.059, z: 0.001, rx: 1.165, ry: -0.628, rz: 0.678 },
  newspaper: { x: 0.207, y: 0.031, z: -0.011, rx: 0.166, ry: 0.01, rz: 0.141 },
  cards: { x: 0, y: 0, z: 0, rx: -0.63, ry: -0.728, rz: -0.449 },
  laptop: { x: 0.132, y: -0.006, z: -0.008, rx: -3.165, ry: -3.2, rz: -3.185 },
  headphones: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
  fan: { x: 0.108, y: 0.029, z: 0.08, rx: 1.378, ry: -0.59, rz: 0.354 },
  glass: { x: 0.033, y: -0.016, z: 0.007, rx: 1.042, ry: 0.103, rz: 0.803 },
  crossword: { x: 0.081, y: 0.067, z: -0.012, rx: -0.172, ry: 0.009, rz: 0.703 },
  // The errands' props (Sprint 25) keep the placement they were built with.
  icecream: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
  bottle: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
  paddle: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
  paddleDark: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
  towel: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
};

/**
 * Where the left hand meets a two-handed prop, in the prop's own frame in
 * metres (before its grip is applied).
 */
export const FAR_EDGE: Partial<Record<PropKind, readonly [number, number, number]>> = {
  book: [0.17, 0, 0],
  newspaper: [0.21, 0, 0],
  cards: [0, 0.085, 0],
  laptop: [0.135, 0, 0],
  crossword: [0.105, 0, 0],
};
