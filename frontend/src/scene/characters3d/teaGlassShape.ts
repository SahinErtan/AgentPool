/**
 * The shape and the colours of the Turkish tea glass (an ince belli), shared
 * by the glass on the side table (`pool3d/teaGlasses.ts`) and the glass in the
 * hand (`characters3d/rig3d.ts`), so the two cannot drift apart.
 *
 * Pure numbers, in metres, measured from the foot of the glass up. The glass
 * has no stem: it is a small clear glass with a narrow waist, wider at the
 * foot and at the rim than at the waist, about 9.5 cm tall. It stands on a
 * thin saucer, and its tea is dark amber-red, not wine.
 */

/** The glass, from the axis at its foot to the rim: [radius, height] pairs. */
export const TEA_GLASS_PROFILE: readonly (readonly [number, number])[] = [
  [0.0, 0.0],
  [0.025, 0.0],
  [0.02, 0.012],
  [0.0165, 0.034],
  [0.0172, 0.05],
  [0.024, 0.07],
  [0.031, 0.085],
  [0.034, 0.095],
];

/** The tea inside, from the bottom up to just under the surface (inside the glass). */
export const TEA_LIQUID_PROFILE: readonly (readonly [number, number])[] = [
  [0.0, 0.004],
  [0.02, 0.006],
  [0.013, 0.03],
  [0.015, 0.045],
  [0.021, 0.065],
  [0.0245, 0.075],
];

/** The tea's surface: its height above the foot, and its radius. */
export const TEA_SURFACE = { y: 0.075, radius: 0.0245 } as const;

/**
 * The saucer: a thin disc, 4 mm thick, whose top is 4 mm above the foot of
 * the glass. The glass stands in its well, so the glass's foot is inside it.
 */
export const SAUCER = { radiusTop: 0.068, radiusBottom: 0.058, thickness: 0.004 } as const;

export const GLASS_COLOUR = '#dfe9ec';
export const TEA_COLOUR = '#94300c';
export const SAUCER_COLOUR = '#f4efe6';
