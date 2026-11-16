/**
 * The action layer: short things a character does on top of what it is
 * doing.
 *
 * A reaction is an offset and lasts a moment. An action can last longer,
 * can loop, and can even take the place of the posture underneath: a
 * character that is told to tread water stops swimming and holds itself
 * upright, and a character that hops keeps its own legs.
 *
 * Every action writes its pose into a buffer the driver owns, so the frame
 * does not allocate. The angles follow the convention of `poses.ts`: every
 * joint angle is measured from straight down, positive means forward, and a
 * knee bends backwards, so it is negative.
 */

import { copyPose, loungePose, resetPose, zeroPose, type Motion, type Pose } from '../characters/poses';
import { fbm } from '../characters/noise';

export type ActionKind =
  | 'cheer'
  | 'clap'
  | 'raiseHand'
  | 'raiseHandLying'
  | 'tread'
  | 'hop'
  | 'stepUp'
  | 'blockReady'
  | 'dive'
  | 'pike'
  | 'pencil'
  | 'slideSit'
  | 'slideRide'
  | 'cannonball'
  | 'flipTurn'
  | 'wallRest'
  | 'pushUp'
  | 'shower'
  | 'headShake'
  | 'reach'
  | 'tubSit'
  | 'stepOver'
  | 'pingPong'
  | 'catch'
  | 'throw'
  | 'chatStand'
  | 'stroll'
  | 'towelShake'
  | 'sunscreen'
  | 'loungeSide'
  | 'loungeSitUp'
  | 'checkWatch'
  | 'shiftWeight'
  | 'stretchArms'
  | 'cover';

export interface ActionSpec {
  /** Seconds for one play, or one loop. */
  seconds: number;
  /**
   * 'replace' blends the whole pose towards the action's pose;
   * 'add' adds the action's pose as an offset, as a reaction does.
   */
  mode: 'replace' | 'add';
  /** Writes the action's pose at progress u (0..1) into out. */
  pose(out: Pose, u: number, motion: Motion): Pose;
  /** How open the mouth is at u (0 closed .. 1 wide). Optional. */
  mouth?(u: number): number;
  /** True when the action loops until it is released. */
  loop?: boolean;
}

const TAU = Math.PI * 2;

/** Both arms up, the way a person cheers. */
function cheer(out: Pose, u: number): Pose {
  resetPose(out);
  // The lift goes up and comes down again, so the arms are up in the middle
  // of the cheer and not at the ends of it.
  const lift = Math.sin(Math.min(1, u) * Math.PI);
  out.armL = -2.6 * lift;
  out.armR = -2.6 * lift;
  // The elbows are almost straight.
  out.elbowL = 0.2;
  out.elbowR = 0.2;
  // The head goes back to look up at what it is cheering at.
  out.headPitch = 0.15 * lift;
  // The whole body stretches at the top of the cheer.
  out.stretch = 0.08 * lift;
  // A small hop off the ground.
  out.bob = 0.05 * Math.sin(Math.min(1, u) * Math.PI);
  return out;
}

/** The hands come together in front of the chest, five times. */
function clap(out: Pose, u: number): Pose {
  resetPose(out);
  out.armL = 1.2;
  out.armR = 1.2;
  // The elbows do the clapping: they open and close five times.
  out.elbowL = 1.1 + 0.25 * Math.sin(u * TAU * 5);
  out.elbowR = 1.1 + 0.25 * Math.sin(u * TAU * 5);
  out.headPitch = -0.05;
  return out;
}

/** One arm up, waving slowly. */
function raiseHand(out: Pose, u: number): Pose {
  resetPose(out);
  out.armR = -2.7;
  // The wave comes from the elbow, so the hand swings.
  out.elbowR = 0.25 * Math.sin(u * TAU);
  out.headPitch = -0.1;
  return out;
}

/** The same, for a figure that is lying on a lounger. */
function raiseHandLying(out: Pose, u: number): Pose {
  resetPose(out);
  // The body of a lounger character is turned a quarter turn, so the
  // shoulder angle that lifts the arm into the air is a quarter turn
  // further round than the one that does it for a standing character.
  out.armR = 1.87;
  // The wave of the lying reaction runs at three and a half cycles a loop;
  // here it runs at a third of that, because this is a slow, held gesture.
  out.elbowR = 0.3 + 0.55 * Math.sin(u * TAU * (3.5 / 3));
  out.headPitch = -0.15;
  return out;
}

