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
  /**
   * Whether the short tag above every character is drawn.
   *
   * On a phone the figure has to be read on its own: the tag is bigger
   * than the figure it names, and the list beside the pool is the text
   * version of the same thing.
   */
  labels: boolean;
}

export const LANE_COUNT = 4;
export const LOUNGER_COUNT = 6;
/** How many agents can wait at the pool edge when every lounger is taken. */
export const WAITING_COUNT = 4;

/**
 * Where the parasol stands, in world pixels.
 *
 * It used to stand in the middle of the deck, which is where a lounger is,
 * and it stood in front of the figure that was sitting there.
 */
export function parasolX(layout: PoolLayout): number {
  const last = layout.loungers[layout.loungers.length - 1];
  if (!last) return layout.width / 2;
  return Math.min(layout.width - 40, last.x + last.w + Math.round(layout.characterHeight * 0.3));
}

/**
 * How much of the deck one lounger needs, in characters.
 *
 * A figure that lies down is as long as it is tall, and the lounger has to
 * be longer than the figure, or the figure hangs off the end of it. It used
 * to be 1.3, and the lounger was drawn at 0.62 of a character: the figure
 * was twice as long as its bed, which is why the pool looked like a heap of
 * limbs on top of a row of orange slabs.
 */
export const LOUNGER_PER_CHARACTER = 1.2;

/**
 * Below this width the canvas is a phone.
 *
 * The picture on a phone is small, so the scene shows fewer characters and
 * shows them bigger, and the text is left to the list beside the pool.
 */
export const PHONE_WIDTH = 640;

/**
 * The smallest a figure may be drawn and still be read.
 *
 * Below this the pool stops being a picture of people and becomes a row
 * of dots, so the deck takes fewer loungers instead.
 */
export const MIN_READABLE_CHARACTER = 64;

/**
 * The height of the seat of a lounger, in world pixels.
 *
 * The figure leans back on the lounger, so it sits at the height of the
 * seat and not at the height of the deck.
 */
export function loungerSeatY(layout: PoolLayout): number {
  return layout.deckY - Math.round(layout.characterHeight * 0.22);
}

/**
 * The height of the top of the back rest of a lounger, in world pixels.
 */
export function loungerBackY(layout: PoolLayout): number {
  return layout.deckY - Math.round(layout.characterHeight * 0.72);
}

/**
 * How deep the pool is at its shallow end, as a part of its depth.
 *
 * The floor of the pool is a slope: the water is deeper at the ladder end
 * than at the gate end, so the pool is not a flat rectangle.
 */
export const SHALLOW_FRACTION = 0.82;

/**
 * How many loungers the deck has room for.
 *
 * The backend owns the number of loungers, but the picture has to fit on
 * the canvas: on a phone the deck is a short row, so the scene draws a few
 * of them and the characters become bigger.
 *
 * @param width The width of the canvas.
 * @param requested How many loungers the backend says the pool has.
 */
export function loungersFor(width: number, requested: number): number {
  const count = Math.max(1, Math.round(requested));
  if (width >= PHONE_WIDTH) return count;
  // A phone: two loungers on the narrowest screens, three on the rest.
  return Math.min(count, width < 420 ? 2 : 3);
}

/**
 * Whether the scene draws the tag above every character.
 *
 * @param width The width of the canvas.
 */
export function labelsVisible(width: number): boolean {
  return width >= PHONE_WIDTH;
}

/**
 * The depth of the water at a point along the pool.
 *
 * @param x The place along the pool, in world pixels.
 */
export function poolDepthAt(layout: PoolLayout, x: number): number {
  const water = layout.water;
  const t = Math.max(0, Math.min(1, (x - water.x) / Math.max(1, water.w)));
  return water.h * (SHALLOW_FRACTION + (1 - SHALLOW_FRACTION) * t);
}

/** The bottom of the pool at a point along it, in world pixels. */
export function poolFloorY(layout: PoolLayout, x: number): number {
  return layout.water.y + poolDepthAt(layout, x);
}

