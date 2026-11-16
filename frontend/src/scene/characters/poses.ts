/**
 * The pose model.
 *
 * A pose is a flat vector of joint angles. The final pose of a character is the
 * weighted sum of several *layers* (rest, lounge, activity, walk, swim, climb).
 * The weights are damped over time; the layer oscillations are not. That keeps
 * the strokes crisp while still cross-fading smoothly, and it makes
 * interruption free: an agent that goes idle mid-swim simply has its `swim`
 * weight fall to zero.
 *
 * Angle convention: every joint angle is measured from straight down, and
 * positive means "forward" (towards the facing direction). The rig applies
 * `rotation = -angle` because Pixi's positive rotation is clockwise.
 */

import type { CharacterSpec, IdleActivity, SwimStyle } from './spec';
import { channelSeed, fbm } from './noise';

/**
 * The clock of one character.
 *
 * Every character has its own. The scene used to hand the same clock to all
 * of them, so every character in the pool breathed at the same moment and
 * the picture looked like a machine. The world still moves together — the
 * caustics, the foam and the light are shared — but the *people* each have
 * their own time and their own noise.
 */
export interface Motion {
  /** The character's own clock, in seconds. */
  t: number;
  /** The seed of this character's noise. */
  seed: number;
}

/* The noise channels. Each one is a different part of the body. */
const CH_BREATH = 1;
const CH_SWAY = 2;
const CH_SETTLE = 3;

export interface Pose {
  /** Whole-body rotation; the lounging pose uses this to lie down. */
  rootRot: number;
  bodyPitch: number;
  bodyRoll: number;
  bodyY: number;
  headPitch: number;
  headYaw: number;
  /** Shoulder angles. */
  armL: number;
  armR: number;
  /** Elbow bends. */
  elbowL: number;
  elbowR: number;
  /** Hip angles. */
  legL: number;
  legR: number;
  /** Knee bends. */
  kneeL: number;
  kneeR: number;
  /** Whole-body vertical offset. */
  bob: number;
  /**
   * The bend of the upper back against the hips, forward positive.
   *
   * The 2D rig has no spine and ignores it. In 3D it carries the wave of
   * the butterfly and the surge of the breaststroke.
   */
  spine: number;
  /**
   * The roll of the body about its own long axis.
   *
   * In a side view a roll can only be drawn as a tilt in the picture, so
   * `bodyRoll` stays small for the 2D rig. This is the roll a swimmer
   * really makes, shoulder to shoulder, and only the 3D rig reads it.
   */
  roll: number;
  /**
   * The turn of the upper body about the spine, a twist and not a roll.
   *
   * The shoulders and the head turn with it; the hips and the legs stay
   * where they are, so a figure that twists its upper body stays on its
   * lounger. Only the 3D rig reads it (Sprint 29.3 fixes): the 2D rig has no
   * spine and ignores it.
   */
  torso: number;
  /**
   * How far each arm is lifted out to the side, away from the body.
   *
   * The other angles all turn in the plane of the body's front and back.
   * A breaststroke sweeps out to the sides and a crawl brings the arm round
   * over the water, and neither fits in that plane. The 2D rig ignores it.
   */
  armOutL: number;
  armOutR: number;
  /** How far each leg is opened out to the side. */
  legOutL: number;
  legOutR: number;
  /**
   * Squash and stretch of the whole figure.
   *
   * Positive stretches the figure up and thins it, negative squashes it
   * down and thickens it; the volume stays about the same. The 2D rig
   * ignores it: a side view has no room for it, and the 2D pool is frozen.
   */
  stretch: number;
  /**
   * The upper arm turned about its own axis: a positive twist turns the
   * forearm in, towards the body.
   *
   * It lets a forearm that is bent up in front of the chest turn its palm
   * towards the middle, which a book or a cup needs. The 2D rig ignores it.
   */
  armTwistL: number;
  armTwistR: number;
  /**
   * The hand bent at the wrist, forward positive. The prop in the hand
   * tilts with it, so a cup can be turned towards the mouth.
   *
   * The 2D rig has no wrist and ignores it.
   */
  wristL: number;
  wristR: number;
}

/** The names of every field of a pose, for the code that walks them all. */
export const POSE_KEYS: readonly (keyof Pose)[] = [
  'rootRot', 'bodyPitch', 'bodyRoll', 'bodyY', 'headPitch', 'headYaw',
  'armL', 'armR', 'elbowL', 'elbowR', 'legL', 'legR', 'kneeL', 'kneeR', 'bob',
  'spine', 'roll', 'torso', 'armOutL', 'armOutR', 'legOutL', 'legOutR', 'stretch',
  'armTwistL', 'armTwistR', 'wristL', 'wristR',
];

/**
 * A pose with every angle at zero.
 *
 * This one allocates: use it when a pose is made once. A pose that is used
 * again and again is made once and then put back to zero with `resetPose`.
 */