/**
 * Upright in the water, sculling with the arms.
 *
 * The driver's treading state plays this same pose, looped, so a swimmer
 * that treads water for minutes and an action that treads for a moment
 * look the same.
 */
export function treadPose(out: Pose, u: number): Pose {
  resetPose(out);
  const beat = Math.sin(u * TAU);
  out.bodyPitch = 0.05;
  // The arms scull out to the side.
  out.armOutL = 0.9 + 0.25 * beat;
  out.armOutR = 0.9 + 0.25 * beat;
  out.armL = 0.4;
  out.armR = 0.4;
  out.elbowL = 0.6;
  out.elbowR = 0.6;
  // The legs go round in a slow eggbeater.
  out.legL = 0.35 * beat;
  out.legR = -0.35 * beat;
  out.kneeL = -0.6;
  out.kneeR = -0.6;
  out.bob = 0.02 * Math.sin(u * TAU * 2);
  return out;
}

/** A crouch, a jump and a landing. */
function hop(out: Pose, u: number): Pose {
  resetPose(out);
  if (u < 0.3) {
    // The crouch.
    const k = u / 0.3;
    out.stretch = -0.15 * k;
    out.kneeL = -0.5 * k;
    out.kneeR = -0.5 * k;
  } else if (u < 0.7) {
    // The jump: the body goes up and stretches.
    const k = (u - 0.3) / 0.4;
    out.stretch = 0.12 * Math.sin(k * Math.PI);
    out.bob = 0.22 * Math.sin(k * Math.PI);
    out.kneeL = -0.5 * (1 - k);
    out.kneeR = -0.5 * (1 - k);
  } else {
    // The landing, and the settle.
    const k = (u - 0.7) / 0.3;
    out.stretch = -0.1 * (1 - k);
    out.kneeL = -0.35 * (1 - k);
    out.kneeR = -0.35 * (1 - k);
    out.bob = -0.04 * (1 - k);
  }
  return out;
}


/** One knee up and then the other, on the way onto a block or a board. */
function stepUp(out: Pose, u: number): Pose {
  resetPose(out);
  const lift = Math.sin(Math.min(1, u) * Math.PI);
  out.legL = 1.3 * lift;
  out.kneeL = -1.0 * lift;
  out.legR = -0.2 + 0.4 * (1 - lift);
  out.armL = -0.6 * lift;
  out.armR = 0.6 * lift;
  out.elbowL = 0.3;
  out.elbowR = 0.3;
  return out;
}

/** The crouch on the block: the body pitched forward, the hands to the edge, the knees bent. */
function blockReady(out: Pose): Pose {
  resetPose(out);
  out.rootRot = 0.9;
  out.armL = 1.9;
  out.armR = 1.9;
  out.elbowL = 0.2;
  out.elbowR = 0.2;
  out.legL = 0.6;
  out.legR = 0.6;
  out.kneeL = -0.7;
  out.kneeR = -0.7;
  out.stretch = -0.05;
  out.headPitch = 0.3;
  return out;
}

/** The dive: the body turns from the crouch to flat, the arms straight ahead past the head. */
function dive(out: Pose, u: number): Pose {
  resetPose(out);
  const s = u * u * (3 - 2 * u);
  out.rootRot = 0.9 + (Math.PI / 2 - 0.9) * s;
  out.armL = 2.9;
  out.armR = 2.9;
  out.elbowL = 0;
  out.elbowR = 0;
  out.stretch = 0.12;
  return out;
}

/** The pike from the board: folded at the hips in the first half of the flight, then straight. */
function pike(out: Pose, u: number): Pose {
  resetPose(out);
  const fold = 1 - Math.min(1, Math.max(0, (u - 0.3) / 0.4));
  out.legL = 2.2 * fold;
  out.legR = 2.2 * fold;
  out.armL = 2.2 * fold;
  out.armR = 2.2 * fold;
  out.stretch = 0.06;
  return out;
}

/** The pencil from the board: upright and straight, the arms at the sides, feet first. */
function pencil(out: Pose): Pose {
  resetPose(out);
  out.armL = 0.05;
  out.armR = 0.05;
  out.stretch = 0.1;
  return out;
}