/**
 * The place where the floor of the pool reaches a given depth.
 *
 * The floor is a slope, so the deeper the water the further to the right
 * the pool begins.
 *
 * @param y The depth below the surface, in world pixels.
 */
export function poolLeftAtDepth(layout: PoolLayout, y: number): number {
  const water = layout.water;
  const t = ((y - water.y) / Math.max(1, water.h) - SHALLOW_FRACTION) / (1 - SHALLOW_FRACTION);
  if (t <= 0) return water.x;
  if (t >= 1) return water.x + water.w;
  return water.x + t * water.w;
}

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
  const waiting_ = Math.max(0, Math.round(waitingCount));
  const w = Math.max(320, width);
  const h = Math.max(240, height);

  // The character is as big as the height of the window allows, but it
  // also has to fit on the deck: there is one lounger per character and
  // the characters may not lie on top of each other.
  const deckSpace = (charHeight: number): number => {
    const gate = Math.round(charHeight * 0.9);
    const left = gate + Math.round(charHeight * 0.6);
    const right = w - Math.round(charHeight * 0.5);
    const ladder = Math.round(charHeight * 0.34);
    const start = left + Math.round(charHeight * 0.25);
    const end = right - ladder - Math.round(charHeight * 0.4);
    return Math.max(0, end - start);
  };
  const wanted = Math.round(Math.min(Math.max(h * 0.16, 64), 128));

  /**
   * The biggest character that fits on `count` loungers.
   *
   * The size is searched for, because a smaller character leaves more
   * room on the deck: the one-pass estimate would shrink it to the floor
   * instead.
   */
  const sizeFor = (count: number): number => {
    let best = 40;
    for (let candidate = 40; candidate <= wanted; candidate += 1) {
      const perLounger = deckSpace(candidate) / Math.max(1, count);
      // A character lies on its side, so it is as long as it is tall, and
      // the lounger it lies on has to be longer than that.
      const fits = Math.floor(perLounger / LOUNGER_PER_CHARACTER);
      if (fits >= candidate) best = candidate;
    }
    return best;
  };

  /**
   * How many loungers the deck has.
   *
   * The deck cannot hold all of them on a narrow canvas, and the figures
   * are what has to be read: a canvas that is too narrow for six loungers
   * gets fewer of them, so that the people on them stay big enough to
   * see. The agents that have no lounger wait at the edge of the pool,
   * which the scene already knows how to do.
   */
  let loungers_ = loungersFor(w, loungerCount);
  let characterHeight = sizeFor(loungers_);
  while (characterHeight < MIN_READABLE_CHARACTER && loungers_ > 2) {
    loungers_ -= 1;
    characterHeight = sizeFor(loungers_);
  }

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
  // The lounger is longer than the figure that lies on it, but never so
  // long that two of them overlap on a small canvas.
  const loungerSpace = Math.max(0, loungerEnd - loungerStart);
  const loungerWidth = Math.max(
    8,
    Math.min(
      Math.round(characterHeight * 1.15),
      Math.floor((loungerSpace / loungers_) * 0.85),
    ),
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
    labels: labelsVisible(w),
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
  // The centre line of the body is at the waterline, so that the water
  // cuts the figure in half: the back and the head are out of it and the
  // rest is in. The line used to be a little above the water, and the
  // whole figure lay on the coping like a body on a slab.
  return layout.surfaceY + laneOffset * layout.characterHeight * 0.16;
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
    // The feet go to the low end of the lounger, and the figure leans back
    // from there over the seat and the back rest. It used to lie along the
    // lounger, which is a body seen from above and not a person at rest.
    // The character walks to the lounger along the deck, and sits down
    // when it gets there.
    //
    // It sits just in front of the back rest: the head leans back against
    // the back rest from there, and the legs run along the seat.
    return {
      x: slot.x + Math.round(slot.w * 0.36),
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
