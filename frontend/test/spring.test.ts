/**
 * The spring.
 *
 * The spring is what gives a movement its lag and its settle. These are the
 * promises it has to keep: it arrives, it does not blow up, and it behaves
 * the same on a slow screen and on a fast one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { damp } from '../src/scene/characters/math';
import { dampingFor, spring, springSnap, springStep } from '../src/scene/characters/spring';

test('a spring that starts at the target stays there', () => {
  const state = spring(1);
  for (let step = 0; step < 60; step += 1) {
    springStep(state, 1, 60, dampingFor(60), 16);
  }
  assert.ok(Math.abs(state.value - 1) < 1e-6, `the spring drifted to ${state.value}`);
  assert.ok(Math.abs(state.velocity) < 1e-6, `the spring is still moving at ${state.velocity}`);
});

test('a spring arrives at its target', () => {
  const state = spring(0);
  for (let step = 0; step < 240; step += 1) {
    springStep(state, 1, 60, dampingFor(60), 16);
  }
  assert.ok(Math.abs(state.value - 1) < 1e-3, `the spring stopped at ${state.value}`);
});

test('a spring that is not damped enough overshoots', () => {
  // A ratio below one lets the spring go past its target and come back.
  const state = spring(0);
  let highest = 0;
  for (let step = 0; step < 240; step += 1) {
    springStep(state, 1, 60, dampingFor(60, 0.35), 16);
    highest = Math.max(highest, state.value);
  }
  assert.ok(highest > 1.05, `the spring never overshot (${highest})`);
  assert.ok(Math.abs(state.value - 1) < 1e-2, `the spring stopped at ${state.value}`);
});

test('a spring that is damped enough does not overshoot', () => {
  const state = spring(0);
  let highest = 0;
  for (let step = 0; step < 240; step += 1) {
    springStep(state, 1, 60, dampingFor(60, 1), 16);
    highest = Math.max(highest, state.value);
  }
  assert.ok(highest <= 1.0001, `the spring overshot to ${highest}`);
});

test('the spring does not depend on the frame rate', () => {
  // The same amount of time gives the same place, whether it comes in one
  // step or in sixty. That is what `damp` promises for the weights, and the
  // spring has to promise it too.
  const slow = spring(0);
  for (let step = 0; step < 120; step += 1) springStep(slow, 1, 60, dampingFor(60), 16);
  const fast = spring(0);
  for (let step = 0; step < 30; step += 1) springStep(fast, 1, 60, dampingFor(60), 64);
  assert.ok(
    Math.abs(slow.value - fast.value) < 0.01,
    `the spring ended at ${slow.value} and ${fast.value}`,
  );
});

test('the spring never goes to NaN', () => {
  const state = spring(0);
  for (let step = 0; step < 200; step += 1) {
    springStep(state, step % 2 === 0 ? 1 : -1, 200, 5, 16);
    assert.ok(Number.isFinite(state.value), `the spring went to ${state.value}`);
    assert.ok(Number.isFinite(state.velocity), `the spring went to ${state.velocity}`);
  }
});

test('a long stall does not throw the spring across the screen', () => {
  // A tab that was in the background comes back with a huge step.
  const state = spring(0);
  springStep(state, 1, 60, dampingFor(60), 5000);
  assert.ok(state.value < 2, `the spring jumped to ${state.value}`);
  assert.ok(Number.isFinite(state.value));
});

test('a target that is not a number is ignored', () => {
  const state = spring(0.5);
  springStep(state, Number.NaN, 60, dampingFor(60), 16);
  assert.equal(state.value, 0.5);
});

test('the spring can be put somewhere at once', () => {
  const state = spring(0);
  springSnap(state, 3, 0);
  assert.equal(state.value, 3);
  assert.equal(state.velocity, 0);
});

test('the damping of a stiff spring is bigger', () => {
  assert.ok(dampingFor(400) > dampingFor(100));
  // And the critical damping is what settles the spring in the shortest
  // time without overshooting.
  assert.equal(dampingFor(100, 1), 2 * Math.sqrt(100));
});

test('a spring moves towards its target and not away from it', () => {
  const state = spring(0);
  let previous = state.value;
  for (let step = 0; step < 60; step += 1) {
    springStep(state, 1, 60, dampingFor(60, 1), 16);
    assert.ok(state.value >= previous - 1e-9, `the spring went backwards to ${state.value}`);
    previous = state.value;
  }
});

// The damp is the other way the animation is smoothed: a value that moves a
// fraction of the way to its target each frame. It has to behave the same
// on a slow screen and on a fast one, too.

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
