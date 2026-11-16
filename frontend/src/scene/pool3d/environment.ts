/**
 * Everything in the pool that is not a person or the water.
 *
 * The deck, the pool shell with its sloping floor, the coping, the lane
 * lines, the lane ropes floating on the water, the ladder, the loungers with
 * their towels, the parasols, the fence and the hedge, the gate and its hut,
 * the plants at the deep end, a toy floating about, and the garden outside
 * the fence.
 *
 * Built once from the world. The few things that move (the ropes, the
 * parasols, the toy) are moved in `update`, by noise, so none of them
 * swings on a visible loop.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  Vector3,
  type Texture,
} from 'three';
import { fbm } from '../characters/noise';
import { merge, put, type Piece } from './build';
import { patchCaustics } from './water';
import { patchUnderwater } from './underwater';
import {
  BACKREST_LEAN,
  backRest,
  floorDepthAt,
  loungerApproach,
  sideTableOf,
  TABLE_FOOT_RADIUS,
  TABLE_RADIUS,
  TABLE_TOP,
  type World,
} from './world';

import { windAt } from './creatures';
import { patchCloudShadow, patchPiecesShadow } from './sky';

export interface Environment {
  group: Group;
  /** `wet` is 0 to 1: how wet the deck is, which doubles the sway of the parasols. */
  update(time: number, wet?: number): void;
  setPalette(deck: number, coping: number, grass: number, tree: number): void;
  /** 0 by day .. 1 at night: the lantern lamps come on. */
  setNight(night: number): void;
  /** 0 dry .. 1 wet: the deck darkens (step 26.6). */
  setWetness(wet: number): void;
  dispose(): void;
}

/** The lamps of the lanterns: grey by day, warm by night. */
const LAMP_OFF = '#8f97a0';
const LAMP_ON = '#ffd28a';
/** How much darker a wet deck is. */
const WET_DARKEN = 0.12;

// --- textures -------------------------------------------------------------

/** A square of tiles with grout lines, as a texture that repeats. */
function tileTexture(base: string, grout: string, tiles: number, jitter: number): Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const step = size / tiles;
    const c = new Color(base);
    for (let i = 0; i < tiles; i += 1) {
      for (let j = 0; j < tiles; j += 1) {
        // Each tile a shade off the next, so the deck is not a flat colour.
        const k = 1 + (Math.sin(i * 12.9898 + j * 78.233) * 43758.5453 % 1) * jitter;
        const t = c.clone().multiplyScalar(k);
        ctx.fillStyle = `#${t.getHexString()}`;
        ctx.fillRect(i * step, j * step, step, step);
      }
    }
    ctx.strokeStyle = grout;
    ctx.lineWidth = 2;
    for (let i = 0; i <= tiles; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, size);
      ctx.moveTo(0, i * step);
      ctx.lineTo(size, i * step);
      ctx.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// --- the pool shell ---------------------------------------------------------

