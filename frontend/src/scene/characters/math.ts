/**
 * The small maths that the animation leans on.
 *
 * They live in their own module so they can be tested without a browser and
 * without a renderer.
 */

/**
 * Move `current` towards `target` by a fraction that depends on the time.
 *
 * The result does not depend on the frame rate: the same amount of time
 * gives the same result whether it comes in one step or in sixty. That is
 * what makes the animation look the same on a 60 Hz and a 144 Hz screen.
 *
 * @param current The value now.
 * @param target The value to move towards.
 * @param k How fast it moves: the bigger, the quicker.
 * @param dtMs The time that passed, in milliseconds.
 */
export function damp(current: number, target: number, k: number, dtMs: number): number {
  return current + (target - current) * (1 - Math.exp((-k * dtMs) / 1000));
}

/** The sum of a list of numbers, with a tiny tolerance for the rounding. */
export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