export function zeroPose(): Pose {
  return resetPose({
    rootRot: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    bodyY: 0,
    headPitch: 0,
    headYaw: 0,
    armL: 0,
    armR: 0,
    elbowL: 0,
    elbowR: 0,
    legL: 0,
    legR: 0,
    kneeL: 0,
    kneeR: 0,
    bob: 0,
    spine: 0,
    roll: 0,
    torso: 0,
    armOutL: 0,
    armOutR: 0,
    legOutL: 0,
    legOutR: 0,
    stretch: 0,
    armTwistL: 0,
    armTwistR: 0,
    wristL: 0,
    wristR: 0,
  });
}

/** Put every angle back to zero, in place. */
export function resetPose(out: Pose): Pose {
  out.rootRot = 0;
  out.bodyPitch = 0;
  out.bodyRoll = 0;
  out.bodyY = 0;
  out.headPitch = 0;
  out.headYaw = 0;
  out.armL = 0;
  out.armR = 0;
  out.elbowL = 0;
  out.elbowR = 0;
  out.legL = 0;
  out.legR = 0;
  out.kneeL = 0;
  out.kneeR = 0;
  out.bob = 0;
  out.spine = 0;
  out.roll = 0;
  out.torso = 0;
  out.armOutL = 0;
  out.armOutR = 0;
  out.legOutL = 0;
  out.legOutR = 0;
  out.stretch = 0;
  out.armTwistL = 0;
  out.armTwistR = 0;
  out.wristL = 0;
  out.wristR = 0;
  return out;
}

export function copyPose(from: Pose, to: Pose): Pose {
  to.rootRot = from.rootRot;
  to.bodyPitch = from.bodyPitch;
  to.bodyRoll = from.bodyRoll;
  to.bodyY = from.bodyY;
  to.headPitch = from.headPitch;
  to.headYaw = from.headYaw;
  to.armL = from.armL;
  to.armR = from.armR;
  to.elbowL = from.elbowL;
  to.elbowR = from.elbowR;
  to.legL = from.legL;
  to.legR = from.legR;
  to.kneeL = from.kneeL;
  to.kneeR = from.kneeR;
  to.bob = from.bob;
  to.spine = from.spine;
  to.roll = from.roll;
  to.torso = from.torso;
  to.armOutL = from.armOutL;
  to.armOutR = from.armOutR;
  to.legOutL = from.legOutL;
  to.legOutR = from.legOutR;
  to.stretch = from.stretch;
  to.armTwistL = from.armTwistL;
  to.armTwistR = from.armTwistR;
  to.wristL = from.wristL;
  to.wristR = from.wristR;
  return to;
}

export function blendPose(out: Pose, a: Pose, wa: number, b: Pose, wb: number): Pose {
  out.rootRot = a.rootRot * wa + b.rootRot * wb;
  out.bodyPitch = a.bodyPitch * wa + b.bodyPitch * wb;
  out.bodyRoll = a.bodyRoll * wa + b.bodyRoll * wb;
  out.bodyY = a.bodyY * wa + b.bodyY * wb;
  out.headPitch = a.headPitch * wa + b.headPitch * wb;
  out.headYaw = a.headYaw * wa + b.headYaw * wb;
  out.armL = a.armL * wa + b.armL * wb;
  out.armR = a.armR * wa + b.armR * wb;
  out.elbowL = a.elbowL * wa + b.elbowL * wb;
  out.elbowR = a.elbowR * wa + b.elbowR * wb;
  out.legL = a.legL * wa + b.legL * wb;
  out.legR = a.legR * wa + b.legR * wb;
  out.kneeL = a.kneeL * wa + b.kneeL * wb;
  out.kneeR = a.kneeR * wa + b.kneeR * wb;
  out.bob = a.bob * wa + b.bob * wb;
  out.spine = a.spine * wa + b.spine * wb;
  out.roll = a.roll * wa + b.roll * wb;
  out.torso = a.torso * wa + b.torso * wb;
  out.armOutL = a.armOutL * wa + b.armOutL * wb;
  out.armOutR = a.armOutR * wa + b.armOutR * wb;
  out.legOutL = a.legOutL * wa + b.legOutL * wb;
  out.legOutR = a.legOutR * wa + b.legOutR * wb;
  out.stretch = a.stretch * wa + b.stretch * wb;
  out.armTwistL = a.armTwistL * wa + b.armTwistL * wb;
  out.armTwistR = a.armTwistR * wa + b.armTwistR * wb;
  out.wristL = a.wristL * wa + b.wristL * wb;
  out.wristR = a.wristR * wa + b.wristR * wb;
  return out;
}

/**
 * Add a pose on top of another one.
 *
 * The reaction is not a layer of its own: it has to sit on top of
 * whatever the character is doing — lying on a lounger, swimming,
 * walking — and a blended layer would drag the body towards its own
 * posture. An offset keeps the reaction where it belongs.
 */