/** Sitting down at the top of the slide, the legs straight out in front. */
function slideSit(out: Pose): Pose {
  resetPose(out);
  out.legL = 1.5;
  out.legR = 1.5;
  out.armL = -0.5;
  out.armR = -0.5;
  out.elbowL = 2.0;
  out.elbowR = 2.0;
  return out;
}

/** The ride: leaning back, both arms up, the way people ride a slide. */
function slideRide(out: Pose, u: number): Pose {
  resetPose(out);
  out.bodyPitch = -0.6;
  out.legL = 1.5;
  out.legR = 1.5;
  out.armL = -2.6;
  out.armR = -2.6;
  out.elbowL = 0.2;
  out.elbowR = 0.2;
  out.headPitch = 0.1 * Math.sin(u * TAU);
  return out;
}

/** The cannonball: knees to the chest, arms wrapped round them, the body rolling forward. */
function cannonball(out: Pose, u: number): Pose {
  resetPose(out);
  const s = u * u * (3 - 2 * u);
  out.legL = 2.0;
  out.legR = 2.0;
  out.kneeL = -2.3;
  out.kneeR = -2.3;
  out.armL = 1.2;
  out.armR = 1.2;
  out.elbowL = 2.0;
  out.elbowR = 2.0;
  out.rootRot = 0.6 * s;
  return out;
}

/** The flip turn: one whole roll over the water, tucked. */
function flipTurn(out: Pose, u: number): Pose {
  resetPose(out);
  const s = u * u * (3 - 2 * u);
  out.rootRot = TAU * s;
  out.kneeL = -2.0;
  out.kneeR = -2.0;
  out.legL = 1.8;
  out.legR = 1.8;
  out.armL = 2.4;
  out.armR = 2.4;
  return out;
}

/** Resting at the wall: the back to it, both elbows on the coping, the head turning slowly. */
function wallRest(out: Pose, u: number): Pose {
  resetPose(out);
  const beat = Math.sin(u * TAU);
  out.armL = -2.2;
  out.armR = -2.2;
  out.armOutL = 1.2;
  out.armOutR = 1.2;
  out.elbowL = 1.4;
  out.elbowR = 1.4;
  out.headYaw = 0.4 * beat;
  out.legL = 0.35 * beat;
  out.legR = -0.35 * beat;
  out.kneeL = -0.6;
  out.kneeR = -0.6;
  return out;
}

/** Getting out over the edge: the arms straighten on the coping and the legs hang in the water. */
function pushUp(out: Pose, u: number): Pose {
  resetPose(out);
  const s = u * u * (3 - 2 * u);
  out.armL = -0.6 - 0.6 * (1 - s);
  out.armR = -0.6 - 0.6 * (1 - s);
  out.legL = 1.2;
  out.legR = 1.2;
  out.kneeL = -0.3;
  out.kneeR = -0.3;
  return out;
}

/**
 * A character sitting on the edge of the pool, its feet in the water.
 *
 * It is a layer of the pose, not an action: it is held for as long as the
 * character waits there. The knees kick, each foot on its own timing, so the
 * two are never in step.
 */
export function edgeSitPose(out: Pose, t: number, seed: number): Pose {
  resetPose(out);
  const phase = (seed % 97) * 0.13;
  out.legL = 1.45;
  out.legR = 1.45;
  out.kneeL = -1.4 + 0.35 * Math.sin(t * TAU * 0.7 + phase);
  out.kneeR = -1.4 + 0.35 * Math.sin(t * TAU * 0.7 + Math.PI + phase * 0.5);
  out.armL = -0.5;
  out.armR = -0.5;
  out.elbowL = 0.2;
  out.elbowR = 0.2;
  return out;
}

/** A bump that starts at 0, peaks at the middle of the window [a, b] and ends at 0. */
function bumpIn(u: number, a: number, b: number): number {
  const k = Math.min(1, Math.max(0, (u - a) / (b - a)));
  return Math.sin(k * Math.PI);
}

/** Standing under the shower, the face up and both hands rubbing the head. */
function showerPose(out: Pose, u: number): Pose {
  resetPose(out);
  out.headPitch = -0.5;
  out.armL = -2.5;
  out.armR = -2.5;
  const rub = 2.2 + 0.3 * Math.sin(u * TAU * 3);
  out.elbowL = rub;
  out.elbowR = rub;
  return out;
}

