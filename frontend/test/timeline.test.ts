/**
 * The timeline under each agent row.
 *
 * The bar shows the last fifteen minutes, so the arithmetic is the whole
 * of the feature.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TIMELINE_WINDOW_S, workingSpan } from '../src/ui/timeline';

const NOW = 1_700_000_000_000;
const NOW_S = NOW / 1000;

test('an agent that never worked has no bar', () => {
  assert.equal(workingSpan(null, null, NOW), null);
});

test('an agent that just started fills the right of the window', () => {
  const span = workingSpan(NOW_S - 60, null, NOW);
  assert.ok(span);
  // Sixty seconds out of fifteen minutes is about seven percent.
  assert.ok(Math.abs(span.left - ((TIMELINE_WINDOW_S - 60) / TIMELINE_WINDOW_S) * 100) < 0.001);
  assert.ok(Math.abs(span.width - (60 / TIMELINE_WINDOW_S) * 100) < 0.001);
});

test('a finished agent shows only the period it worked', () => {
  const span = workingSpan(NOW_S - 300, NOW_S - 120, NOW);
  assert.ok(span);
  assert.ok(Math.abs(span.width - (180 / TIMELINE_WINDOW_S) * 100) < 0.001);
});

test('an agent that started before the window is cut off at the left', () => {
  // It has been working for half an hour: the bar starts at the left edge.
  const span = workingSpan(NOW_S - TIMELINE_WINDOW_S * 2, null, NOW);
  assert.ok(span);
  assert.equal(span.left, 0);
  assert.ok(Math.abs(span.width - 100) < 0.001);
});

test('an agent that finished before the window has no bar', () => {
  const span = workingSpan(NOW_S - TIMELINE_WINDOW_S * 3, NOW_S - TIMELINE_WINDOW_S * 2, NOW);
  assert.equal(span, null);
});

test('an agent that has not started yet has no bar', () => {
  assert.equal(workingSpan(NOW_S + 500, NOW_S + 900, NOW), null);
});

test('an agent that has not started yet has no bar', () => {
  assert.equal(workingSpan(NOW_S + 10, null, NOW), null);
});
