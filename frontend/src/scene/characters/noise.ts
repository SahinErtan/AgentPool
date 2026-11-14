/**
 * One-dimensional noise.
 *
 * The characters used to breathe on a sine wave: `Math.sin(t * TAU * 0.28)`.
 * Every one of them in the pool took its breath at the same moment and at
 * the same rate, so a row of loungers looked like a machine rather than
 * like people.
 *
 * Noise does the same job — a slow, wandering movement — without the
 * movement ever coming back to the same value. A sine wave repeats; noise
 * only repeats if you ask it to.
 *
 * The noise is seeded, so a character that is given the same id moves the
 * same way in every tab and after every reload. That is the same promise
 * `spec.ts` makes about the rest of the character.
 *
 * The reference is the usual one: value noise, interpolated with a
 * smoothstep, summed over a few octaves. See Red Blob Games' "Noise
 * Functions and Map Generation" and The Book of Shaders.
 */

/**
 * A number in [0, 1) from an integer and a seed.
 *
 * The hash is the murmur3 finalizer: it mixes every bit of the input, so
 * neighbouring indices give unrelated numbers.
 */
export function hash1(index: number, seed: number): number {
  let h = Math.imul(index | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The smoothstep curve: flat at both ends, steep in the middle. */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Value noise at a point, in [0, 1).
 *
 * The two nearest whole numbers are hashed and interpolated between them.
 * The result is continuous everywhere, so a value that moves along the line
 * never jumps.
 */
export function valueNoise(x: number, seed: number): number {
  const index = Math.floor(x);
  const fraction = x - index;
  const a = hash1(index, seed);
  const b = hash1(index + 1, seed);
  return a + (b - a) * smoothstep(fraction);
}

/**
 * Value noise at a point, in [-1, 1).
 *
 * This is the shape most of the movement wants: it goes up and it goes
 * down, and it does not sit at zero.
 */
export function noise1(x: number, seed: number): number {
  return valueNoise(x, seed) * 2 - 1;
}

/**
 * Fractional Brownian motion: a few octaves of noise on top of each other,
 * each one twice as fast and half as strong as the one below.
 *
 * The result is in [-1, 1]. The low octaves give the movement its shape and
 * the high ones give it the grain, so the sum never looks like a single
 * smooth wave.
 *
 * @param x Where along the line to look.
 * @param seed The seed: the same seed gives the same noise for ever.
 * @param octaves How many octaves to sum. Three is enough for a body.
 */
export function fbm(x: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    // Each octave has its own seed, so the octaves do not line up with
    // each other and the sum does not have a visible period.
    const octaveSeed = (seed + octave * 1013) | 0;
    sum += noise1(x * frequency, octaveSeed) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total > 0 ? sum / total : 0;
}

/**
 * A seed for a named channel of a character's movement.
 *
 * The seed is derived from the character's own seed, so it is as
 * deterministic as the rest of the character, and it is different for every
 * channel so that two channels do not move together by accident.
 */
export function channelSeed(seed: number, channel: number): number {
  let h = Math.imul(channel | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return h | 0;
}