/** Shaking the water out of the hair: the head swings from side to side, fading. */
function headShake(out: Pose, u: number): Pose {
  resetPose(out);
  out.headYaw = 0.5 * Math.sin(u * TAU * 4) * (1 - u);
  return out;
}

/** The right arm reaches forward for the fridge door, and comes back. */
function reach(out: Pose, u: number): Pose {
  resetPose(out);
  out.armR = 1.4 * Math.sin(Math.min(1, u) * Math.PI);
  out.elbowR = 0.2;
  return out;
}

/** Sitting deep in the tub: leaning back, the arms along the rim and the head back. */
function tubSit(out: Pose, u: number): Pose {
  resetPose(out);
  out.bodyPitch = -0.5;
  out.legL = 1.4;
  out.legR = 1.4;
  out.kneeL = -0.1;
  out.kneeR = -0.1;
  out.armOutL = 1.3;
  out.armOutR = 1.3;
  out.armL = -0.3;
  out.armR = -0.3;
  out.headPitch = -0.25;
  out.bob = 0.01 * Math.sin(u * TAU);
  return out;
}

/** One knee up over the rim and then the other: getting into the tub. */
function stepOver(out: Pose, u: number): Pose {
  resetPose(out);
  const left = bumpIn(u, 0, 0.5);
  const right = bumpIn(u, 0.5, 1);
  out.legL = 1.4 * left;
  out.kneeL = -1.0 * left;
  out.legR = 1.4 * right;
  out.kneeR = -1.0 * right;
  out.armL = -0.5 * left;
  out.armR = -0.5 * right;
  return out;
}

/** Standing at the table, the knees soft, and a forehand at the start of each stroke. */
function pingPongPose(out: Pose, u: number): Pose {
  resetPose(out);
  out.kneeL = -0.25;
  out.kneeR = -0.25;
  out.bodyPitch = 0.25;
  out.armL = 0.6;
  out.elbowL = 1.0;
  if (u < 0.15) {
    const k = u / 0.15;
    out.armR = 0.2 + 1.2 * k;
    out.elbowR = 0.9;
  } else {
    const back = Math.min(1, (u - 0.15) / 0.3);
    out.armR = 1.4 - 0.8 * back;
    out.elbowR = 0.9;
  }
  return out;
}

/** Both arms up in front to catch the ball. */
function catchPose(out: Pose, u: number): Pose {
  resetPose(out);
  const lift = bumpIn(u, 0, 1);
  out.armL = 2.0 * lift;
  out.armR = 2.0 * lift;
  out.elbowL = 0.4;
  out.elbowR = 0.4;
  return out;
}

/** Both arms back over the head, then forward to throw. */
function throwPose(out: Pose, u: number): Pose {
  resetPose(out);
  const arm = u < 0.5 ? -2.8 * (u / 0.5) : -2.8 + 4.0 * ((u - 0.5) / 0.5);
  out.armL = arm;
  out.armR = arm;
  out.stretch = 0.06 * bumpIn(u, 0.4, 0.7);
  return out;
}

/** Talking in a group: the right hand gestures, the head nods a little. */
function chatStandPose(out: Pose, u: number): Pose {
  resetPose(out);
  out.armR = 0.6 + 0.3 * Math.sin(u * TAU * 2);
  out.elbowR = 0.5;
  out.headPitch = 0.08 * Math.sin(u * TAU * 3);
  out.armL = 0.1;
  return out;
}

/** A walk round the pool: the hands behind the back, the head looking about. */
function strollPose(out: Pose, u: number, motion: Motion): Pose {
  resetPose(out);
  out.armL = -0.45;
  out.armR = -0.45;
  out.elbowL = 0.7;
  out.elbowR = 0.7;
  out.headYaw = 0.5 * fbm(motion.t * 0.25 + u, motion.seed);
  return out;
}

/** The towel held in both hands in front, shaken up and down. */
function towelShakePose(out: Pose, u: number): Pose {
  resetPose(out);
  const shake = 0.5 * Math.sin(u * TAU * 4);
  out.armL = 1.2 + shake;
  out.armR = 1.2 + shake;
  out.elbowL = 1.0;
  out.elbowR = 1.0;
  return out;
}

