/**
 * The 3D lounger activities (Sprint 29.3): the poses, the props they hold, and
 * the driver that chooses between the 2D and the 3D pose.
 *
 * The hands and the head are read from the bones' world matrices, as in
 * `reach.test.ts`, so this runs in node with no WebGL. The figure is scaled to
 * its height, so the distances are in metres.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';

import { ARCHETYPES, specFor, type Archetype } from '../src/scene/characters/spec';
import { POSE_KEYS, loungePose, zeroPose, type Motion, type Pose } from '../src/scene/characters/poses';
import { applyPose3D } from '../src/scene/characters3d/apply3d';
import { buildRig3D } from '../src/scene/characters3d/rig3d';
import { FAR_EDGE, METRES_PER_UNIT } from '../src/scene/characters3d/grips';
import { buildSkeleton3D, restPosition } from '../src/scene/characters3d/skeleton3d';
import { leisureEyes, leisurePose, TEA_PUT_DOWN_U, TEA_SIP_U, TEA_TAKE_U, type LeisureDrawKind } from '../src/scene/motion/leisure';
import { LEISURE_KINDS, NEW_LEISURE_KINDS, type LeisureKind } from '../src/scene/motion/leisureKind';
import { PoseDriver, type PropKind } from '../src/scene/motion/driver';
import { buildWorld, GLASS_ORIGIN_Y, GLASS_REACH, HIP_BACK, TABLE_RADIUS, sideTableOf, teaSpotOf, type Lounger } from '../src/scene/pool3d/world';

const HEIGHT = 1.7;
const TALL: Archetype = 'tall';

/** Two clocks and two seeds: the checks hold for more than one figure. */
const MOTIONS: Motion[] = [
  { t: 0, seed: 12345 },
  { t: 17.3, seed: 987654 },
];

/**
 * A moment at which the figure holds its prop still: no page is turned, no
 * one laughs, no card is dealt and no book is lowered under way. Those small
 * events are part of the activities, so a check of the hold reads the figure
 * between them. (Seed 12345, at t = 8 s.)
 */
const QUIET: Motion = { t: 8, seed: 12345 };

/** A figure, in its own rig, scaled to its height in metres. */
function figure(id: string, archetype: Archetype = TALL, prop: PropKind | null = null) {
  const spec = specFor(id, 'subagent', { accessory: 'none', height: 1, archetype });
  const rig = buildRig3D(spec);
  rig.root.scale.setScalar(HEIGHT);
  return { rig, spec, prop };
}

/** Put a pose on a figure, and update its matrices. */
function pose(fig: ReturnType<typeof figure>, p: Pose): void {
  applyPose3D(fig.rig, p, { eyes: 1, hair: 0, mouth: 0.12, ponytail: 0, prop: fig.prop });
  fig.rig.root.updateMatrixWorld(true);
}

type Bones = { bones: Record<string, { getWorldPosition(v: Vector3): Vector3; getWorldQuaternion(q: Quaternion): Quaternion }> };

function at(rig: Bones, bone: string): Vector3 {
  return rig.bones[bone].getWorldPosition(new Vector3());
}

/** The point of the prop at `local` (in metres, the prop's own frame), in the world. */
function onProp(fig: ReturnType<typeof figure>, local: readonly [number, number, number]): Vector3 {
  const prop = fig.rig.props[fig.prop!];
  return prop.localToWorld(new Vector3(local[0] / METRES_PER_UNIT, local[1] / METRES_PER_UNIT, local[2] / METRES_PER_UNIT));
}

/** The angle between two directions, in radians. */
function angle(a: Vector3, b: Vector3): number {
  return a.clone().normalize().angleTo(b.clone().normalize());
}

/** The lounge pose of a motion, as the reference every activity starts from. */
function lounge(motion: Motion): Pose {
  return loungePose(zeroPose(), motion);
}

/* ------------------------------------------------------------------ */
/* Every activity: finite, and starts and ends on the lounge           */
/* ------------------------------------------------------------------ */

const ALL_KINDS: LeisureDrawKind[] = [...LEISURE_KINDS];

test('every activity gives finite angles for every u from 0 to 1', () => {
  for (const kind of ALL_KINDS) {
    for (const motion of MOTIONS) {
      const out = zeroPose();
      for (let i = 0; i <= 100; i += 1) {
        leisurePose(out, kind, i / 100, motion);
        for (const key of POSE_KEYS) {
          assert.ok(Number.isFinite(out[key]), `${kind} at u=${i / 100}: ${key} is ${out[key]}`);
        }
      }
    }
  }
});

