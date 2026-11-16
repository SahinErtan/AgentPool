/**
 * The glasses of tea on the side tables (Sprint 29.5).
 *
 * One instanced mesh holds a glass for every table, so the glasses cost one
 * draw call however many loungers there are. A glass that is in a hand is
 * not drawn: its instance is scaled to nothing. The rig draws the glass in the
 * hand (the `cup` prop); this one is the same tulip glass, standing on its
 * saucer, in metres.
 */

import { CylinderGeometry, InstancedMesh, LatheGeometry, Matrix4, Quaternion, Vector2, Vector3 } from 'three';
import { merge, put, type Piece } from './build';
import { GLASS_ORIGIN_Y, type SideTable } from './world';

/** The tulip glass of tea, a lathe in metres, from its foot to its rim. */
const GLASS: Vector2[] = [
  new Vector2(0.0, 0.0),
  new Vector2(0.026, 0.0),
  new Vector2(0.008, 0.012),
  new Vector2(0.008, 0.04),
  new Vector2(0.034, 0.075),
  new Vector2(0.048, 0.11),
  new Vector2(0.044, 0.14),
  new Vector2(0.05, 0.155),
];
const TEA: Vector2[] = [new Vector2(0.0, 0.02), new Vector2(0.03, 0.05), new Vector2(0.042, 0.085), new Vector2(0.042, 0.1)];
/** The glass is centred on its bowl: its foot is this far below the origin. */
const BASE = -GLASS_ORIGIN_Y;

export class TeaGlasses {
  readonly mesh: InstancedMesh;
  /** What each instance shows now: true for a glass on its table. */
  private readonly shown: boolean[];
  private readonly tables: SideTable[];
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);
  private readonly shownMatrices: Matrix4[] = [];
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3(1, 1, 1);

  constructor(tables: SideTable[]) {
    this.tables = tables;
    const pieces: Piece[] = [
      { geometry: put(new LatheGeometry(GLASS, 14), 0, BASE, 0), color: '#f3e9d6' },
      { geometry: put(new LatheGeometry(TEA, 14), 0, BASE, 0), color: '#7a3418' },
      { geometry: put(new CylinderGeometry(0.068, 0.058, 0.008, 16), 0, BASE - 0.006, 0), color: '#f4efe6' },
    ];
    const glass = merge(pieces, 'tea-glasses');
    this.mesh = new InstancedMesh(glass.geometry, glass.material, Math.max(1, tables.length));
    this.mesh.name = 'tea-glasses';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.shown = new Array<boolean>(tables.length).fill(false);
    for (let i = 0; i < tables.length; i += 1) {
      const t = tables[i];
      this.shownMatrices.push(new Matrix4().compose(this.p.set(t.x, t.top + GLASS_ORIGIN_Y, t.z), this.q, this.s));
      this.mesh.setMatrixAt(i, this.hidden);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Show the glasses that are on their tables, and hide the rest. Only an
   * instance whose state changed is written, so a quiet frame costs nothing.
   */
  sync(onTable: (index: number) => boolean): void {
    let changed = false;
    for (let i = 0; i < this.tables.length; i += 1) {
      const want = onTable(i);
      if (want === this.shown[i]) continue;
      this.shown[i] = want;
      this.mesh.setMatrixAt(i, want ? this.shownMatrices[i] : this.hidden);
      changed = true;
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** The material is shared with the other pieces of the pool, so only the geometry goes. */
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
