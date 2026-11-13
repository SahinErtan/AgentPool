/**
 * The pure rules of a connection that is allowed to die.
 *
 * The dashboard may sit open for hours, so the socket is expected to break:
 * the backend restarts, a proxy eats the connection, the laptop sleeps.
 * Everything in this file is a rule about what to do next, written so it can
 * be driven by a fake clock and a fake random number - the tests never wait
 * for real time to pass.
 */

import type { ConnectionState } from './types';

/** The first retry waits half a second: most drops are over in a blink. */
export const BACKOFF_BASE_MS = 500;

/** The last retry waits fifteen seconds: a dead backend must not be hammered. */
export const BACKOFF_MAX_MS = 15_000;

/**
 * The jitter, as a fraction of the base delay.
 *
 * Several tabs of the same dashboard reconnect at the same moment after a
 * restart; the jitter spreads them out. It is a fraction of the base delay,
 * so the cap stays the cap.
 */
export const BACKOFF_JITTER_RATIO = 0.25;

/** A socket that says nothing for this long is treated as dead. */
export const STALL_TIMEOUT_MS = 20_000;

/** The slow poll that keeps the panel alive while the socket is down. */
export const POLL_INTERVAL_MS = 3_000;

/**
 * The un-jittered delay before the n-th retry.
 *
 * 500 ms, 1 s, 2 s, 4 s, 8 s, then the cap. The attempt number is the
 * number of failures so far, so the first failure waits the shortest.
 */
export function backoffBaseMs(attempt: number): number {
  const safe = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** safe);
}

/**
 * The delay before the next attempt, with the jitter folded in.
 *
 * The random number is a parameter so a test can pin it down.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = backoffBaseMs(attempt);
  const spread = BACKOFF_JITTER_RATIO * (random() * 2 - 1);
  return Math.min(BACKOFF_MAX_MS, Math.max(0, Math.round(base * (1 + spread))));
}

/**
 * The counter behind the reconnect loop.
 *
 * It forgets the failures as soon as a socket goes live, so one long outage
 * does not make the next one wait fifteen seconds for its first retry.
 */
export class Backoff {
  private attempt = 0;

  constructor(private readonly random: () => number = Math.random) {}

  /** The delay before the next attempt; the counter moves on. */
  next(): number {
    const delay = backoffDelay(this.attempt, this.random);
    this.attempt += 1;
    return delay;
  }

  /** A live socket means the next failure starts from the beginning again. */
  reset(): void {
    this.attempt = 0;
  }

  /** How many attempts have been made since the last reset. */
  get attempts(): number {
    return this.attempt;
  }
}

/**
 * Watches the silence of a socket.
 *
 * A TCP connection can stay open long after the peer has gone: the socket
 * says nothing, but it never says it is broken either. The dashboard has to
 * notice that by itself, which is what this does - it only needs a clock.
 */
export class StallDetector {
  private lastActivityAt: number;

  constructor(
    private readonly timeoutMs: number = STALL_TIMEOUT_MS,
    private readonly now: () => number = Date.now,
  ) {
    this.lastActivityAt = this.now();
  }

  /** Anything on the wire counts as life: a frame, a pong, a ping answer. */
  markActivity(): void {
    this.lastActivityAt = this.now();
  }

  /** How long the socket has been silent. */
  silenceMs(): number {
    return Math.max(0, this.now() - this.lastActivityAt);
  }

  /** True once the silence has lasted longer than the timeout. */
  isStalled(): boolean {
    return this.silenceMs() >= this.timeoutMs;
  }
}

/**
 * The polling rule.
 *
 * The slow poll of `/api/state` is only needed while the socket cannot carry
 * the state itself; a live socket makes polling waste.
 */
export function shouldPoll(connection: ConnectionState): boolean {
  return connection !== 'live';
}

/**
 * How long until the next poll, or null when there is nothing to poll.
 *
 * The elapsed time is a parameter, so the rule can be tested without a
 * timer.
 */
export function nextPollDelay(
  connection: ConnectionState,
  elapsedMs: number,
  intervalMs: number = POLL_INTERVAL_MS,
): number | null {
  if (!shouldPoll(connection)) return null;
  return Math.max(0, intervalMs - Math.max(0, elapsedMs));
}