/** The floor: a strip along x that follows the slope. */
function floorGeometry(world: World): BufferGeometry {
  const segments = 48;
  const { minX, maxX, minZ, maxZ } = world.pool;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const x = minX + ((maxX - minX) * i) / segments;
    const y = -floorDepthAt(world, x);
    positions.push(x, y, minZ, x, y, maxZ);
    uvs.push(x / 1.2, minZ / 1.2, x / 1.2, maxZ / 1.2);
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A long wall at `z`, from the deck down to the sloping floor. */
function longWall(world: World, z: number, facing: 1 | -1): BufferGeometry {
  const segments = 48;
  const { minX, maxX } = world.pool;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const x = minX + ((maxX - minX) * i) / segments;
    const y = -floorDepthAt(world, x);
    positions.push(x, 0, z, x, y, z);
    uvs.push(x / 1.2, 0, x / 1.2, y / 1.2);
    if (i > 0) {
      const a = (i - 1) * 2;
      if (facing > 0) index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** An end wall at `x`. */
function endWall(world: World, x: number, facing: 1 | -1): BufferGeometry {
  const depth = floorDepthAt(world, x);
  const width = world.pool.maxZ - world.pool.minZ;
  const g = new PlaneGeometry(width, depth);
  g.rotateY(facing > 0 ? Math.PI / 2 : -Math.PI / 2);
  g.translate(x, -depth / 2, (world.pool.minZ + world.pool.maxZ) / 2);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * (width / 1.2), uv.getY(i) * (depth / 1.2));
  return g;
}

/** The deck: the paved ground inside the fence, with a hole for the pool. */
function deckGeometry(world: World): BufferGeometry {
  const { deck, pool } = world;
  const shape = new Shape();
  shape.moveTo(deck.minX, -deck.minZ);
  shape.lineTo(deck.maxX, -deck.minZ);
  shape.lineTo(deck.maxX, -deck.maxZ);
  shape.lineTo(deck.minX, -deck.maxZ);
  shape.lineTo(deck.minX, -deck.minZ);
  const hole = new Shape();
  hole.moveTo(pool.minX, -pool.minZ);
  hole.lineTo(pool.minX, -pool.maxZ);
  hole.lineTo(pool.maxX, -pool.maxZ);
  hole.lineTo(pool.maxX, -pool.minZ);
  hole.lineTo(pool.minX, -pool.minZ);
  shape.holes.push(hole);
  const g = new ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 1) {
    uv[i * 2] = pos.getX(i) / 2.4;
    uv[i * 2 + 1] = pos.getZ(i) / 2.4;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}

// --- the furniture ----------------------------------------------------------

const CUSHIONS = ['#f2c14e', '#e76f51', '#2a9d8f', '#f4a3a8', '#7fb7e6', '#b8d86b'];
const TOWELS = ['#ffffff', '#ff9f68', '#7ad3c9', '#f7e07a', '#c7a7ff', '#ff8fb0'];

/** One lounger: a frame, a seat, a back rest leaning back, legs, a towel. */
function loungerPieces(world: World, index: number, pieces: Piece[], towels: Piece[]): void {
  const l = world.loungers[index];
  const seatY = l.seatHeight;
  const back = l.z - l.facing.z * (l.length / 2);
  const front = l.z + l.facing.z * (l.length / 2);
  const dir = l.facing.z;
  const frame = '#f1efe9';
  const cushion = CUSHIONS[index % CUSHIONS.length];

  // The seat runs from the back rest to the foot.
  const seatStart = back + dir * 0.52;
  const seatLen = Math.abs(front - seatStart);
  const seatMid = (seatStart + front) / 2;
  pieces.push({
    geometry: put(new BoxGeometry(l.width, 0.05, seatLen), l.x, seatY - 0.06, seatMid),
    color: frame,
  });
  pieces.push({
    geometry: put(new BoxGeometry(l.width * 0.9, 0.07, seatLen * 0.96), l.x, seatY - 0.005, seatMid),
    color: cushion,
  });
  // The back rest, leaning back at the angle the figure leans at. Its
  // place and its normal come from the world, so the drawing and the test
  // cannot disagree about where the back of the lounger is.
  const lean = BACKREST_LEAN;
  const restLen = 0.82;
  const rest = backRest(l);
  const cy = rest.y;
  const cz = rest.z;
  // The box lies along z; turned about x by this much it stands up and
  // leans back, away from the seat.
  const tilt = dir * (Math.PI / 2 - lean);
  // The normal of the back rest, towards the figure that leans on it.
  const ny = rest.normalY;
  const nz = rest.normalZ;
  const layer = (offset: number) => [l.x, cy + ny * offset, cz + nz * offset] as const;
  pieces.push({
    geometry: put(new BoxGeometry(l.width, 0.05, restLen), ...layer(-0.04), [tilt, 0, 0]),
    color: frame,
  });
  pieces.push({
    geometry: put(new BoxGeometry(l.width * 0.9, 0.07, restLen * 0.95), ...layer(0.01), [tilt, 0, 0]),
    color: cushion,
  });
  // A towel over the back rest. It is a slab of its own and it stands a
  // little clear of the cushion: a towel that touches the cushion is a
  // razor-thin surface that the shadow map cannot hold.
  towels.push({
    geometry: put(new BoxGeometry(l.width * 0.62, 0.04, restLen * 0.7), ...layer(0.07), [tilt, 0, 0]),
    color: TOWELS[index % TOWELS.length],
  });
  // Four legs down to the deck.
  for (const sx of [-1, 1]) {
    for (const end of [seatStart, front - dir * 0.08]) {
      pieces.push({
        geometry: put(new CylinderGeometry(0.025, 0.025, seatY - 0.06, 6), l.x + sx * (l.width / 2 - 0.05), (seatY - 0.06) / 2, end),
        color: '#c9c6bd',
      });
    }
  }
  // The side table on the figure's right, where its tea waits (Sprint 29.5).
  // It is part of this mesh, so it costs no draw call of its own.
  const table = sideTableOf(l);
  pieces.push({
    geometry: put(new CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.02, 14), table.x, TABLE_TOP - 0.01, table.z),
    color: '#b98a5e',
  });
  pieces.push({
    geometry: put(new CylinderGeometry(0.018, 0.018, TABLE_TOP - 0.02, 6), table.x, (TABLE_TOP - 0.02) / 2, table.z),
    color: '#8c6a48',
  });
  pieces.push({
    geometry: put(new CylinderGeometry(TABLE_FOOT_RADIUS, TABLE_FOOT_RADIUS, 0.015, 14), table.x, 0.0075, table.z),
    color: '#8c6a48',
  });
  // A pair of flip-flops at the foot, where the figure stepped out of them.
  const foot = loungerApproach(l);
  for (const sx of [-1, 1]) {
    pieces.push({
      geometry: put(new BoxGeometry(0.1, 0.02, 0.26), foot.x + sx * 0.09 + 0.25, 0.01, foot.z - dir * 0.12, [0, sx * 0.15, 0]),
      color: TOWELS[(index + 2) % TOWELS.length],
    });
  }
}

function parasol(color: string): Group {
  const g = new Group();
  const pole = new Mesh(new CylinderGeometry(0.03, 0.03, 2.3, 8), new MeshLambertMaterial({ color: '#e9e4da' }));
  pole.position.y = 1.15;
  pole.castShadow = true;
  g.add(pole);
  const canopyPieces: Piece[] = [];
  // Eight panels in two colours.
  for (let i = 0; i < 8; i += 1) {
    const cone = new ConeGeometry(1.25, 0.45, 2, 1, true, (i * Math.PI) / 4, Math.PI / 4);
    canopyPieces.push({ geometry: put(cone, 0, 2.2, 0), color: i % 2 === 0 ? color : '#fbf7ef' });
  }
  canopyPieces.push({ geometry: put(new SphereGeometry(0.06, 8, 6), 0, 2.45, 0), color: '#e9e4da' });
  const canopy = merge(canopyPieces, 'canopy');
  canopy.material = canopy.material as never;
  // The canopy is a sheet with no thickness, so it cannot take a shadow
  // without striping itself. It still casts one.
  canopy.receiveShadow = false;
  g.add(canopy);
  return g;
}

/** A simple low-poly tree for the garden outside the fence. */
function treePieces(x: number, z: number, scale: number, pieces: Piece[], leaf: string): void {
  pieces.push({ geometry: put(new CylinderGeometry(0.12 * scale, 0.16 * scale, 1.4 * scale, 6), x, 0.7 * scale, z), color: '#7a5636' });
  pieces.push({ geometry: put(new IcosahedronGeometry(1.0 * scale, 0), x, 1.9 * scale, z), color: leaf });
  pieces.push({ geometry: put(new IcosahedronGeometry(0.7 * scale, 0), x + 0.4 * scale, 2.5 * scale, z - 0.2 * scale), color: leaf });
}

// --- the whole environment ---------------------------------------------------

export function buildEnvironment(world: World): Environment {
  const group = new Group();
  group.name = 'environment';
  const disposables: { dispose(): void }[] = [];

  // --- ground outside the fence
  const grassMaterial = patchCloudShadow(new MeshLambertMaterial({ color: '#8cc56a' }));
  // The garden has a hole where the deck is, or it would cover the pool.
  const lawn = new Shape();
  lawn.moveTo(-110, 110);
  lawn.lineTo(110, 110);
  lawn.lineTo(110, -110);
  lawn.lineTo(-110, -110);
  lawn.lineTo(-110, 110);
  const yard = new Shape();
  yard.moveTo(world.deck.minX, -world.deck.minZ);
  yard.lineTo(world.deck.minX, -world.deck.maxZ);
  yard.lineTo(world.deck.maxX, -world.deck.maxZ);
  yard.lineTo(world.deck.maxX, -world.deck.minZ);
  yard.lineTo(world.deck.minX, -world.deck.minZ);
  lawn.holes.push(yard);
  const grassGeometry = new ShapeGeometry(lawn);
  grassGeometry.rotateX(-Math.PI / 2);
  const grass = new Mesh(grassGeometry, grassMaterial);
  grass.position.y = -0.01;
  grass.receiveShadow = true;
  group.add(grass);
  disposables.push(grass.geometry, grassMaterial);

  // --- the deck
  const deckTexture = tileTexture('#e9dcc4', '#cbbda2', 4, 0.06);
  const deckMaterial = patchCloudShadow(new MeshLambertMaterial({ map: deckTexture }));
  // The loungers, the fence and the rest are pieces: one shared material takes the shadows too.
  patchPiecesShadow();
  const deck = new Mesh(deckGeometry(world), deckMaterial);
  deck.receiveShadow = true;
  group.add(deck);
  disposables.push(deck.geometry, deckMaterial, deckTexture);

  // --- the pool shell: blue tiles, with the light of the waves on them
  const poolTexture = tileTexture('#9fd9ea', '#6fb7cf', 8, 0.05);
  const shellMaterial = patchCaustics(new MeshLambertMaterial({ map: poolTexture }));
  const shell = new Group();
  shell.add(new Mesh(floorGeometry(world), shellMaterial));
  shell.add(new Mesh(longWall(world, world.pool.minZ, 1), shellMaterial));
  shell.add(new Mesh(longWall(world, world.pool.maxZ, -1), shellMaterial));
  shell.add(new Mesh(endWall(world, world.pool.minX, 1), shellMaterial));
  shell.add(new Mesh(endWall(world, world.pool.maxX, -1), shellMaterial));
  shell.traverse((o) => {
    if (o instanceof Mesh) {
      o.receiveShadow = true;
      disposables.push(o.geometry);
    }
  });
  group.add(shell);
  disposables.push(shellMaterial, poolTexture);

  // --- the lane lines on the floor, and the T at each end
  const floorPieces: Piece[] = [];
  for (const lane of world.lanes) {
    const segments = 24;
    const start = world.pool.minX + 1.4;
    const end = world.pool.maxX - 1.4;
    for (let i = 0; i < segments; i += 1) {
      const x0 = start + ((end - start) * i) / segments;
      const x1 = start + ((end - start) * (i + 1)) / segments;
      const y0 = -floorDepthAt(world, x0) + 0.01;
      const y1 = -floorDepthAt(world, x1) + 0.01;
      const len = Math.hypot(x1 - x0, y1 - y0);
      floorPieces.push({
        geometry: put(new BoxGeometry(len, 0.01, 0.22), (x0 + x1) / 2, (y0 + y1) / 2, lane.z, [0, 0, Math.atan2(y1 - y0, x1 - x0)]),
        color: '#1d4f7a',
      });
    }
    for (const x of [start, end]) {
      floorPieces.push({
        geometry: put(new BoxGeometry(0.22, 0.01, 0.9), x, -floorDepthAt(world, x) + 0.012, lane.z),
        color: '#1d4f7a',
      });
    }
  }
  // A drain at the deepest point.
  floorPieces.push({
    geometry: put(new CylinderGeometry(0.28, 0.28, 0.02, 16), world.pool.maxX - 2.2, -world.deepDepth + 0.012, (world.pool.minZ + world.pool.maxZ) / 2),
    color: '#5f7d8c',
  });
  // Weeds and stones at the deep end, swaying is not needed: they are
  // under two metres of moving water.
  for (let i = 0; i < 9; i += 1) {
    const x = world.pool.maxX - 0.4 - (i % 3) * 0.35;
    const z = world.pool.minZ + 0.5 + i * 0.75;
    const y = -floorDepthAt(world, x);
    floorPieces.push({
      geometry: put(new CapsuleGeometry(0.05, 0.35 + (i % 4) * 0.12, 2, 5), x, y + 0.25 + (i % 4) * 0.06, z, [0.15 * Math.sin(i), 0, 0.2 * Math.cos(i * 1.7)]),
      color: i % 2 ? '#3f8f5a' : '#5aa86d',
    });
    if (i % 3 === 0) {
      floorPieces.push({ geometry: put(new DodecahedronGeometry(0.14, 0), x - 0.2, y + 0.06, z + 0.3), color: '#8a9aa3' });
    }
  }
  const floorDetails = merge(floorPieces, 'floor-details');
  floorDetails.castShadow = false;
  group.add(floorDetails);
  disposables.push(floorDetails.geometry);

  // --- the coping round the pool
  const copingPieces: Piece[] = [];
  const { pool } = world;
  const cw = 0.32;
  const ch = 0.08;
  copingPieces.push({ geometry: put(new BoxGeometry(pool.maxX - pool.minX + cw * 2, ch, cw), (pool.minX + pool.maxX) / 2, ch / 2 - 0.01, pool.minZ - cw / 2 + 0.02), color: '#f6f1e6' });
  copingPieces.push({ geometry: put(new BoxGeometry(pool.maxX - pool.minX + cw * 2, ch, cw), (pool.minX + pool.maxX) / 2, ch / 2 - 0.01, pool.maxZ + cw / 2 - 0.02), color: '#f6f1e6' });
  copingPieces.push({ geometry: put(new BoxGeometry(cw, ch, pool.maxZ - pool.minZ), pool.minX - cw / 2 + 0.02, ch / 2 - 0.01, (pool.minZ + pool.maxZ) / 2), color: '#f6f1e6' });
  copingPieces.push({ geometry: put(new BoxGeometry(cw, ch, pool.maxZ - pool.minZ), pool.maxX + cw / 2 - 0.02, ch / 2 - 0.01, (pool.minZ + pool.maxZ) / 2), color: '#f6f1e6' });
  // Depth markers on the coping.
  for (const [x, label] of [[pool.minX + 0.8, 0], [pool.maxX - 0.8, 1]] as const) {
    copingPieces.push({ geometry: put(new BoxGeometry(0.34, 0.012, 0.16), x, ch + 0.0, pool.maxZ + cw / 2), color: label ? '#d64545' : '#2b5f8a' });
  }
  // Starting blocks at the shallow end, one per lane.
  for (const lane of world.lanes) {
    copingPieces.push({ geometry: put(new BoxGeometry(0.5, 0.42, 0.5), pool.minX - 0.3, 0.21, lane.z), color: '#f6f1e6' });
    copingPieces.push({ geometry: put(new BoxGeometry(0.52, 0.04, 0.52), pool.minX - 0.28, 0.43, lane.z, [0, 0, -0.12]), color: lane.index % 2 ? '#2b5f8a' : '#d64545' });
  }
  const coping = merge(copingPieces, 'coping');
  group.add(coping);
  disposables.push(coping.geometry);

  // --- the ladder: two rails that come over the coping and down the wall
  const ladderMaterial = patchUnderwater(new MeshLambertMaterial({ color: '#cfd6dc' }));
  disposables.push(ladderMaterial);
  for (const ladder of world.ladders) {
    const down = ladder.down.z;
    for (const side of [-0.28, 0.28]) {
      const x = ladder.x + side;
      const curve = new CatmullRomCurve3([
        new Vector3(x, 0, ladder.z - down * 0.45),
        new Vector3(x, 0.75, ladder.z - down * 0.32),
        new Vector3(x, 0.85, ladder.z - down * 0.05),
        new Vector3(x, 0.55, ladder.z + down * 0.12),
        new Vector3(x, -0.2, ladder.z + down * 0.14),
        new Vector3(x, -1.5, ladder.z + down * 0.14),
      ]);
      const rail = new Mesh(new TubeGeometry(curve, 40, 0.028, 6, false), ladderMaterial);
      rail.castShadow = true;
      group.add(rail);
      disposables.push(rail.geometry);
    }
    for (let i = 0; i < 4; i += 1) {
      const rung = new Mesh(new BoxGeometry(0.56, 0.035, 0.1), ladderMaterial);
      rung.position.set(ladder.x, -0.15 - i * 0.32, ladder.z + down * 0.1);
      group.add(rung);
      disposables.push(rung.geometry);
    }
  }

  // --- the loungers, merged into one mesh
  const loungerPiecesList: Piece[] = [];
  const towelPiecesList: Piece[] = [];
  for (let i = 0; i < world.loungers.length; i += 1) {
    loungerPieces(world, i, loungerPiecesList, towelPiecesList);
  }
  const loungers = merge(loungerPiecesList, 'loungers');
  group.add(loungers);
  disposables.push(loungers.geometry);
  // The towels are a mesh of their own, because a towel is a sheet with no
  // thickness: a surface that thin cannot take a shadow without striping
  // itself in the low sun of the evening.
  const towels = merge(towelPiecesList, 'towels');
  towels.receiveShadow = false;
  group.add(towels);
  disposables.push(towels.geometry);

  // --- the parasols, each its own group so it can sway
  const parasols: Group[] = [];
  world.parasols.forEach((spot, i) => {
    const p = parasol(i % 2 === 0 ? '#e85d4f' : '#2f8fb8');
    p.position.set(spot.x, 0, spot.z);
    group.add(p);
    parasols.push(p);
  });

  // --- the fence round the deck, with a gap for the gate
  const { deck: area } = world;
  const fencePieces: Piece[] = [];
  const hedgePieces: Piece[] = [];
  // The trees are outside the shadow camera, which covers the deck only;
  // their shadows ended in straight-cut wedges on the grass. They cast none.
  const treePiecesList: Piece[] = [];
  const fenceH = 1.05;
  const gateGap = { from: world.gate.z - 0.7, to: world.gate.z + 0.7 };
  const fenceRun = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const posts = Math.max(1, Math.round(len / 1.6));
    const ang = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i <= posts; i += 1) {
      const t = i / posts;
      fencePieces.push({ geometry: put(new BoxGeometry(0.08, fenceH, 0.08), x0 + (x1 - x0) * t, fenceH / 2, z0 + (z1 - z0) * t), color: '#f4f1ea' });
    }
    for (const y of [0.35, 0.9]) {
      fencePieces.push({ geometry: put(new BoxGeometry(0.05, 0.07, len), (x0 + x1) / 2, y, (z0 + z1) / 2, [0, ang, 0]), color: '#f4f1ea' });
    }
    // Pickets.
    const pickets = Math.round(len / 0.22);
    for (let i = 0; i < pickets; i += 1) {
      const t = (i + 0.5) / pickets;
      fencePieces.push({ geometry: put(new BoxGeometry(0.06, fenceH - 0.12, 0.025), x0 + (x1 - x0) * t, (fenceH - 0.12) / 2, z0 + (z1 - z0) * t, [0, ang + Math.PI / 2, 0]), color: '#fbfaf6' });
    }
  };
  fenceRun(area.minX, area.minZ, area.maxX, area.minZ);
  fenceRun(area.maxX, area.minZ, area.maxX, area.maxZ);
  fenceRun(area.maxX, area.maxZ, area.minX, area.maxZ);
  fenceRun(area.minX, area.maxZ, area.minX, gateGap.to);
  fenceRun(area.minX, gateGap.from, area.minX, area.minZ);
  // The hedge behind the far fence and the far end: rounded bushes in a row.
  const leaf = ['#4f9a4a', '#5aa954', '#468d43'];
  for (let x = area.minX + 0.4; x < area.maxX; x += 0.85) {
    hedgePieces.push({ geometry: put(new IcosahedronGeometry(0.62, 1), x, 0.55, area.minZ - 0.65, [x, x * 0.3, 0], [1, 0.95, 0.8]), color: leaf[Math.abs(Math.round(x * 7)) % 3] });
  }
  for (let z = area.minZ + 0.4; z < area.maxZ; z += 0.85) {
    hedgePieces.push({ geometry: put(new IcosahedronGeometry(0.62, 1), area.maxX + 0.65, 0.55, z, [z, 0, z * 0.2], [0.8, 0.95, 1]), color: leaf[Math.abs(Math.round(z * 7)) % 3] });
  }
  // Trees further off, so the garden has a horizon.
  for (let i = 0; i < 14; i += 1) {
    const a = (i / 14) * Math.PI * 2;
    const r = 26 + (i % 3) * 5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.8;
    treePieces(x, z, 1.3 + (i % 4) * 0.25, treePiecesList, leaf[i % 3]);
  }
  for (let i = 0; i < 6; i += 1) {
    treePieces(area.minX + 2 + i * 4.2, area.minZ - 2.6 - (i % 2) * 0.8, 1.1 + (i % 3) * 0.2, treePiecesList, leaf[(i + 1) % 3]);
  }

  // --- the lantern posts: a thin post each; the lamp heads are one instanced mesh
  for (const p of world.lanterns) {
    fencePieces.push({ geometry: put(new CylinderGeometry(0.03, 0.03, 2.0, 6), p.x, 1.0, p.z), color: '#f4f1ea' });
  }
  // --- the gate and the hut by it
  const gx = area.minX;
  fencePieces.push({ geometry: put(new BoxGeometry(0.14, 1.6, 0.14), gx, 0.8, gateGap.from), color: '#d8cfbf' });
  fencePieces.push({ geometry: put(new BoxGeometry(0.14, 1.6, 0.14), gx, 0.8, gateGap.to), color: '#d8cfbf' });
  fencePieces.push({ geometry: put(new BoxGeometry(0.16, 0.12, gateGap.to - gateGap.from + 0.14), gx, 1.62, world.gate.z), color: '#d8cfbf' });
  // The gate leaf stands open, swung outwards.
  fencePieces.push({ geometry: put(new BoxGeometry(0.04, 0.9, 1.3), gx - 0.65, 0.5, gateGap.to + 0.05, [0, Math.PI / 2 - 0.3, 0]), color: '#f4f1ea' });
  // The hut: walls, a roof, a door and a window.
  // It stands outside the fence on the far side of the gate from the
  // queue, so the queue does not walk into it.
  const hx = gx - 2.4;
  const hz = world.gate.z + 2.7;
  fencePieces.push({ geometry: put(new BoxGeometry(2.4, 2.1, 2.0), hx, 1.05, hz), color: '#f3e3c3' });
  fencePieces.push({ geometry: put(new ConeGeometry(1.95, 0.9, 4), hx, 2.55, hz, [0, Math.PI / 4, 0], [1, 1, 0.85]), color: '#c4553f' });
  fencePieces.push({ geometry: put(new BoxGeometry(0.06, 1.4, 0.7), hx + 1.21, 0.7, hz + 0.4), color: '#7a5636' });
  fencePieces.push({ geometry: put(new BoxGeometry(0.06, 0.6, 0.7), hx + 1.21, 1.35, hz - 0.5), color: '#9fd3f0' });
  // A sign over the gate's hut door.
  fencePieces.push({ geometry: put(new BoxGeometry(0.05, 0.3, 1.0), hx + 1.24, 1.75, hz + 0.0), color: '#2f8fb8' });
  // A lifeguard's chair at the middle of the near side.
  const lx = (pool.minX + pool.maxX) / 2 + 2.5;
  const lz = pool.maxZ + 2.7;
  for (const sx of [-0.3, 0.3]) {
    for (const sz of [-0.3, 0.3]) {
      fencePieces.push({ geometry: put(new BoxGeometry(0.06, 1.6, 0.06), lx + sx, 0.8, lz + sz), color: '#f4f1ea' });
    }
  }
  fencePieces.push({ geometry: put(new BoxGeometry(0.7, 0.06, 0.7), lx, 1.6, lz), color: '#e85d4f' });
  fencePieces.push({ geometry: put(new BoxGeometry(0.7, 0.6, 0.06), lx, 1.9, lz + 0.33), color: '#f4f1ea' });
  // A ring buoy on its post by the ladder.
  fencePieces.push({ geometry: put(new BoxGeometry(0.06, 1.2, 0.06), world.ladders[0].x + 1.6, 0.6, pool.maxZ + 1.2), color: '#e9e4da' });
  fencePieces.push({ geometry: put(new TorusGeometry(0.26, 0.07, 8, 16), world.ladders[0].x + 1.6, 1.0, pool.maxZ + 1.24), color: '#e85d4f' });
  // Potted plants in the corners of the deck.
  for (const [px, pz] of [
    [area.maxX - 0.6, area.maxZ - 0.6],
    [area.maxX - 0.6, area.minZ + 0.6],
    [area.minX + 0.6, area.minZ + 0.6],
  ]) {
    fencePieces.push({ geometry: put(new CylinderGeometry(0.3, 0.22, 0.45, 10), px, 0.225, pz), color: '#c97b4a' });
    hedgePieces.push({ geometry: put(new IcosahedronGeometry(0.42, 1), px, 0.75, pz), color: '#4f9a4a' });
  }

  // --- the flower beds in front of the far hedge: soil, and a row of flowers
  const flowerColours = ['#ff6b8b', '#ffd23f', '#ffffff', '#b58cff'];
  world.flowerBeds.forEach((bed, b) => {
    const len = bed.maxX - bed.minX;
    const cx = (bed.minX + bed.maxX) / 2;
    const cz = (bed.minZ + bed.maxZ) / 2;
    hedgePieces.push({ geometry: put(new BoxGeometry(len, 0.2, bed.maxZ - bed.minZ), cx, 0.1, cz), color: '#7a5636' });
    for (let i = 0; i < 14; i += 1) {
      const x = bed.minX + 0.15 + ((len - 0.3) * i) / 13;
      const z = cz + (i % 2 === 0 ? -0.12 : 0.12);
      hedgePieces.push({ geometry: put(new SphereGeometry(0.07, 6, 5), x, 0.28, z), color: flowerColours[(i + b) % flowerColours.length] });
    }
  });
  // --- the sprinkler on the lawn: a riser and a head, merged with the hedge
  hedgePieces.push({ geometry: put(new CylinderGeometry(0.035, 0.045, 0.22, 8), world.sprinkler.x, 0.11, world.sprinkler.z), color: '#9aa3ab' });
  hedgePieces.push({ geometry: put(new CylinderGeometry(0.06, 0.04, 0.07, 8), world.sprinkler.x, 0.25, world.sprinkler.z), color: '#3c3c3c' });

  const fence = merge(fencePieces, 'fence');
  const hedge = merge(hedgePieces, 'hedge');
  const trees = merge(treePiecesList, 'trees');
  trees.castShadow = false;
  group.add(fence, hedge, trees);
  disposables.push(fence.geometry, hedge.geometry, trees.geometry);

  // --- the lamp heads of the lanterns: one instanced mesh for all six
  const lampGeometry = new BoxGeometry(0.22, 0.16, 0.22);
  const lampMaterial = new MeshBasicMaterial({ color: LAMP_OFF });
  const lamps = new InstancedMesh(lampGeometry, lampMaterial, world.lanterns.length);
  const lampDummy = new Object3D();
  world.lanterns.forEach((p, i) => {
    lampDummy.position.set(p.x, 2.08, p.z);
    lampDummy.updateMatrix();
    lamps.setMatrixAt(i, lampDummy.matrix);
  });
  lamps.castShadow = false;
  group.add(lamps);
  disposables.push(lampGeometry, lampMaterial);
  const lampOff = new Color(LAMP_OFF);
  const lampOn = new Color(LAMP_ON);

  // --- the lane ropes: a row of floats along each line between two lanes
  const ropes: number[] = [];
  for (let i = 1; i < world.lanes.length; i += 1) ropes.push((world.lanes[i - 1].z + world.lanes[i].z) / 2);
  const floatsPerRope = Math.round((pool.maxX - pool.minX) / 0.32);
  const floatGeometry = new SphereGeometry(0.075, 8, 6);
  floatGeometry.scale(1.5, 1, 1);
  const floatMaterial = new MeshLambertMaterial({ color: '#ffffff' });
  const floats = new InstancedMesh(floatGeometry, floatMaterial, Math.max(1, ropes.length * floatsPerRope));
  floats.count = ropes.length * floatsPerRope;
  floats.castShadow = true;
  const ropeColours = [new Color('#d64545'), new Color('#ffffff'), new Color('#2b6cb0')];
  for (let r = 0; r < ropes.length; r += 1) {
    for (let i = 0; i < floatsPerRope; i += 1) {
      // Red at the ends, so a swimmer knows the wall is coming.
      const end = i < 6 || i >= floatsPerRope - 6;
      floats.setColorAt(r * floatsPerRope + i, end ? ropeColours[0] : ropeColours[1 + (Math.floor(i / 3) % 2)]);
    }
  }
  group.add(floats);
  disposables.push(floatGeometry, floatMaterial);

  // --- a toy drifting in the pool
  const toyMaterial = new MeshLambertMaterial({ color: '#ffd23f' });
  const toy = new Mesh(new TorusGeometry(0.34, 0.13, 10, 20), toyMaterial);
  toy.rotation.x = Math.PI / 2;
  toy.castShadow = true;
  group.add(toy);
  disposables.push(toy.geometry, toyMaterial);
  const ball = new Mesh(new SphereGeometry(0.17, 14, 10), new MeshLambertMaterial({ color: '#ff6b6b' }));
  ball.castShadow = true;
  group.add(ball);
  disposables.push(ball.geometry, ball.material as MeshLambertMaterial);

  const dummy = new Object3D();
  const mat = new Matrix4();
  // The colour of the deck before the wet darkens it, and how wet it is now.
  const deckBase = new Color();
  let wetness = 0;

  return {
    group,
    update(time, wet = 0) {
      wetness = wet;
      // The floats ride the same waves as the surface, out of step along
      // the rope.
      for (let r = 0; r < ropes.length; r += 1) {
        for (let i = 0; i < floatsPerRope; i += 1) {
          const x = pool.minX + 0.16 + i * 0.32;
          const y = world.waterY + 0.02 + 0.02 * Math.sin(x * 2.1 + time * 1.3 + r) + 0.012 * Math.sin(x * 4.3 - time * 2.3);
          dummy.position.set(x, y, ropes[r]);
          dummy.rotation.set(0, 0, 0.15 * Math.sin(x * 2.1 + time * 1.3 + r));
          dummy.updateMatrix();
          mat.copy(dummy.matrix);
          floats.setMatrixAt(r * floatsPerRope + i, mat);
        }
      }
      floats.instanceMatrix.needsUpdate = true;

      // The parasols lean in the breeze; the breeze is noise.
      // The breeze, and twice as much of it in the rain.
      const sway = (0.6 + 0.8 * windAt(time)) * (1 + wetness);
      parasols.forEach((p, i) => {
        p.rotation.z = fbm(time * 0.21, 900 + i) * 0.035 * sway;
        p.rotation.x = fbm(time * 0.17, 950 + i) * 0.03 * sway;
      });

      // The toy drifts round the middle of the pool, and the ball at the deep end.
      // The toy is in the middle third now: the flamingo has the shallow end.
      const tx = fbm(time * 0.02, 31) * 2.2;
      const tz = pool.minZ + 0.9 + (fbm(time * 0.017, 37) * 0.5 + 0.5) * 0.4;
      toy.position.set(tx, world.waterY + 0.03 + 0.02 * Math.sin(time * 1.4), tz);
      toy.rotation.z = time * 0.05;
      ball.position.set(
        pool.maxX - 2.0 + fbm(time * 0.025, 41) * 1.2,
        world.waterY + 0.08 + 0.02 * Math.sin(time * 1.7 + 1),
        pool.minZ + 0.7 + (fbm(time * 0.02, 43) * 0.5 + 0.5) * 0.3,
      );
    },
    setPalette(deckColour, copingColour, grassColour, tree) {
      deckBase.set(deckColour).lerp(new Color('#ffffff'), 0.55);
      deckMaterial.color.copy(deckBase).multiplyScalar(1 - WET_DARKEN * wetness);
      void copingColour;
      grassMaterial.color.set(grassColour);
      void tree;
    },
    setNight(night) {
      lampMaterial.color.copy(lampOff).lerp(lampOn, Math.min(1, Math.max(0, night)));
    },
    setWetness(wet) {
      wetness = Math.min(1, Math.max(0, wet));
      deckMaterial.color.copy(deckBase).multiplyScalar(1 - WET_DARKEN * wetness);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.traverse((o) => {
        if (o instanceof Mesh && o.name === 'canopy') o.geometry.dispose();
      });
    },
  };
}