export function addPose(out: Pose, delta: Pose, weight: number): Pose {
  out.rootRot += delta.rootRot * weight;
  out.bodyPitch += delta.bodyPitch * weight;
  out.bodyRoll += delta.bodyRoll * weight;
  out.bodyY += delta.bodyY * weight;
  out.headPitch += delta.headPitch * weight;
  out.headYaw += delta.headYaw * weight;
  out.armL += delta.armL * weight;
  out.armR += delta.armR * weight;
  out.elbowL += delta.elbowL * weight;
  out.elbowR += delta.elbowR * weight;
  out.legL += delta.legL * weight;
  out.legR += delta.legR * weight;
  out.kneeL += delta.kneeL * weight;
  out.kneeR += delta.kneeR * weight;
  out.bob += delta.bob * weight;
  out.spine += delta.spine * weight;
  out.roll += delta.roll * weight;
  out.torso += delta.torso * weight;
  out.armOutL += delta.armOutL * weight;
  out.armOutR += delta.armOutR * weight;
  out.legOutL += delta.legOutL * weight;
  out.legOutR += delta.legOutR * weight;
  out.stretch += delta.stretch * weight;
  out.armTwistL += delta.armTwistL * weight;
  out.armTwistR += delta.armTwistR * weight;
  out.wristL += delta.wristL * weight;
  out.wristR += delta.wristR * weight;
  return out;
}

const TAU = Math.PI * 2;

/** A smooth 0 -> 1 -> 0 bump over [a, b] of the unit cycle. */
export function pulse(t: number, a: number, b: number): number {
  if (t < a || t > b) return 0;
  const u = (t - a) / (b - a);
  return Math.sin(u * Math.PI) ** 2;
}

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

/**
 * Standing idle: arms slightly away from the body, a slow breath.
 *
 * The breath and the sway are noise, not a wave. A wave repeats, and every
 * character in the pool was on the same wave, so a row of loungers looked
 * like a row of machines. Noise moves the same way but never comes back to
 * the same value.
 */
export function restPose(out: Pose, motion: Motion): Pose {
  const breath = fbm(motion.t * 0.35, channelSeed(motion.seed, CH_BREATH));
  const sway = fbm(motion.t * 0.13, channelSeed(motion.seed, CH_SWAY));
  const settle = fbm(motion.t * 0.09, channelSeed(motion.seed, CH_SETTLE));
  out.rootRot = 0;
  out.bodyPitch = 0.02 + breath * 0.014;
  out.bodyRoll = settle * 0.018;
  out.bodyY = 0;
  out.headPitch = 0;
  out.headYaw = sway * 0.14;
  out.armL = 0.16 + breath * 0.025;
  out.armR = -0.16 + breath * 0.022;
  out.elbowL = 0.14;
  out.elbowR = 0.14;
  out.legL = 0.04;
  out.legR = -0.04;
  out.kneeL = 0.03;
  out.kneeR = 0.03;
  out.bob = breath * 0.006;
  return out;
}

/**
 * Lying back on a lounger.
 *
 * The figure leans back rather than lying flat. A body that is turned a
 * quarter turn is a body seen from above, and a row of bodies seen from
 * above is a row of blobs; a figure that leans back against the back of a
 * lounger reads as a person from the first glance.
 *
 * The lean is a pitch of the body, so it leans back whichever way the
 * figure happens to be facing.
 */
export function loungePose(out: Pose, motion: Motion): Pose {
  const breath = fbm(motion.t * 0.26, channelSeed(motion.seed, CH_BREATH));
  const sway = fbm(motion.t * 0.11, channelSeed(motion.seed, CH_SWAY));
  const settle = fbm(motion.t * 0.07, channelSeed(motion.seed, CH_SETTLE));
  out.rootRot = 0;
  // The lean back, against the back rest.
  out.bodyPitch = -0.62 + breath * 0.012;
  out.bodyRoll = settle * 0.012;
  out.bodyY = 0;
  // The head comes forward again, so the figure looks along its legs and
  // not at the sky.
  out.headPitch = -0.3;
  out.headYaw = sway * 0.16;
  // The forearms rest on the belly.
  out.armL = 0.25;
  out.armR = 0.2;
  out.elbowL = 0.75;
  out.elbowR = 0.7;
  // The legs lie along the seat. With the body leaning back, a thigh that
  // is a little short of a right angle to the body lies flat. The knee is
  // bent a little, and it bends backwards: it used to bend forwards, and
  // the shins stuck up into the air.
  out.legL = 0.95;
  out.legR = 0.9;
  out.kneeL = -0.12;
  out.kneeR = -0.2;
  out.bob = breath * 0.008;
  return out;
}

