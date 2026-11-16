/**
 * The pool in three dimensions, in metres.
 *
 * A pure function of what the backend described (how many lanes, loungers
 * and waiting spots), and of nothing else. The 2D layout had to be searched
 * for every canvas size, because the picture *was* the layout; in 3D the
 * world keeps its size and only the camera frames it differently.
 *
 * Axes: y is up, the deck is at y = 0. The pool runs along x; its long side
 * nearest the default camera is at +z. The shallow end is at -x, the deep
 * end at +x, the same way round as the 2D pool.
 */

export interface Vec2 {
  x: number;
  z: number;
}

/** An axis-aligned rectangle on the ground. */
export interface Area {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A point in the world, in metres. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A place a person stands on, and the way it faces: 0 is +z, π/2 is +x. */
export interface Spot {
  x: number;
  z: number;
  yaw: number;
}

export interface Lane {
  index: number;
  /** The middle of the lane, across the pool. */
  z: number;
  /** The width of the lane. */
  width: number;
}

export interface Lounger {
  index: number;
  /** The middle of the lounger. */
  x: number;
  z: number;
  /**
   * The way the figure on it looks, as a unit vector on the ground.
   *
   * The loungers face the pool, so the figures on them watch the swimmers.
   */
  facing: Vec2;
  /** The length of the lounger, along its facing. */
  length: number;
  width: number;
  /** The height of the seat above the deck. */
  seatHeight: number;
}

export interface Ladder {
  index: number;
  x: number;
  /** The z of the wall it hangs on. */
  z: number;
  down: Vec2;
}

/**
 * A place at the edge of the pool where an agent waits with nothing to lie
 * on. The spots on the coping are `edge`: the agent sits there with its feet
 * in the water.
 */
export interface WaitingSpot extends Vec2 {
  edge: boolean;
}

export interface World {
  lanes: Lane[];
  loungers: Lounger[];
  waiting: WaitingSpot[];
  /** The water, inside the walls of the pool. */
  pool: Area;
  /** The paved area round the pool, inside the fence. */
  deck: Area;
  /** The height of the water surface (the deck is 0). */
  waterY: number;
  /** The depth of the floor at the shallow and at the deep end. */
  shallowDepth: number;
  deepDepth: number;
  /**
   * The ladders: where each one hangs on the wall, and which way it goes
   * down into the water.
   *
   * One ladder for a pool full of agents was a queue that never moved; a
   * real pool has one at each corner.
   */
  ladders: Ladder[];
  /** The gate in the fence, where the agents come in and leave. */
  gate: Vec2;
  /** The way the queue at the gate grows. */
  queueDir: Vec2;
  /** The parasols, between the loungers. */
  parasols: Vec2[];
  /** The new equipment on the terrace and at the shallow end. */
  equipment: Equipment;
  /**
   * Where nobody walks: the pool first, then the equipment. An obstacle is
   * a footprint on the ground.
   */
  obstacles: { name: string; area: Area }[];
  /**
   * The hut outside the fence, by the gate: its footprint, and the porch in
   * front of its door, where the cat shelters from the rain.
   */
  hut: { area: Area; porch: Vec2 };
  /** The trunks of the garden trees that stand outside the far fence. */
  trees: Vec2[];
  /** The sprinkler on the lawn, outside the fence near the hut. */
  sprinkler: Vec2;
  /** Three low beds of flowers in the garden, in front of the hedge. */
  flowerBeds: Area[];
  /** Six lantern posts, 0.3 m inside the fence: two near, two far, two on the terrace. */
  lanterns: Vec2[];
}

/** The places in the pool that the agents use, and where they stand. */
export interface Equipment {
  slide: {
    /** The middle of the platform at the top of the tower. */
    tower: Vec2;
    /** Where the rider sits down, on the platform. */
    top: Vec3;
    /** Where a climber starts, at the foot of the stairs, facing up them. */
    stairsFoot: Spot;
    /** Where the stairs meet the platform. */
    stairsTop: Vec3;
    /** The chute's control points, from the platform to the water. */
    path: Vec3[];
    /** Where the rider lands in the water. */
    splash: Vec2;
    lane: number;
  };
  board: {
    /** Where a diver stands to climb onto the board: behind the base. */
    base: Spot;
    /** The middle of the block the board stands on. */
    block: Vec2;
    /** The end of the board, over the water. */
    tip: Vec3;
    /** Where the diver lands. */
    splash: Vec2;
    lane: number;
    /** The height of the board above the deck. */
    height: number;
  };
  hotTub: {
    centre: Vec2;
    radius: number;
    /** The height of the rim above the deck. */
    rim: number;
    seats: Spot[];
    /** The step into the tub, outside the rim on the pool side. */
    step: Spot;
  };
  kiosk: {
    centre: Vec2;
    /** Where a customer stands, facing the counter. */
    use: Spot;
  };
  pingPong: {
    centre: Vec2;
    /** The two players, one at each end of the table, facing it. */
    ends: [Spot, Spot];
  };
  shower: {
    post: Vec2;
    /** Where a showering person stands, under the head. */
    stand: Spot;
    head: Vec3;
  };
  /** The two nozzles of the fountains on the coping at the shallow end. */
  fountains: Vec3[];
  /**
   * The ball court on the terrace: a beach ball is thrown round by three
   * players who stand on the spots, facing the middle.
   */
  ballCourt: {
    centre: Vec2;
    spots: Spot[];
  };
}

export const POOL_LENGTH = 16;
export const LANE_WIDTH = 1.8;
export const DEFAULT_LANES = 4;
export const DEFAULT_LOUNGERS = 6;
export const DEFAULT_WAITING = 4;
/** The height of a character with `spec.height == 1`, in metres. */
export const CHARACTER_HEIGHT = 1.7;
/** Loungers per row; a bigger pool gets a second row behind the first. */
export const LOUNGERS_PER_ROW = 8;

/** The deck reaches this far past the far end of the pool: the terrace. */
const TERRACE = 9.5;
/** The half sizes of the kiosk and the ping-pong table, on the ground. */
const KIOSK_HALF = { x: 0.9, z: 0.5 };
const TABLE_HALF = { x: 0.7625, z: 1.37 };
/** How far the table is grown for the players' room, on each side. */
const TABLE_MARGIN = 0.15;

/**
 * How far the back rest of a lounger leans back from upright, in radians.
 *
 * The figure on the lounger leans back at the same angle, so its back
 * meets the rest instead of standing away from it.
 */
export const BACKREST_LEAN = 0.62;
/** The length of the back rest of a lounger. */
const BACKREST_LENGTH = 0.82;
/** How far from the back of the lounger the seat begins. */
const SEAT_START = 0.52;

/**
 * The back rest of a lounger: where it is and which way it faces.
 *
 * The drawing and the test both use these numbers, so the figure cannot
 * drift away from the rest without the test noticing.
 */
export function backRest(l: Lounger): {
  y: number;
  z: number;
  normalY: number;
  normalZ: number;
} {
  const dir = l.facing.z;
  const seatStart = l.z - dir * (l.length / 2) + dir * SEAT_START;
  const half = BACKREST_LENGTH / 2;
  const lean = BACKREST_LEAN;
  // The middle of the back rest.
  const y = l.seatHeight + half * Math.cos(lean) - 0.02;
  const z = seatStart - dir * (half * Math.sin(lean) + 0.02);
  // The normal of the back rest, towards the figure that leans on it.
  return { y, z, normalY: Math.sin(lean), normalZ: dir * Math.cos(lean) };
}

/**
 * How far back on the seat the hips of a lounging figure sit.
 *
 * It is a fraction of the length of the lounger, measured from its middle.
 * The figure leans back against the back rest, so this is what decides how
 * far its back is from the rest.
 */
export const HIP_BACK = 0.2;

/** The side table of a lounger (Sprint 29.5). Its numbers are the tea station's reach. */
/** Where the glass is, from the middle of the hips, to the figure's right, in metres. */
export const TABLE_REACH = 0.444;
/** How far the glass stands in front of the hips, in metres. */
export const TABLE_FORWARD = 0.058;
/** The height of the table top above the deck, in metres: just above the cushion. */
export const TABLE_TOP = 0.41;
/** The radius of the top, in metres. */
export const TABLE_RADIUS = 0.13;
/**
 * The radius of the foot, in metres. The foot is the table's footprint on the
 * deck, and it stays clear of the lounger's own box (its half-width is 0.36).
 */
export const TABLE_FOOT_RADIUS = 0.08;
/** How far the glass's origin is above its base, in metres (the glass is centred on its bowl). */
export const GLASS_ORIGIN_Y = 0.077;

/** A side table: where it stands, and how big. */
export interface SideTable {
  /** The lounger it belongs to. */
  index: number;
  x: number;
  z: number;
  /** The height of the top above the deck. */
  top: number;
  radius: number;
  footRadius: number;
}

/**
 * The side table of a lounger: on the figure's right, where the tea is reached.
 *
 * The figure's right is the lounger's facing turned a quarter, so the table
 * moves with the lounger whatever way it faces.
 */
export function sideTableOf(lounger: Lounger): SideTable {
  const f = lounger.facing;
  const hipX = lounger.x - f.x * lounger.length * HIP_BACK;
  const hipZ = lounger.z - f.z * lounger.length * HIP_BACK;
  // Right of a figure facing (fx, fz) is (-fz, fx); its front is (fx, fz).
  return {
    index: lounger.index,
    x: hipX - f.z * TABLE_REACH + f.x * TABLE_FORWARD,
    z: hipZ + f.x * TABLE_REACH + f.z * TABLE_FORWARD,
    top: TABLE_TOP,
    radius: TABLE_RADIUS,
    footRadius: TABLE_FOOT_RADIUS,
  };
}

/**
 * How far the glass of tea stands from the middle of its table, towards the
 * lounger (Sprint 29.5). The glass's saucer (radius 6.8 cm) stays on the top
 * (radius 13 cm): 6 + 6.8 < 13.
 */
export const GLASS_REACH = 0.06;

/**
 * Where the glass of tea stands on its table: the table's middle, moved
 * towards the lounger (to the figure's left), so that the figure reaches it.
 * The glass is taken and put back here; the table itself is `sideTableOf`.
 */
export function teaSpotOf(lounger: Lounger): SideTable {
  const t = sideTableOf(lounger);
  const f = lounger.facing;
  // The figure's left is (fz, -fx): towards the hips.
  return { ...t, x: t.x + f.z * GLASS_REACH, z: t.z - f.x * GLASS_REACH };
}

/**
 * The foot of the side table as an obstacle on the deck: a walker keeps off it
 * like off any other obstacle. The top is above a standing walker's hips, so
 * only the foot is in the way.
 */
function tableObstacle(l: Lounger): { name: string; area: Area } {
  const t = sideTableOf(l);
  const r = t.footRadius;
  return {
    name: `table ${l.index}`,
    area: { minX: t.x - r, maxX: t.x + r, minZ: t.z - r, maxZ: t.z + r },
  };
}

const LOUNGER_LENGTH = 1.9;
const LOUNGER_WIDTH = 0.72;
const LOUNGER_PITCH = 1.7;
/** The room between the edge of the pool and the foot of the loungers. */
const WALKWAY = 1.6;

/** A count from the scene description, kept to something sensible. */
function count(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * The world for a scene description.
 *
 * `describe()` sends the number of lanes, loungers and waiting spots; the
 * frontend used to ignore the lanes and use four. A pool in 3D can show
 * whatever the backend asks for.
 */
export function buildWorld(payload: Record<string, unknown> | null = null): World {
  const laneCount = count(payload?.lanes, DEFAULT_LANES, 8);
  const loungerCount = count(payload?.loungers, DEFAULT_LOUNGERS, 24);
  const waitingCount = count(payload?.waiting, DEFAULT_WAITING, 8);

  const width = laneCount * LANE_WIDTH;
  const pool: Area = {
    minX: -POOL_LENGTH / 2,
    maxX: POOL_LENGTH / 2,
    minZ: -width / 2,
    maxZ: width / 2,
  };

  // Lane 0 is the one nearest the camera, the way the eye reads a picture.
  const lanes: Lane[] = [];
  for (let i = 0; i < laneCount; i += 1) {
    lanes.push({ index: i, z: pool.maxZ - LANE_WIDTH * (i + 0.5), width: LANE_WIDTH });
  }

  // The loungers stand in rows behind the far side of the pool and look
  // across the water at it.
  const rows = Math.ceil(loungerCount / LOUNGERS_PER_ROW);
  const loungers: Lounger[] = [];
  for (let i = 0; i < loungerCount; i += 1) {
    const row = Math.floor(i / LOUNGERS_PER_ROW);
    const inRow = Math.min(LOUNGERS_PER_ROW, loungerCount - row * LOUNGERS_PER_ROW);
    const k = i - row * LOUNGERS_PER_ROW;
    // The second row is staggered, so its figures look between the heads
    // of the first.
    const stagger = row % 2 === 1 ? LOUNGER_PITCH / 2 : 0;
    const x = (k - (inRow - 1) / 2) * LOUNGER_PITCH + stagger;
    const z = pool.minZ - WALKWAY - LOUNGER_LENGTH / 2 - row * (LOUNGER_LENGTH + 1.1);
    loungers.push({
      index: i,
      x,
      z,
      facing: { x: 0, z: 1 },
      length: LOUNGER_LENGTH,
      width: LOUNGER_WIDTH,
      seatHeight: 0.36,
    });
  }

  const backOfLoungers = pool.minZ - WALKWAY - rows * (LOUNGER_LENGTH + 1.1);
  const deck: Area = {
    minX: pool.minX - 4.5,
    maxX: pool.maxX + TERRACE,
    minZ: Math.min(pool.minZ - 4, backOfLoungers - 0.6),
    maxZ: pool.maxZ + 3.6,
  };

  // A ladder at each corner, on the long walls, clear of the starting
  // blocks at the shallow end.
  const ladders: Ladder[] = [
    { index: 0, x: pool.maxX - 1.6, z: pool.maxZ, down: { x: 0, z: -1 } },
    { index: 1, x: pool.minX + 2.6, z: pool.maxZ, down: { x: 0, z: -1 } },
    { index: 2, x: pool.maxX - 1.6, z: pool.minZ, down: { x: 0, z: 1 } },
    { index: 3, x: pool.minX + 2.6, z: pool.minZ, down: { x: 0, z: 1 } },
  ];

  // The agents with no lounger wait on the coping of the near side, with
  // their feet in the water.
  const waiting = waitingSpots(pool, ladders, waitingCount);

  // The gate is in the near-left corner of the fence; the queue lines up
  // outside it, along the fence, where it is in nobody's way.
  // along the fence, away from the pool.
  const gate: Vec2 = { x: deck.minX + 0.9, z: deck.maxZ - 0.9 };
  const queueDir: Vec2 = { x: 0, z: -1 };

  // A parasol between every few loungers in the first row.
  const parasols: Vec2[] = [];
  const firstRow = loungers.filter((l) => l.z === loungers[0]?.z);
  for (let i = 1; i < firstRow.length; i += 3) {
    const a = firstRow[i - 1];
    const b = firstRow[i];
    parasols.push({ x: (a.x + b.x) / 2, z: a.z - 0.35 });
  }
  if (parasols.length === 0 && firstRow.length > 0) {
    const last = firstRow[firstRow.length - 1];
    parasols.push({ x: last.x + LOUNGER_PITCH * 0.75, z: last.z - 0.35 });
  }

  const equipment = buildEquipment(pool, deck, lanes);
  const hut = hutOf(deck, gate);
  const trees = gardenTrees(deck);

  return {
    lanes,
    loungers,
    waiting,
    pool,
    deck,
    waterY: -0.18,
    shallowDepth: 1.0,
    deepDepth: 2.2,
    ladders,
    gate,
    queueDir,
    parasols,
    equipment,
    obstacles: [...buildObstacles(pool, equipment, lanes), ...loungers.map(tableObstacle)],
    hut,
    trees,
    sprinkler: { x: deck.minX - 5, z: gate.z - 1.5 },
    flowerBeds: flowerBedsOf(deck),
    lanterns: lanternsOf(pool, deck, midZ(pool)),
  };
}

function midZ(pool: Area): number {
  return (pool.minZ + pool.maxZ) / 2;
}

/**
 * The hut by the gate, outside the fence. Its door is on the side of the
 * porch, and the porch is where the cat sits in the rain.
 */
function hutOf(deck: Area, gate: Vec2): { area: Area; porch: Vec2 } {
  const x = deck.minX - 2.4;
  const z = gate.z + 2.7;
  return {
    area: { minX: x - 1.2, maxX: x + 1.2, minZ: z - 1.0, maxZ: z + 1.0 },
    porch: { x: x + 1.6, z },
  };
}

/**
 * The six trees outside the far fence, the trunks of which the cat keeps
 * off. The tree crowns are drawn at the same places.
 */
export function gardenTrees(deck: Area): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < 6; i += 1) {
    out.push({ x: deck.minX + 2 + i * 4.2, z: deck.minZ - 2.6 - (i % 2) * 0.8 });
  }
  return out;
}