/** The sunscreen: the right hand rubs the left arm, then the legs. Added to the lounge. */
function sunscreenPose(out: Pose, u: number): Pose {
  resetPose(out);
  if (u < 0.5) {
    const k = u / 0.5;
    out.armR = 0.4 + 0.8 * k;
    out.elbowR = 1.6;
    out.armL = -0.2;
    out.elbowL = 0.3;
  } else {
    const k = (u - 0.5) / 0.5;
    out.armR = 0.9 - 0.3 * k;
    out.elbowR = 1.6;
    out.legL = 0.3 * Math.sin(k * Math.PI * 2);
    out.kneeL = -0.2 * Math.sin(k * Math.PI * 2);
  }
  return out;
}

/** Rolled onto the side, the lower arm under the head. Added to the lounge. */
function loungeSide(out: Pose): Pose {
  resetPose(out);
  out.roll = 1.1;
  out.armL = -2.6;
  out.elbowL = 2.2;
  out.armR = 0.3;
  out.kneeL = -0.6;
  out.kneeR = -0.6;
  return out;
}

/** Sitting up on the lounger, the elbows on the knees. Added to the lounge. */
function loungeSitUp(out: Pose, u: number): Pose {
  resetPose(out);
  out.bodyPitch = 0.55;
  out.armL = 1.3;
  out.armR = 1.3;
  out.elbowL = 1.4;
  out.elbowR = 1.4;
  out.headYaw = 0.35 * Math.sin(u * TAU);
  return out;
}

/** Glancing at the watch on the left wrist. */
function checkWatch(out: Pose, u: number): Pose {
  resetPose(out);
  const b = bumpIn(u, 0, 1);
  out.armL = 1.2 * b;
  out.elbowL = 2.0 * b;
  out.headPitch = 0.25 * b;
  return out;
}

/** Shifting the weight from one leg to the other. */
function shiftWeight(out: Pose, u: number): Pose {
  resetPose(out);
  out.bodyRoll = 0.06 * Math.sin(u * TAU);
  out.kneeR = -0.35 * bumpIn(u, 0, 1);
  return out;
}

/** Stretching the arms up and back. */
function stretchArms(out: Pose, u: number): Pose {
  resetPose(out);
  const b = bumpIn(u, 0, 1);
  out.armL = -2.4 * b;
  out.armR = -2.4 * b;
  out.stretch = 0.05 * b;
  return out;
}

/** The lounge pose the cover is built on: the figure lies as it does, and the arms come up. */
const coverBase = zeroPose();

/**
 * A towel over the head, held with both hands: the lounge, with the arms up
 * and the elbows bent, and the head bowed. It replaces the lounge pose, so
 * the figure is covered rather than lying with a towel on top.
 */
function cover(out: Pose, motion: Motion): Pose {
  loungePose(coverBase, motion);
  copyPose(coverBase, out);
  out.armL = -2.4;
  out.armR = -2.4;
  out.elbowL = 2.0;
  out.elbowR = 2.0;
  out.headPitch = 0.2;
  return out;
}

