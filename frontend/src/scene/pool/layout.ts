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
  /**
   * The world is wider than the screen.
   *
   * The terrace and the sky carry on past the edges of the canvas, so the
   * camera can move without ever showing the end of the world. The pool
   * itself does not grow: it ends at the gate and at the ladder.
   */
  margin: number;
  worldLeft: number;
  worldWidth: number;
  /** The top of the sky, above the screen. */
  worldTop: number;
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
  /** The spots at the pool edge for the agents that have no lounger. */
  waiting: Rect[];
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
export const LOUNGER_COUNT = 6;
/** How many agents can wait at the pool edge when every lounger is taken. */
export const WAITING_COUNT = 4;

/**
 * @param loungerCount How many loungers the deck has. The backend owns that
 *   number, so the frontend asks the scene description for it and only falls
 *   back to the default when the scene has not spoken yet.
 */
export function computeLayout(
  width: number,
  height: number,
  loungerCount = LOUNGER_COUNT,
  waitingCount = WAITING_COUNT,
): PoolLayout {
  const loungers_ = Math.max(1, Math.round(loungerCount));
  const waiting_ = Math.max(0, Math.round(waitingCount));
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
  // The lounger is as wide as a character needs it, but never so wide that
  // two of them overlap on a small canvas.
  const loungerSpace = Math.max(0, loungerEnd - loungerStart);
  const loungerWidth = Math.max(
    8,
    Math.min(Math.round(characterHeight * 0.62), Math.floor((loungerSpace / loungers_) * 0.75)),
  );
  const loungerGap = Math.max(
    6,
    (loungerEnd - loungerStart - loungerWidth) / Math.max(1, loungers_ - 1),
  );
  const loungers: Rect[] = [];
  for (let index = 0; index < loungers_; index += 1) {
    loungers.push({
      x: Math.round(loungerStart + index * loungerGap),
      y: deckY - Math.round(characterHeight * 0.26),
      w: loungerWidth,
      h: Math.round(characterHeight * 0.26),
    });
  }

  // The waiting spots are at the pool edge: when every lounger is taken the
  // agent stands there until one frees up.
  const waiting: Rect[] = [];
  const waitStart = water.x + Math.round(characterHeight * 0.3);
  const waitGap = Math.round(characterHeight * 0.62);
  for (let index = 0; index < waiting_; index += 1) {
    waiting.push({
      x: Math.round(waitStart + index * waitGap),
      y: surfaceY - Math.round(characterHeight * 0.04),
      w: Math.round(characterHeight * 0.34),
      h: Math.round(characterHeight * 0.04),
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
    margin: Math.round(w * 0.15),
    worldLeft: -Math.round(w * 0.15),
    worldWidth: w + Math.round(w * 0.3),
    worldTop: -Math.round(h * 0.15),
    deckY,
    deck: { x: 0, y: deckY - deckHeight, w, h: deckHeight + terrace },
    water,
    surfaceY,
    lanes,
    loungers,
    waiting,
    gate,
    ladder,
    characterHeight,
    scale: characterHeight,
  };
}

/**
 * The height a swimmer floats at.
 *
 * Every swimmer is at the surface: the waterline cuts it lengthwise, so
 * the head and the back stay above the water. The lane moves it up or
 * down a little.
 *
 * The height comes from the layout and not from the character, so a pool
 * that is resized takes its swimmers with it: a swimmer that kept the
 * height of the old pool would float in the sky.
 */
export function swimYFor(layout: PoolLayout, laneOffset: number): number {
  return (
    layout.surfaceY -
    layout.characterHeight * 0.06 +
    laneOffset * layout.characterHeight * 0.16
  );
}

/**
 * Where the camera looks, in world coordinates.
 *
 * The camera may not leave the world: the terrace and the sky carry on
 * past the edges of the canvas, so the camera can move without ever
 * showing the end of the world.
 */
export function cameraLeftFor(
  layout: PoolLayout,
  focus: number,
  zoom: number,
): number {
  const visible = layout.width / Math.max(0.01, zoom);
  const wanted = focus - visible / 2;
  const lowest = layout.worldLeft;
  const highest = layout.worldLeft + layout.worldWidth - visible;
  return Math.max(lowest, Math.min(highest, wanted));
}

/** The pixel position of a semantic waypoint. */
export function resolveWaypoint(
  layout: PoolLayout,
  waypoint: string,
): { x: number; y: number } | null {
  if (waypoint === 'gate' || waypoint.startsWith('gate:')) {
    // The queue at the gate spreads out, so the agents do not stand on top
    // of each other.
    const queue = waypoint.startsWith('gate:') ? Number(waypoint.slice(5)) : 0;
    return {
      x: layout.gate.x + layout.gate.w / 2 + queue * layout.characterHeight * 0.24,
      y: layout.deckY,
    };
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
  if (waypoint.startsWith('waiting:')) {
    const index = Number(waypoint.slice('waiting:'.length));
    const slot = layout.waiting[index];
    if (!slot) return null;
    return { x: slot.x + slot.w / 2, y: slot.y };
  }
  if (waypoint.startsWith('lane:')) {
    const index = Number(waypoint.slice('lane:'.length));
    const lane = layout.lanes[index];
    if (!lane) return null;
    return { x: lane.x + lane.w / 2, y: lane.y + lane.h / 2 };
  }
  return null;
}