/**
 * Three flower beds in the garden: in front of the hedge on the far side,
 * between the trees. A bed is 0.5 m deep and 2.6 m long, and no trunk stands
 * in it.
 */
function flowerBedsOf(deck: Area): Area[] {
  return [4.5, 12.0, 16.5].map((along) => ({
    minX: deck.minX + along - 1.3,
    maxX: deck.minX + along + 1.3,
    minZ: deck.minZ - 2.2,
    maxZ: deck.minZ - 1.7,
  }));
}

/**
 * The six lantern posts: 0.3 m inside the fence. Two on the near side, two
 * on the far side behind the loungers, and two on the terrace. None of them
 * stands on a path or on a place where somebody stands (the test checks it).
 */
function lanternsOf(pool: Area, deck: Area, mid: number): Vec2[] {
  return [
    { x: pool.minX + 6, z: deck.maxZ - 0.3 },
    { x: pool.maxX - 3, z: deck.maxZ - 0.3 },
    { x: -6, z: deck.minZ + 0.3 },
    { x: 6, z: deck.minZ + 0.3 },
    { x: deck.maxX - 0.3, z: mid - 3.0 },
    { x: deck.maxX - 0.3, z: mid + 1.0 },
  ];
}

/** The spacing of the waiting spots along the coping. */
const WAITING_PITCH = 1.3;
/** How far a waiting spot keeps from a ladder, along the wall. */
const WAITING_FROM_LADDER = 1.2;
/** How far a waiting spot keeps from a flag post, along the edge. */
const WAITING_FROM_FLAG = 0.5;