/** Walking on the deck. */
export function walkPose(out: Pose, t: number): Pose {
  const s = Math.sin(t * TAU);
  const c = Math.cos(t * TAU);
  out.rootRot = 0;
  out.bodyPitch = 0.07;
  out.bodyRoll = 0;
  out.bodyY = 0;
  out.headPitch = 0.02;
  out.headYaw = 0;
  out.legL = 0.5 * s;
  out.legR = -0.5 * s;
  // The knee bends backwards: the heel comes up towards the butt on the
  // push-off. It bent forwards before, which is not a thing a knee does.
  out.kneeL = -0.85 * Math.max(0, -s);
  out.kneeR = -0.85 * Math.max(0, s);
  // The arm swings against the leg on the same side.
  out.armL = -0.38 * s;
  out.armR = 0.38 * s;
  // The elbow is bent more when the arm is forward.
  out.elbowL = 0.34 + 0.32 * Math.max(0, -s);
  out.elbowR = 0.34 + 0.32 * Math.max(0, s);
  out.bob = Math.abs(c) * 0.018;
  return out;
}

/** Climbing in or out of the pool at the ladder. */
export function climbPose(out: Pose, u: number): Pose {
  out.rootRot = 0;
  out.bodyPitch = -0.25 + 0.3 * Math.sin(u * Math.PI);
  out.bodyRoll = 0;
  out.bodyY = 0;
  out.headPitch = -0.15;
  out.headYaw = 0;
  // The arms reach up to the rails.
  out.armL = 2.4 - 0.7 * u;
  out.armR = 2.4 - 0.7 * u;
  out.elbowL = 0.5 - 0.4 * u;
  out.elbowR = 0.5 - 0.4 * u;
  out.legL = 0.5 - 0.4 * u;
  out.legR = 0.2 - 0.1 * u;
  // The knee bends backwards, as it does on a ladder.
  out.kneeL = -0.9 + 0.6 * u;
  out.kneeR = -0.7 + 0.4 * u;
  out.bob = 0;
  return out;
}

/* ------------------------------------------------------------------ */
/* Swim styles                                                         */
/* ------------------------------------------------------------------ */

export interface SwimStyleInfo {
  cadence: number;
  fn: (out: Pose, t: number, spec: CharacterSpec) => Pose;
}

/** A straight line from one value to another. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** A ramp that is slow at the start and quick at the end. */
function easeIn(t: number): number {
  return t * t;
}

/** A ramp that is quick at the start and slow at the end. */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * One arm of a swimmer, at one point of its stroke.
 *
 * The shoulder angle is measured from "pointing at the feet". A positive
 * angle means the arm swings towards the head, which is the direction the
 * swimmer is going.
 */
interface StrokeArm {
  shoulder: number;
  elbow: number;
  /** How far the arm is out to the side; only the 3D rig reads it. */
  out: number;
}

/**
 * The crawl: one arm, over one cycle.
 *
 * The hand reaches forward under the water, catches, is pulled back along
 * the side of the body, comes out at the hip and swings over the water to
 * go in again. The shoulder angle sweeps a whole turn, because that is
 * what an arm does in a crawl; the old stroke swung it to and fro around
 * "pointing at the feet", which is why the swimmers reached backwards.
 */
function crawlArm(p: number): StrokeArm {
  const A = Math.PI;
  if (p < 0.26) {
    // The hand reaches forward under the water and catches.
    const u = p / 0.26;
    return { shoulder: lerp(A, A - 0.6, u), elbow: lerp(0.12, 0.95, u), out: 0.08 };
  }
  if (p < 0.56) {
    // The pull: the hand travels back along the side of the body.
    const u = (p - 0.26) / 0.3;
    return { shoulder: lerp(A - 0.6, 0.5, easeIn(u)), elbow: lerp(0.95, 0.55, u), out: 0.08 };
  }
  if (p < 0.78) {
    // The hand leaves the water at the hip and the elbow comes up.
    const u = (p - 0.56) / 0.22;
    // The arm swings out to the side as it leaves the water, so in 3D it
    // comes round over the water instead of through the body.
    return {
      shoulder: lerp(0.5, -0.95, easeOut(u)),
      elbow: lerp(0.55, 0.3, u),
      out: lerp(0.08, 0.55, easeOut(u)),
    };
  }
  // The recovery over the water: the elbow leads the hand up and round.
  const u = (p - 0.78) / 0.22;
  return {
    shoulder: lerp(-0.95, -A, easeOut(u)),
    elbow: lerp(0.3, 0.12, u),
    out: lerp(0.55, 0.08, easeIn(u)),
  };
}

/**
 * Crawl (freestyle): the right arm leads by half a cycle.
 *
 * The body rolls towards the arm that is pulling, the head stays in the
 * water but lifts a little to breathe, and the legs flutter at four times
 * the rate of the arms.
 */
