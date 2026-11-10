/**
 * Clicking a character.
 *
 * The characters are drawn on a canvas, so a click has to be matched
 * against their geometry. The geometry is a pure function, so it can be
 * checked without a browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { characterBox, hitTest } from '../src/scene/pool/hittest';

const HEIGHT = 100;

test('a standing character is caught around its body', () => {
  const box = characterBox('a', 200, 500, HEIGHT, 'stand');
  assert.equal(hitTest([box], 200, 480), 'a');
  assert.equal(hitTest([box], 200, 500), 'a');
  assert.equal(hitTest([box], 205, 470), 'a');
});

test('the empty water is not a character', () => {
  const box = characterBox('a', 200, 500, HEIGHT, 'stand');
  assert.equal(hitTest([box], 800, 500), null);
  assert.equal(hitTest([box], 200, 200), null);
});

test('a swimmer is caught at the waterline, where the head is', () => {
  const box = characterBox('a', 200, 500, HEIGHT, 'swim');
  assert.equal(hitTest([box], 200, 460), 'a');
  // Far below the surface there is only water.
  assert.equal(hitTest([box], 200, 560), null);
});

test('a character that lies down is caught along its body', () => {
  const box = characterBox('a', 200, 500, HEIGHT, 'lie');
  assert.equal(hitTest([box], 260, 495), 'a');
  // The empty air above the lounger belongs to nobody.
  assert.equal(hitTest([box], 200, 380), null);
});

test('the character that is closest to the pointer wins', () => {
  const near = characterBox('near', 200, 500, HEIGHT, 'stand');
  const far = characterBox('far', 215, 500, HEIGHT, 'stand');
  assert.equal(hitTest([near, far], 205, 480), 'near');
  assert.equal(hitTest([near, far], 214, 480), 'far');
});

test('a character that is not under the pointer is not picked', () => {
  const first = characterBox('a', 100, 500, HEIGHT, 'stand');
  const second = characterBox('b', 400, 500, HEIGHT, 'stand');
  assert.equal(hitTest([first, second], 100, 480), 'a');
  assert.equal(hitTest([first, second], 400, 480), 'b');
});

test('no characters means nothing is picked', () => {
  assert.equal(hitTest([], 100, 100), null);
});
