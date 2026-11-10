/**
 * The light of the day.
 *
 * The pool has a morning and an evening. The palette is a pure function
 * of the hour, so it can be checked without a browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hourOfDay, mixColour, paletteFor } from '../src/scene/pool/daylight';

test('the middle of the day is bright and has no lamps', () => {
  const noon = paletteFor(13);
  assert.equal(noon.light, 1);
  assert.equal(noon.lamps, false);
  assert.equal(noon.stars, false);
});

test('the middle of the night is dark and has lamps', () => {
  const night = paletteFor(2);
  assert.ok(night.light < 0.3);
  assert.equal(night.lamps, true);
  assert.equal(night.stars, true);
});

test('the evening has lamps', () => {
  assert.equal(paletteFor(20).lamps, true);
  assert.equal(paletteFor(9).lamps, false);
});

test('the hour is wrapped into the day', () => {
  assert.deepEqual(paletteFor(25), paletteFor(1));
  assert.deepEqual(paletteFor(-1), paletteFor(23));
});

test('the colours do not jump', () => {
  // Ten seconds apart, the palette may only move a little.
  const before = paletteFor(9);
  const after = paletteFor(9 + 10 / 3600);
  const difference = Math.abs(before.deck - after.deck);
  assert.ok(difference < 4, `the deck jumped by ${difference}`);
});

test('the sky is darker at night than at noon', () => {
  const night = paletteFor(1);
  const noon = paletteFor(13);
  const brightness = (colour: number) =>
    ((colour >> 16) & 0xff) * 0.3 + ((colour >> 8) & 0xff) * 0.6 + (colour & 0xff) * 0.1;
  assert.ok(brightness(night.skyTop) < brightness(noon.skyTop));
});

test('the colours are mixed between the two ends', () => {
  assert.equal(mixColour(0x000000, 0xffffff, 0), 0x000000);
  assert.equal(mixColour(0x000000, 0xffffff, 1), 0xffffff);
  // Halfway is the middle grey; the halves round up.
  assert.equal(mixColour(0x000000, 0xffffff, 0.5), 0x808080);
});

test('the hour of the day counts the minutes', () => {
  assert.equal(hourOfDay(new Date(2026, 10, 10, 6, 30, 0)), 6.5);
  assert.equal(hourOfDay(new Date(2026, 10, 10, 0, 0, 0)), 0);
});
