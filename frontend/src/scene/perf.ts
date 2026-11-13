/**
 * The hot path of the pool.
 *
 * The scene draws sixty frames a second and every frame walks over every
 * agent. With a dozen agents that is nothing; with sixty it is not. The
 * helpers here take the work out of that path: the clearance check looks
 * at the neighbours of a character instead of at the whole pool, and the
 * foam line is built once instead of sixty times a second.
 *
 * Everything here is pure, so it can be checked without a browser and
 * without a renderer.
 */

/* ------------------------------------------------------------------ */
/* The clearance between the characters that walk on the deck          */
/* ------------------------------------------------------------------ */

/**
 * What the clearance check needs to know about a character.
 *
 * The scene keeps the state of its own characters; this is the part of it
 * that the check looks at.
 */
export interface ClearanceAgent {
  readonly id: string;
  /** Where it stands, in scene pixels. */
  x: number;
  y: number;
  /** The way it walks: 1, -1, or 0 when it stands still. */
  moveDir: number;
  /** True while it is on its way somewhere. */
  moving: boolean;
  /** True when it has somewhere to go. */
  hasTarget: boolean;
}

/**
 * The neighbours of a character, kept in a grid.
 *
 * The old check looked at every character for every character, which is a
 * square of the size of the pool on every frame. The grid keeps the
 * characters in cells, so a character only looks at the cells around it:
 * the pool is cut into strips, and only the strips at the same height can
 * block it.
 *
 * The grid is updated as the characters move, so the answer is the same as
 * the answer of the old check at the same moment.
 */
export class ClearanceIndex {
  /** The size of a cell, in pixels. */
  private cell: number;
  /** The characters of every cell, by column and then by row. */
  private readonly columns = new Map<number, Map<number, ClearanceAgent[]>>();
  /** Where every character sits, so it can be moved without a search. */
  private readonly places = new Map<string, { col: number; row: number }>();
  /** Every character the index knows about. */
  private readonly agents = new Map<string, ClearanceAgent>();
  /** The first and the last column that holds a character. */
  private lowest = Number.POSITIVE_INFINITY;
  private highest = Number.NEGATIVE_INFINITY;

  constructor(cellSize = 64) {
    this.cell = Math.max(1, cellSize);
  }

  /** The size of the cells. It is the height of a character, so that the
   * rows around a character are exactly the ones within its reach. */
  setCellSize(size: number): void {
    const next = Math.max(1, size);
    if (next === this.cell) return;
    this.cell = next;
    for (const agent of this.agents.values()) this.place(agent);
  }

  /** Put a character into the grid. */
  add(agent: ClearanceAgent): void {
    this.remove(agent.id);
    this.agents.set(agent.id, agent);
    this.place(agent);
  }

  /** Take a character out of the grid. */
  remove(id: string): void {
    this.unplace(id);
    this.agents.delete(id);
    this.rebound();
  }

  /**
   * The character has moved: put it in the cell it belongs to now.
   *
   * The scene calls this after every character has moved, so the grid is
   * never a step behind the characters themselves.
   */
  update(agent: ClearanceAgent): void {
    if (!this.agents.has(agent.id)) {
      this.add(agent);
      return;
    }
    this.agents.set(agent.id, agent);
    this.place(agent);
  }

  /**
   * How far the character may still walk before it bumps into the one ahead.
   *
   * It is the distance to the closest character on the same stretch of
   * deck, minus the gap that has to be kept between them. When two
   * characters stand exactly on top of each other — which happens at the
   * gate, where they all arrive from the same point — the one with the
   * lower id yields, so the pair never deadlocks.
   *
   * @param direction The way the character walks: 1 or -1.
   * @param gap The distance that has to be kept between two characters.
   * @param tolerance How far another character may be off the line to
   *   still be in the way.
   */
  clearanceAhead(
    agent: ClearanceAgent,
    direction: number,
    gap: number,
    tolerance: number,
  ): number {
    if (direction === 0) return Number.POSITIVE_INFINITY;

    const cell = this.cell;
    const col = Math.floor(agent.x / cell);
    const row = Math.floor(agent.y / cell);
    // The rows that are within reach of the character.
    const span = Math.max(1, Math.ceil(tolerance / cell));

    // The nearest one in front. The columns are walked outwards, and the
    // first column that holds a character in front holds the nearest one:
    // every column further away is further to the front as well.
    let ahead = Number.POSITIVE_INFINITY;
    for (let c = col; c >= this.lowest && c <= this.highest; c += direction) {
      const column = this.columns.get(c);
      if (column) {
        for (let r = row - span; r <= row + span; r += 1) {
          const bucket = column.get(r);
          if (!bucket) continue;
          for (const other of bucket) {
            if (!this.blocks(other, agent, direction, tolerance)) continue;
            const d = (other.x - agent.x) * direction;
            if (d > 0.5 && d < ahead) ahead = d;
          }
        }
      }
      if (ahead !== Number.POSITIVE_INFINITY) break;
    }

    // The same spot: the two pixels around the character. Standing on the
    // same spot is not "in front", it is the same place, and the two of
    // them must not lock each other. The window is walked exactly, so a
    // character on the edge of a column is still found.
    const first = Math.floor((agent.x - 2) / cell);
    const last = Math.floor((agent.x + 2) / cell);
    let onTop = false;
    for (let c = first; c <= last; c += 1) {
      const column = this.columns.get(c);
      if (!column) continue;
      for (let r = row - span; r <= row + span; r += 1) {
        const bucket = column.get(r);
        if (!bucket) continue;
        for (const other of bucket) {
          if (!this.blocks(other, agent, direction, tolerance)) continue;
          const d = (other.x - agent.x) * direction;
          if (Math.abs(d) > 2) continue;
          onTop = true;
          // The higher id yields, so the pair never deadlocks.
          if (d <= 0.5 && other.id > agent.id) return 0;
        }
      }
    }

    // The pair stands on the same spot: the one that yields is the one
    // with the higher id, so the other one is free to move. Without this
    // both of them wait for each other and the queue never moves again.
    if (onTop) return Number.POSITIVE_INFINITY;

    return ahead === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : Math.max(0, ahead - gap);
  }

