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
  assert.equal(spec.idleActivity, 'nap');
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

/* --- 7. the characters do not run in lockstep ------------------------- */

test('two characters do not breathe at the same moment', () => {
  // The scene used to hand one clock to everybody, so a row of loungers
  // was a row of figures breathing in step. Each character has its own
  // clock and its own noise now.
  const one = new CharacterAnimator(buildRig(specFor('sub:breath-1')));
  const two = new CharacterAnimator(buildRig(specFor('sub:breath-2')));

  const first: number[] = [];
  const second: number[] = [];
  for (let frame = 0; frame < 300; frame += 1) {
    one.setState('resting');
    two.setState('resting');
    one.update(16.67);
    two.update(16.67);
    first.push(one.currentPose.bob);
    second.push(two.currentPose.bob);
  }

  // Two characters must not trace the same curve.
  let alike = 0;
  for (let frame = 0; frame < first.length; frame += 1) {
    if (Math.abs(first[frame] - second[frame]) < 1e-6) alike += 1;
  }
  assert.ok(alike < 5, `the two characters breathed together ${alike} times`);

  // And neither of them may stand still: a figure that does not move at
  // all reads as a picture, not as a person.
  const firstRange = Math.max(...first) - Math.min(...first);
  const secondRange = Math.max(...second) - Math.min(...second);
  assert.ok(firstRange > 1e-5, `the first character never moved (${firstRange})`);
  assert.ok(secondRange > 1e-5, `the second character never moved (${secondRange})`);
});

test('a character breathes on its own clock', () => {
  const animator = new CharacterAnimator(buildRig(specFor('sub:own-clock')));
  animator.setState('resting');
  const first = animator.currentPose.bob;
  for (let frame = 0; frame < 60; frame += 1) animator.update(16.67);
  assert.notEqual(animator.currentPose.bob, first, 'the character never moved');
});

/* --- 8. the sign of the angles ----------------------------------------- */

test('a positive angle points the limb forwards', () => {
  // The angles are written the way a person thinks about them: a positive
  // angle is towards the way the figure is facing. The rig applies them
  // the other way round, because PixiJS turns a limb that hangs downwards
  // backwards. The negation was missing for a long time, and every limb
  // in the pool was backwards: the crawl reached behind the swimmer, the
  // knee of the walk bent on the wrong half of the stride, and the wave
  // pointed at the deck.
  const spec = specFor('sub:sign-convention');
  const rig = buildRig(spec);
  const animator = new CharacterAnimator(rig);
  animator.setState('resting');
  for (let frame = 0; frame < 30; frame += 1) animator.update(16.67);

  const pose = animator.currentPose;
  // The rest pose holds the left arm a little forwards and the right one
  // a little back.
  assert.ok(pose.armL > 0, 'the rest pose does not hold the left arm forwards');
  assert.ok(pose.armR < 0, 'the rest pose does not hold the right arm back');

  const leftShoulder = rig.armL.getGlobalPosition();
  const leftHand = rig.handL.getGlobalPosition();
  assert.ok(
    leftHand.x > leftShoulder.x,
    `the left hand is behind the shoulder (${leftHand.x} and ${leftShoulder.x})`,
  );

  const rightShoulder = rig.armR.getGlobalPosition();
  const rightHand = rig.handR.getGlobalPosition();
  assert.ok(
    rightHand.x < rightShoulder.x,
    `the right hand is in front of the shoulder (${rightHand.x} and ${rightShoulder.x})`,
  );
});

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
  // In a side view the roll of the body is a tilt in the picture. A roll
  // of a quarter of a radian lifted the swimmer out of the water.
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

test('a character wears only its own accessory', () => {
  // The goggles, the snorkel and the floatie used to be drawn on every
  // character, whatever it had been given.
  const cases = [
    ['none', { hat: false, goggles: false, snorkel: false, floatie: false }],
    ['cap', { hat: true, goggles: false, snorkel: false, floatie: false }],
    ['sunhat', { hat: true, goggles: false, snorkel: false, floatie: false }],
    ['goggles', { hat: false, goggles: true, snorkel: false, floatie: false }],
    ['snorkel', { hat: false, goggles: false, snorkel: true, floatie: false }],
    ['floatie', { hat: false, goggles: false, snorkel: false, floatie: true }],
  ] as const;
  for (const [accessory, expected] of cases) {
    const rig = buildRig(specFor(`sub:accessory-${accessory}`, 'subagent', { accessory }));
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      assert.equal(
        rig.accessories[key].visible,
        expected[key],
        `a character with ${accessory} shows its ${key}: ${rig.accessories[key].visible}`,
      );
    }
  }
});

test('the head hangs from the neck', () => {
  // The head used to pivot about its own middle, so it was a ball
  // floating above the shoulders. It hangs from the neck now.
  const spec = specFor('sub:neck');
  const rig = buildRig(spec);
  const neck = rig.headPivot.getGlobalPosition();
  const head = rig.headGroup.getGlobalPosition();
  assert.ok(
    head.y < neck.y,
    `the head is not above the neck (${head.y} and ${neck.y})`,
  );
});

test('the walk follows the distance and not the clock', () => {
  // A character that is held up by another one used to keep walking its
  // legs on the spot: the stride was a free-running timer.
  const animator = new CharacterAnimator(buildRig(specFor('sub:stride')));
  animator.setState('walking');

  const before = animator.walkCycle;
  animator.advanceWalk(0);
  assert.equal(animator.walkCycle, before, 'the walk moved without any ground covered');
  animator.advanceWalk(0.5);
  const after = animator.walkCycle;
  assert.ok(
    Math.abs(after - before) > 0.4 && Math.abs(after - before) < 0.6,
    `the walk did not follow the distance (${before} and ${after})`,
  );
});

/* --- 9. the idle activities do not run in lockstep -------------------- */

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
