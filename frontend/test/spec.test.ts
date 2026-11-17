/**
 * The character spec.
 *
 * A character is a pure function of its id: the same id always gives the
 * same figure, and every channel of its random numbers is its own stream.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rngFor, specFor } from '../src/scene/characters/spec';
import { AGENTPOOL_IDS } from './ids';

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
