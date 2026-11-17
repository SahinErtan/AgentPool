/**
 * The 3D skeleton: where the joints of a character are, from its spec.
 *
 * Pure, so it is tested without WebGL. Unit space: the character is 1 tall,
 * the origin is between its feet, y is up and it faces +z. Its left is +x
 * (seen from behind, looking where it looks).
 *
 * The proportions come from `spec.ARCHETYPES`, the one table.
 */

import { ARCHETYPES, type CharacterSpec } from '../characters/spec';

export interface Skeleton3D {
  /** Hip joint height. */
  hipY: number;
  /** The height of the spine joint (the waist), above the hips. */
  waist: number;
  /** From the waist to the shoulders. */
  chest: number;
  /** From the shoulders to the base of the neck. */
  neck: number;
  /** From the base of the neck to the middle of the head. */
  headUp: number;
  headR: number;
  /** Half the distance between the shoulder joints. */
  shoulderX: number;
  /** Half the distance between the hip joints. */
  hipX: number;
  /** Torso half widths and depth. */
  chestHalfW: number;
  waistHalfW: number;
  hipHalfW: number;
  depth: number;
  upperArm: number;
  lowerArm: number;
  thigh: number;
  shin: number;
  /** Limb radii. */
  armR: number;
  legR: number;
}

/** The height of the ankle above the sole. */
export const ANKLE = 0.03;

/**
 * How big the head of the 3D figure is.
 *
 * The head of the round archetype was a third of the whole figure, and seen
 * from behind the head and the hair read as one dark ball.
 */
export const HEAD_SCALE_3D = 0.84;

export function buildSkeleton3D(spec: CharacterSpec): Skeleton3D {
  const p = ARCHETYPES[spec.archetype];
  const total = p.leg + p.torso + 2 * p.headR;
  const leg = p.leg / total;
  const torso = p.torso / total;
  const arm = p.arm / total;
  const headR = (p.headR / total) * HEAD_SCALE_3D;

  const girth = p.girth;
  const chestHalfW = 0.105 * girth * p.shoulderWidth;
  const hipHalfW = 0.095 * girth * p.hipWidth;

  return {
    hipY: leg,
    waist: torso * 0.42,
    chest: torso * 0.46,
    neck: torso * 0.12,
    headUp: headR * 0.95,
    headR,
    shoulderX: chestHalfW + 0.018,
    hipX: hipHalfW * 0.55,
    chestHalfW,
    waistHalfW: Math.min(chestHalfW, hipHalfW) * 0.88,
    hipHalfW,
    depth: 0.075 * girth,
    upperArm: arm * 0.52,
    lowerArm: arm * 0.48,
    thigh: leg * 0.5,
    // The ankle is a little off the ground: the foot is under it.
    shin: leg * 0.5 - ANKLE,
    armR: 0.03 * (0.85 + girth * 0.2),
    legR: 0.038 * (0.85 + girth * 0.2),
  };
}

/** The joints by name, in the order the bones are made. */
export const BONES = [
  'root',
  'pitch',
  'bob',
  'hips',
  'spine',
  'neck',
  'head',
  'hair',
  'eyes',
  'shoulderL',
  'elbowL',
  'handL',
  'shoulderR',
  'elbowR',
  'handR',
  'legL',
  'kneeL',
  'footL',
  'legR',
  'kneeR',
  'footR',
  // The mouth and the ponytail come last, so that the skin index of every
  // part that was there before stays the same.
  'mouth',
  'ponytail',
] as const;

export type BoneName = (typeof BONES)[number];

/** Every bone's parent, and its place relative to the parent at rest. */
export function boneLayout(
  sk: Skeleton3D,
): Record<BoneName, { parent: BoneName | null; x: number; y: number; z: number }> {
  return {
    root: { parent: null, x: 0, y: 0, z: 0 },
    pitch: { parent: 'root', x: 0, y: 0, z: 0 },
    bob: { parent: 'pitch', x: 0, y: 0, z: 0 },
    hips: { parent: 'bob', x: 0, y: sk.hipY, z: 0 },
    spine: { parent: 'hips', x: 0, y: sk.waist, z: 0 },
    neck: { parent: 'spine', x: 0, y: sk.chest + sk.neck * 0.3, z: 0 },
    head: { parent: 'neck', x: 0, y: sk.neck * 0.7 + sk.headUp, z: 0 },
    hair: { parent: 'head', x: 0, y: 0, z: 0 },
    eyes: { parent: 'head', x: 0, y: sk.headR * 0.12, z: sk.headR * 0.86 },
    shoulderL: { parent: 'spine', x: sk.shoulderX, y: sk.chest - 0.012, z: 0 },
    elbowL: { parent: 'shoulderL', x: 0, y: -sk.upperArm, z: 0 },
    handL: { parent: 'elbowL', x: 0, y: -sk.lowerArm, z: 0 },
    shoulderR: { parent: 'spine', x: -sk.shoulderX, y: sk.chest - 0.012, z: 0 },
    elbowR: { parent: 'shoulderR', x: 0, y: -sk.upperArm, z: 0 },
    handR: { parent: 'elbowR', x: 0, y: -sk.lowerArm, z: 0 },
    legL: { parent: 'hips', x: sk.hipX, y: 0, z: 0 },
    kneeL: { parent: 'legL', x: 0, y: -sk.thigh, z: 0 },
    footL: { parent: 'kneeL', x: 0, y: -sk.shin, z: 0 },
    legR: { parent: 'hips', x: -sk.hipX, y: 0, z: 0 },
    kneeR: { parent: 'legR', x: 0, y: -sk.thigh, z: 0 },
    footR: { parent: 'kneeR', x: 0, y: -sk.shin, z: 0 },
    mouth: { parent: 'head', x: 0, y: -sk.headR * 0.4, z: sk.headR * 0.88 },
    ponytail: { parent: 'head', x: 0, y: sk.headR * 0.35, z: -sk.headR * 0.9 },
  };
}

/** The rest position of a bone in the unit space of the character. */
export function restPosition(sk: Skeleton3D, bone: BoneName): { x: number; y: number; z: number } {
  const layout = boneLayout(sk);
  let x = 0;
  let y = 0;
  let z = 0;
  for (let b: BoneName | null = bone; b !== null; b = layout[b].parent) {
    x += layout[b].x;
    y += layout[b].y;
    z += layout[b].z;
  }
  return { x, y, z };
}
