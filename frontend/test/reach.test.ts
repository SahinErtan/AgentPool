/**
 * Reach: how far the arms come in, and where the hands end up.
 *
 * The hands are read from the bones' world matrices, so this runs in node
 * with no WebGL. The figure is scaled to its height, as the lab and the pool
 * scale it, so the distances are in metres.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';

import { specFor, type Archetype } from '../src/scene/characters/spec';
import { zeroPose, type Pose } from '../src/scene/characters/poses';
import { applyPose3D } from '../src/scene/characters3d/apply3d';
import { buildRig3D } from '../src/scene/characters3d/rig3d';
import { buildSkeleton3D, restPosition } from '../src/scene/characters3d/skeleton3d';
import { FAR_EDGE, METRES_PER_UNIT } from '../src/scene/characters3d/grips';
import { leisurePose } from '../src/scene/motion/leisure';
import type { LeisureKind } from '../src/scene/motion/leisureKind';
import type { PropKind } from '../src/scene/motion/driver';

/** The prop each held activity holds in 3D (Sprint 29.3). */
const HELD_PROP: Partial<Record<LeisureKind, PropKind>> = {
  tea: 'cup',
  book: 'book',
  phone: 'phone',
  call: 'phone',
  snack: 'snack',
  newspaper: 'newspaper',
  cards: 'cards',
  laptop: 'laptop',
  fan: 'fan',
  lemonade: 'glass',
  crossword: 'crossword',
};

const HEIGHT = 1.7;
const ARCHETYPES: Archetype[] = ['bean', 'pear', 'tall', 'squat', 'round'];

/** A figure in a pose, standing at the origin, scaled to its height. */
function figure(id: string, pose: Pose, archetype?: Archetype) {
  const spec = specFor(id, 'subagent', { accessory: 'none', ...(archetype ? { archetype } : {}) });
  const rig = buildRig3D(spec);
  const scale = HEIGHT * spec.height;
  rig.root.scale.setScalar(scale);
  applyPose3D(rig, pose, { eyes: 1, hair: 0, mouth: 0.12, ponytail: 0, prop: null });
  rig.root.updateMatrixWorld(true);
  // The front of the chest, in metres, in the figure's own z.
  const sk = buildSkeleton3D(spec);
  const chestFront = (restPosition(sk, 'spine').z + sk.depth) * scale;
  return { rig, scale, chestFront };
}

type Bones = { bones: Record<string, { getWorldPosition(v: Vector3): Vector3 }> };

function worldOf(rig: Bones, bone: string): Vector3 {
  return rig.bones[bone].getWorldPosition(new Vector3());
}

test('a right hand brought across the chest, palm in, reaches the middle in front of the chest', () => {
  // The figure the plan describes: a tall one reaches the middle to within
  // 6 cm. The reach depends on the shoulders and the arm lengths, so the
  // other figures are only held to the chest here (see the next test).
  const pose = zeroPose();
  pose.armOutR = -0.5;
  pose.armTwistR = 0.6;
  pose.elbowR = 2.0;
  const { rig, chestFront } = figure('reach-tall', pose, 'tall');
  const hand = worldOf(rig, 'handR');
  assert.ok(Math.abs(hand.x) < 0.06, `the hand is ${hand.x.toFixed(3)} m from the middle`);
  assert.ok(hand.z > chestFront, `the hand is ${hand.z.toFixed(3)} m, the chest is at ${chestFront.toFixed(3)}`);
  rig.destroy();
});

test('every figure brings the hand across the chest with the same pose, in front of it', () => {
  const pose = zeroPose();
  pose.armOutR = -0.5;
  pose.armTwistR = 0.6;
  pose.elbowR = 2.0;
  for (const archetype of ARCHETYPES) {
    const { rig, chestFront } = figure(`reach-${archetype}`, pose, archetype);
    const hand = worldOf(rig, 'handR');
    assert.ok(Math.abs(hand.x) < 0.1, `${archetype}: the hand is ${hand.x.toFixed(3)} m from the middle`);
    assert.ok(hand.z > chestFront, `${archetype}: the hand is not in front of the chest`);
    rig.destroy();
  }
});

