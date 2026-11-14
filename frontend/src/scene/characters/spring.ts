/**
 * The spring.
 *
 * A sine wave says where a thing is. A spring says where a thing is *going*
 * and how it gets there — it lags, it overshoots, and it settles. That lag
 * is what makes a movement read as physical: a head that turns a moment
 * after the body, a towel that falls a moment after the arm, a body that
 * rises after a stroke and settles after it.
 *
 * The spring is integrated with the semi-implicit Euler method, in fixed
 * sub-steps, so it behaves the same on a 30 Hz screen and on a 144 Hz one.
 */

/** The state of a spring: where it is and how fast it is moving. */
export interface SpringState {
  value: number;
  velocity: number;
}

/**
 * The biggest step the integrator takes at once, in milliseconds.
 *
 * A spring that is stepped with a long step can overshoot and ring; a fixed
 * small step keeps it stable however long the frame was.
 */
const MAX_STEP_MS = 1000 / 120;

/**
 * The longest frame the spring will try to catch up with, in milliseconds.
 *
 * A tab that was in the background comes back with a huge step. Integrating
 * it would throw the spring across the screen, so the excess is dropped:
 * the spring carries on from where it was.
 */
const MAX_FRAME_MS = 250;

/** A spring that is sitting still at a value. */
export function spring(value = 0, velocity = 0): SpringState {
  return { value, velocity };
}

/**
 * The damping that makes a spring settle at a given rate.
 *
 * The critical damping of a spring of stiffness `k` is `2 * sqrt(k)`. A
 * ratio of one settles without overshooting; a ratio below one overshoots
 * and comes back; a ratio above one is slow and heavy.
 *
 * @param stiffness How stiff the spring is.
 * @param ratio How much it overshoots: 1 settles, 0.6 bounces.
 */
export function dampingFor(stiffness: number, ratio = 1): number {
  return 2 * Math.sqrt(Math.max(0, stiffness)) * ratio;
}

/**
 * Move a spring one frame towards a target.
 *
 * The state is written in place, so the frame does not allocate.
 *
 * @param out The spring to move.
 * @param target Where it is going.
 * @param stiffness How stiff it is: the bigger, the quicker.
 * @param damping How much it is slowed down. See `dampingFor`.
 * @param dtMs The time that passed, in milliseconds.
 */
export function springStep(
  out: SpringState,
  target: number,
  stiffness: number,
  damping: number,
  dtMs: number,
): SpringState {
  if (!Number.isFinite(target)) return out;
  let remaining = Math.min(Math.max(dtMs, 0), MAX_FRAME_MS);
  const k = Math.max(0, stiffness);
  const c = Math.max(0, damping);
  while (remaining > 0) {
    const step = Math.min(remaining, MAX_STEP_MS);
    remaining -= step;
    const dt = step / 1000;
    // The force: towards the target, against the movement.
    const acceleration = k * (target - out.value) - c * out.velocity;
    out.velocity += acceleration * dt;
    out.value += out.velocity * dt;
  }
  // A spring that has gone somewhere impossible is put back where it was.
  if (!Number.isFinite(out.value) || !Number.isFinite(out.velocity)) {
    out.value = target;
    out.velocity = 0;
  }
  return out;
}

/**
 * Put a spring where it belongs at once, without any of the travel.
 *
 * This is what happens when a character is teleported — a resize, or a
 * promotion from the queue to a lounger. The spring would otherwise sweep
 * the figure across the pool to get there.
 */
export function springSnap(out: SpringState, value: number, velocity = 0): SpringState {
  out.value = value;
  out.velocity = velocity;
  return out;
}