function crawl(out: Pose, t: number): Pose {
  out.rootRot = Math.PI / 2; // lying in the water, head towards +x
  const phase = ((t % 1) + 1) % 1;
  const right = crawlArm(phase);
  const left = crawlArm((phase + 0.5) % 1);

  out.armR = right.shoulder;
  out.elbowR = right.elbow;
  out.armL = left.shoulder;
  out.elbowL = left.elbow;
  out.armOutR = right.out;
  out.armOutL = left.out;

  // The body rolls towards the arm that is pulling. In a side view a roll
  // about the long axis of the body can only be drawn as a tilt in the
  // picture, and a tilt of a quarter of a radian lifted the whole swimmer
  // out of the water, so the roll is a small one.
  const pulling = Math.sin(phase * TAU - 0.6);
  out.bodyRoll = pulling * 0.05;
  // The real roll, shoulder to shoulder, for the 3D rig.
  out.roll = pulling * 0.6;
  out.spine = 0;
  out.legOutL = 0;
  out.legOutR = 0;
  out.bodyPitch = 0.05;
  out.bodyY = 0;
  // The head stays down, but it lifts a little when the near arm comes
  // over the water.
  out.headPitch = -0.16 + Math.max(0, -pulling) * 0.14;
  out.headYaw = -0.16 * Math.max(0, Math.sin(phase * TAU - 2.2));

  // The kick: a flutter at four times the rate of the arms.
  const kick = Math.sin(phase * TAU * 4);
  out.legL = 0.34 * kick;
  out.legR = 0.34 * Math.sin(phase * TAU * 4 + Math.PI);
  // The knee bends backwards: the heel comes up towards the butt. It used
  // to bend forwards, which is not a thing a knee does.
  out.kneeL = -0.62 * Math.max(0, kick);
  out.kneeR = -0.62 * Math.max(0, -kick);

  // The body rides on the stroke: it rises as the arm pulls.
  out.bob = 0.02 * Math.max(0, pulling);
  // Squash and stretch is not part of a stroke.
  out.stretch = 0;
  return out;
}

/**
 * Breaststroke: both arms together.
 *
 * The arms reach forward under the water, sweep back and out to the
 * sides, and come forward again. The knees snap in at the end of the
 * pull. The head lifts forward to breathe and goes under again.
 */
function breaststroke(out: Pose, t: number): Pose {
  out.rootRot = Math.PI / 2;
  const phase = ((t % 1) + 1) % 1;
  const A = Math.PI;

  if (phase < 0.3) {
    // The arms reach forward under the water and the body glides.
    const u = phase / 0.3;
    out.armL = lerp(A - 0.55, A, easeOut(u));
    out.elbowL = lerp(0.65, 0.15, u);
  } else if (phase < 0.65) {
    // The pull: the arms sweep back and out, and the knees come in.
    const u = (phase - 0.3) / 0.35;
    out.armL = lerp(A, 0.4, easeIn(u));
    out.elbowL = lerp(0.15, 1.15, u);
  } else {
    // The arms come forward again and the legs go out.
    const u = (phase - 0.65) / 0.35;
    out.armL = lerp(0.4, A - 0.55, easeOut(u));
    out.elbowL = lerp(1.15, 0.65, u);
  }
  out.armR = out.armL;
  out.elbowR = out.elbowL;
  // The arms sweep out to the sides on the pull and come together again
  // in front of the face.
  const sweep = phase >= 0.3 && phase < 0.65 ? Math.sin(((phase - 0.3) / 0.35) * Math.PI) : 0;
  out.armOutL = 0.1 + 0.85 * sweep;
  out.armOutR = out.armOutL;

  // The knees snap in at the end of the pull.
  const snap = Math.max(0, Math.sin(phase * TAU - 1.9));
  // The frog kick: the knees open as they come in, and the legs close
  // again as they push out.
  out.legOutL = 0.55 * snap;
  out.legOutR = out.legOutL;
  out.roll = 0;
  // The chest rises as the head comes up to breathe.
  out.spine = -0.18 * Math.max(0, Math.sin(phase * TAU - 2.6));
  out.legL = 0.22 * snap;
  out.legR = 0.22 * snap;
  out.kneeL = -1.5 * snap;
  out.kneeR = -1.5 * snap;

  // The head lifts forward to breathe.
  const breathe = Math.max(0, Math.sin(phase * TAU - 2.6));
  out.headPitch = -0.2 + breathe * 0.72;
  out.headYaw = 0;
  out.bodyPitch = -0.26 * breathe;
  out.bodyRoll = 0;
  out.bodyY = 0;
  // The body surges up with the pull.
  out.bob = 0.03 * snap;
  // Squash and stretch is not part of a stroke.
  out.stretch = 0;
  return out;
}

/**
 * Butterfly: both arms in one big arc, and a wave that travels down the
 * body.
 *
 * The wave is a single value here, because the rig has no spine to bend
 * along. It is the arms that carry the stroke.
 */