test('the twist is what brings the hand in: without it the hand stays out to the side', () => {
  const straight = zeroPose();
  straight.armOutR = -0.5;
  straight.elbowR = 2.0;
  const twisted = zeroPose();
  twisted.armOutR = -0.5;
  twisted.armTwistR = 0.6;
  twisted.elbowR = 2.0;
  const a = figure('reach-a', straight);
  const b = figure('reach-a', twisted);
  const without = Math.abs(worldOf(a.rig, 'handR').x);
  const withTwist = Math.abs(worldOf(b.rig, 'handR').x);
  assert.ok(withTwist < without - 0.03, `twist ${withTwist.toFixed(3)} m, no twist ${without.toFixed(3)} m`);
  a.rig.destroy();
  b.rig.destroy();
});

test('the left hand mirrors the right: a positive twist brings it in too', () => {
  const pose = zeroPose();
  pose.armOutL = -0.5;
  pose.armTwistL = 0.6;
  pose.elbowL = 2.0;
  for (const archetype of ARCHETYPES) {
    const { rig, chestFront } = figure(`reach-${archetype}`, pose, archetype);
    const hand = worldOf(rig, 'handL');
    assert.ok(Math.abs(hand.x) < 0.1, `${archetype}: the left hand is ${hand.x.toFixed(3)} m from the middle`);
    assert.ok(hand.z > chestFront, `${archetype}: the left hand is not in front of the chest`);
    rig.destroy();
  }
});

test('a wrist bend tilts the hand and the prop in it, and leaves the prop layer alone', () => {
  const flat = figure('reach-b', zeroPose());
  const pose = zeroPose();
  pose.wristR = 0.8;
  const bent = figure('reach-b', pose);
  const a = flat.rig.bones.handR.getWorldQuaternion(new Quaternion());
  const b = bent.rig.bones.handR.getWorldQuaternion(new Quaternion());
  assert.ok(Math.abs(a.x - b.x) > 0.2, 'the wrist did not bend');
  // The prop layer only turns back for the arm and the body, so a prop in a
  // bent wrist goes with it.
  assert.equal(bent.rig.propLayer.rotation.x, 0);
  flat.rig.destroy();
  bent.rig.destroy();
});

// --- the held props ------------------------------------------------------

/** A figure holding a prop in its held pose, scaled to its height in metres. */
function holding(kind: LeisureKind, prop: PropKind) {
  // The held poses are fitted to the tall figure (Sprint 29.3): the far hand
  // of the other figures stops short, so the two-handed check uses this one.
  const spec = specFor(`held-${kind}`, 'subagent', { accessory: 'none', height: 1, archetype: 'tall' });
  const rig = buildRig3D(spec);
  rig.root.scale.setScalar(METRES_PER_UNIT);
  // A quiet moment: a page turn or a laugh moves a hand, and a hold is read between them.
  const pose = leisurePose(zeroPose(), kind, 0.5, { t: 8, seed: 12345 });
  applyPose3D(rig, pose, { eyes: 1, hair: 0, mouth: 0.12, ponytail: 0, prop });
  rig.root.updateMatrixWorld(true);
  return rig;
}

test('a held prop is in the right hand: its centre is within 25 cm of the wrist', () => {
  // A two-handed prop is held at its edge, so its centre is half its width
  // away from the wrist: the newspaper, 42 cm wide, is 21 cm.
  for (const [kind, prop] of Object.entries(HELD_PROP) as [LeisureKind, PropKind][]) {
    const rig = holding(kind, prop);
    const centre = rig.props[prop].getWorldPosition(new Vector3());
    const wrist = worldOf(rig, 'handR');
    assert.ok(centre.distanceTo(wrist) < 0.25, `${kind}: the ${prop} is ${centre.distanceTo(wrist).toFixed(3)} m from the wrist`);
    rig.destroy();
  }
});

test('the other hand of a two-handed prop meets its far edge, within 4 cm', () => {
  for (const [kind, prop] of [['book', 'book'], ['newspaper', 'newspaper'], ['cards', 'cards'], ['laptop', 'laptop'], ['crossword', 'crossword']] as const) {
    const rig = holding(kind, prop);
    const edge = FAR_EDGE[prop];
    assert.ok(edge, `${prop} has no far edge`);
    // The edge is in the prop's own metres; the rig is in units, so it is
    // divided by the height of the figure.
    const point = rig.props[prop].localToWorld(new Vector3(...edge).divideScalar(METRES_PER_UNIT));
    const left = worldOf(rig, 'handL');
    const off = left.distanceTo(point);
    assert.ok(off <= 0.04, `${kind}: the left hand is ${(off * 100).toFixed(1)} cm from the far edge`);
    rig.destroy();
  }
});