/**
 * The waiting spots on the near coping, from the shallow end on.
 *
 * A spot that would be at a ladder is skipped. When the wall has no room
 * for all of them, the rest stand on the walk behind, as they did before.
 */
export function waitingSpots(pool: Area, ladders: Ladder[], count: number): WaitingSpot[] {
  // The flags stand at the near edge too, at 5 m in from each end wall.
  const flags = [pool.minX + 5, pool.maxX - 5];
  const out: WaitingSpot[] = [];
  for (let k = 0; out.length < count && k < 40; k += 1) {
    const x = pool.minX + 3.6 + k * WAITING_PITCH;
    if (x > pool.maxX + 0.5) break;
    if (ladders.some((l) => Math.abs(l.x - x) < WAITING_FROM_LADDER)) continue;
    if (flags.some((f) => Math.abs(f - x) < WAITING_FROM_FLAG)) continue;
    out.push({ x, z: pool.maxZ + 0.32, edge: true });
  }
  for (let i = 0; out.length < count; i += 1) {
    out.push({ x: pool.minX + 2.2 + i * WAITING_PITCH, z: pool.maxZ + 2.1, edge: false });
  }
  return out;
}

/**
 * The places on the terrace and at the shallow end.
 *
 * Everything is measured from the pool and the deck, so it still fits with
 * one to eight lanes. The slide and the board sit in lanes of their own, so
 * a swimmer that climbs out of one is not in the way of the other.
 */