function butterfly(out: Pose, t: number): Pose {
  out.rootRot = Math.PI / 2;
  const phase = ((t % 1) + 1) % 1;
  const A = Math.PI;

  if (phase < 0.35) {
    // The arms reach forward under the water.
    const u = phase / 0.35;
    out.armL = lerp(A - 0.4, A, easeOut(u));
    out.elbowL = lerp(0.4, 0.15, u);
  } else if (phase < 0.62) {
    // The pull: the arms sweep back to the hips.
    const u = (phase - 0.35) / 0.27;
    out.armL = lerp(A, 0.3, easeIn(u));
    out.elbowL = lerp(0.15, 0.5, u);
  } else {
    // The recovery: the arms come over the water, the elbows leading.
    const u = (phase - 0.62) / 0.38;
    out.armL = lerp(0.3, -A, easeOut(u));
    out.elbowL = lerp(0.5, 0.15, u);
  }
  out.armR = out.armL;
  out.elbowR = out.elbowL;
  // Both arms come round over the water together, out at the sides.
  const recovering = phase >= 0.62 ? Math.sin(((phase - 0.62) / 0.38) * Math.PI) : 0;
  out.armOutL = 0.1 + 0.75 * recovering;
  out.armOutR = out.armOutL;
  out.legOutL = 0;
  out.legOutR = 0;
  out.roll = 0;

  // The wave travels from the chest to the feet, so the body rises as the
  // arms pull and settles as they come over.
  const wave = Math.sin(phase * TAU - 0.9);
  out.legL = 0.3 * wave;
  out.legR = 0.3 * wave;
  out.kneeL = -0.35 * Math.max(0, wave);
  out.kneeR = -0.35 * Math.max(0, wave);

  // The head goes under and only comes up at the end of the pull.
  const breathe = Math.max(0, Math.sin(phase * TAU - 2.4));
  out.headPitch = -0.24 + breathe * 0.6;
  out.headYaw = 0;
  out.bodyPitch = 0.09 * wave;
  // The spine carries the wave a quarter of a cycle ahead of the legs.
  out.spine = 0.3 * Math.sin(phase * TAU - 0.9 + Math.PI / 2);
  out.bodyRoll = 0;
  out.bodyY = 0.02 * wave;
  out.bob = 0.026 * Math.max(0, wave);
  // Squash and stretch is not part of a stroke.
  out.stretch = 0;
  return out;
}

/**
 * Doggy paddle: the head stays above the water and the arms paddle.
 *
 * It is the stroke of somebody who cannot swim, and it is the one that
 * looks the most like a person on their front in the water.
 */
function doggy(out: Pose, t: number): Pose {
  out.rootRot = Math.PI / 2;
  const phase = ((t % 1) + 1) % 1;

  // The arms paddle forwards and down, one after the other.
  const paddle = Math.sin(phase * TAU);
  out.armL = 1.05 + paddle * 0.95;
  out.armR = 1.05 - paddle * 0.95;
  out.elbowL = 0.5 + Math.max(0, paddle) * 0.45;
  out.elbowR = 0.5 + Math.max(0, -paddle) * 0.45;

  // The legs kick breaststroke fashion.
  const kick = Math.sin(phase * TAU * 2);
  out.legL = 0.3 * kick;
  out.legR = 0.3 * Math.sin(phase * TAU * 2 + Math.PI);
  out.kneeL = -0.95 * Math.max(0, -kick);
  out.kneeR = -0.95 * Math.max(0, kick);

  // The chin is up, and the head looks forward along the water.
  out.headPitch = 0.34;
  out.headYaw = Math.sin(phase * TAU * 0.5) * 0.1;
  out.armOutL = 0.12;
  out.armOutR = 0.12;
  out.legOutL = 0.12;
  out.legOutR = 0.12;
  out.spine = 0;
  out.roll = 0;
  out.bodyPitch = -0.22;
  out.bodyRoll = 0;
  out.bodyY = 0;
  out.bob = 0.014 * Math.sin(phase * TAU * 2);
  // Squash and stretch is not part of a stroke.
  out.stretch = 0;
  return out;
}

/**
 * Backstroke: the swimmer lies on its back and the arms go over the head,
 * one after the other, each in a full turn.
 *
 * The arm angle wraps once a cycle, the way a wheel does: a full turn looks
 * the same as none. The shoulders rock with the stroke, and the legs flutter
 * at three times the rate of the arms.
 */
function backstroke(out: Pose, t: number): Pose {
  out.rootRot = Math.PI / 2;
  const phase = ((t % 1) + 1) % 1;
  const other = (phase + 0.5) % 1;

  // Half a turn about the long axis: the swimmer lies face up.
  out.roll = Math.PI + 0.45 * Math.sin(phase * TAU);
  // The arms are straight and go round over the head.
  out.armL = -phase * TAU;
  out.armR = -other * TAU;
  // The elbows stay just above the water, and bend in the half of the
  // circle that is under the body, where the hand pulls.
  out.elbowL = 0.1 + 0.6 * Math.max(0, Math.sin(phase * TAU));
  out.elbowR = 0.1 + 0.6 * Math.max(0, Math.sin(other * TAU));

  // The flutter kick, at three times the rate of the arms.
  const kick = Math.sin(phase * TAU * 3);
  out.legL = 0.22 * kick;
  out.legR = -0.22 * kick;
  out.kneeL = -0.15;
  out.kneeR = -0.15;

  // The head rests on the water and looks up at the sky.
  out.headPitch = 0.15;
  out.headYaw = 0;
  out.bob = 0.01 * Math.sin(phase * TAU * 2);
  out.bodyPitch = 0;
  out.bodyRoll = 0;
  out.bodyY = 0;
  out.spine = 0;
  out.armOutL = 0;
  out.armOutR = 0;
  out.legOutL = 0;
  out.legOutR = 0;
  out.stretch = 0;
  return out;
}

