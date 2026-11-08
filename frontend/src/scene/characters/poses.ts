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
}

export function zeroPose(): Pose {
  return {
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
  };
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
  return out;
}

const TAU = Math.PI * 2;

/** A smooth 0 -> 1 -> 0 bump over [a, b] of the unit cycle. */
export function pulse(t: number, a: number, b: number): number {
  if (t < a || t > b) return 0;
  const u = (t - a) / (b - a);
  return Math.sin(u * Math.PI) ** 2;
}

/** A ramp that rises from 0 to 1 over [0, period) and resets. */
export function sawtooth(t: number, period: number): number {
  const u = (t % period) / period;
  return u;
}

/** A ramp that falls from 1 to 0 over [0, period) and resets. */
export function rampDown(t: number, period: number): number {
  return 1 - sawtooth(t, period);
}

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

/** Standing idle: arms slightly away from the body, a slow breath. */
export function restPose(out: Pose, t: number): Pose {
  out.rootRot = 0;
  out.bodyPitch = 0.02;
  out.bodyRoll = 0;
  out.bodyY = 0;
  out.headPitch = 0;
  out.headYaw = Math.sin(t * TAU * 0.12) * 0.12;
  out.armL = 0.16 + Math.sin(t * TAU * 0.25) * 0.03;
  out.armR = -0.16 + Math.sin(t * TAU * 0.25 + 1) * 0.03;
  out.elbowL = 0.14;
  out.elbowR = 0.14;
  out.legL = 0.04;
  out.legR = -0.04;
  out.kneeL = 0.03;
  out.kneeR = 0.03;
  out.bob = Math.sin(t * TAU * 0.28) * 0.006;
  return out;
}

/**
 * Lying on a lounger. The body is rotated a quarter turn so the head points
 * along +x; in body space the arms and legs then simply hang towards the feet.
 */