export function buildEquipment(pool: Area, deck: Area, lanes: Lane[]): Equipment {
  const laneCount = lanes.length;
  const midZ = (pool.minZ + pool.maxZ) / 2;

  // The slide: a tower at the far corner of the deck, and a chute that
  // spirals down to the last lane.
  const tower = { x: pool.maxX + 6.6, z: pool.minZ - 1.8 };
  const slideLane = laneCount - 1;
  const splash = { x: pool.maxX - 0.6, z: lanes[slideLane].z };
  const chuteEnd = { x: splash.x + 1.0, z: splash.z };
  const path: Vec3[] = [
    { x: tower.x, y: 2.8, z: tower.z },
    { x: tower.x - 1.4, y: 2.5, z: tower.z - 0.9 },
    { x: tower.x - 3.0, y: 2.0, z: tower.z - 0.6 },
    { x: tower.x - 3.7, y: 1.5, z: tower.z + 0.8 },
    { x: tower.x - 3.0, y: 1.0, z: tower.z + 2.1 },
    { x: splash.x + 3.0, y: 0.6, z: splash.z },
    { x: chuteEnd.x, y: 0.15, z: chuteEnd.z },
  ];

  // The board: a block at the end of the pool, and a board over the water
  // in the second lane (the first, for a pool of one or two lanes).
  const boardLane = laneCount >= 3 ? 1 : 0;
  // On one lane the board moves a little towards the middle, so that its
  // splash is still half a metre from the wall.
  const boardZ = laneCount === 1 ? lanes[0].z + 0.35 : lanes[boardLane].z;
  const block = { x: pool.maxX + 1.6, z: boardZ };

  // The hot tub: a round tub in the far corner, with its step on the pool side.
  const tubCentre = { x: pool.maxX + 4.2, z: pool.maxZ + 1.0 };
  const tubRadius = 1.2;
  const seats: Spot[] = [45, 135, 225, 315].map((deg) => {
    const a = (deg * Math.PI) / 180;
    const x = tubCentre.x + 0.72 * Math.cos(a);
    const z = tubCentre.z + 0.72 * Math.sin(a);
    return { x, z, yaw: Math.atan2(tubCentre.x - x, tubCentre.z - z) };
  });

  // The kiosk: on the corner of the deck, the customer stands in front of it.
  const kioskCentre = { x: deck.maxX - 1.3, z: deck.maxZ - 0.75 };

  // The ping-pong table: a little way out from the middle of the deck, with
  // a player at each end.
  // On one lane the tower reaches past the middle of the deck, and the table
  // moves up the deck to stand clear of it.
  const tableZ = laneCount === 1 ? Math.max(midZ + 1.0, tower.z + 4.75) : midZ + 1.0;
  const tableCentre = { x: pool.maxX + 7.0, z: tableZ };

  // The ball court: three players on a ring round a beach ball, on the
  // terrace beyond the far end of the pool.
  // Centred on the pool's middle: 0.6 m further out, the far spot of the
  // ring stood in the hot tub on a three-lane pool.
  const courtCentre = { x: pool.maxX + 3.6, z: midZ };
  const courtSpots: Spot[] = [90, 210, 330].map((deg) => {
    const a = (deg * Math.PI) / 180;
    const x = courtCentre.x + 1.6 * Math.cos(a);
    const z = courtCentre.z + 1.6 * Math.sin(a);
    return { x, z, yaw: Math.atan2(courtCentre.x - x, courtCentre.z - z) };
  });

  // The shower: a post on the west side of the deck. It stands far enough
  // in from the fence for its footprint to keep 0.3 m clear of it.
  const showerPost = { x: deck.minX + 0.6, z: midZ + 1.8 };

  return {
    slide: {
      tower,
      top: { x: tower.x, y: 2.8, z: tower.z },
      // The foot of the stairs is just clear of the tower's footprint.
      stairsFoot: { x: tower.x, z: tower.z + 2.6, yaw: Math.PI },
      stairsTop: { x: tower.x, y: 2.8, z: tower.z + 0.8 },
      path,
      splash,
      lane: slideLane,
    },
    board: {
      base: { x: block.x + 0.7, z: boardZ, yaw: -Math.PI / 2 },
      block,
      tip: { x: pool.maxX - 1.0, y: 0.55, z: boardZ },
      splash: { x: pool.maxX - 2.0, z: boardZ },
      lane: boardLane,
      height: 0.55,
    },
    hotTub: {
      centre: tubCentre,
      radius: tubRadius,
      rim: 0.5,
      seats,
      step: { x: tubCentre.x, z: tubCentre.z - 1.55, yaw: 0 },
    },
    kiosk: {
      centre: kioskCentre,
      use: { x: kioskCentre.x, z: kioskCentre.z - 1.1, yaw: 0 },
    },
    pingPong: {
      centre: tableCentre,
      ends: [
        { x: tableCentre.x, z: tableCentre.z - 2.05, yaw: 0 },
        { x: tableCentre.x, z: tableCentre.z + 2.05, yaw: Math.PI },
      ],
    },
    shower: {
      post: showerPost,
      stand: { x: showerPost.x + 0.65, z: showerPost.z, yaw: -Math.PI / 2 },
      head: { x: showerPost.x + 0.65, y: 2.15, z: showerPost.z },
    },
    fountains: [
      { x: pool.minX - 0.1, y: 0.12, z: pool.minZ + 0.5 },
      { x: pool.minX - 0.1, y: 0.12, z: pool.maxZ - 0.5 },
    ],
    ballCourt: { centre: courtCentre, spots: courtSpots },
  };
}