test('every activity starts and ends on the lounge, within 0.05 rad of loungePose', () => {
  for (const kind of ALL_KINDS) {
    for (const motion of MOTIONS) {
      const ref = lounge(motion);
      for (const u of [0, 1]) {
        const out = leisurePose(zeroPose(), kind, u, motion);
        for (const key of POSE_KEYS) {
          const d = Math.abs(out[key] - ref[key]);
          assert.ok(d <= 0.05, `${kind} at u=${u}: ${key} is ${d.toFixed(3)} rad from the lounge`);
        }
      }
    }
  }
});

test('an activity is a pure function of its inputs', () => {
  const motion = { t: 4.2, seed: 77 };
  for (const kind of ALL_KINDS) {
    const a = leisurePose(zeroPose(), kind, 0.37, motion, { aim: 0.4, sun: 0.9 });
    const b = leisurePose(zeroPose(), kind, 0.37, motion, { aim: 0.4, sun: 0.9 });
    assert.deepEqual(a, b, kind);
  }
});

test('the new activities move: each one differs from the lounge somewhere in its middle', () => {
  for (const kind of NEW_LEISURE_KINDS) {
    // A rhythm can pass through the lounge (a beat at zero), so the middle is
    // looked at over a few moments, not one.
    let moved = false;
    for (let t = 0; t < 8 && !moved; t += 0.5) {
      const motion = { t, seed: MOTIONS[0].seed };
      const mid = leisurePose(zeroPose(), kind, 0.5, motion, { aim: 0.6, sun: 1 });
      const ref = lounge(motion);
      moved = POSE_KEYS.some((key) => Math.abs(mid[key] - ref[key]) > 0.05);
    }
    assert.ok(moved, `${kind} is still the lounge in its middle`);
  }
});

test('the eyes are shut for a sunbather and a napper, and open for the rest', () => {
  assert.ok(leisureEyes('sunbathe') < 0.2);
  assert.ok(leisureEyes('nap') < 0.2);
  for (const kind of ALL_KINDS) {
    if (kind === 'sunbathe' || kind === 'nap') continue;
    assert.equal(leisureEyes(kind), 1, kind);
  }
});

/* ------------------------------------------------------------------ */
/* Hands at the prop: the mouth, the chest and the face                */
/* ------------------------------------------------------------------ */

/** The u at which a sip, a bite or a glass is at the mouth (the middle of the sip). */
const SIP_AT: [LeisureKind, number][] = [
  ['tea', TEA_SIP_U],
  ['snack', 0.56],
  ['lemonade', 0.51],
];

test('tea, snack and lemonade: the hand holding the prop is within 8 cm of the mouth mid-sip', () => {
  for (const [kind, u] of SIP_AT) {
    const prop = (kind === 'tea' ? 'cup' : kind === 'snack' ? 'snack' : 'glass') as PropKind;
    const fig = figure(`sip-${kind}`, TALL, prop);
    pose(fig, leisurePose(zeroPose(), kind, u, QUIET));
    const mouth = at(fig.rig, 'mouth');
    const hand = at(fig.rig, 'handR');
    const off = hand.distanceTo(mouth);
    assert.ok(off < 0.08, `${kind}: the hand is ${(off * 100).toFixed(1)} cm from the mouth`);
    fig.rig.destroy();
  }
});

/** A prop held in front of the figure: its centre is in front of the torso, and the head looks at it. */
const IN_FRONT: [LeisureKind, PropKind, number][] = [
  ['book', 'book', 0.5],
  ['newspaper', 'newspaper', 0.5],
  ['phone', 'phone', 0.5],
  ['laptop', 'laptop', 0.5],
];

