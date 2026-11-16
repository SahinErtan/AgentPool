/**
 * The haircuts of the 3D figures.
 *
 * Every character had the same cap of hair, so a row of heads was a row of
 * the same head. The style is drawn from its own stream, so giving a
 * character a haircut does not move a single one of its other attributes.
 */

import { mulberry32 } from '../characters/spec';

export type HairStyle = 'crop' | 'bob' | 'bun' | 'ponytail' | 'buzz';

/** How likely each style is. */
const HAIR_TABLE: Record<HairStyle, number> = {
  crop: 30,
  bob: 22,
  bun: 14,
  ponytail: 20,
  buzz: 14,
};

/** The haircut of a character. */
export function hairStyleFor(seed: number): HairStyle {
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const entries = Object.entries(HAIR_TABLE) as [HairStyle, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [style, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return style;
  }
  return entries[entries.length - 1][0];
}