/**
 * Floating on the back, a star with the arms out: almost still, with a slow
 * scull of the hands. It is what a swimmer does while it waits for a plan to
 * come together.
 */
function floating(out: Pose, t: number): Pose {
  out.rootRot = Math.PI / 2;
  const phase = ((t % 1) + 1) % 1;

  out.roll = Math.PI;
  // The arms are out to the sides and the hands scull slowly.
  out.armL = 0.1;
  out.armR = 0.1;
  out.armOutL = 1.35;
  out.armOutR = 1.35;
  const scull = 0.2 + 0.1 * Math.sin(phase * TAU);
  out.elbowL = scull;
  out.elbowR = scull;
  // The legs are out to the sides, and the body barely moves.
  out.legOutL = 0.35;
  out.legOutR = 0.35;
  out.legL = 0;
  out.legR = 0;
  out.kneeL = 0;
  out.kneeR = 0;
  out.spine = -0.05;
  out.bob = 0.015 * Math.sin(phase * TAU);
  out.headPitch = 0;
  out.headYaw = 0;
  out.bodyPitch = 0;
  out.bodyRoll = 0;
  out.bodyY = 0;
  out.stretch = 0;
  return out;
}

export const SWIM_STYLES: Record<SwimStyle, SwimStyleInfo> = {
  crawl: { cadence: 0.55, fn: (out, t) => crawl(out, t) },
  breaststroke: { cadence: 0.38, fn: (out, t) => breaststroke(out, t) },
  butterfly: { cadence: 0.42, fn: (out, t) => butterfly(out, t) },
  doggy: { cadence: 0.75, fn: (out, t) => doggy(out, t) },
  backstroke: { cadence: 0.5, fn: (out, t) => backstroke(out, t) },
  float: { cadence: 0.2, fn: (out, t) => floating(out, t) },
};

/* ------------------------------------------------------------------ */
/* Reactions                                                           */
/* ------------------------------------------------------------------ */

/**
 * What a character does when something happens in the pool.
 *
 * A reaction is an offset, not a posture: it is added on top of whatever
 * the character is doing, so a character can wave while it is lying down
 * or while it is swimming.
 */
export type ReactionKind = 'wave' | 'waveLying' | 'look';

/** How long a reaction lasts, in seconds. */
export const REACTION_DURATION_S = 2.4;

/**
 * The offset of a reaction at the progress `u`.
 *
 * The angles follow the convention of the rest of the file: they are
 * measured from straight down, and negative means backwards. The head
 * follows the waving hand a little, the way a person does.
 *
 * A character that lies down needs its own wave. The body of a lounger
 * character is turned a quarter turn, so the same shoulder angle would
 * send the arm out sideways instead of up into the air.
 */