export function loungePose(out: Pose, t: number): Pose {
  out.rootRot = Math.PI / 2;
  out.bodyPitch = -0.06;
  out.bodyRoll = 0;
  out.bodyY = 0;
  out.headPitch = -0.22;
  out.headYaw = Math.sin(t * TAU * 0.09) * 0.14;
  out.armL = 0.34;
  out.armR = -0.3;
  out.elbowL = 0.5;
  out.elbowR = 0.46;
  out.legL = 0.1;
  out.legR = -0.05;
  out.kneeL = 0.14;
  out.kneeR = 0.1;
  out.bob = Math.sin(t * TAU * 0.22) * 0.008;
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
  out.kneeL = 0.45 * Math.max(0, -s);
  out.kneeR = 0.45 * Math.max(0, s);
  out.armL = -0.38 * s;
  out.armR = 0.38 * s;
  out.elbowL = 0.22;
  out.elbowR = 0.22;
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
  out.armL = -2.5 + 0.7 * u;
  out.armR = -2.5 + 0.7 * u;
  out.elbowL = 0.5 - 0.4 * u;
  out.elbowR = 0.5 - 0.4 * u;
  out.legL = 0.5 - 0.4 * u;
  out.legR = 0.2 - 0.1 * u;
  out.kneeL = 0.7 - 0.6 * u;
  out.kneeR = 0.5 - 0.4 * u;
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

/** Crawl (freestyle): two arm strokes per body cycle, flutter kick at 2x. */
function crawl(out: Pose, t: number): Pose {
  out.rootRot = Math.PI / 2; // lying in the water, head towards +x
  const s = Math.sin(t * TAU);
  const s2 = Math.sin(t * TAU * 2);
  out.bodyPitch = 0.06;
  out.bodyRoll = 0.16 * s;
  out.bodyY = 0;
  out.headPitch = -0.12 + 0.1 * s;
  out.headYaw = -0.24 * pulse(t, 0.55, 0.85);
  out.armL = 1.15 * s;
  out.armR = 1.15 * Math.sin(t * TAU + Math.PI);
  out.elbowL = 0.95 * Math.max(0, Math.sin(t * TAU - 0.9));
  out.elbowR = 0.95 * Math.max(0, Math.sin(t * TAU + Math.PI - 0.9));
  out.legL = 0.42 * s2;
  out.legR = 0.42 * Math.sin(t * TAU * 2 + Math.PI);
  out.kneeL = 0.35 * Math.max(0, s2);
  out.kneeR = 0.35 * Math.max(0, -s2);
  out.bob = 0.004 * s2;
  return out;
}

/** Breaststroke: symmetric pull, knees snap in, head lifts to breathe. */
function breaststroke(out: Pose, t: number): Pose {
  out.rootRot = Math.PI / 2; // lying in the water, head towards +x
  const pull = 1 - sawtooth(t, 0.35);
  out.bodyPitch = -0.3 * pulse(t, 0.25, 0.5);
  out.bodyRoll = 0;
  out.bodyY = 0;
  out.headPitch = -0.85 * pulse(t, 0.02, 0.28);
  out.headYaw = 0;
  out.armL = -0.95 + 1.55 * pull;
  out.armR = out.armL;
  out.elbowL = 0.15 + 0.55 * pulse(t, 0.0, 0.35);
  out.elbowR = out.elbowL;
  out.legL = 0.3 * pulse(t, 0.85, 1.0);
  out.legR = out.legL;
  out.kneeL = 1.35 * pulse(t, 0.45, 0.85);
  out.kneeR = out.kneeL;
  out.bob = 0.006 * Math.sin(t * TAU);
  return out;
}

/** Butterfly: one big arm arc, the body wave travels chest to feet. */
function butterfly(out: Pose, t: number): Pose {
  out.rootRot = Math.PI / 2; // lying in the water, head towards +x
  out.bodyPitch = 0.22 * Math.sin(t * TAU);
  out.bodyRoll = 0;
  out.bodyY = 0.03 * Math.sin(t * TAU * 2 - 0.6);
  out.headPitch = -0.25 * pulse(t, 0.55, 0.9);
  out.headYaw = 0;
  out.armL = -1.35 * Math.sin(Math.PI * t);
  out.armR = out.armL;
  out.elbowL = 0.25;
  out.elbowR = 0.25;
  out.legL = 0.55 * Math.sin(t * TAU * 2 + 0.6);
  out.legR = out.legL;
  out.kneeL = 0.2 * Math.max(0, -Math.sin(t * TAU * 2));
  out.kneeR = out.kneeL;
  out.bob = 0;
  return out;
}

/** Doggy paddle: head above the water, limbs paddling fast. */
function doggy(out: Pose, t: number): Pose {
  out.rootRot = Math.PI / 2; // lying in the water, head towards +x
  const s = Math.sin(t * TAU * 2);
  out.bodyPitch = -0.25;
  out.bodyRoll = 0;
  out.bodyY = 0.014 * s;
  out.headPitch = -0.95;
  out.headYaw = Math.sin(t * TAU * 0.5) * 0.1;
  out.armL = 0.7 * s;
  out.armR = 0.7 * Math.sin(t * TAU * 2 + Math.PI);
  out.elbowL = 0.3;
  out.elbowR = 0.3;
  out.legL = 0.4 * Math.sin(t * TAU * 2 + 0.5);
  out.legR = 0.4 * Math.sin(t * TAU * 2 + 0.5 + Math.PI);
  out.kneeL = 0.2;
  out.kneeR = 0.2;
  out.bob = 0.01 * s;
  return out;
}

export const SWIM_STYLES: Record<SwimStyle, SwimStyleInfo> = {
  crawl: { cadence: 0.55, fn: (out, t) => crawl(out, t) },
  breaststroke: { cadence: 0.38, fn: (out, t) => breaststroke(out, t) },
  butterfly: { cadence: 0.42, fn: (out, t) => butterfly(out, t) },
  doggy: { cadence: 0.75, fn: (out, t) => doggy(out, t) },
};

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
  _spec: CharacterSpec,
): Pose {
  loungePose(out, 0);
  switch (activity) {
    case 'tea': {
      // Reach for the cup, hold it to the mouth, sip, lower it again.
      const lift = pulse(u, 0.05, 0.75);
      const sip = pulse(u, 0.3, 0.6);
      out.armR = -0.3 - 2.5 * lift;
      out.elbowR = 0.46 + 1.1 * lift;
      out.headPitch = -0.22 - 0.16 * sip;
      out.headYaw = -0.1 * lift;
      out.bob = Math.sin(u * TAU * 3) * 0.002 * sip;
      break;
    }
    case 'book': {
      const turn = pulse(u, 0.55, 0.7);
      out.armL = 0.34 - 0.55 * (1 - turn);
      out.armR = -0.3 + 0.55 * (1 - turn);
      out.elbowL = 0.5 + 0.45 * (1 - turn);
      out.elbowR = 0.46 + 0.45 * (1 - turn);
      out.headPitch = -0.22 - 0.35;
      out.headYaw = 0.05 * Math.sin(u * TAU * 2);
      break;
    }
    case 'phone': {
      const scroll = Math.sin(u * TAU * 6);
      out.armR = -0.3 - 1.9;
      out.elbowR = 0.46 + 1.0;
      out.headPitch = -0.22 - 0.42;
      out.headYaw = 0.06 * scroll;
      break;
    }
    case 'sunbathe': {
      // Arms folded behind the head.
      out.armL = Math.PI - 0.35;
      out.armR = -Math.PI + 0.35;
      out.elbowL = 1.1;
      out.elbowR = 1.1;
      out.headPitch = -0.1;
      break;
    }
    case 'nap': {
      out.headPitch = -0.02;
      out.armL = 0.5;
      out.armR = -0.45;
      out.bob = Math.sin(u * TAU * 4) * 0.012;
      break;
    }
    case 'stretch': {
      const stretch = pulse(u, 0.1, 0.8);
      out.armL = 0.34 - 1.6 * stretch;
      out.elbowL = 0.5 + 0.6 * stretch;
      out.legL = 0.1 - 0.5 * stretch;
      out.kneeL = 0.14 + 0.5 * stretch;
      out.headPitch = -0.22 + 0.12 * stretch;
      break;
    }
    case 'snack': {
      const chew = Math.abs(Math.sin(u * TAU * 8));
      out.armR = -0.3 - 2.1;
      out.elbowR = 0.46 + 0.9;
      out.headPitch = -0.22 - 0.1 + chew * 0.05;
      break;
    }
    case 'chat': {
      const gesture = Math.sin(u * TAU * 3);
      out.armR = -0.3 - 0.9 + gesture * 0.5;
      out.elbowR = 0.46 + 0.7;
      out.headPitch = -0.22 + 0.2;
      out.headYaw = 0.25;
      break;
    }
    case 'none':
    default:
      break;
  }
  return out;
}
