/**
 * The weather over the pool.
 *
 * The weather changes on its own: the sky clouds over, sometimes it
 * rains, and then it clears again. The spell is a pure function of the
 * clock, so every browser watching the same pool sees the same weather,
 * and it can be checked without a browser.
 */

/** What the weather is doing. */
export type Weather = 'clear' | 'cloudy' | 'rain';

/** How long one spell of weather lasts, in seconds. */
export const SPELL_S = 900;

/** A hash that turns a number into a number between 0 and 1. */
function hash(value: number): number {
  let x = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * The weather at a given moment.
 *
 * The time is in seconds; any clock works, as long as everyone watching
 * uses the same one.
 */
export function weatherFor(timeSeconds: number): Weather {
  const spell = Math.floor(timeSeconds / SPELL_S);
  const roll = hash(spell);
  if (roll < 0.6) return 'clear';
  if (roll < 0.82) return 'cloudy';
  return 'rain';
}

/**
 * How much rain is falling right now.
 *
 * The rain does not start and stop in one frame: it comes in over a
 * minute and goes out over a minute, so the pool does not blink.
 */
export function rainAmount(timeSeconds: number): number {
  const spell = Math.floor(timeSeconds / SPELL_S);
  if (weatherFor(timeSeconds) !== 'rain') return 0;

  const into = timeSeconds - spell * SPELL_S;
  const fade = Math.min(1, into / 60);
  const out = Math.min(1, (SPELL_S - into) / 60);
  return Math.max(0, Math.min(fade, out));
}
