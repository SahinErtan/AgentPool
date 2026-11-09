/**
 * The invariants of the character system.
 *
 * These are the checks the plan asks for: a character is a pure function of
 * its id, the animation does not depend on the frame rate, the pose layers
 * never fight each other, and the pose is always a number and never a NaN.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CharacterAnimator } from '../src/scene/characters/animator';
import { damp } from '../src/scene/characters/math';
import {
  activityPose,
  blendPose,
  climbPose,
  loungePose,
  restPose,
  SWIM_STYLES,
  walkPose,
  zeroPose,
  type Pose,
} from '../src/scene/characters/poses';
import { buildRig } from '../src/scene/characters/rig';
import { rngFor, specFor, type CharacterSpec } from '../src/scene/characters/spec';
import { AGENTPOOL_IDS } from './ids';

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

/* --- 1. the same id always gives the same character ------------------ */

test('the same id always gives the same character', () => {
  for (const id of AGENTPOOL_IDS) {
    const first = specFor(id);
    const second = specFor(id);
    assert.deepEqual(second, first, `the spec of ${id} changed between two calls`);
  }
});

test('the characters are snapshots, not just equal to each other', () => {
  // A change in the spec would show up here: the values are pinned.
  const spec = specFor('sub:0123456789abcdef');
  assert.equal(spec.seed, 2132370805);
  assert.equal(spec.archetype, 'bean');
  assert.equal(spec.swimStyle, 'doggy');
  assert.equal(spec.idleActivity, 'phone');
  assert.equal(spec.skin, '#3a2317');
  assert.equal(spec.hair, '#6b3f22');
  assert.equal(spec.suit, '#bc78cd');
  assert.equal(spec.accent, '#b0d86f');
  assert.equal(spec.accessory, 'none');
  assert.equal(spec.flip, true);
  assert.ok(Math.abs(spec.height - 1.09991423) < 0.000001);
  assert.ok(Math.abs(spec.idleStartDelay - 7.0505550) < 0.000001);
  assert.ok(Math.abs(spec.idleDuration - 6.8717590) < 0.000001);
  assert.ok(Math.abs(spec.idleCooldown - 39.9357844) < 0.000001);
  assert.ok(Math.abs(spec.blinkInterval - 3.4220494) < 0.000001);
  assert.ok(Math.abs(spec.phaseOffset - 0.54621822) < 0.000001);
  assert.ok(Math.abs(spec.speedScale - 1.01691761) < 0.000001);
});

/* --- 2. the random streams are separated ---------------------------- */

test('every channel draws from its own stream', () => {
  const skin = rngFor('sub:1', 'skin');
  const hair = rngFor('sub:1', 'hair');

  const skinValues = [skin(), skin(), skin()];
  const hairValues = [hair(), hair(), hair()];

  assert.notDeepEqual(skinValues, hairValues, 'two channels share their stream');
});

test('adding a channel does not change the other ones', () => {
  // The streams are derived from the id and the channel name alone, so a
  // new attribute cannot shift the ones that already exist.
  const before = [rngFor('sub:1', 'skin')(), rngFor('sub:1', 'hair')()];
  const unused = rngFor('sub:1', 'a-brand-new-channel');
  unused();
  const after = [rngFor('sub:1', 'skin')(), rngFor('sub:1', 'hair')()];
  assert.deepEqual(after, before);
});

test('the same channel gives the same numbers', () => {
  const first = rngFor('sub:1', 'shape');
  const second = rngFor('sub:1', 'shape');
  for (let index = 0; index < 10; index += 1) {
    assert.equal(first(), second());
  }
});

/* --- 3. the animation does not depend on the frame rate --------------- */

test('damp does not depend on the frame rate', () => {
  let slow = 0;
  for (let frame = 0; frame < 30; frame += 1) slow = damp(slow, 1, 8, 33.3);

  let fast = 0;
  for (let frame = 0; frame < 60; frame += 1) fast = damp(fast, 1, 8, 16.67);

  assert.ok(
    Math.abs(slow - fast) / fast < 0.01,
    `30 steps of 33.3 ms gave ${slow}, 60 steps of 16.67 ms gave ${fast}`,
  );
});

test('damp never overshoots and never goes backwards', () => {
  let value = 0;
  for (let frame = 0; frame < 100; frame += 1) {
    const next = damp(value, 1, 8, 16.67);
    assert.ok(next > value && next <= 1, `damp went from ${value} to ${next}`);
    value = next;
  }
});

/* --- 4. the pose layers never fight each other ------------------------ */

test('the weights always add up to one', () => {
  for (const id of AGENTPOOL_IDS) {
    const spec = specFor(id);
    const animator = new CharacterAnimator(buildRig(spec));
    for (let frame = 0; frame < 400; frame += 1) {
      animator.setState('lounging');
      animator.update(16.67);
      const weights = animator.layerWeights;
      const total =
        weights.rest + weights.lounge + weights.activity + weights.walk + weights.swim + weights.climb;
      assert.ok(
        Math.abs(total - 1) < 0.001,
        `the weights of ${id} add up to ${total}`,
      );
      assert.ok(weights.rest >= 0, `the rest weight of ${id} is negative`);
      assert.ok(weights.activity >= 0, `the activity weight of ${id} is negative`);
    }
  }
});

