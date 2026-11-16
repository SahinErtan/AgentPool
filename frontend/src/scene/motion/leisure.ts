/**
 * What a figure does on its lounger, drawn for the 3D rig (Sprint 29.3).
 *
 * The 2D activities (`activityPose`) were made for the side view: the arms
 * move forward and back, in the plane of the body, so a prop held in them
 * floats beside the figure. In 3D the arms can come in across the body and
 * the forearms can turn, so each activity here is drawn again from the
 * lounger's own pose. The 2D pool keeps `activityPose`, and this module is
 * only reached from the 3D driver.
 *
 * Every activity starts and ends at `loungePose`, so a figure lies down and
 * gets up again without a jump. Each one is a few phases on `u` (the whole
 * activity, 0 to 1): a reach in, a loop and a put-away. Inside the loop, the
 * small repeats (a page turned, a laugh, a card dealt) come from the figure's
 * noise, not from a sine on one clock, so no two figures do them together.
 *
 * The angles follow the rule of the rest of the pose model: measured from
 * straight down, positive forward, and the body leans back against the
 * lounger (`bodyPitch` about -0.62). The stations below were fitted against
 * the rig's own bones (the same world matrices `test/reach.test.ts` reads), so
 * that the hand is where a person would hold the prop. The checks are in
 * test/leisure.test.ts.
 */

import { channelSeed, fbm, hash1 } from '../characters/noise';
import { activityPose, blendPose, copyPose, loungePose, pulse, zeroPose, type Motion, type Pose } from '../characters/poses';
import type { Archetype, IdleActivity } from '../characters/spec';
import type { NewLeisureKind } from './leisureKind';

/** What the activity may look at, and how strong the sun is. */
export interface LeisureOptions {
  /**
   * The yaw of the thing the figure looks at, in radians, relative to the
   * body. Positive turns the head to the figure's left (+x). Used by `chat`,
   * `watch` and `cat`; the default looks straight ahead.
   */
  aim: number;
  /** How high the sun is, 0 (low, or none) to 1 (midday). It speeds the fan. */
  sun: number;
  /**
   * The figure's body shape. A prop held in two hands needs the far hand to
   * reach the far edge, and the reach depends on the shoulders and the arms,
   * so the stations that reach the body's edges are fitted per archetype.
   * Default `tall`, the shape they were first fitted to.
   */
  archetype?: Archetype;
  /**
   * Reduced motion (Sprint 29.4): the head turns to `aim` at a quarter of the
   * speed, and the music does not tap. The activity itself stays.
   */
  calm?: boolean;
}

export const DEFAULT_LEISURE: LeisureOptions = { aim: 0, sun: 0.5 };

/** Every kind the 3D driver can draw on a lounger. */
export type LeisureDrawKind = IdleActivity | NewLeisureKind;

/* The noise channels of the activities. They are apart from the ones the
 * body uses (1 to 3, and 7 for the ride), so an activity never moves with
 * the breath. */
const CH_PAGE = 21;
const CH_LOWER = 22;
const CH_LAUGH = 23;
const CH_DEAL = 24;
const CH_NOD = 25;
const CH_TAP = 26;
const CH_SHADE = 27;
const CH_TALK = 28;

const TAU = Math.PI * 2;

/* The hand joints an activity moves. The head is set by each activity on its
 * own, because a head that looks at a thing has its own rule. */
const HAND_KEYS = [
  'armR', 'elbowR', 'armOutR', 'armTwistR', 'wristR',
  'armL', 'elbowL', 'armOutL', 'armTwistL', 'wristL',
] as const;
type HandKey = (typeof HAND_KEYS)[number];
/** A set of hand joints. */
type Hands = Record<HandKey, number>;

/** The pose the lounge gives the hands; the stations are measured from it. */
const rest: Pose = zeroPose();
const scratch: Pose = zeroPose();

/**
 * Move the hands a share `w` of the way from the lounge to a station.
 *
 * Several stations add up, each with its own weight, so a figure can be
 * part way to the table and part way to the mouth at the same time.
 */
function reach(out: Pose, s: Hands, w: number): void {
  if (w === 0) return;
  for (const k of HAND_KEYS) out[k] += (s[k] - rest[k]) * w;
}

