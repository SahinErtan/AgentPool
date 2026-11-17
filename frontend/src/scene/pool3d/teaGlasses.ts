/**
 * The glasses of tea on the side tables (Sprint 29.5).
 *
 * One instanced mesh holds a glass for every table, so the glasses cost one
 * draw call however many loungers there are. A glass that is in a hand is
 * not drawn: its instance is scaled to nothing. The rig draws the glass in the
 * hand (the `cup` prop); this one is the same tulip glass, standing on its
 * saucer, in metres.
 */

import { CircleGeometry, CylinderGeometry, InstancedMesh, LatheGeometry, Matrix4, Quaternion, Vector2, Vector3 } from 'three';
import { SAUCER, GLASS_COLOUR, SAUCER_COLOUR, TEA_COLOUR, TEA_GLASS_PROFILE, TEA_LIQUID_PROFILE, TEA_SURFACE } from '../characters3d/teaGlassShape';
import { merge, put, type Piece } from './build';
import { GLASS_ORIGIN_Y, type SideTable } from './world';

/** The glass is centred on its bowl: its foot is this far below the origin. */
const BASE = -GLASS_ORIGIN_Y;

const toVectors = (points: readonly (readonly [number, number])[]): Vector2[] => points.map(([x, y]) => new Vector2(x, y));

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
    // The saucer lies on the table top, and the glass stands in its well: its
    // foot is inside the saucer. The tea's surface is a disc over its lathe.
    const pieces: Piece[] = [
      { geometry: put(new LatheGeometry(toVectors(TEA_GLASS_PROFILE), 14), 0, BASE, 0), color: GLASS_COLOUR },
      { geometry: put(new LatheGeometry(toVectors(TEA_LIQUID_PROFILE), 14), 0, BASE, 0), color: TEA_COLOUR },
      { geometry: put(new CircleGeometry(TEA_SURFACE.radius, 14), 0, BASE + TEA_SURFACE.y, 0, [-Math.PI / 2, 0, 0]), color: TEA_COLOUR },
      { geometry: put(new CylinderGeometry(SAUCER.radiusTop, SAUCER.radiusBottom, SAUCER.thickness, 16), 0, BASE + SAUCER.thickness / 2, 0), color: SAUCER_COLOUR },
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