export function reactionDelta(out: Pose, kind: ReactionKind, u: number): Pose {
  resetPose(out);
  const wave = Math.sin(u * TAU * 3.5);
  const lift = Math.min(1, u * 6) * Math.min(1, (1 - u) * 6);
  switch (kind) {
    case 'wave': {
      // The arm goes up and waves; the elbow does the waving.
      out.armR = -2.35 * lift;
      out.elbowR = 0.3 + 0.5 * wave * lift;
      out.headPitch = 0.1 * lift;
      out.headYaw = -0.2 * lift;
      out.bob = Math.sin(u * TAU * 2) * 0.008 * lift;
      break;
    }
    case 'waveLying': {
      // The body of a lounger character is turned a quarter turn, so the
      // shoulder angle that lifts the arm into the air is a quarter turn
      // further round than the one that does it for a standing character.
      // The base pose hangs the arm at -0.3, and the arm points straight
      // up at about 1.57.
      out.armR = 1.87 * lift;
      out.elbowR = 0.3 + 0.55 * wave * lift;
      out.headPitch = -0.35 * lift;
      out.headYaw = 0.15 * lift;
      out.bob = Math.sin(u * TAU * 2) * 0.008 * lift;
      break;
    }
    case 'look': {
      // The head comes up out of the water.
      out.headPitch = -0.5 * lift;
      out.headYaw = 0.18 * lift;
      break;
    }
    default:
      break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Idle activities                                                     */
/* ------------------------------------------------------------------ */

/**
 * An idle activity is just another pose layer, driven by a normalised progress
 * `u` across the whole activity duration.
 */
export function activityPose(
  out: Pose,
  activity: IdleActivity,
  u: number,
  motion: Motion,
): Pose {
  loungePose(out, motion);
  // The angles are measured in the frame of the body, which leans back
  // against the lounger. A positive shoulder angle is forwards, and a
  // positive elbow brings the forearm up towards the face.
  switch (activity) {
    case 'tea': {
      // Reach for the cup, bring it to the mouth, sip, lower it again.
      const lift = pulse(u, 0.05, 0.75);
      const sip = pulse(u, 0.3, 0.6);
      out.armR = 0.2 + 1.05 * lift;
      out.elbowR = 0.7 + 1.65 * lift;
      out.headPitch = -0.3 - 0.12 * sip;
      out.headYaw = 0.06 * lift;
      out.bob += Math.sin(u * TAU * 3) * 0.002 * sip;
      break;
    }
    case 'book': {
      // The book is held up in front of the chest; now and then a page is
      // turned with the left hand.
      const turn = pulse(u, 0.55, 0.7);
      out.armR = 0.85;
      out.elbowR = 1.45;
      out.armL = 0.8 + 0.35 * turn;
      out.elbowL = 1.4 + 0.3 * turn;
      out.headPitch = -0.48;
      out.headYaw = 0.05 * Math.sin(u * TAU * 2);
      break;
    }
    case 'phone': {
      // The phone is in front of the face, and the thumb scrolls.
      const scroll = Math.sin(u * TAU * 6);
      out.armR = 0.75;
      out.elbowR = 1.75 + 0.04 * scroll;
      out.headPitch = -0.5;
      out.headYaw = 0.04 * scroll;
      break;
    }
    case 'sunbathe': {
      // The hands are folded behind the head: the upper arms go up and
      // back, and the forearms come down behind the head. The forearms
      // used to point backwards, and they stuck out of the head like horns.
      out.armL = -2.7;
      out.armR = -2.65;
      out.elbowL = 2.45;
      out.elbowR = 2.4;
      out.headPitch = -0.1;
      break;
    }
    case 'nap': {
      // The hands are folded on the belly, and the head has rolled to one
      // side.
      out.armL = 0.35;
      out.armR = 0.3;
      out.elbowL = 0.95;
      out.elbowR = 1.0;
      out.headPitch = -0.12;
      out.headYaw = 0.3;
      out.bob += Math.sin(u * TAU * 4) * 0.006;
      break;
    }
    case 'stretch': {
      // Both arms go up over the head, and the legs stretch out.
      const stretch = pulse(u, 0.1, 0.8);
      out.armL = 0.25 + 2.75 * stretch;
      out.armR = 0.2 + 2.7 * stretch;
      out.elbowL = 0.75 - 0.6 * stretch;
      out.elbowR = 0.7 - 0.55 * stretch;
      out.kneeL = -0.12 + 0.1 * stretch;
      out.kneeR = -0.2 + 0.18 * stretch;
      out.headPitch = -0.3 + 0.25 * stretch;
      break;
    }
    case 'snack': {
      // The ice lolly goes to the mouth and back.
      const bite = pulse(u, 0.2, 0.9);
      const chew = Math.abs(Math.sin(u * TAU * 8));
      out.armR = 0.3 + 0.9 * bite;
      out.elbowR = 0.8 + 1.5 * bite;
      out.headPitch = -0.34 + chew * 0.04;
      break;
    }
    case 'chat': {
      // The hand talks.
      const gesture = Math.sin(u * TAU * 3);
      out.armR = 0.7 + gesture * 0.35;
      out.elbowR = 0.9 + Math.max(0, gesture) * 0.4;
      out.headPitch = -0.2;
      out.headYaw = 0.25;
      break;
    }
    case 'newspaper': {
      // Both hands hold the paper up; every now and then a page is turned.
      const turn = pulse(u, 0.45, 0.75);
      out.armL = 0.95 + 0.2 * turn;
      out.armR = 0.9;
      out.elbowL = 1.3;
      out.elbowR = 1.35;
      out.headPitch = -0.45;
      out.headYaw = 0.04 * Math.sin(u * TAU * 2);
      out.bob += 0.004 * turn;
      break;
    }
    case 'cards': {
      // The cards are dealt out one by one onto the lap.
      const deal = pulse(u, 0.2, 0.55);
      const hand = pulse(u, 0.6, 0.9);
      out.armL = 0.6 + 0.4 * hand;
      out.elbowL = 1.2 + 0.3 * hand;
      out.armR = 0.7 + 0.35 * deal;
      out.elbowR = 1.1 - 0.4 * deal;
      out.headPitch = -0.5;
      out.headYaw = -0.12;
      break;
    }
    case 'call': {
      // The phone is at the ear and the other hand talks.
      const gesture = Math.sin(u * TAU * 2.5);
      out.armR = 0.55;
      out.elbowR = 2.45;
      out.armL = 0.55 + 0.3 * gesture;
      out.elbowL = 0.9 + 0.25 * Math.max(0, gesture);
      out.headPitch = -0.22;
      out.headYaw = 0.12 + 0.06 * gesture;
      break;
    }
    case 'none':
    default:
      break;
  }
  return out;
}