/** Smooth 0 before `a`, 1 after `b`. */
function ease(u: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (u - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The activity's envelope: it rises in the first part and falls in the last. */
function envelope(u: number, inFrom: number, inTo: number, outFrom: number, outTo: number): number {
  return ease(u, inFrom, inTo) * (1 - ease(u, outFrom, outTo));
}

/**
 * A short event, driven by the figure's noise: 0 most of the time, and a
 * smooth bump when the noise rises above `threshold`. The events come at
 * irregular times, and never on a clock.
 */
function event(motion: Motion, channel: number, rate: number, threshold: number): number {
  const n = fbm(motion.t * rate, channelSeed(motion.seed, channel));
  return ease(n, threshold, threshold + 0.2);
}

/* ------------------------------------------------------------------ */
/* Stations: the hands at the places a prop is held                    */
/* ------------------------------------------------------------------ */

/*
 * The stations that hold a prop with both hands, or put a hand on the face,
 * depend on the figure's shape. They are fitted per archetype against the
 * rig's own bones (the same world matrices `test/reach.test.ts` reads): the
 * prop's edge is where the far hand is, the far hand is on it, and the near
 * hand keeps its grip. A table, not a solve, because the fit is a one-off
 * for five bodies and the frame must not do any work for it.
 */

/** The book held open on the chest, the head bent over it. */
const BOOK_AT: Record<Archetype, Hands> = {
  bean: { armR: 0.453, elbowR: 1.304, armOutR: -0.112, armTwistR: 0.34, wristR: 0.441, armL: 0.111, elbowL: 1.796, armOutL: -0.178, armTwistL: 0.123, wristL: 0 },
  pear: { armR: 0.327, elbowR: 1.533, armOutR: 0.016, armTwistR: 0.265, wristR: 0.579, armL: 0.109, elbowL: 1.779, armOutL: -0.109, armTwistL: 0.043, wristL: 0 },
  tall: { armR: 0.25, elbowR: 1.69, armOutR: 0.12, armTwistR: 0.2, wristR: 0.65, armL: 0.11, elbowL: 1.76, armOutL: -0.07, armTwistL: 0, wristL: 0 },
  squat: { armR: 0.577, elbowR: 1.114, armOutR: -0.214, armTwistR: 0.389, wristR: 0.293, armL: 0.113, elbowL: 1.792, armOutL: -0.255, armTwistL: 0.213, wristL: 0 },
  round: { armR: 0.531, elbowR: 1.181, armOutR: -0.178, armTwistR: 0.374, wristR: 0.349, armL: 0.112, elbowL: 1.796, armOutL: -0.225, armTwistL: 0.178, wristL: 0 },
};
/*
 * The tea stations (Sprint 29.5). The glass stands 6 cm towards the lounger
 * from the middle of its table (`teaSpotOf`), and the right hand takes it
 * there. The arms are fitted per archetype; a short figure cannot bring the
 * glass in with its arm alone, so it also leans its upper body towards the
 * table (`TEA_LEAN`, at most 0.25 rad). The bean and the squat figures still
 * stop about 11 cm short (their elbow is straight): see the Deviations.
 */
const TEA_LEFT: Pick<Hands, 'armL' | 'elbowL' | 'armOutL' | 'armTwistL' | 'wristL'> = { armL: 0.05, elbowL: 1.43, armOutL: -0.25, armTwistL: 0.12, wristL: 0 };
/** The right hand at the side table, the glass lifted off it, per archetype. */
const TEA_TABLE: Record<Archetype, Hands> = {
  bean: { armR: 0.143, elbowR: 0, armOutR: 0.25, armTwistR: -0.968, wristR: 0, ...TEA_LEFT },
  pear: { armR: 0.147, elbowR: 0.001, armOutR: 0.349, armTwistR: 0.02, wristR: 0, ...TEA_LEFT },
  tall: { armR: -0.162, elbowR: 0.893, armOutR: 0.3, armTwistR: -0.227, wristR: 0, ...TEA_LEFT },
  squat: { armR: 0.143, elbowR: 0.001, armOutR: 0.205, armTwistR: 0.046, wristR: 0, ...TEA_LEFT },
  round: { armR: 0.148, elbowR: 0.001, armOutR: 0.261, armTwistR: -0.333, wristR: 0, ...TEA_LEFT },
};
/** How far the upper body leans to the table at the reach (spine bend, torso turn), per archetype. */
const TEA_LEAN: Record<Archetype, { spine: number; torso: number }> = {
  bean: { spine: 0.25, torso: 0.25 },
  pear: { spine: 0.25, torso: 0.25 },
  tall: { spine: 0, torso: 0 },
  squat: { spine: 0.25, torso: 0.25 },
  round: { spine: 0.25, torso: 0.25 },
};
/** The glass at the chest, stirred, the left hand under the saucer. */
const TEA_CHEST: Hands = { armR: 0.03, elbowR: 1.41, armOutR: -0.19, armTwistR: 0.2, wristR: 0.4, armL: 0.48, elbowL: 0.75, armOutL: -0.41, armTwistL: 0.43, wristL: 0 };
/** The glass at the lips for a sip, per archetype: the hand where a sip of the tall figure puts it. */
const TEA_SIP: Record<Archetype, Hands> = {
  bean: { armR: 1.399, elbowR: 1.574, armOutR: -0.763, armTwistR: 0.472, wristR: -0.82, armL: 0.48, elbowL: 0.75, armOutL: -0.41, armTwistL: 0.43, wristL: 0 },
  pear: { armR: 1.26, elbowR: 1.911, armOutR: -0.672, armTwistR: 0.56, wristR: -0.82, armL: 0.48, elbowL: 0.75, armOutL: -0.41, armTwistL: 0.43, wristL: 0 },
  tall: { armR: 1.1, elbowR: 2.19, armOutR: -0.661, armTwistR: 0.6, wristR: -0.82, armL: 0.48, elbowL: 0.75, armOutL: -0.41, armTwistL: 0.43, wristL: 0 },
  squat: { armR: 1.651, elbowR: 1.215, armOutR: -0.684, armTwistR: 0.537, wristR: -0.82, armL: 0.48, elbowL: 0.75, armOutL: -0.41, armTwistL: 0.43, wristL: 0 },
  round: { armR: 1.421, elbowR: 1.317, armOutR: -0.928, armTwistR: 0.218, wristR: -0.82, armL: 0.48, elbowL: 0.75, armOutL: -0.41, armTwistL: 0.43, wristL: 0 },
};
/** The head bent down to the phone in front of the face. */
const PHONE_HEAD = -0.8;
/** The phone in front of the face, the left hand at its edge. */
const PHONE: Hands = { armR: -0.15, elbowR: 1.89, armOutR: -0.68, armTwistR: 0.46, wristR: 0.63, armL: 0.57, elbowL: 2.12, armOutL: 0, armTwistL: 0.76, wristL: 0 };
/** The phone against the ear, on the outside of the head, the left hand down. */
const CALL_AT: Record<Archetype, Hands> = {
  bean: { armR: 1.994, elbowR: 2.429, armOutR: 0.061, armTwistR: -0.008, wristR: 0.884, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 },
  pear: { armR: 1.981, elbowR: 2.598, armOutR: 0.083, armTwistR: -0.053, wristR: 0.848, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 },
  tall: { armR: 1.992, elbowR: 2.749, armOutR: 0.104, armTwistR: -0.087, wristR: 0.829, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 },
  squat: { armR: 2.02, elbowR: 2.274, armOutR: 0.058, armTwistR: 0.003, wristR: 0.91, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 },
  round: { armR: 2.006, elbowR: 2.292, armOutR: 0.09, armTwistR: -0.051, wristR: 0.895, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 },
};
/** The broadsheet held up in front of the face, both hands at its edges. */
const NEWSPAPER_AT: Record<Archetype, Hands> = {
  bean: { armR: 0.456, elbowR: 1.961, armOutR: -0.271, armTwistR: 0.098, wristR: -0.262, armL: 0.916, elbowL: 2.131, armOutL: 0.311, armTwistL: 0.328, wristL: 0 },
  pear: { armR: 0.347, elbowR: 2.298, armOutR: -0.187, armTwistR: -0.049, wristR: -0.169, armL: 0.918, elbowL: 2.096, armOutL: 0.364, armTwistL: 0.263, wristL: 0 },
  tall: { armR: 0.308, elbowR: 2.455, armOutR: -0.168, armTwistR: -0.174, wristR: -0.134, armL: 0.918, elbowL: 2.066, armOutL: 0.392, armTwistL: 0.228, wristL: 0 },
  squat: { armR: 0.577, elbowR: 1.632, armOutR: -0.363, armTwistR: 0.172, wristR: -0.378, armL: 0.916, elbowL: 2.148, armOutL: 0.254, armTwistL: 0.396, wristL: 0 },
  round: { armR: 0.531, elbowR: 1.752, armOutR: -0.33, armTwistR: 0.152, wristR: -0.332, armL: 0.916, elbowL: 2.144, armOutL: 0.277, armTwistL: 0.369, wristL: 0 },
};
/**
 * The ice lolly at the mouth. The left hand stays on the belly, where the
 * lounge puts it: a hand cupped under the lolly needs the elbow forward, and
 * on a reclined figure that forearm crossed the face.
 */
const SNACK_AT: Record<Archetype, Hands> = {
  bean: { armR: 1.581, elbowR: 1.779, armOutR: -0.301, armTwistR: 0.949, wristR: -0.763, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 },
  pear: { armR: 1.541, elbowR: 2.049, armOutR: -0.196, armTwistR: 0.973, wristR: -0.839, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 },
  tall: { armR: 1.51, elbowR: 2.28, armOutR: -0.11, armTwistR: 1, wristR: -0.9, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 },
  squat: { armR: 1.615, elbowR: 1.504, armOutR: -0.391, armTwistR: 0.933, wristR: -0.697, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 },
  round: { armR: 1.582, elbowR: 1.574, armOutR: -0.335, armTwistR: 0.945, wristR: -0.726, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 },
};
/** The lemonade held against the chest. */
const LEMON_CHEST: Hands = { armR: 0.32, elbowR: 1.17, armOutR: 0.16, armTwistR: 0.46, wristR: 0.88, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 };
/** The lemonade at the lips for the long sip. */
const LEMON_SIP: Hands = { armR: 1.44, elbowR: 2.23, armOutR: 0.04, armTwistR: 1, wristR: 0.9, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 };
/** The folded sheet held in front of the chest, both hands on its edges. */
const CROSSWORD_AT: Record<Archetype, Hands> = {
  bean: { armR: 0.295, elbowR: 1.259, armOutR: -0.2, armTwistR: 0.549, wristR: -1.052, armL: 0.29, elbowL: 1.273, armOutL: -0.305, armTwistL: 0.137, wristL: 0 },
  pear: { armR: 0.193, elbowR: 1.402, armOutR: -0.07, armTwistR: 0.472, wristR: -0.951, armL: 0.29, elbowL: 1.266, armOutL: -0.243, armTwistL: 0.093, wristL: 0 },
  tall: { armR: 0.128, elbowR: 1.492, armOutR: 0.026, armTwistR: 0.389, wristR: -0.884, armL: 0.289, elbowL: 1.259, armOutL: -0.208, armTwistL: 0.069, wristL: 0 },
  squat: { armR: 0.385, elbowR: 1.122, armOutR: -0.316, armTwistR: 0.59, wristR: -1.143, armL: 0.29, elbowL: 1.272, armOutL: -0.375, armTwistL: 0.188, wristL: 0 },
  round: { armR: 0.352, elbowR: 1.172, armOutR: -0.273, armTwistR: 0.578, wristR: -1.11, armL: 0.29, elbowL: 1.273, armOutL: -0.347, armTwistL: 0.168, wristL: 0 },
};
/** The pencil at the chin, for a tap. */
const CROSSWORD_TAP: Hands = { armR: 0.8, elbowR: 2.1, armOutR: -0.5, armTwistR: 0.4, wristR: 0.4, armL: 0.29, elbowL: 1.26, armOutL: -0.21, armTwistL: 0.07, wristL: 0 };
/** The laptop on the belly, the hands at the keys. */
const LAPTOP_AT: Record<Archetype, Hands> = {
  bean: { armR: -0.017, elbowR: 1.032, armOutR: -0.414, armTwistR: 0.031, wristR: 0.124, armL: -0.272, elbowL: 1.694, armOutL: -0.442, armTwistL: 0.028, wristL: -0.141 },
  pear: { armR: -0.073, elbowR: 1.303, armOutR: -0.266, armTwistR: 0.074, wristR: 0.066, armL: -0.259, elbowL: 1.698, armOutL: -0.362, armTwistL: -0.057, wristL: -0.141 },
  tall: { armR: -0.124, elbowR: 1.503, armOutR: -0.143, armTwistR: 0.067, wristR: 0.04, armL: -0.251, elbowL: 1.69, armOutL: -0.32, armTwistL: -0.1, wristL: -0.141 },
  squat: { armR: 0.012, elbowR: 0.828, armOutR: -0.518, armTwistR: -0.045, wristR: 0.204, armL: -0.284, elbowL: 1.661, armOutL: -0.535, armTwistL: 0.135, wristL: -0.141 },
  round: { armR: 0.005, elbowR: 0.897, armOutR: -0.483, armTwistR: -0.015, wristR: 0.172, armL: -0.28, elbowL: 1.678, armOutL: -0.499, armTwistL: 0.093, wristL: -0.141 },
};
/** The head bent down to the laptop on the belly. */
const LAPTOP_HEAD = -1.1;
/** The hand fan in front of the face. */
const FAN: Hands = { armR: 0.14, elbowR: 2.25, armOutR: -0.67, armTwistR: 0.26, wristR: 0.9, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 };
/** The fan of cards held over the belly, the left hand on its top card. */
const CARDS_AT: Record<Archetype, Hands> = {
  bean: { armR: 0.144, elbowR: 1.11, armOutR: -0.334, armTwistR: 0.533, wristR: -0.401, armL: 0.33, elbowL: 1.141, armOutL: -0.416, armTwistL: 0.649, wristL: 0 },
  pear: { armR: 0.087, elbowR: 1.223, armOutR: -0.2, armTwistR: 0.388, wristR: -0.288, armL: 0.324, elbowL: 1.13, armOutL: -0.358, armTwistL: 0.619, wristL: 0 },
  tall: { armR: 0.058, elbowR: 1.299, armOutR: -0.077, armTwistR: 0.258, wristR: -0.23, armL: 0.32, elbowL: 1.12, armOutL: -0.32, armTwistL: 0.6, wristL: 0 },
  squat: { armR: 0.214, elbowR: 1.003, armOutR: -0.443, armTwistR: 0.66, wristR: -0.545, armL: 0.338, elbowL: 1.147, armOutL: -0.48, armTwistL: 0.682, wristL: 0 },
  round: { armR: 0.185, elbowR: 1.043, armOutR: -0.404, armTwistR: 0.613, wristR: -0.486, armL: 0.335, elbowL: 1.145, armOutL: -0.455, armTwistL: 0.669, wristL: 0 },
};
/** The hands brought together in front of the chest for a clap. */
const CLAP: Hands = { armR: -0.09, elbowR: 1.78, armOutR: -0.39, armTwistR: 0.23, wristR: 0, armL: -0.1, elbowL: 1.78, armOutL: -0.48, armTwistL: 0.16, wristL: 0 };
/** The hand over the eyes, a shade for a nap. */
const SHADE: Hands = { armR: 1.6, elbowR: 1.99, armOutR: -0.7, armTwistR: 0.08, wristR: 0, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 };
/** The right hand talking, in front of the chest. */
const TALK_R: Hands = { armR: 0.18, elbowR: 1.84, armOutR: 0.2, armTwistR: 0.47, wristR: 0, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 };
/** The hand reaching down over the side of the lounger to a cat. */
const CAT: Hands = { armR: 0.15, elbowR: 0.1, armOutR: 0.18, armTwistR: 0.56, wristR: 0, armL: 0.25, elbowL: 0.75, armOutL: 0, armTwistL: 0, wristL: 0 };

/** The shape a figure is drawn with, as the table keys it. */
function archetypeOf(options: LeisureOptions): Archetype {
  return options.archetype ?? 'tall';
}

/** A station's mirror: the same reach with the other arm. */
function mirror(s: Hands): Hands {
  return {
    armR: s.armL, elbowR: s.elbowL, armOutR: s.armOutL, armTwistR: -s.armTwistL, wristR: s.wristL,
    armL: s.armR, elbowL: s.elbowR, armOutL: s.armOutR, armTwistL: -s.armTwistR, wristL: s.wristR,
  };
}
const CAT_LEFT = mirror(CAT);
/** The left hand talking, in front of the chest. */
const TALK_L = mirror(TALK_R);

/* ------------------------------------------------------------------ */
/* The activities                                                      */
/* ------------------------------------------------------------------ */

/** The moment the glass is taken off the table (the hand is on it). */
export const TEA_TAKE_U = 0.15;
/** The moment the glass is set back on the table. The hand lets go there, and the activity goes on from it. */
export const TEA_PUT_DOWN_U = 0.86;
/** The middle of the second sip, when the glass is at the lips. */
export const TEA_SIP_U = 0.63;

/** Tea: to the side table, the glass lifted, stirred, sipped, and set back on the table. */
function tea(out: Pose, u: number, options: LeisureOptions): void {
  const archetype = archetypeOf(options);
  const reachIn = ease(u, 0.02, 0.14);
  const back = 1 - ease(u, 0.9, 0.97);
  const hold = reachIn * back;
  // Lifted from the table, to the chest, and back down to the table by the put-down.
  const toChest = ease(u, 0.16, 0.26) * (1 - ease(u, 0.8, 0.86));
  // Three sips, each one a short bump on the glass going to the lips.
  const sip = Math.max(pulse(u, 0.46, 0.56), pulse(u, 0.58, 0.68), pulse(u, 0.7, 0.8));
  const stirring = pulse(u, 0.28, 0.44);
  const table = hold * (1 - toChest);
  const chest = hold * toChest * (1 - sip);
  reach(out, TEA_TABLE[archetype], table);
  // A short figure leans to the table while it reaches for the glass.
  out.spine += TEA_LEAN[archetype].spine * table;
  out.torso += TEA_LEAN[archetype].torso * table;
  reach(out, TEA_CHEST, chest);
  reach(out, TEA_SIP[archetype], hold * toChest * sip);
  // The spoon goes round twice in the glass: the forearm turns in small
  // circles while the glass is at the chest.
  const spin = Math.sin(((u - 0.28) / 0.16) * TAU * 2);
  out.elbowR += 0.14 * spin * stirring;
  out.armTwistR += 0.12 * Math.cos(((u - 0.28) / 0.16) * TAU * 2) * stirring;
  // The head tips back a little with each sip, and turns to the table.
  out.headPitch = rest.headPitch + 0.14 * sip * hold;
  out.headYaw = rest.headYaw - 0.2 * table;
}

/** The head bent over the book. */
const BOOK_HEAD = -0.8;
/** The head bent over the paper. */
const NEWSPAPER_HEAD = -0.66;

/** Book: held open on the chest, a page turned now and then, the book lowered now and then. */
function book(out: Pose, u: number, motion: Motion, options: LeisureOptions): void {
  const env = envelope(u, 0.04, 0.16, 0.86, 0.96);
  const lowered = event(motion, CH_LOWER, 0.05, 0.36) * env;
  reach(out, BOOK_AT[archetypeOf(options)], env * (1 - 0.8 * lowered));
  // The page turns with the left hand.
  const turn = event(motion, CH_PAGE, 0.12, 0.3) * env * (1 - lowered);
  out.armL += 0.22 * turn;
  out.elbowL += 0.2 * turn;
  // The head bends over the book, or lifts to the pool when it is lowered.
  out.headPitch = rest.headPitch + (BOOK_HEAD - rest.headPitch) * env * (1 - lowered) + 0.25 * lowered * env;
  out.headYaw = rest.headYaw + (options.aim * 0.6 - rest.headYaw) * lowered * env;
}

/** Phone: in front of the face, the thumb scrolling, a short laugh now and then. */
function phone(out: Pose, u: number, motion: Motion): void {
  const env = envelope(u, 0.04, 0.16, 0.86, 0.96);
  reach(out, PHONE, env);
  out.headPitch = rest.headPitch + (PHONE_HEAD - rest.headPitch) * env;
  const laugh = event(motion, CH_LAUGH, 0.2, 0.42) * env;
  out.headPitch += 0.14 * laugh;
  // The thumb: a small flick of the wrist, as a finger scrolls.
  out.wristR += 0.05 * Math.sin(motion.t * 7.3) * env;
}

/** Call: the phone at the ear, the other hand talking in short bursts. */
function call(out: Pose, u: number, motion: Motion, options: LeisureOptions): void {
  const env = envelope(u, 0.04, 0.16, 0.86, 0.96);
  reach(out, CALL_AT[archetypeOf(options)], env);
  const talk = event(motion, CH_TALK, 0.5, 0.25) * env;
  out.armL += 0.3 * talk;
  out.elbowL += 0.25 * talk;
  out.headYaw = rest.headYaw + (0.12 - rest.headYaw) * env;
}

/** Sunbathe: the 2D pose (hands behind the head), with the knee drawn up now and then. */
function sunbathe(out: Pose, u: number, motion: Motion): void {
  const act = activityPose(scratch, 'sunbathe', u, motion);
  const env = envelope(u, 0.02, 0.12, 0.88, 0.98);
  blendPose(out, out, 1 - env, act, env);
  const knee = event(motion, CH_TAP, 0.06, 0.38) * env;
  out.legL += 0.7 * knee;
  out.kneeL -= 0.6 * knee;
}

/** Nap: the 2D pose (hands on the belly, head to the side), a hand over the eyes now and then. */
function nap(out: Pose, u: number, motion: Motion): void {
  const act = activityPose(scratch, 'nap', u, motion);
  const env = envelope(u, 0.02, 0.12, 0.88, 0.98);
  blendPose(out, out, 1 - env, act, env);
  const shade = event(motion, CH_SHADE, 0.04, 0.3) * env;
  reach(out, SHADE, shade);
}

/**
 * Stretch: the 2D pose, with the upper body turned to each side in turn.
 *
 * The turn is the spine's (`torso`): the shoulders and the head go round, and
 * the hips and the legs stay on the lounger. A whole-body roll would tip the
 * figure off its seat.
 */
function stretch(out: Pose, u: number, motion: Motion): void {
  activityPose(out, 'stretch', u, motion);
  out.torso += 0.2 * Math.sin(u * TAU * 1.5) * pulse(u, 0.1, 0.8);
}

/** Snack: the lolly to the mouth and back, a nod at each bite. */
function snack(out: Pose, u: number, options: LeisureOptions): void {
  const bite = pulse(u, 0.22, 0.9);
  reach(out, SNACK_AT[archetypeOf(options)], bite);
  out.headPitch += 0.05 * Math.abs(Math.sin(u * TAU * 4)) * bite;
}

/** Chat: the head turned to the neighbour, and the hands talking in turn. */
function chat(out: Pose, u: number, motion: Motion, options: LeisureOptions): void {
  const env = envelope(u, 0.03, 0.12, 0.9, 0.98);
  const g = Math.sin(u * TAU * 4);
  reach(out, TALK_R, env * Math.max(0, g) * 0.9);
  reach(out, TALK_L, env * Math.max(0, -g) * 0.9);
  out.headYaw = rest.headYaw + (clampYaw(options.aim) - rest.headYaw) * env;
  out.headPitch = rest.headPitch + (-0.2 - rest.headPitch) * env;
  out.headPitch += 0.03 * Math.sin(motion.t * 3.1) * env;
}

/** Newspaper: held up in front of the face; the page shaken when it is turned. */
function newspaper(out: Pose, u: number, motion: Motion, options: LeisureOptions): void {
  const env = envelope(u, 0.04, 0.16, 0.86, 0.96);
  reach(out, NEWSPAPER_AT[archetypeOf(options)], env);
  const turn = event(motion, CH_PAGE, 0.14, 0.3) * env;
  out.wristR += 0.2 * turn * Math.sin(motion.t * 12);
  out.headPitch = rest.headPitch + (NEWSPAPER_HEAD - rest.headPitch) * env;
  out.headYaw = rest.headYaw + (-0.16 - rest.headYaw) * env;
}

/** Cards: a patience laid out on the belly; the top card taken and laid down now and then. */
function cards(out: Pose, u: number, motion: Motion, options: LeisureOptions): void {
  const env = envelope(u, 0.04, 0.16, 0.86, 0.96);
  reach(out, CARDS_AT[archetypeOf(options)], env);
  const deal = event(motion, CH_DEAL, 0.16, 0.28) * env;
  out.armL += 0.25 * deal;
  out.elbowL -= 0.3 * deal;
  out.headPitch = rest.headPitch + (-0.5 - rest.headPitch) * env;
  out.headYaw = rest.headYaw + (-0.12 - rest.headYaw) * env;
}

/** Laptop: both hands at the keys, the head bent to the screen, a nod now and then. */
function laptop(out: Pose, u: number, motion: Motion, options: LeisureOptions): void {
  const env = envelope(u, 0.04, 0.16, 0.86, 0.96);
  reach(out, LAPTOP_AT[archetypeOf(options)], env);
  // The fingers go down in turn, at the rate of typing.
  const typing = Math.sin(motion.t * TAU * 2.3) * env;
  out.wristR += 0.12 * typing;
  out.wristL -= 0.12 * typing;
  const nod = event(motion, CH_NOD, 0.25, 0.32) * env;
  out.headPitch = rest.headPitch + (LAPTOP_HEAD - rest.headPitch) * env - 0.12 * nod;
}

/**
 * Music: headphones on, the head and a knee keeping a beat. The beat rate is
 * the figure's own, so two listeners do not nod in step.
 */
function music(out: Pose, u: number, motion: Motion, options: LeisureOptions): void {
  const env = envelope(u, 0.03, 0.12, 0.9, 0.98);
  const rate = 1.6 + 0.8 * hash1(7, motion.seed);
  const beat = Math.sin(motion.t * TAU * rate);
  // Reduced motion: the music is heard, the figure does not tap to it.
  const tap = options.calm ? 0 : 1;
  out.headPitch += 0.07 * beat * env * tap;
  out.headYaw += 0.05 * Math.sin(motion.t * TAU * rate * 0.5) * env * tap;
  out.kneeL -= 0.14 * Math.max(0, beat) * env * tap;
}

/** Fan: the hand fan in front of the face, fanned faster when the sun is high. */
function fan(out: Pose, u: number, motion: Motion, options: LeisureOptions): void {
  const env = envelope(u, 0.04, 0.16, 0.86, 0.96);
  reach(out, FAN, env);
  const rate = 0.9 + 1.3 * Math.min(1, Math.max(0, options.sun));
  out.wristR += 0.35 * Math.sin(motion.t * TAU * rate) * env;
  out.headPitch = rest.headPitch + (-0.6 - rest.headPitch) * env;
}

/** Lemonade: held against the chest, a long sip through the straw. */
function lemonade(out: Pose, u: number): void {
  const env = envelope(u, 0.04, 0.16, 0.86, 0.96);
  const sip = pulse(u, 0.3, 0.72);
  reach(out, LEMON_CHEST, env * (1 - sip));
  reach(out, LEMON_SIP, sip);
  out.headPitch += -0.12 * sip;
}

/** Crossword: the sheet held in front of the chest; the pencil taps the chin, then writes. */
function crossword(out: Pose, u: number, motion: Motion, options: LeisureOptions): void {
  const env = envelope(u, 0.04, 0.16, 0.86, 0.96);
  reach(out, CROSSWORD_AT[archetypeOf(options)], env);
  const tap = event(motion, CH_TAP, 0.3, 0.34) * env;
  reach(out, CROSSWORD_TAP, tap);
  // Writing: a small scribble of the wrist while the pencil is not at the chin.
  out.wristR += 0.08 * Math.sin(motion.t * 9.1) * env * (1 - tap);
  out.headPitch = rest.headPitch + (-0.5 - rest.headPitch) * env;
}

/** Watch: sits up, the head follows a swimmer, and the hands clap once in the activity. */
function watch(out: Pose, u: number, motion: Motion, options: LeisureOptions): void {
  const env = envelope(u, 0.03, 0.12, 0.9, 0.98);
  // Sitting up: the body leans back less than on the lounger.
  out.bodyPitch = rest.bodyPitch + (-0.32 - rest.bodyPitch) * env;
  out.headYaw = rest.headYaw + (clampYaw(options.aim) * turnSpeed(options) - rest.headYaw) * env;
  out.headPitch = rest.headPitch + (-0.2 - rest.headPitch) * env;
  // One clap, a little after the middle.
  reach(out, CLAP, pulse(u, 0.55, 0.64));
  out.headPitch += 0.02 * Math.sin(motion.t * 2.4) * env;
}

/** Cat: the hand reaches down to a sleeping cat at the side, and strokes it. */
function cat(out: Pose, u: number, motion: Motion, options: LeisureOptions): void {
  const env = envelope(u, 0.04, 0.16, 0.86, 0.96);
  // The hand on the side the cat is on.
  const left = options.aim > 0;
  reach(out, left ? CAT_LEFT : CAT, env);
  // The stroke: back and forth, at the wrist, in a loose rhythm.
  const stroke = Math.sin(motion.t * TAU * 0.8) * env;
  if (left) out.wristL += 0.3 * stroke;
  else out.wristR += 0.3 * stroke;
  out.headYaw = rest.headYaw + (clampYaw(options.aim) - rest.headYaw) * env;
  out.headPitch = rest.headPitch + (-0.6 - rest.headPitch) * env;
}

/** How much of the aim the head takes: all of it, or a quarter under reduced motion. */
function turnSpeed(options: LeisureOptions): number {
  return options.calm ? 0.25 : 1;
}

/** The head may turn so far, either way (as the driver's own look does). */
function clampYaw(yaw: number): number {
  return Math.max(-1.2, Math.min(1.2, yaw));
}

/**
 * The pose of a figure doing an activity on its lounger, in 3D.
 *
 * `out` is written and returned. `kind` is one of the 2D activities, or one of
 * the seven of Sprint 29. `u` is the progress of the whole activity, 0 to 1,
 * and `motion` is the figure's own clock and noise. `options` gives what the
 * figure looks at and how strong the sun is; the defaults look straight ahead
 * at a midday sun.
 *
 * Pure: the same inputs give the same pose.
 */
export function leisurePose(
  out: Pose,
  kind: LeisureDrawKind,
  u: number,
  motion: Motion,
  options: LeisureOptions = DEFAULT_LEISURE,
): Pose {
  loungePose(out, motion);
  // The lounge does not set the spine or the torso, and the pose is reused
  // from frame to frame: they are put back to rest here, or a lean would add
  // up over the frames.
  out.spine = 0;
  out.torso = 0;
  // The lounge is kept, so every activity can measure its stations from it
  // and return to it at the end.
  copyPose(out, rest);
  const x = Math.min(1, Math.max(0, u));
  switch (kind) {
    case 'tea': tea(out, x, options); break;
    case 'book': book(out, x, motion, options); break;
    case 'phone': phone(out, x, motion); break;
    case 'call': call(out, x, motion, options); break;
    case 'sunbathe': sunbathe(out, x, motion); break;
    case 'nap': nap(out, x, motion); break;
    case 'stretch': stretch(out, x, motion); break;
    case 'snack': snack(out, x, options); break;
    case 'chat': chat(out, x, motion, options); break;
    case 'newspaper': newspaper(out, x, motion, options); break;
    case 'cards': cards(out, x, motion, options); break;
    case 'laptop': laptop(out, x, motion, options); break;
    case 'music': music(out, x, motion, options); break;
    case 'fan': fan(out, x, motion, options); break;
    case 'lemonade': lemonade(out, x); break;
    case 'crossword': crossword(out, x, motion, options); break;
    case 'watch': watch(out, x, motion, options); break;
    case 'cat': cat(out, x, motion, options); break;
    default:
      // `none`: the lounge, as it is.
      break;
  }
  return out;
}

/**
 * How open the eyes are while the activity runs, 0 (shut) to 1 (open).
 *
 * A sunbather and a napper have their eyes shut. The rest keep the blink of
 * the figure.
 */
export function leisureEyes(kind: LeisureDrawKind): number {
  return kind === 'sunbathe' || kind === 'nap' ? 0.08 : 1;
}