  /** True when the other character stands in the way of this one. */
  private blocks(
    other: ClearanceAgent,
    agent: ClearanceAgent,
    direction: number,
    tolerance: number,
  ): boolean {
    if (other.id === agent.id) return false;
    // A character that has nowhere to go stands still, so it must not
    // block the queue behind it.
    if (!other.moving) return false;
    if (!other.hasTarget) return false;
    // Two characters walking towards each other pass by, they do not queue
    // up behind one another.
    if (other.moveDir !== 0 && other.moveDir !== direction) return false;
    if (Math.abs(other.y - agent.y) > tolerance) return false;
    return true;
  }

  /** Put the agent in the cell its position belongs to. */
  private place(agent: ClearanceAgent): void {
    const col = Math.floor(agent.x / this.cell);
    const row = Math.floor(agent.y / this.cell);
    const at = this.places.get(agent.id);
    if (at && at.col === col && at.row === row) return;
    if (at) this.unplace(agent.id);

    let column = this.columns.get(col);
    if (!column) {
      column = new Map();
      this.columns.set(col, column);
    }
    let bucket = column.get(row);
    if (!bucket) {
      bucket = [];
      column.set(row, bucket);
    }
    bucket.push(agent);
    this.places.set(agent.id, { col, row });

    if (col < this.lowest) this.lowest = col;
    if (col > this.highest) this.highest = col;
  }

  /** Take the agent out of the cell it is in. */
  private unplace(id: string): void {
    const at = this.places.get(id);
    if (!at) return;
    const column = this.columns.get(at.col);
    const bucket = column?.get(at.row);
    if (bucket) {
      const index = bucket.findIndex((agent) => agent.id === id);
      if (index >= 0) bucket.splice(index, 1);
      if (bucket.length === 0) column?.delete(at.row);
    }
    if (column && column.size === 0) this.columns.delete(at.col);
    this.places.delete(id);
  }

  /** The columns that are left decide where the scan has to stop. */
  private rebound(): void {
    this.lowest = Number.POSITIVE_INFINITY;
    this.highest = Number.NEGATIVE_INFINITY;
    for (const col of this.columns.keys()) {
      if (col < this.lowest) this.lowest = col;
      if (col > this.highest) this.highest = col;
    }
  }
}

/* ------------------------------------------------------------------ */
/* The foam line                                                       */
/* ------------------------------------------------------------------ */

/** How far apart the points of the foam line are, in pixels. */
export const FOAM_STEP = 16;
/** How high the foam line swings, in pixels. */
export const FOAM_AMPLITUDE = 2.2;
/** How many radians the wave turns for every pixel of the pool. */
export const FOAM_WAVE = 0.7 / FOAM_STEP;
/** How fast the wave turns, in radians per second. */
export const FOAM_PHASE_SPEED = 1.6;
/** The length of one wave, in pixels. */
export const FOAM_PERIOD = (Math.PI * 2) / FOAM_WAVE;

/**
 * The height of the foam line at a point of the pool.
 *
 * It is the same sine as the one the foam line was drawn with before, so
 * a line that is moved sideways looks exactly like a line that is drawn
 * again.
 */
export function foamY(x: number, time: number): number {
  return FOAM_AMPLITUDE * Math.sin(x * FOAM_WAVE + time * FOAM_PHASE_SPEED);
}

/**
 * How far the foam line has travelled, in pixels.
 *
 * A wave that travels sideways is the same shape, so the line does not
 * have to be built again: it is built once and moved. The travel is
 * wrapped into one wave, because the line looks the same after a wave.
 */
export function foamShift(time: number): number {
  const travel = (FOAM_PHASE_SPEED * time) / FOAM_WAVE;
  const wrapped = ((travel % FOAM_PERIOD) + FOAM_PERIOD) % FOAM_PERIOD;
  return -wrapped;
}

/**
 * The points of the foam line, as flat x and y pairs.
 *
 * The points sit on the grid that starts at the anchor, so the line is the
 * same line as the one that was drawn before.
 */
export function foamPoints(
  anchorX: number,
  fromX: number,
  toX: number,
  time = 0,
): number[] {
  const points: number[] = [];
  const first = Math.ceil((fromX - anchorX) / FOAM_STEP);
  const last = Math.floor((toX - anchorX) / FOAM_STEP);
  for (let k = first; k <= last; k += 1) {
    const x = anchorX + k * FOAM_STEP;
    points.push(x, foamY(x, time));
  }
  return points;
}