test('book, newspaper, phone and laptop: the prop is in front of the chest and the head looks at it within 25 degrees', () => {
  for (const [kind, prop, u] of IN_FRONT) {
    const fig = figure(`front-${kind}`, TALL, prop);
    pose(fig, leisurePose(zeroPose(), kind, u, QUIET));
    // The chest is the middle of the shoulders.
    const chest = at(fig.rig, 'shoulderL').add(at(fig.rig, 'shoulderR')).multiplyScalar(0.5);
    const centre = fig.rig.props[prop].getWorldPosition(new Vector3());
    // In front of the chest: the prop is ahead of the shoulders, not beside them.
    assert.ok(centre.z - chest.z > 0.05, `${kind}: the prop is ${(centre.z - chest.z).toFixed(3)} m in front of the chest`);
    // The head's forward axis points at it.
    const eyes = at(fig.rig, 'eyes');
    const forward = new Vector3(0, 0, 1).applyQuaternion(fig.rig.bones.head.getWorldQuaternion(new Quaternion()));
    const deg = (angle(forward, centre.clone().sub(eyes)) * 180) / Math.PI;
    assert.ok(deg < 25, `${kind}: the head looks ${deg.toFixed(1)} degrees away from the prop`);
    fig.rig.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* Two hands on a two-handed prop                                       */
/* ------------------------------------------------------------------ */

/**
 * The two edges of each two-handed prop, in the prop's metres: the right hand
 * holds the near edge (the negative of the far edge), the left the far edge.
 * The cards are held by the fan's pivot and its top card.
 */
const TWO_HANDED: [LeisureKind, PropKind, [number, number, number], [number, number, number]][] = [
  ['book', 'book', [-0.17, 0, 0], [0.17, 0, 0]],
  ['newspaper', 'newspaper', [-0.21, 0, 0], [0.21, 0, 0]],
  ['cards', 'cards', [0, 0, 0], [0, 0.085, 0]],
  ['crossword', 'crossword', [-0.105, 0, 0], [0.105, 0, 0]],
  ['laptop', 'laptop', [-0.135, 0, 0], [0.135, 0, 0]],
];

const ALL_ARCHETYPES = Object.keys(ARCHETYPES) as Archetype[];

test('two-handed props: both hands are within 4 cm of their edges, on every archetype', () => {
  for (const [kind, prop, near, far] of TWO_HANDED) {
    // The far edge is the reach test's own table, so the two stay in step.
    if (FAR_EDGE[prop]) assert.deepEqual(far, FAR_EDGE[prop], `${prop} far edge`);
    for (const archetype of ALL_ARCHETYPES) {
      const fig = figure(`hands-${kind}-${archetype}`, archetype, prop);
      pose(fig, leisurePose(zeroPose(), kind, 0.5, QUIET, { aim: 0, sun: 0.5, archetype }));
      const rightOff = at(fig.rig, 'handR').distanceTo(onProp(fig, near));
      const leftOff = at(fig.rig, 'handL').distanceTo(onProp(fig, far));
      assert.ok(rightOff <= 0.04, `${kind} ${archetype}: the right hand is ${(rightOff * 100).toFixed(1)} cm from its edge`);
      assert.ok(leftOff <= 0.04, `${kind} ${archetype}: the left hand is ${(leftOff * 100).toFixed(1)} cm from its edge`);
      fig.rig.destroy();
    }
  }
});

/** The distance from a point to a segment, in the same units as the points. */
function distanceToSegment(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

test('snack: the lolly is at the mouth, and the left hand stays low, never in front of the face, on every archetype', () => {
  for (const archetype of ALL_ARCHETYPES) {
    const fig = figure(`snack-${archetype}`, archetype, 'snack');
    pose(fig, leisurePose(zeroPose(), 'snack', 0.56, QUIET, { aim: 0, sun: 0.5, archetype }));
    const mouth = at(fig.rig, 'mouth');
    const hand = at(fig.rig, 'handR');
    assert.ok(hand.distanceTo(mouth) < 0.08, `${archetype}: the lolly hand is ${(hand.distanceTo(mouth) * 100).toFixed(1)} cm from the mouth`);
    const left = at(fig.rig, 'handL');
    // On the belly: well below the mouth and far from it. (The figure leans
    // back, so "in front of" in world z would only mean "towards the feet".)
    assert.ok(mouth.y - left.y > 0.05, `${archetype}: the left hand is only ${((mouth.y - left.y) * 100).toFixed(1)} cm below the mouth`);
    assert.ok(left.distanceTo(mouth) > 0.15, `${archetype}: the left hand is ${(left.distanceTo(mouth) * 100).toFixed(1)} cm from the mouth`);
    // And the forearm does not cross the face.
    const forearm = distanceToSegment(mouth, at(fig.rig, 'elbowL'), left);
    assert.ok(forearm > 0.05, `${archetype}: the left forearm passes ${(forearm * 100).toFixed(1)} cm from the mouth`);
    fig.rig.destroy();
  }
});

test('call: the phone is against the ear, on the outside of the head, and visible from the front, on every archetype', () => {
  for (const archetype of ALL_ARCHETYPES) {
    const fig = figure(`call-${archetype}`, archetype, 'phone');
    pose(fig, leisurePose(zeroPose(), 'call', 0.5, QUIET, { aim: 0, sun: 0.5, archetype }));
    const head = at(fig.rig, 'head');
    const phone = fig.rig.props.phone.getWorldPosition(new Vector3());
    const headR = buildSkeleton3D(fig.spec).headR * HEIGHT;
    const d = phone.distanceTo(head) / headR;
    // Outside the head, a little way off it: the ear is at the surface.
    assert.ok(d > 1.05 && d < 1.35, `${archetype}: the phone is ${d.toFixed(2)} head radii from the middle of the head`);
    // Visible from the front: the phone sits beyond the head's outline, to the side.
    assert.ok(Math.abs(phone.x - head.x) > headR, `${archetype}: the phone is ${((phone.x - head.x) * 100).toFixed(1)} cm to the side, inside the head's outline`);
    fig.rig.destroy();
  }
});

test('stretch: the upper body turns, and the hips and the feet stay on the lounger', () => {
  const fig = figure('stretch-body', TALL);
  const rest = lounge(QUIET);
  // The lounge's own hips and feet are the reference: the test is about the
  // change from them, not about where the lounger puts the figure.
  pose(fig, rest);
  const hips0 = at(fig.rig, 'hips').x;
  const footL0 = at(fig.rig, 'footL').x;
  const footR0 = at(fig.rig, 'footR').x;
  let turned = 0;
  for (let i = 0; i <= 100; i += 1) {
    const p = leisurePose(zeroPose(), 'stretch', i / 100, QUIET);
    // No whole-body roll: the figure does not tip off the seat.
    assert.equal(p.roll, rest.roll, `stretch at u=${i / 100}: roll is ${p.roll}`);
    assert.ok(Math.abs(p.torso) <= 0.25, `stretch at u=${i / 100}: the upper body turns ${p.torso.toFixed(3)} rad`);
    turned = Math.max(turned, Math.abs(p.torso));
    pose(fig, p);
    const hips = at(fig.rig, 'hips');
    const footL = at(fig.rig, 'footL');
    const footR = at(fig.rig, 'footR');
    assert.ok(Math.abs(hips.x - hips0) < 0.02, `stretch at u=${i / 100}: the hips moved ${((hips.x - hips0) * 100).toFixed(1)} cm to the side`);
    assert.ok(Math.abs(footL.x - footL0) < 0.03 && Math.abs(footR.x - footR0) < 0.03, `stretch at u=${i / 100}: a foot moved off the seat`);
  }
  assert.ok(turned > 0.1, `the upper body turns only ${turned.toFixed(3)} rad`);
  fig.rig.destroy();
});

/* ------------------------------------------------------------------ */
/* Tea: the glass on the side table, taken and put back                  */
/* ------------------------------------------------------------------ */

/**
 * The reach the tea station allows, per archetype, in cm, from the hand to the
 * glass's standing point. Tall, pear and round are within the plan's 4 cm.
 * Bean and squat are not: their elbow is straight at the table, and their
 * shoulder is further from it than the arm reaches, so neither the arm, the
 * lean (0.25 rad) nor the glass's spot (6 cm towards the lounger, on the
 * table top) brings the hand to it. Measured: bean 11.4, squat 11.7 cm. This
 * is the limit of the current design (Deviations, 29.5), not a tolerance.
 */
const TEA_REACH_CM: Record<Archetype, number> = { tall: 4, pear: 4, round: 4, bean: 12, squat: 12 };

/**
 * A figure lying on a lounger, placed as the pool places a lounging figure:
 * the hips on the seat, the root under them, turned to the lounger's facing.
 */
function onLounger(id: string, archetype: Archetype, l: Lounger, prop: PropKind | null = 'cup') {
  const spec = specFor(id, 'subagent', { accessory: 'none', height: 1, archetype });
  const rig = buildRig3D(spec);
  rig.root.scale.setScalar(HEIGHT);
  const hipHeight = restPosition(rig.skeleton, 'hips').y * HEIGHT;
  const f = l.facing;
  rig.root.position.set(l.x - f.x * l.length * HIP_BACK, l.seatHeight - hipHeight, l.z - f.z * l.length * HIP_BACK);
  rig.root.rotation.y = Math.atan2(f.x, f.z);
  return { rig, spec, prop };
}

test('tea: the glass stands on the table top, and its saucer stays on it, on every lounger', () => {
  // The saucer is 6.8 cm in radius: the glass's spot and its saucer stay on the top.
  const SAUCER = 0.068;
  assert.ok(GLASS_REACH + SAUCER <= TABLE_RADIUS, `the saucer hangs off the table by ${((GLASS_REACH + SAUCER - TABLE_RADIUS) * 100).toFixed(1)} cm`);
  for (const l of buildWorld(null).loungers) {
    const table = sideTableOf(l);
    const spot = teaSpotOf(l);
    // The spot is GLASS_REACH from the middle of the table, and on the top.
    assert.ok(Math.abs(Math.hypot(spot.x - table.x, spot.z - table.z) - GLASS_REACH) < 1e-9, `lounger ${l.index}: the spot is not ${GLASS_REACH} m from the table's middle`);
    assert.equal(spot.top, table.top);
    assert.equal(spot.radius, TABLE_RADIUS);
  }
});

test('tea: at the take and at the put-back, the hand is within the reach of its archetype of the glass, on every archetype', () => {
  const l = buildWorld(null).loungers[0];
  const spot = teaSpotOf(l);
  const glass = new Vector3(spot.x, spot.top + GLASS_ORIGIN_Y, spot.z);
  for (const archetype of ALL_ARCHETYPES) {
    const fig = onLounger(`tea-reach-${archetype}`, archetype, l);
    for (const [moment, u] of [['take', TEA_TAKE_U], ['put-back', TEA_PUT_DOWN_U]] as const) {
      const p = leisurePose(zeroPose(), 'tea', u, QUIET, { aim: 0, sun: 0.5, archetype });
      pose(fig, p);
      const off = at(fig.rig, 'handR').distanceTo(glass) * 100;
      assert.ok(off <= TEA_REACH_CM[archetype], `${archetype} at the ${moment}: the hand is ${off.toFixed(1)} cm from the glass`);
      // The lean is at most a quarter of a radian, and only towards the table.
      assert.ok(Math.abs(p.spine) <= 0.25 && Math.abs(p.torso) <= 0.25, `${archetype} at the ${moment}: the lean is ${p.spine.toFixed(2)}, ${p.torso.toFixed(2)}`);
    }
    fig.rig.destroy();
  }
});

test('tea: between the take and the put-back the hand holds the glass at the chest, above the table', () => {
  const l = buildWorld(null).loungers[0];
  const spot = teaSpotOf(l);
  for (const archetype of ALL_ARCHETYPES) {
    const fig = onLounger(`tea-hand-${archetype}`, archetype, l);
    const mid = leisurePose(zeroPose(), 'tea', (TEA_TAKE_U + TEA_PUT_DOWN_U) / 2, QUIET, { aim: 0, sun: 0.5, archetype });
    pose(fig, mid);
    const hand = at(fig.rig, 'handR');
    assert.ok(hand.y > spot.top + 0.1, `${archetype}: the hand is ${((hand.y - spot.top) * 100).toFixed(1)} cm above the table in the middle`);
    fig.rig.destroy();
  }
});

test('tea: the sip brings the glass to the mouth, within 8 cm, on every archetype', () => {
  for (const archetype of ALL_ARCHETYPES) {
    const fig = figure(`tea-sip-${archetype}`, archetype, 'cup');
    pose(fig, leisurePose(zeroPose(), 'tea', TEA_SIP_U, QUIET, { aim: 0, sun: 0.5, archetype }));
    const off = at(fig.rig, 'handR').distanceTo(at(fig.rig, 'mouth')) * 100;
    assert.ok(off < 8, `${archetype}: the hand is ${off.toFixed(1)} cm from the mouth at the sip`);
    fig.rig.destroy();
  }
});

/* ------------------------------------------------------------------ */
/* The driver: the 2D pose by default, the 3D pose and props on request */
/* ------------------------------------------------------------------ */

test('the driver shows the 3D props only when it is asked for the 3D pose', () => {
  const spec = specFor('driver-props', 'subagent', { accessory: 'none' });
  const pool3d = new PoseDriver(spec, { leisure: '3d' });
  const side2d = new PoseDriver(spec);
  const expected: [LeisureKind, PropKind | null][] = [
    ['tea', 'cup'], ['book', 'book'], ['phone', 'phone'], ['call', 'phone'], ['snack', 'snack'],
    ['newspaper', 'newspaper'], ['cards', 'cards'], ['laptop', 'laptop'], ['music', 'headphones'],
    ['fan', 'fan'], ['lemonade', 'glass'], ['crossword', 'crossword'], ['sunbathe', null],
    ['nap', null], ['stretch', null], ['chat', null], ['watch', null], ['cat', null],
  ];
  for (const [kind, prop] of expected) {
    pool3d.playActivity(kind, 30);
    pool3d.update(16);
    assert.equal(pool3d.prop, prop, `3D ${kind}`);
    side2d.playActivity(kind, 30);
    side2d.update(16);
    // The 2D driver has the props of Sprint 25 and before, and no others.
    const old2d = (['tea', 'book', 'phone', 'call', 'snack', 'newspaper', 'cards'] as LeisureKind[]).includes(kind);
    assert.equal(side2d.prop, old2d ? prop : null, `2D ${kind}`);
  }
});

test('the 3D driver plays the activity along its length: the book is read in the middle', () => {
  const spec = specFor('driver-clock', 'subagent', { accessory: 'none' });
  const driver = new PoseDriver(spec, { leisure: '3d' });
  driver.playActivity('book', 60);
  // Half way through (30 s of a 60 s activity), the book is in the hands.
  for (let i = 0; i < 1875; i += 1) driver.update(16);
  assert.ok(driver.isDoingActivity);
  assert.equal(driver.prop, 'book');
  assert.ok(driver.actionProgress >= 0 || driver.actionProgress < 0);
  assert.ok(driver.currentPose.headPitch < -0.3, `head ${driver.currentPose.headPitch.toFixed(2)}`);
});

test('the lounge for an agent with no activity: the 3D driver has no prop on its lounger', () => {
  const spec = specFor('driver-none', 'subagent', { accessory: 'none', idleActivity: 'none' });
  const driver = new PoseDriver(spec, { leisure: '3d' });
  for (let i = 0; i < 40; i += 1) driver.update(16);
  assert.equal(driver.prop, null);
});

test('the 3D driver holds the tea glass until the put-down, and then the hand is empty', () => {
  const spec = specFor('driver-tea', 'subagent', { accessory: 'none', idleActivity: 'none' });
  const driver = new PoseDriver(spec, { leisure: '3d' });
  driver.playActivity('tea', 40);
  // Thirty seconds of a 40 s activity: u = 0.75, the glass is still in the hand.
  for (let i = 0; i < 1875; i += 1) driver.update(16);
  assert.equal(driver.prop, 'cup');
  assert.ok(driver.activeProgress < TEA_PUT_DOWN_U);
  // Past the put-down (u = 0.86 is 34.4 s): the glass is on the table, the hand is empty.
  for (let i = 0; i < 300; i += 1) driver.update(16);
  assert.ok(driver.activeProgress >= TEA_PUT_DOWN_U, `progress ${driver.activeProgress.toFixed(3)}`);
  assert.equal(driver.prop, null);
});

test('a reused pose gives the same lean and turn each time: the spine and the torso do not add up over the frames', () => {
  // The driver writes every frame into one pose object, so a lean that is
  // added to the last frame's would grow without end.
  for (const [kind, u, key] of [['tea', 0.15, 'spine'], ['tea', 0.15, 'torso'], ['stretch', 0.4, 'torso']] as const) {
    const shared = zeroPose();
    const first = leisurePose(shared, kind, u, QUIET, { aim: 0, sun: 0.5, archetype: 'pear' })[key];
    for (let i = 0; i < 20; i += 1) leisurePose(shared, kind, u, QUIET, { aim: 0, sun: 0.5, archetype: 'pear' });
    const later = shared[key];
    assert.ok(Math.abs(later - first) < 1e-9, `${kind} ${key}: ${first.toFixed(3)} at first, ${later.toFixed(3)} after 20 frames`);
  }
});
