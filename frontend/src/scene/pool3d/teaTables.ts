/**
 * The glasses of tea on the side tables (Sprint 29.5), as state.
 *
 * Each lounger has a small round table on the figure's right (`sideTableOf`,
 * in `world.ts`), where a figure that drinks tea reaches for its glass. This
 * module keeps which glasses are on the tables and which are in a hand. It has
 * no Three.js objects; `teaGlasses.ts` draws them.
 */

/** A table with no glass gets one back after this long, in seconds, as if someone had refilled it. */
export const REFILL_S = 300;

/**
 * Which glasses are on the tables, and which are in a hand.
 *
 * A glass taken for a cup of tea is in the hand until the tea ends. If the
 * figure is put back on its lounger, the glass goes back on its table. If the
 * figure leaves (an errand, a request for the person) the table stays empty,
 * and it is refilled after REFILL_S.
 */
export class TeaTables {
  private readonly glass: boolean[];
  private readonly held: boolean[];
  private readonly emptySince: (number | null)[];

  constructor(count: number) {
    this.glass = new Array<boolean>(count).fill(true);
    this.held = new Array<boolean>(count).fill(false);
    this.emptySince = new Array<number | null>(count).fill(null);
  }

  /** Whether the table has its glass on it now. */
  has(index: number): boolean {
    return this.glass[index] === true;
  }

  /** A figure takes the glass from its table. False when there is none to take. */
  take(index: number): boolean {
    if (!this.glass[index]) return false;
    this.glass[index] = false;
    this.held[index] = true;
    this.emptySince[index] = null;
    return true;
  }

  /** The figure puts the glass back on its table, where the tea ended. */
  putBack(index: number): void {
    this.glass[index] = true;
    this.held[index] = false;
    this.emptySince[index] = null;
  }

  /** The figure goes away with the glass: the table is empty from `now`. */
  leave(index: number, now: number): void {
    this.held[index] = false;
    this.glass[index] = false;
    this.emptySince[index] = now;
  }

  /** Refill the tables that have been empty for REFILL_S, and that nobody holds a glass from. */
  tick(now: number): void {
    for (let i = 0; i < this.glass.length; i += 1) {
      const since = this.emptySince[i];
      if (this.glass[i] || this.held[i] || since === null) continue;
      if (now - since >= REFILL_S) {
        this.glass[i] = true;
        this.emptySince[i] = null;
      }
    }
  }
}
