/**
 * The poses.
 *
 * A pose is a set of angles. These are the promises the pose model has to
 * keep: every pose is a number and never a NaN, the swim strokes go round
 * without jumping, a swimmer stays flat in the water, the knees bend the
 * right way, and a pose that is reused never keeps the values of the frame
 * before.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activityPose,
  blendPose,
  climbPose,
  loungePose,
  resetPose,
  restPose,
  SWIM_STYLES,
  walkPose,
  zeroPose,
  type Pose,
} from '../src/scene/characters/poses';
import { specFor } from '../src/scene/characters/spec';

const POSE_KEYS: (keyof Pose)[] = [
  'rootRot',
  'bodyPitch',
  'bodyRoll',
  'bodyY',
  'headPitch',
  'headYaw',
  'armL',
  'armR',
  'elbowL',
  'elbowR',
  'legL',
  'legR',
  'kneeL',
  'kneeR',
  'bob',
];

function assertFinitePose(pose: Pose, what: string): void {
  for (const key of POSE_KEYS) {
    assert.ok(
      Number.isFinite(pose[key]),
      `${what}: ${key} is ${pose[key]}, which is not a number`,
    );
  }
}

/* --- the pose is always a number ------------------------------------- */

test('every swim style gives a finite pose', () => {
  const spec = specFor('sub:pose-check');
  for (const [name, style] of Object.entries(SWIM_STYLES)) {
    const pose = zeroPose();
    for (let step = 0; step < 200; step += 1) {
      style.fn(pose, step / 200, spec);
      assertFinitePose(pose, `${name} at t=${step / 200}`);
    }
  }
});

test('every other pose gives a finite pose', () => {
  const pose = zeroPose();
  for (let step = 0; step < 100; step += 1) {
    const t = step / 100;
    const motion = { t, seed: 1 };
    assertFinitePose(restPose(pose, motion), `rest at ${t}`);
    assertFinitePose(loungePose(pose, motion), `lounge at ${t}`);
    assertFinitePose(walkPose(pose, t), `walk at ${t}`);
    assertFinitePose(climbPose(pose, t), `climb at ${t}`);
    for (const activity of ['tea', 'book', 'phone', 'sunbathe', 'nap', 'stretch', 'chat'] as const) {
      assertFinitePose(activityPose(pose, activity, t, motion), `${activity} at ${t}`);
    }
  }
});

test('blending two poses gives a finite pose', () => {
  const a = walkPose(zeroPose(), 0.3);
  const b = loungePose(zeroPose(), { t: 0.7, seed: 1 });
  const out = blendPose(zeroPose(), a, 0.5, b, 0.5);
  assertFinitePose(out, 'the blend');
});

/* --- the swim strokes ------------------------------------------------- */

test('no stroke jumps', () => {
  // The crawl takes the arm all the way round: forward under the water,
  // back along the hip, up over the water and in again. The angle sweeps a
  // whole turn, and it has to sweep it the right way round — a jump of
  // more than a radian between two frames means the path wrapped itself
  // the wrong way and the arm would snap.
  const spec = specFor('sub:stroke-jump');
  for (const [name, style] of Object.entries(SWIM_STYLES)) {
    const pose = zeroPose();
    let previous = 0;
    for (let step = 0; step < 400; step += 1) {
      style.fn(pose, step / 400, spec);
      if (step > 0) {
        // The arms of a backstroke go round a whole turn, so the step is
        // measured the short way round the circle.
        const raw = pose.armR - previous;
        const jump = Math.abs(raw - Math.PI * 2 * Math.round(raw / (Math.PI * 2)));
        assert.ok(
          jump < 1,
          `${name} jumps by ${jump.toFixed(2)} radians between two frames`,
        );
      }
      previous = pose.armR;
      assert.ok(
        pose.elbowR >= 0,
        `${name} bends the elbow the wrong way (${pose.elbowR})`,
      );
    }
  }
});

test('a swimmer stays flat in the water', () => {
  // A roll of the body reads as a tilt of the swimmer. A roll of a quarter
  // of a radian lifted the swimmer out of the water.
  const spec = specFor('sub:flat-swimmer');
  for (const [name, style] of Object.entries(SWIM_STYLES)) {
    const pose = zeroPose();
    for (let step = 0; step < 200; step += 1) {
      style.fn(pose, step / 200, spec);
      const tilt = Math.abs(pose.bodyRoll) + Math.abs(pose.bodyPitch);
      assert.ok(tilt < 0.3, `${name} tilts the swimmer by ${tilt.toFixed(2)} radians`);
    }
  }
});

test('the knees bend backwards', () => {
  // A knee bends so that the heel comes up towards the butt. It does not
  // bend forwards.
  for (const [name, style] of Object.entries(SWIM_STYLES)) {
    const pose = zeroPose();
    for (let step = 0; step < 200; step += 1) {
      style.fn(pose, step / 200, specFor('sub:knee-check'));
      assert.ok(
        pose.kneeL <= 0.001 && pose.kneeR <= 0.001,
        `${name} bends the knee forwards (${pose.kneeL})`,
      );
    }
  }
});

/* --- the pose that is used again and again ---------------------------- */

test('resetPose puts every angle back to zero', () => {
  const pose = zeroPose();
  restPose(pose, 0.4);
  loungePose(pose, 0.8);
  assert.ok(pose.armR !== 0 || pose.headPitch !== 0, 'the pose was not filled');

  resetPose(pose);
  for (const [key, value] of Object.entries(pose)) {
    assert.equal(value, 0, `${key} was left at ${value}`);
  }
});

test('blending into the pose that is also the first input gives the same answer', () => {
  // The driver blends the layers into the pose it already holds, so the
  // pose is both the input and the output.
  const first = zeroPose();
  restPose(first, 0.3);
  const second = zeroPose();
  restPose(second, 0.3);
  const layer = zeroPose();
  loungePose(layer, 0.7);

  const expected = blendPose(zeroPose(), first, 0.4, layer, 0.6);
  const actual = blendPose(second, second, 0.4, layer, 0.6);

  assert.deepEqual(actual, expected);
});

test('a pose that is reused does not keep the values of the frame before', () => {
  // The driver holds one pose and blends the layers into it, frame after
  // frame. The result of a frame has to be the same as the result of a
  // frame that started with an empty pose.
  const reused = zeroPose();
  const rest = zeroPose();
  const lounge = zeroPose();

  restPose(rest, 0.2);
  loungePose(lounge, 0.9);

  // The first frame.
  resetPose(reused);
  blendPose(reused, rest, 0.5, lounge, 0.5);
  const first = blendPose(zeroPose(), rest, 0.5, lounge, 0.5);

  // The second frame, with a different layer.
  restPose(rest, 0.8);
  resetPose(reused);
  blendPose(reused, rest, 0.2, lounge, 0.8);
  const second = blendPose(zeroPose(), rest, 0.2, lounge, 0.8);

  assert.deepEqual(reused, second);
  assert.notDeepEqual(first, second);
});