/**
 * The footprints nobody walks through: the pool, then every piece of
 * equipment that stands on the ground.
 *
 * The chute's posts stand in a box, and the box is what is kept clear. The
 * flags' posts at the two ends are in it too, since they stand on the walk
 * round the pool.
 */
export function buildObstacles(pool: Area, e: Equipment, lanes: Lane[] = []): { name: string; area: Area }[] {
  const T = e.slide.tower;
  const S = e.slide.splash;
  const boardZ = e.board.block.z;
  const c = e.hotTub.centre;
  const k = e.kiosk.centre;
  const t = e.pingPong.centre;
  const post = e.shower.post;
  const out: { name: string; area: Area }[] = [
    { name: 'pool', area: pool },
    {
      name: 'slideTower',
      area: { minX: T.x - 1.0, maxX: T.x + 1.0, minZ: T.z - 1.0, maxZ: T.z + 2.4 },
    },
    {
      name: 'chuteHigh',
      area: { minX: T.x - 4.1, maxX: T.x - 1.0, minZ: T.z - 1.2, maxZ: T.z + 2.5 },
    },
    {
      name: 'chuteLow',
      area: { minX: pool.maxX, maxX: S.x + 3.3, minZ: S.z - 0.4, maxZ: S.z + 0.4 },
    },
    {
      name: 'board',
      area: { minX: pool.maxX, maxX: e.board.block.x + 0.4, minZ: boardZ - 0.35, maxZ: boardZ + 0.35 },
    },
    {
      name: 'hotTub',
      area: { minX: c.x - 1.3, maxX: c.x + 1.3, minZ: c.z - 1.3, maxZ: c.z + 1.3 },
    },
    {
      name: 'kiosk',
      area: {
        minX: k.x - KIOSK_HALF.x - 0.1,
        maxX: k.x + KIOSK_HALF.x + 0.1,
        minZ: k.z - KIOSK_HALF.z - 0.1,
        maxZ: k.z + KIOSK_HALF.z + 0.1,
      },
    },
    {
      name: 'pingPong',
      area: {
        minX: t.x - TABLE_HALF.x - TABLE_MARGIN,
        maxX: t.x + TABLE_HALF.x + TABLE_MARGIN,
        minZ: t.z - TABLE_HALF.z - TABLE_MARGIN,
        maxZ: t.z + TABLE_HALF.z + TABLE_MARGIN,
      },
    },
    {
      name: 'shower',
      area: { minX: post.x - 0.25, maxX: post.x + 0.25, minZ: post.z - 0.3, maxZ: post.z + 0.3 },
    },
  ];
  // The starting block of each lane stands on the coping at the shallow end.
  // The walkers keep off it, as they keep off the rest.
  for (const lane of lanes) {
    out.push({
      name: 'startBlock',
      area: { minX: pool.minX - 0.55, maxX: pool.minX - 0.05, minZ: lane.z - 0.25, maxZ: lane.z + 0.25 },
    });
  }
  // Two lines of flags over the water, one at 5 m in from each end wall;
  // each line is fixed by a post at either side of the pool.
  for (const x of [pool.minX + 5, pool.maxX - 5]) {
    for (const z of [pool.minZ - 0.3, pool.maxZ + 0.3]) {
      out.push({ name: 'flagPost', area: { minX: x - 0.15, maxX: x + 0.15, minZ: z - 0.15, maxZ: z + 0.15 } });
    }
  }
  return out;
}

