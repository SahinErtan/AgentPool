/**
 * The connection rules.
 *
 * The net layer has to survive a backend that restarts, a proxy that eats
 * the socket and a laptop that sleeps. The rules that decide what to do
 * next are pure, so they are tested here without any real waiting.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKOFF_BASE_MS,
  BACKOFF_JITTER_RATIO,
  BACKOFF_MAX_MS,
  Backoff,
  POLL_INTERVAL_MS,
  STALL_TIMEOUT_MS,
  StallDetector,
  backoffBaseMs,
  backoffDelay,
  nextPollDelay,
  shouldPoll,
} from '../src/net/backoff';

/** A clock the test moves by hand. */
function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

test('the backoff grows with every failure', () => {
  assert.equal(backoffBaseMs(0), 500);
  assert.equal(backoffBaseMs(1), 1_000);
  assert.equal(backoffBaseMs(2), 2_000);
  assert.equal(backoffBaseMs(3), 4_000);
  assert.equal(backoffBaseMs(4), 8_000);
});

test('the backoff is capped', () => {
  assert.equal(backoffBaseMs(5), BACKOFF_MAX_MS);
  assert.equal(backoffBaseMs(50), BACKOFF_MAX_MS);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    assert.ok(backoffBaseMs(attempt) <= BACKOFF_MAX_MS);
  }
});

test('the backoff starts at half a second', () => {
  assert.equal(BACKOFF_BASE_MS, 500);
  assert.equal(BACKOFF_MAX_MS, 15_000);
});

test('the jitter stays inside its window', () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const base = backoffBaseMs(attempt);
    for (let i = 0; i <= 20; i += 1) {
      const random = i / 20;
      const delay = backoffDelay(attempt, () => random);
      assert.ok(
        delay >= Math.floor(base * (1 - BACKOFF_JITTER_RATIO)),
        `delay ${delay} is below the window for attempt ${attempt}`,
      );
      assert.ok(delay <= BACKOFF_MAX_MS, `delay ${delay} is above the cap`);
    }
  }
});

test('the jitter spreads the tabs out', () => {
  const early = backoffDelay(3, () => 0);
  const late = backoffDelay(3, () => 1);
  assert.ok(early < late, 'the jitter does not change the delay');
});

test('the delay never waits longer than the cap', () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    assert.ok(backoffDelay(attempt, () => 1) <= BACKOFF_MAX_MS);
    assert.ok(backoffDelay(attempt, () => 0) <= BACKOFF_MAX_MS);
  }
});

test('a bad attempt number does not break the backoff', () => {
  assert.equal(backoffBaseMs(0), backoffBaseMs(-3));
  assert.equal(backoffBaseMs(0), backoffBaseMs(Number.NaN));
});

test('the backoff counter walks forward and can be reset', () => {
  const backoff = new Backoff(() => 0.5);
  const first = backoff.next();
  const second = backoff.next();
  assert.equal(backoff.attempts, 2);
  assert.ok(second > first, 'the second wait is not longer than the first');
  backoff.reset();
  assert.equal(backoff.attempts, 0);
  assert.equal(backoff.next(), first);
});

test('the stall detector is quiet before the timeout', () => {
  const clock = fakeClock();
  const stall = new StallDetector(STALL_TIMEOUT_MS, clock.now);
  clock.advance(STALL_TIMEOUT_MS - 1);
  assert.equal(stall.isStalled(), false);
  assert.equal(stall.silenceMs(), STALL_TIMEOUT_MS - 1);
});

test('the stall detector fires when the silence lasts too long', () => {
  const clock = fakeClock();
  const stall = new StallDetector(STALL_TIMEOUT_MS, clock.now);
  clock.advance(STALL_TIMEOUT_MS);
  assert.equal(stall.isStalled(), true);
  clock.advance(5_000);
  assert.equal(stall.isStalled(), true);
});

test('anything on the wire feeds the stall detector', () => {
  const clock = fakeClock();
  const stall = new StallDetector(STALL_TIMEOUT_MS, clock.now);
  clock.advance(STALL_TIMEOUT_MS - 100);
  stall.markActivity();
  clock.advance(STALL_TIMEOUT_MS - 100);
  assert.equal(stall.isStalled(), false, 'the detector forgot the activity');
  clock.advance(200);
  assert.equal(stall.isStalled(), true);
});

test('the panel only polls while the socket is not carrying the state', () => {
  assert.equal(shouldPoll('live'), false);
  assert.equal(shouldPoll('connecting'), true);
  assert.equal(shouldPoll('reconnecting'), true);
  assert.equal(shouldPoll('offline'), true);
});

test('the next poll waits for the rest of the interval', () => {
  assert.equal(nextPollDelay('reconnecting', 0), POLL_INTERVAL_MS);
  assert.equal(nextPollDelay('reconnecting', 1_000), POLL_INTERVAL_MS - 1_000);
  assert.equal(nextPollDelay('offline', POLL_INTERVAL_MS + 500), 0);
  assert.equal(nextPollDelay('live', 0), null);
});

test('the poll interval is slow enough not to shout at the backend', () => {
  assert.equal(POLL_INTERVAL_MS, 3_000);
});
