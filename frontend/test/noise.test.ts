/**
 * The noise.
 *
 * The characters used to breathe on a sine wave, so every one of them in
 * the pool took its breath at the same moment. The noise replaced it, and
 * these are the promises the noise has to keep: the same seed gives the
 * same noise for ever, the noise is continuous, and it does not come back
 * to the same value.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { channelSeed, fbm, hash1, noise1, smoothstep, valueNoise } from '../src/scene/characters/noise';

test('the hash gives a number between zero and one', () => {
  for (let index = 0; index < 200; index += 1) {
    const value = hash1(index, 12345);
    assert.ok(value >= 0 && value < 1, `the hash gave ${value}`);
    assert.ok(Number.isFinite(value));
  }
});

test('the hash gives the same number for the same input', () => {
  assert.equal(hash1(7, 42), hash1(7, 42));
  assert.equal(hash1(8, 42), hash1(8, 42));
});

test('the hash does not give the same number to neighbours', () => {
  // Two neighbours must not land next to each other, or the noise would
  // wander slowly instead of moving.
  //
  // Two unrelated numbers land within 0.02 of each other about four per
  // cent of the time, so the bound is a quarter of the samples rather than
  // a handful: the test is about the hash being unrelated, not about it
  // being impossible.
  let close = 0;
  let total = 0;
  const samples = 400;
  for (let index = 0; index < samples; index += 1) {
    const difference = Math.abs(hash1(index, 42) - hash1(index + 1, 42));
    total += difference;
    if (difference < 0.02) close += 1;
  }
  assert.ok(close < samples * 0.25, `${close} neighbours were too close`);
  // The average gap of two unrelated numbers in [0, 1) is a third.
  assert.ok(total / samples > 0.2, `the neighbours were on average too close`);
});

test('two seeds give different noise', () => {
  let same = 0;
  for (let step = 0; step < 100; step += 1) {
    const x = step * 0.37;
    if (Math.abs(valueNoise(x, 1) - valueNoise(x, 2)) < 1e-9) same += 1;
  }
  assert.equal(same, 0);
});

test('the noise is between zero and one', () => {
  for (let step = 0; step < 500; step += 1) {
    const value = valueNoise(step * 0.13, 99);
    assert.ok(value >= 0 && value < 1, `the noise gave ${value}`);
  }
});

test('the noise is continuous', () => {
  // The noise must not jump: a small move along the line gives a small
  // change in the value, or the body would twitch.
  let previous = valueNoise(3.2, 7);
  for (let step = 1; step <= 400; step += 1) {
    const current = valueNoise(3.2 + step * 0.001, 7);
    assert.ok(
      Math.abs(current - previous) < 0.02,
      `the noise jumped by ${Math.abs(current - previous)}`,
    );
    previous = current;
  }
});

test('the noise is the same for the same seed', () => {
  for (let step = 0; step < 50; step += 1) {
    const x = step * 0.61;
    assert.equal(valueNoise(x, 2024), valueNoise(x, 2024));
    assert.equal(fbm(x, 2024), fbm(x, 2024));
  }
});

test('the signed noise goes up and down', () => {
  let positive = 0;
  let negative = 0;
  for (let step = 0; step < 500; step += 1) {
    const value = noise1(step * 0.29, 5);
    assert.ok(value >= -1 && value < 1, `the noise gave ${value}`);
    if (value > 0) positive += 1;
    if (value < 0) negative += 1;
  }
  assert.ok(positive > 50, `the noise only went up (${positive} times)`);
  assert.ok(negative > 50, `the noise only went down (${negative} times)`);
});

test('the sum of the octaves stays inside its range', () => {
  for (let step = 0; step < 500; step += 1) {
    const value = fbm(step * 0.17, 31);
    assert.ok(value >= -1 && value <= 1, `the sum gave ${value}`);
  }
});

test('the sum of the octaves is not a wave', () => {
  // A sine wave of the same length comes back to the same value. The noise
  // must not: that is the whole point of using it.
  const first = fbm(0, 77);
  const after = fbm(0.5, 77);
  assert.notEqual(first, after);
  // And the same point a long way along the line is a different value.
  assert.notEqual(fbm(0, 77), fbm(1000, 77));
});

test('the smoothstep is flat at both ends', () => {
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.ok(Math.abs(smoothstep(0.5) - 0.5) < 1e-9);
  for (let step = 0; step <= 100; step += 1) {
    const t = step / 100;
    const value = smoothstep(t);
    assert.ok(value >= 0 && value <= 1, `the curve left the range at ${t}`);
  }
});

test('every channel has its own seed', () => {
  const seeds = [0, 1, 2, 3, 4].map((channel) => channelSeed(1234, channel));
  assert.equal(new Set(seeds).size, seeds.length, 'two channels share a seed');
  // And the same channel always gives the same seed.
  assert.equal(channelSeed(1234, 2), channelSeed(1234, 2));
});