/** The depth of the pool floor below the deck at `x`. */
export function floorDepthAt(world: World, x: number): number {
  const u = (x - world.pool.minX) / (world.pool.maxX - world.pool.minX);
  const t = Math.min(1, Math.max(0, u));
  // The floor is flat in the shallow third and slopes down to the deep end.
  const s = t < 0.35 ? 0 : (t - 0.35) / 0.65;
  const eased = s * s * (3 - 2 * s);
  return world.shallowDepth + (world.deepDepth - world.shallowDepth) * eased;
}

/** True when a point on the ground is in the water. */
export function inPool(world: World, p: Vec2, margin = 0): boolean {
  return (
    p.x > world.pool.minX - margin &&
    p.x < world.pool.maxX + margin &&
    p.z > world.pool.minZ - margin &&
    p.z < world.pool.maxZ + margin
  );
}

/** True when a point is on the deck, inside the fence. */
export function onDeck(world: World, p: Vec2): boolean {
  return (
    p.x >= world.deck.minX &&
    p.x <= world.deck.maxX &&
    p.z >= world.deck.minZ &&
    p.z <= world.deck.maxZ &&
    !inPool(world, p)
  );
}

/** Where a character stands to step onto a lounger: at its foot. */
export function loungerApproach(lounger: Lounger): Vec2 {
  return {
    x: lounger.x,
    z: lounger.z + lounger.facing.z * (lounger.length / 2 + 0.35),
  };
}

