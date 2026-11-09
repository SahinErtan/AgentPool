/**
 * The world layout of the pool.
 *
 * A pure function of the canvas size: everything the scene draws is derived
 * from here, so a resize only has to recompute this and re-target the
 * characters.
 *
 * The composition is a side view: the sky at the top, the deck as a walkway
 * the characters cross, and the pool below it. The water surface sits just
 * under the deck line, so a character steps off the edge into the water.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PoolLayout {
  width: number;
  height: number;
  /** The line the characters stand on. */
  deckY: number;
  /** The band the characters walk through. */
  deck: Rect;
  /** The water, from the surface down to the floor. */
  water: Rect;
  /** The water surface line. */
  surfaceY: number;
  /** The horizontal swim lanes, top to bottom. */
  lanes: Rect[];
  /** The lounger slots along the deck. */
  loungers: Rect[];
  /** The entrance and exit, at the left end of the deck. */
  gate: Rect;
  /** The ladder at the right end of the pool. */
  ladder: Rect;
  /** The character height in pixels. */
  characterHeight: number;
  /** The scale factor applied to the unit-space rig. */
  scale: number;
}

export const LANE_COUNT = 4;
export const LOUNGER_COUNT = 8;

export function computeLayout(width: number, height: number): PoolLayout {
  const w = Math.max(320, width);
  const h = Math.max(240, height);

  const characterHeight = Math.round(Math.min(Math.max(h * 0.16, 64), 128));
  const deckY = Math.round(h * 0.4);
  // The deck is a terrace: the characters stand on the upper edge, and the
  // strip between them and the water is the poolside floor. It keeps the
  // loungers and the swimmers clearly apart.
  const deckHeight = Math.round(characterHeight * 0.9);
  const terrace = Math.round(characterHeight * 0.85);
  const surfaceY = deckY + terrace;
  const poolBottom = h - Math.round(h * 0.04);

  const gateWidth = Math.round(characterHeight * 0.9);
  const waterLeft = gateWidth + Math.round(characterHeight * 0.6);
  const waterRight = w - Math.round(characterHeight * 0.5);
  const ladderWidth = Math.round(characterHeight * 0.34);

  const water: Rect = {
    x: waterLeft,
    y: surfaceY,
    w: waterRight - waterLeft,
    h: poolBottom - surfaceY,
  };

  // The lanes divide the pool *horizontally*. In a side view every swimmer
  // is at the surface, so a lane is a stretch of water rather than a depth:
  // the lane decides where along the pool an agent swims, and the surface
  // line decides how much of it is in the water.
  const lanes: Rect[] = [];
  const laneWidth = water.w / LANE_COUNT;
  for (let index = 0; index < LANE_COUNT; index += 1) {
    lanes.push({
      x: Math.round(water.x + index * laneWidth),
      y: surfaceY,
      w: Math.round(laneWidth),
      h: water.h,
    });
  }

  // The loungers run along the deck, from just after the gate to the ladder.
  const loungerStart = waterLeft + Math.round(characterHeight * 0.25);
  const loungerEnd = waterRight - ladderWidth - Math.round(characterHeight * 0.4);
  const loungerWidth = Math.round(characterHeight * 0.62);
  const loungerGap = Math.max(
    6,
    (loungerEnd - loungerStart - loungerWidth) / Math.max(1, LOUNGER_COUNT - 1),
  );
  const loungers: Rect[] = [];
  for (let index = 0; index < LOUNGER_COUNT; index += 1) {
    loungers.push({
      x: Math.round(loungerStart + index * loungerGap),
      y: deckY - Math.round(characterHeight * 0.26),
      w: loungerWidth,
      h: Math.round(characterHeight * 0.26),
    });
  }

  const gate: Rect = {
    x: Math.round(characterHeight * 0.15),
    y: deckY - Math.round(characterHeight * 1.05),
    w: gateWidth,
    h: Math.round(characterHeight * 1.05),
  };

  const ladder: Rect = {
    x: waterRight - ladderWidth,
    y: deckY,
    w: ladderWidth,
    h: poolBottom - deckY,
  };

  return {
    width: w,
    height: h,
    deckY,
    deck: { x: 0, y: deckY - deckHeight, w, h: deckHeight + terrace },
    water,
    surfaceY,
    lanes,
    loungers,
    gate,
    ladder,
    characterHeight,
    scale: characterHeight,
  };
}

/** The pixel position of a semantic waypoint. */
export function resolveWaypoint(
  layout: PoolLayout,
  waypoint: string,
): { x: number; y: number } | null {
  if (waypoint === 'gate') {
    return { x: layout.gate.x + layout.gate.w / 2, y: layout.deckY };
  }
  if (waypoint === 'ladder') {
    return { x: layout.ladder.x + layout.ladder.w / 2, y: layout.deckY };
  }
  if (waypoint.startsWith('lounger:')) {
    const index = Number(waypoint.slice('lounger:'.length));
    const slot = layout.loungers[index];
    if (!slot) return null;
    // A lounging character lies with its feet towards the lounger's middle,
    // so the body spans the slot instead of starting at it.
    return {
      x: slot.x + slot.w / 2 - layout.characterHeight * 0.42,
      y: layout.deckY,
    };
  }
  if (waypoint.startsWith('lane:')) {
    const index = Number(waypoint.slice('lane:'.length));
    const lane = layout.lanes[index];
    if (!lane) return null;
    return { x: lane.x + lane.w / 2, y: lane.y + lane.h / 2 };
  }
  return null;
}