export const ACTIONS: Record<ActionKind, ActionSpec> = {
  cover: {
    seconds: 2,
    mode: 'replace',
    pose: (out, _u, motion) => cover(out, motion),
  },
  cheer: {
    seconds: 1.6,
    mode: 'add',
    pose: (out, u) => cheer(out, u),
    mouth: () => 0.9,
  },
  clap: {
    seconds: 2.0,
    mode: 'add',
    pose: (out, u) => clap(out, u),
    mouth: () => 0.5,
  },
  raiseHand: {
    seconds: 2.4,
    mode: 'add',
    loop: true,
    pose: (out, u) => raiseHand(out, u),
    mouth: () => 0.25,
  },
  raiseHandLying: {
    seconds: 2.4,
    mode: 'add',
    loop: true,
    pose: (out, u) => raiseHandLying(out, u),
    mouth: () => 0.25,
  },
  tread: {
    seconds: 2.0,
    mode: 'replace',
    loop: true,
    pose: (out, u) => treadPose(out, u),
  },
  hop: {
    seconds: 0.9,
    mode: 'add',
    pose: (out, u) => hop(out, u),
  },
  stepUp: {
    seconds: 0.6,
    mode: 'add',
    pose: (out, u) => stepUp(out, u),
  },
  blockReady: {
    seconds: 0.8,
    mode: 'replace',
    pose: (out) => blockReady(out),
  },
  dive: {
    seconds: 0.7,
    mode: 'replace',
    pose: (out, u) => dive(out, u),
  },
  pike: {
    seconds: 1.0,
    mode: 'replace',
    pose: (out, u) => pike(out, u),
  },
  pencil: {
    seconds: 1.0,
    mode: 'replace',
    pose: (out) => pencil(out),
  },
  slideSit: {
    seconds: 0.7,
    mode: 'replace',
    pose: (out) => slideSit(out),
  },
  slideRide: {
    seconds: 1.0,
    mode: 'replace',
    loop: true,
    pose: (out, u) => slideRide(out, u),
    mouth: () => 0.9,
  },
  cannonball: {
    seconds: 0.8,
    mode: 'replace',
    pose: (out, u) => cannonball(out, u),
  },
  flipTurn: {
    seconds: 1.1,
    mode: 'replace',
    pose: (out, u) => flipTurn(out, u),
  },
  wallRest: {
    seconds: 2.4,
    mode: 'replace',
    loop: true,
    pose: (out, u) => wallRest(out, u),
  },
  pushUp: {
    seconds: 1.0,
    mode: 'replace',
    pose: (out, u) => pushUp(out, u),
  },
  // --- the errands (Sprint 25)
  shower: {
    seconds: 3,
    mode: 'replace',
    loop: true,
    pose: (out, u) => showerPose(out, u),
    mouth: () => 0.4,
  },
  headShake: {
    seconds: 0.8,
    mode: 'add',
    pose: (out, u) => headShake(out, u),
  },
  reach: {
    seconds: 1.4,
    mode: 'add',
    pose: (out, u) => reach(out, u),
  },
  tubSit: {
    seconds: 6,
    mode: 'replace',
    loop: true,
    pose: (out, u) => tubSit(out, u),
  },
  stepOver: {
    seconds: 0.8,
    mode: 'add',
    pose: (out, u) => stepOver(out, u),
  },
  pingPong: {
    seconds: 1.2,
    mode: 'replace',
    loop: true,
    pose: (out, u) => pingPongPose(out, u),
  },
  catch: {
    seconds: 0.6,
    mode: 'add',
    pose: (out, u) => catchPose(out, u),
  },
  throw: {
    seconds: 0.7,
    mode: 'add',
    pose: (out, u) => throwPose(out, u),
  },
  chatStand: {
    seconds: 4,
    mode: 'add',
    loop: true,
    pose: (out, u) => chatStandPose(out, u),
    mouth: (u) => 0.2 + 0.3 * Math.abs(Math.sin(u * TAU * 5)),
  },
  stroll: {
    seconds: 3,
    mode: 'add',
    loop: true,
    pose: (out, u, motion) => strollPose(out, u, motion),
  },
  towelShake: {
    seconds: 4,
    mode: 'add',
    pose: (out, u) => towelShakePose(out, u),
  },
  sunscreen: {
    seconds: 6,
    mode: 'add',
    pose: (out, u) => sunscreenPose(out, u),
  },
  loungeSide: {
    seconds: 1,
    mode: 'add',
    loop: true,
    pose: (out) => loungeSide(out),
  },
  loungeSitUp: {
    seconds: 1,
    mode: 'add',
    loop: true,
    pose: (out, u) => loungeSitUp(out, u),
  },
  checkWatch: {
    seconds: 1.5,
    mode: 'add',
    pose: (out, u) => checkWatch(out, u),
  },
  shiftWeight: {
    seconds: 2,
    mode: 'add',
    pose: (out, u) => shiftWeight(out, u),
  },
  stretchArms: {
    seconds: 2,
    mode: 'add',
    pose: (out, u) => stretchArms(out, u),
  },
};

/** The kinds of action, in the order the lab shows them. */
export const ACTION_ORDER: ActionKind[] = [
  'cheer',
  'clap',
  'raiseHand',
  'raiseHandLying',
  'tread',
  'hop',
  'stepUp',
  'blockReady',
  'dive',
  'pike',
  'pencil',
  'slideSit',
  'slideRide',
  'cannonball',
  'flipTurn',
  'wallRest',
  'pushUp',
  'shower',
  'headShake',
  'reach',
  'tubSit',
  'stepOver',
  'pingPong',
  'catch',
  'throw',
  'chatStand',
  'stroll',
  'towelShake',
  'sunscreen',
  'loungeSide',
  'loungeSitUp',
  'checkWatch',
  'shiftWeight',
  'stretchArms',
  'cover',
];