test('the activity weight never goes negative', () => {
  // This is the bug the layering caused once: the activity was taken out of
  // the damped lounge weight, which made the fixed point negative.
  const spec = specFor('sub:activity-check');
  const animator = new CharacterAnimator(buildRig(spec));
  for (let frame = 0; frame < 600; frame += 1) {
    animator.setState('lounging');
    animator.update(16.67);
    assert.ok(animator.layerWeights.activity >= 0);
    assert.ok(animator.layerWeights.lounge >= 0);
  }
});

/* --- 5. the pose is always a number ----------------------------------- */

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
  const spec = specFor('sub:pose-check');
  const pose = zeroPose();
  for (let step = 0; step < 100; step += 1) {
    const t = step / 100;
    assertFinitePose(restPose(pose, t), `rest at ${t}`);
    assertFinitePose(loungePose(pose, t), `lounge at ${t}`);
    assertFinitePose(walkPose(pose, t), `walk at ${t}`);
    assertFinitePose(climbPose(pose, t), `climb at ${t}`);
    for (const activity of ['tea', 'book', 'phone', 'sunbathe', 'nap', 'stretch', 'chat'] as const) {
      assertFinitePose(activityPose(pose, activity, t, spec), `${activity} at ${t}`);
    }
  }
});

test('blending two poses gives a finite pose', () => {
  const a = walkPose(zeroPose(), 0.3);
  const b = loungePose(zeroPose(), 0.7);
  const out = blendPose(zeroPose(), a, 0.5, b, 0.5);
  assertFinitePose(out, 'the blend');
});

/* --- 6. the two rigs stay in sync ------------------------------------- */

test('the underwater rig gets the same transforms as the surface rig', () => {
  const spec = specFor('sub:rig-sync');
  const surface = buildRig(spec);
  const under = buildRig(spec);
  const animator = new CharacterAnimator(surface);
  animator.setSecondary(under);

  animator.setState('swimming');
  for (let frame = 0; frame < 120; frame += 1) {
    animator.update(16.67);
  }

  const pairs: [keyof typeof surface, keyof typeof surface][] = [
    ['facing', 'facing'],
    ['bob', 'bob'],
    ['body', 'body'],
    ['headPivot', 'headPivot'],
    ['armL', 'armL'],
    ['armR', 'armR'],
    ['elbowL', 'elbowL'],
    ['elbowR', 'elbowR'],
    ['legL', 'legL'],
    ['legR', 'legR'],
    ['kneeL', 'kneeL'],
    ['kneeR', 'kneeR'],
  ];

  for (const [left, right] of pairs) {
    const a = surface[left];
    const b = under[right];
    assert.equal(a.x, b.x, `${String(left)} moved on one rig only`);
    assert.equal(a.y, b.y, `${String(left)} moved on one rig only`);
    assert.equal(a.rotation, b.rotation, `${String(left)} turned on one rig only`);
    assert.equal(a.scale.x, b.scale.x, `${String(left)} scaled on one rig only`);
  }
});

/* --- 7. the idle activities do not run in lockstep -------------------- */

test('two characters with the same activity do not start it together', () => {
  const first = specFor('sub:twin-1');
  const second = specFor('sub:twin-2');
  // Give them the same activity, so only the timing can tell them apart.
  const overrides = { idleActivity: 'tea' } as Partial<CharacterSpec>;
  const one = new CharacterAnimator(buildRig(specFor('sub:twin-1', 'subagent', overrides)));
  const two = new CharacterAnimator(buildRig(specFor('sub:twin-2', 'subagent', overrides)));

  let oneStart = -1;
  let twoStart = -1;
  for (let frame = 0; frame < 2000; frame += 1) {
    one.setState('lounging');
    two.setState('lounging');
    one.update(16.67);
    two.update(16.67);
    if (oneStart < 0 && one.isDoingActivity) oneStart = frame;
    if (twoStart < 0 && two.isDoingActivity) twoStart = frame;
  }

  assert.ok(oneStart >= 0, 'the first character never started its activity');
  assert.ok(twoStart >= 0, 'the second character never started its activity');
  assert.ok(
    Math.abs(oneStart - twoStart) > 30,
    `both characters started their activity at the same moment (${oneStart} and ${twoStart})`,
  );
  assert.ok(first.idleStartDelay !== second.idleStartDelay);
});

test('the activity comes back to nothing when it is over', () => {
  // The activity is forced: some characters have none at all.
  const spec = specFor('sub:activity-ends', 'subagent', { idleActivity: 'tea' });
  const animator = new CharacterAnimator(buildRig(spec));

  let sawActivity = false;
  for (let frame = 0; frame < 3000; frame += 1) {
    animator.setState('lounging');
    animator.update(16.67);
    if (animator.isDoingActivity) sawActivity = true;
    if (sawActivity && !animator.isDoingActivity) {
      assert.ok(
        animator.layerWeights.activity < 0.01,
        `the activity weight stayed at ${animator.layerWeights.activity}`,
      );
      return;
    }
  }
  assert.fail('the activity never ended');
});