/** The room between two people in the queue at the gate. */
const QUEUE_GAP = 0.75;

/** The point just outside the gate, in the garden. */
export function gateOutside(world: World): Vec2 {
  return { x: world.deck.minX - 0.9, z: world.gate.z };
}

/**
 * Where a newcomer appears: on the path through the garden that leads to
 * the gate, a few steps out. The queue is along the fence to one side, so
 * the people coming in do not walk into the people waiting.
 */
export function entrance(world: World, k: number): Vec2 {
  const out = gateOutside(world);
  return {
    x: out.x - 2.2 - (k % 4) * 0.7,
    z: world.gate.z + 0.35 + ((k * 7) % 3) * 0.45,
  };
}

/** True when a point is inside the fence. */
export function insideFence(world: World, p: Vec2): boolean {
  return (
    p.x > world.deck.minX &&
    p.x < world.deck.maxX &&
    p.z > world.deck.minZ &&
    p.z < world.deck.maxZ
  );
}

/**
 * The place in the queue at the gate.
 *
 * The agents that wait at the gate wait outside it, along the fence. Inside
 * the fence the queue stood on the path everybody walks, and the people
 * going to the ladder piled up against it. When a line reaches the corner it
 * folds back in a second line further out.
 */
export function queueSpot(world: World, place: number): Vec2 {
  const outside = gateOutside(world);
  const start = outside.z + world.queueDir.z * QUEUE_GAP;
  const room = Math.abs(start - (world.queueDir.z < 0 ? world.deck.minZ : world.deck.maxZ));
  const perLine = Math.max(1, Math.floor(room / QUEUE_GAP) + 1);
  const line = Math.floor(place / perLine);
  const k = place % perLine;
  // Every other line walks back the way the one before came.
  const along = line % 2 === 0 ? k : perLine - 1 - k;
  return {
    // The lines are far enough apart for a person to walk between them.
    x: outside.x - line * 1.05,
    z: start + world.queueDir.z * QUEUE_GAP * along,
  };
}

