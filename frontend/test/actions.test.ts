/**
 * The action layer: the short things a character does on top of what it is
 * doing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { POSE_KEYS, SWIM_STYLES, zeroPose, type Pose } from '../src/scene/characters/poses';
import { specFor, type CharacterSpec, type SwimStyle } from '../src/scene/characters/spec';
import { ACTIONS, treadPose, type ActionKind } from '../src/scene/motion/actions';
import { PoseDriver } from '../src/scene/motion/driver';

const MOTION = { t: 0, seed: 1 };

test('every action writes a whole pose, and every number in it is a number', () => {
  for (const [name, spec] of Object.entries(ACTIONS)) {
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const pose = zeroPose();
      // Fill the pose with junk: a field the action forgets would keep it.
      for (const key of POSE_KEYS) pose[key] = 99;
      spec.pose(pose, u, MOTION);
      for (const key of POSE_KEYS) {
        assert.ok(Number.isFinite(pose[key]), `${name} ${key} at ${u}`);
        assert.ok(Math.abs(pose[key]) < 10, `${name} ${key} at ${u} is ${pose[key]}`);
      }
    }
  }
});

test('an action that is not running leaves the figure alone', () => {
  const driver = new PoseDriver(specFor('still'));
  driver.update(16);
  assert.equal(driver.action, null);
  assert.equal(driver.currentPose.stretch, 0);
});

test('a one-shot action ends by itself', () => {
  const driver = new PoseDriver(specFor('one-shot'));
  driver.play('hop');
  assert.equal(driver.action, 'hop');
  const seconds = ACTIONS.hop.seconds;
  for (let t = 0; t < (seconds + 1) * 1000; t += 16) driver.update(16);
  assert.equal(driver.action, null);
});

test('a held action goes on, and a release stops it', () => {
  const driver = new PoseDriver(specFor('held'));
  driver.hold('raiseHand');
  const seconds = ACTIONS.raiseHand.seconds;
  for (let t = 0; t < seconds * 3 * 1000; t += 16) driver.update(16);
  assert.equal(driver.action, 'raiseHand', 'the action stopped on its own');
  assert.ok(driver.actionProgress >= 0 && driver.actionProgress <= 1);
  driver.release();
  for (let t = 0; t < 1000; t += 16) driver.update(16);
  assert.equal(driver.action, null, 'the release did not stop it');
});

test('the hop squashes and stretches', () => {
  const driver = new PoseDriver(specFor('hopper'));
  driver.play('hop');
  const seen: number[] = [];
  for (let t = 0; t < ACTIONS.hop.seconds * 1000; t += 16) {
    driver.update(16);
    seen.push(driver.currentPose.stretch);
  }
  assert.ok(Math.min(...seen) < -0.05, 'the hop never squashed');
  assert.ok(Math.max(...seen) > 0.05, 'the hop never stretched');
});

test('an action that is added does not fight the pose underneath', () => {
  const driver = new PoseDriver(specFor('added'));
  driver.setState('resting');
  for (let i = 0; i < 60; i += 1) driver.update(16);
  const before = driver.currentPose.armR;
  driver.play('clap');
  for (let i = 0; i < 30; i += 1) driver.update(16);
  // The clap brings the arms forward, so the right arm ends up in front of
  // where it was hanging.
  assert.ok(driver.currentPose.armR > before, 'the arms did not move');
});

test('the mouth opens for an action that wants it open', () => {
  const driver = new PoseDriver(specFor('mouth'));
  for (let i = 0; i < 60; i += 1) driver.update(16);
  assert.ok(driver.mouth < 0.2, 'the mouth was already open');
  driver.play('cheer');
  for (let i = 0; i < 40; i += 1) driver.update(16);
  assert.ok(driver.mouth > 0.5, `the mouth is ${driver.mouth}`);
});

test('every action kind is one the driver knows', () => {
  const kinds: ActionKind[] = ['cheer', 'clap', 'raiseHand', 'raiseHandLying', 'tread', 'hop'];
  for (const kind of kinds) {
    assert.ok(ACTIONS[kind], kind);
    const driver = new PoseDriver(specFor(`kind-${kind}`));
    driver.play(kind);
    for (let i = 0; i < 30; i += 1) driver.update(16);
    assert.equal(driver.action, kind, kind);
  }
});

// --- the work changes the stroke and the tempo ----------------------------

/** A spec whose own stroke is the crawl, so a change of style is visible. */
function crawler(): CharacterSpec {
  for (let i = 0; i < 200; i += 1) {
    const spec = specFor(`crawler-${i}`);
    if (spec.swimStyle === 'crawl') return spec;
  }
  throw new Error('no crawler');
}

