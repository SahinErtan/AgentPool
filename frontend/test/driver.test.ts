/**
 * The pose driver: the invariants of the character system.
 *
 * The driver is what turns a character's state into a pose. These are the
 * promises it has to keep: the pose layers never fight each other, the
 * characters do not run in lockstep, the walk follows the ground covered
 * and not the clock, and the idle activities do not start together.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { specFor, type CharacterSpec } from '../src/scene/characters/spec';
import { PoseDriver } from '../src/scene/motion/driver';
import { AGENTPOOL_IDS } from './ids';

/* --- the pose layers never fight each other --------------------------- */

test('the weights always add up to one', () => {
  for (const id of AGENTPOOL_IDS) {
    const driver = new PoseDriver(specFor(id));
    for (let frame = 0; frame < 400; frame += 1) {
      driver.setState('lounging');
      driver.update(16.67);
      const weights = driver.layerWeights;
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
  const driver = new PoseDriver(specFor('sub:activity-check'));
  for (let frame = 0; frame < 600; frame += 1) {
    driver.setState('lounging');
    driver.update(16.67);
    assert.ok(driver.layerWeights.activity >= 0);
    assert.ok(driver.layerWeights.lounge >= 0);
  }
});

/* --- the characters do not run in lockstep ---------------------------- */

test('two characters do not breathe at the same moment', () => {
  // The scene used to hand one clock to everybody, so a row of loungers
  // was a row of figures breathing in step. Each character has its own
  // clock and its own noise now.
  const one = new PoseDriver(specFor('sub:breath-1'));
  const two = new PoseDriver(specFor('sub:breath-2'));

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
  const driver = new PoseDriver(specFor('sub:own-clock'));
  driver.setState('resting');
  const first = driver.currentPose.bob;
  for (let frame = 0; frame < 60; frame += 1) driver.update(16.67);
  assert.notEqual(driver.currentPose.bob, first, 'the character never moved');
});

test('the walk follows the distance and not the clock', () => {
  // A character that is held up by another one used to keep walking its
  // legs on the spot: the stride was a free-running timer.
  const driver = new PoseDriver(specFor('sub:stride'));
  driver.setState('walking');

  const before = driver.walkCycle;
  driver.advanceWalk(0);
  assert.equal(driver.walkCycle, before, 'the walk moved without any ground covered');
  driver.advanceWalk(0.5);
  const after = driver.walkCycle;
  assert.ok(
    Math.abs(after - before) > 0.4 && Math.abs(after - before) < 0.6,
    `the walk did not follow the distance (${before} and ${after})`,
  );
});

/* --- the idle activities do not run in lockstep ----------------------- */

test('two characters with the same activity do not start it together', () => {
  const first = specFor('sub:twin-1');
  const second = specFor('sub:twin-2');
  // Give them the same activity, so only the timing can tell them apart.
  const overrides = { idleActivity: 'tea' } as Partial<CharacterSpec>;
  const one = new PoseDriver(specFor('sub:twin-1', 'subagent', overrides));
  const two = new PoseDriver(specFor('sub:twin-2', 'subagent', overrides));

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
  const driver = new PoseDriver(spec);

  let sawActivity = false;
  for (let frame = 0; frame < 3000; frame += 1) {
    driver.setState('lounging');
    driver.update(16.67);
    if (driver.isDoingActivity) sawActivity = true;
    if (sawActivity && !driver.isDoingActivity) {
      assert.ok(
        driver.layerWeights.activity < 0.01,
        `the activity weight stayed at ${driver.layerWeights.activity}`,
      );
      return;
    }
  }
  assert.fail('the activity never ended');
});