/** Where a character stands at the top of a ladder. */
export function ladderTop(ladder: Ladder): Vec2 {
  return {
    x: ladder.x,
    z: ladder.z - ladder.down.z * 0.55,
  };
}

/** Where a swimmer comes off a ladder, in the water. */
export function ladderFoot(ladder: Ladder): Vec2 {
  return {
    x: ladder.x,
    z: ladder.z + ladder.down.z * 0.55,
  };
}

/**
 * The z of a swimmer in its lane.
 *
 * Swimmers keep to the right of the lane, the way people do in a real
 * pool: one going towards the deep end swims on one side, one coming back
 * on the other, so two that meet pass each other instead of swimming
 * through each other. `lane_offset` from the backend spreads the swimmers
 * that go the same way a little apart.
 *
 * @param dir The way the swimmer is going along the pool, +1 or -1; 0
 *   for the middle of the lane.
 */
export function swimZ(world: World, lane: number, offset: number, dir: -1 | 0 | 1 = 0): number {
  const l = world.lanes[Math.max(0, Math.min(world.lanes.length - 1, lane))];
  if (!l) return 0;
  // Facing +x the right hand is +z, facing -x it is -z.
  const side = dir * 0.2;
  const spread = Math.max(-0.42, Math.min(0.42, offset)) * (dir === 0 ? 0.75 : 0.15);
  // The middle of the body stays a shoulder's width inside the ropes.
  const across = Math.max(-0.3, Math.min(0.3, side + spread));
  return l.z + across * l.width;
}