/** The largest difference of two poses over the fields the strokes use. */
function apart(a: Pose, b: Pose): number {
  let worst = 0;
  for (const key of ['armL', 'armR', 'elbowL', 'elbowR', 'legL', 'legR', 'roll', 'armOutL'] as const) {
    worst = Math.max(worst, Math.abs(a[key] - b[key]));
  }
  return worst;
}

function strokeAt(style: SwimStyle, phase: number, spec: CharacterSpec): Pose {
  return SWIM_STYLES[style].fn(zeroPose(), phase, spec);
}

test('asking for a butterfly changes the stroke within 0.7 s, and null brings the spec back', () => {
  const spec = crawler();
  const driver = new PoseDriver(spec);
  driver.setState('swimming');
  for (let t = 0; t < 1000; t += 16) driver.update(16);
  assert.equal(driver.swimStyleNow, 'crawl');

  driver.setSwimStyle('butterfly');
  for (let t = 0; t < 700; t += 16) driver.update(16);
  assert.equal(driver.swimStyleNow, 'butterfly');
  for (let t = 0; t < 400; t += 16) driver.update(16);
  // The cross-fade is over: the pose is the butterfly at this phase, and
  // not the crawl.
  const butterfly = strokeAt('butterfly', driver.strokePhase, spec);
  const crawl = strokeAt('crawl', driver.strokePhase, spec);
  assert.ok(apart(driver.currentPose, butterfly) < 0.02, 'not the butterfly');
  assert.ok(apart(butterfly, crawl) > 0.1, 'the check cannot tell the two apart');

  driver.setSwimStyle(null);
  for (let t = 0; t < 1000; t += 16) driver.update(16);
  assert.equal(driver.swimStyleNow, 'crawl');
  assert.ok(apart(driver.currentPose, strokeAt('crawl', driver.strokePhase, spec)) < 0.02);
});

test('a tempo of 1.3 makes the strokes come 1.3 times as fast', () => {
  const spec = crawler();
  const normal = new PoseDriver(spec);
  const sprint = new PoseDriver(spec);
  sprint.setTempo(1.3);
  for (const driver of [normal, sprint]) {
    driver.setState('swimming');
    for (let t = 0; t < 120000; t += 16) driver.update(16);
  }
  assert.ok(Math.abs(sprint.strokeCount / normal.strokeCount - 1.3) < 0.05, `${sprint.strokeCount} / ${normal.strokeCount}`);
});

test('treading water takes the weight within a second, and the pose is the tread', () => {
  const driver = new PoseDriver(specFor('treader'));
  driver.setState('treading');
  for (let t = 0; t < 1000; t += 16) driver.update(16);
  assert.ok(driver.layerWeights.tread > 0.99, `tread weight ${driver.layerWeights.tread}`);
  assert.ok(driver.layerWeights.rest < 0.01);
  // Treading is the tread pose: the knees and the body pitch of the pose
  // do not move with its loop.
  const pose = driver.currentPose;
  const tread = treadPose(zeroPose(), 0.3);
  assert.ok(Math.abs(pose.kneeL - tread.kneeL) < 0.01, `knee ${pose.kneeL}`);
  assert.ok(Math.abs(pose.bodyPitch - tread.bodyPitch) < 0.01, `pitch ${pose.bodyPitch}`);
});

test('a waiting session holds its hand up until it is released', () => {
  const driver = new PoseDriver(specFor('waiting-hand'));
  driver.hold('raiseHand');
  for (let t = 0; t < 1500; t += 16) driver.update(16);
  // The arm is lifted above the shoulder, in the way the figure faces.
  assert.ok(driver.currentPose.armR < -2, `arm at ${driver.currentPose.armR.toFixed(2)}`);
  driver.release();
  for (let t = 0; t < 2000; t += 16) driver.update(16);
  assert.equal(driver.action, null);
  assert.ok(driver.currentPose.armR > -0.5, 'the arm did not come down');
});
