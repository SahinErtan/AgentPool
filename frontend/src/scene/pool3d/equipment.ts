/**
 * The new equipment of the pool: a water slide, a diving board, a hot tub, a
 * self-service kiosk, a ping-pong table, a shower, two fountains, a flamingo
 * float and a line of backstroke flags.
 *
 * What stands still is merged into one mesh (`equipment-static`), so the whole
 * terrace costs a few draw calls. What moves has a mesh of its own: the plank
 * of the board, the water in the chute and in the hot tub, the flags and the
 * flamingo. The places people use are in `world.equipment`; this only draws
 * them and makes the water and the flags move.
 */

import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Curve,
} from 'three';
import { fbm } from '../characters/noise';
import { merge, put, troughGeometry, type Piece } from './build';
import type { Particles } from './effects3d';
import type { Water } from './water';
import type { World } from './world';

export interface EquipmentView {
  group: Group;
  update(time: number, dt: number): void;
  /** The board's bend, in radians about z; 0 at rest, positive tips the end down. */
  setBoardFlex(angle: number): void;
  /** Where the beach ball is, on the court; the scene moves it in a game. */
  beachBall: Mesh;
  /** The ping-pong ball, shown only while a rally is on. */
  pingBall: Mesh;
  /** Show the ping-pong ball (at its place, set by the scene) or hide it. */
  setPingBallVisible(visible: boolean): void;
  /** Show or hide the paddles that lie on the table. */
  setTablePaddles(visible: boolean): void;
  /** How many people are in the hot tub: more of them, more bubbles. */
  setTubOccupancy(n: number): void;
  /** Where the flamingo is, for anything that must avoid it. */
  flamingo: Object3D;
  /** 0 day .. 1 night. A no-op until the night pass (Sprint 26). */
  setNight(amount: number): void;
  /** Calm water: the fountains stay off. */
  setCalm(calm: boolean): void;
  /** Run the fountains for their forty seconds now, whatever the cycle says (a busy pool). */
  startFountains(time: number): void;
  /** A click on the flamingo or the ball: it bobs and turns for 0.8 s. */
  nudge(what: 'flamingo' | 'ball', time: number): void;
  dispose(): void;
}

const WHITE = '#f4f1ea';
const BLUE = '#2f8fb8';
const RED = '#e85d4f';
const YELLOW = '#ffd23f';
/** The beach ball's stripes, in the order they go round it. */
const BALL_COLOURS = [new Color(RED), new Color(WHITE), new Color(BLUE), new Color(YELLOW), new Color(RED), new Color(WHITE)];
/** The beach ball's radius, in metres. */
const BALL_RADIUS = 0.25;
/** How long a click keeps the flamingo or the ball moving, in seconds. */
const NUDGE_S = 0.8;

/** How far a click's impulse has got, 0 to 1, or -1 when it is over (or never came). */
function nudgeProgress(started: number, time: number): number {
  if (started < 0) return -1;
  const k = (time - started) / NUDGE_S;
  return k < 1 ? Math.max(0, k) : -1;
}

/** The number of backstroke flags on each line. */
const FLAGS_PER_LINE = 14;
/** How many drops a fountain throws each second, and how fast. */
const DROPS_PER_SECOND = 20;
const DROP_SPEED = 2.4;
const DROP_ANGLE = (50 * Math.PI) / 180;
/** The fountains run for this long, out of every this many seconds. */
const FOUNTAIN_PERIOD = 120;
const FOUNTAIN_ON = 40;
const GRAVITY = 9.8;

// --- the shaders -----------------------------------------------------------

const CHUTE_VERT = /* glsl */ `
varying float vU;
void main() {
  vU = uv.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The water in the chute runs down it in pale stripes. */
const CHUTE_FRAG = /* glsl */ `
uniform float uTime;
varying float vU;
void main() {
  float s = fract(vU * 12.0 - uTime * 1.6);
  vec3 base = vec3(0.56, 0.84, 0.94);
  vec3 stripe = vec3(0.95, 0.99, 1.0);
  vec3 colour = mix(base, stripe, smoothstep(0.55, 0.7, s));
  gl_FragColor = vec4(colour, 0.55);
  #include <colorspace_fragment>
}
`;

const TUB_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The hot tub's water: its colours, and bubbles rising in a cell pattern. */
const TUB_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
varying vec2 vUv;
void main() {
  vec2 g = vUv * 10.0;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float seed = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
  float phase = fract(uTime * (0.25 + seed * 0.35) + seed);
  float rad = mix(0.12, 0.02, phase);
  vec2 centre = vec2((seed - 0.5) * 0.4, phase - 0.5);
  float bubble = smoothstep(rad, rad * 0.5, length(f - centre)) * (1.0 - phase) * step(0.5, seed);
  vec3 colour = mix(uDeep, uShallow, 0.5 + 0.5 * vUv.y) + vec3(bubble) * 0.45;
  gl_FragColor = vec4(colour, 0.78);
  #include <colorspace_fragment>
}
`;

/** A pennant: a triangle in the plane of the line, hanging from it. */
function pennantGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-0.15, 0, 0, 0.15, 0, 0, 0, -0.3, 0], 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The stairs of the slide tower, from the foot to the platform.
 *
 * The run is the distance from the foot to where the stairs meet the platform,
 * and the steps share it evenly.
 */
function slideStairs(foot: { z: number }, top: { z: number }, x: number, rise: number, pieces: Piece[]): void {
  const run = foot.z - top.z;
  const steps = 9;
  const tread = run / steps;
  for (let i = 0; i < steps; i += 1) {
    const z = foot.z - tread * (i + 0.5);
    const y = (rise * (i + 1)) / steps;
    pieces.push({ geometry: put(new BoxGeometry(1.0, 0.06, tread), x, y - 0.03, z), color: BLUE });
    pieces.push({ geometry: put(new BoxGeometry(0.06, y, tread), x - 0.47, y / 2, z), color: WHITE });
    pieces.push({ geometry: put(new BoxGeometry(0.06, y, tread), x + 0.47, y / 2, z), color: WHITE });
  }
  // A hand rail on each side, along the slope of the stairs.
  const length = Math.hypot(run, rise);
  const tilt = -Math.atan2(run, rise);
  for (const side of [-0.5, 0.5]) {
    pieces.push({
      geometry: put(new BoxGeometry(0.04, length, 0.04), x + side, rise / 2 + 0.9, (foot.z + top.z) / 2, [tilt, 0, 0]),
      color: WHITE,
    });
  }
}

/** A lip along each edge of the chute: a thin tube at the rim of the trough. */
function chuteLip(curve: Curve<Vector3>, side: number, pieces: Piece[], rimColour: string): void {
  const up = new Vector3(0, 1, 0);
  const tangent = new Vector3();
  const points: Vector3[] = [];
  const samples = 120;
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const p = curve.getPointAt(t);
    curve.getTangentAt(t, tangent);
    const across = new Vector3().crossVectors(tangent, up).normalize();
    // The rim of the trough, at the angle the trough stops at.
    points.push(new Vector3(p.x + across.x * 0.39 * side, p.y - 0.155, p.z + across.z * 0.39 * side));
  }
  const lip = new CatmullRomCurve3(points);
  pieces.push({ geometry: new TubeGeometry(lip, 120, 0.035, 6, false), color: rimColour });
}

/** The fountain in the water at the shallow end: drops thrown from the nozzle. */
interface Nozzle {
  x: number;
  y: number;
  z: number;
  /** The way the drops go, along x: towards the middle of the pool. */
  dirX: number;
  /** The way they go across the pool, to spread them out. */
  dirZ: number;
  /** Drops still owed, as a fraction. */
  owed: number;
}

export function buildEquipment(world: World, particles: Particles, water: Water): EquipmentView {
  const group = new Group();
  group.name = 'equipment';
  const disposables: { dispose(): void }[] = [];
  const e = world.equipment;
  const { pool } = world;
  const pieces: Piece[] = [];

  // --- the slide: a tower, stairs and a chute round the corner
  const tower = e.slide.tower;
  for (const dx of [-0.7, 0.7]) {
    for (const dz of [-0.7, 0.7]) {
      pieces.push({ geometry: put(new BoxGeometry(0.12, 2.8, 0.12), tower.x + dx, 1.4, tower.z + dz), color: WHITE });
    }
  }
  pieces.push({ geometry: put(new BoxGeometry(1.6, 0.1, 1.6), tower.x, 2.75, tower.z), color: RED });
  // Rails on the three sides that have no stairs: a top rail and pickets.
  const rails: [number, number, number, number][] = [
    [tower.x, tower.z - 0.8, 1.6, 0],
    [tower.x - 0.8, tower.z, 0, 1.6],
    [tower.x + 0.8, tower.z, 0, 1.6],
  ];
  for (const [x, z, w, d] of rails) {
    pieces.push({ geometry: put(new BoxGeometry(w || 0.05, 0.05, d || 0.05), x, 3.6, z), color: WHITE });
    for (let k = 0; k < 8; k += 1) {
      const along = -0.7 + k * 0.2;
      const px = w ? tower.x + along : x;
      const pz = d ? tower.z + along : z;
      pieces.push({ geometry: put(new BoxGeometry(0.03, 0.8, 0.03), px, 3.2, pz), color: WHITE });
    }
  }
  slideStairs(e.slide.stairsFoot, e.slide.stairsTop, tower.x, e.slide.stairsTop.y, pieces);

  const chute = new CatmullRomCurve3(e.slide.path.map((p) => new Vector3(p.x, p.y, p.z)));
  pieces.push({ geometry: troughGeometry(chute, 120, 0.42), color: YELLOW });
  chuteLip(chute, -1, pieces, '#f6b93b');
  chuteLip(chute, 1, pieces, '#f6b93b');
  // Posts under the chute, every 1.6 m, where it is high enough to need them.
  const length = chute.getLength();
  for (let s = 0.8; s < length; s += 1.6) {
    const p = chute.getPointAt(s / length);
    if (p.y < 0.4) continue;
    const h = p.y - 0.42;
    pieces.push({ geometry: put(new CylinderGeometry(0.05, 0.05, h, 6), p.x, h / 2, p.z), color: WHITE });
  }
  // The water in the chute: the bottom of a second, thinner trough.
  const chuteWater = troughGeometry(chute, 120, 0.4, Math.PI * 0.38, Math.PI * 0.62);
  const chuteMaterial = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: CHUTE_VERT,
    fragmentShader: CHUTE_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const chuteMesh = new Mesh(chuteWater, chuteMaterial);
  chuteMesh.name = 'chute-water';
  group.add(chuteMesh);
  disposables.push(chuteWater, chuteMaterial);

  // --- the diving board: a block, and a plank on a pivot
  const block = e.board.block;
  pieces.push({ geometry: put(new BoxGeometry(0.6, 0.55, 0.7), block.x, 0.275, block.z), color: WHITE });
  pieces.push({ geometry: put(new BoxGeometry(0.62, 0.1, 0.72), block.x, 0.05, block.z), color: BLUE });
  // The pivot is at the front edge of the block, and the plank reaches out to
  // the tip over the water. The plank ends where the tip is, not where the
  // plan's 2.6 m would put it.
  const pivot = new Group();
  pivot.name = 'board-pivot';
  pivot.position.set(block.x - 0.3, e.board.height, block.z);
  const plankLength = pivot.position.x - e.board.tip.x;
  const plank = merge(
    [
      { geometry: put(new BoxGeometry(plankLength, 0.06, 0.5), -plankLength / 2, 0, 0), color: WHITE },
      { geometry: put(new BoxGeometry(plankLength, 0.012, 0.16), -plankLength / 2, 0.036, 0), color: BLUE },
    ],
    'board-plank',
  );
  pivot.add(plank);
  group.add(pivot);
  disposables.push(plank.geometry);

  // --- the hot tub: a round rim, the water and bubbles coming up in it
  const tub = e.hotTub;
  const r = tub.radius;
  pieces.push({ geometry: put(new CylinderGeometry(r, r, tub.rim, 32, 1, true), tub.centre.x, tub.rim / 2, tub.centre.z), color: WHITE });
  pieces.push({ geometry: put(new RingGeometry(r - 0.12, r + 0.04, 32), tub.centre.x, tub.rim, tub.centre.z, [-Math.PI / 2, 0, 0]), color: WHITE });
  pieces.push({ geometry: put(new CircleGeometry(r - 0.1, 32), tub.centre.x, 0.02, tub.centre.z, [-Math.PI / 2, 0, 0]), color: '#bfe9f5' });
  for (const seat of tub.seats) {
    pieces.push({ geometry: put(new BoxGeometry(0.36, 0.2, 0.36), seat.x, 0.1, seat.z), color: '#bfe9f5' });
  }
  const tubWater = put(new CircleGeometry(r - 0.1, 32), tub.centre.x, 0.42, tub.centre.z, [-Math.PI / 2, 0, 0]);
  const tubMaterial = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new Color('#57c6e0') },
      uDeep: { value: new Color('#1f6f9f') },
    },
    vertexShader: TUB_VERT,
    fragmentShader: TUB_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const tubMesh = new Mesh(tubWater, tubMaterial);
  tubMesh.name = 'hot-tub-water';
  group.add(tubMesh);
  disposables.push(tubWater, tubMaterial);

  // --- the kiosk: a counter, a fridge, a freezer, an awning and a sign
  const k = e.kiosk.centre;
  const front = k.z - 0.5;
  pieces.push({ geometry: put(new BoxGeometry(1.8, 0.12, 1.0), k.x, 0.06, k.z), color: BLUE });
  pieces.push({ geometry: put(new BoxGeometry(1.8, 0.9, 1.0), k.x, 0.57, k.z), color: WHITE });
  pieces.push({ geometry: put(new BoxGeometry(0.55, 1.2, 0.5), k.x - 0.5, 0.72, k.z), color: '#3d4a52' });
  pieces.push({ geometry: put(new BoxGeometry(0.5, 0.8, 0.02), k.x - 0.5, 0.75, front - 0.02), color: '#9fd3f0' });
  pieces.push({ geometry: put(new BoxGeometry(0.7, 0.45, 0.5), k.x + 0.45, 1.245, k.z), color: '#e9f4f8' });
  pieces.push({ geometry: put(new BoxGeometry(0.72, 0.05, 0.52), k.x + 0.45, 1.5, k.z), color: '#cfe6ef' });
  for (const dx of [-0.85, 0.85]) {
    pieces.push({ geometry: put(new BoxGeometry(0.06, 2.45, 0.06), k.x + dx, 1.225, k.z - 0.6), color: WHITE });
  }
  // The awning: six stripes, red and white, sloping down towards the customer.
  for (let i = 0; i < 6; i += 1) {
    pieces.push({
      geometry: put(new BoxGeometry(0.3, 0.04, 0.7), k.x - 0.75 + i * 0.3, 1.95, k.z - 0.6 - 0.35, [-0.12, 0, 0]),
      color: i % 2 === 0 ? RED : WHITE,
    });
  }
  pieces.push({ geometry: put(new BoxGeometry(1.7, 0.3, 0.05), k.x, 2.3, k.z - 0.6), color: BLUE });
  pieces.push({ geometry: put(new BoxGeometry(1.5, 0.05, 0.06), k.x, 2.3, k.z - 0.61), color: WHITE });

  // --- the ping-pong table, with its net and two paddles
  const t = e.pingPong.centre;
  const tableColour = '#2b6cb0';
  pieces.push({ geometry: put(new BoxGeometry(1.525, 0.04, 2.74), t.x, 0.76, t.z), color: tableColour });
  for (const sx of [-0.7625, 0.7625]) {
    pieces.push({ geometry: put(new BoxGeometry(0.02, 0.005, 2.74), t.x + sx, 0.781, t.z), color: WHITE });
  }
  for (const sz of [-1.37, 1.37]) {
    pieces.push({ geometry: put(new BoxGeometry(1.525, 0.005, 0.02), t.x, 0.781, t.z + sz), color: WHITE });
  }
  pieces.push({ geometry: put(new BoxGeometry(0.02, 0.005, 2.74), t.x, 0.781, t.z), color: WHITE });
  for (const sx of [-0.65, 0.65]) {
    for (const sz of [-1.25, 1.25]) {
      pieces.push({ geometry: put(new BoxGeometry(0.05, 0.74, 0.05), t.x + sx, 0.37, t.z + sz), color: '#4a4a4a' });
    }
  }
  pieces.push({ geometry: put(new BoxGeometry(1.7, 0.15, 0.01), t.x, 0.835, t.z), color: WHITE });
  // The two paddles that lie on the table. They are a mesh of their own, so
  // they can be hidden while the players have them in their hands.
  const paddles: [string, number][] = [
    [RED, -1.0],
    ['#222222', 1.0],
  ];
  const paddlePieces: Piece[] = [];
  for (const [colour, dz] of paddles) {
    const px = t.x - 0.3;
    const pz = t.z + dz * 0.9;
    paddlePieces.push({ geometry: put(new CylinderGeometry(0.08, 0.08, 0.012, 12), px, 0.775, pz), color: colour });
    paddlePieces.push({ geometry: put(new CylinderGeometry(0.02, 0.02, 0.1, 6), px + 0.12, 0.78, pz, [0, 0, Math.PI / 2]), color: colour });
  }
  const tablePaddles = merge(paddlePieces, 'table-paddles');
  group.add(tablePaddles);
  disposables.push(tablePaddles.geometry);

  // --- the shower: a post with an arm and a head, over a tray on the deck
  const sh = e.shower;
  pieces.push({ geometry: put(new CylinderGeometry(0.05, 0.05, 2.2, 8), sh.post.x, 1.1, sh.post.z), color: '#cfd6dc' });
  pieces.push({ geometry: put(new BoxGeometry(0.65, 0.04, 0.04), sh.post.x + 0.325, 2.15, sh.post.z), color: '#cfd6dc' });
  pieces.push({ geometry: put(new CylinderGeometry(0.12, 0.12, 0.04, 12), sh.head.x, sh.head.y - 0.03, sh.head.z), color: '#cfd6dc' });
  pieces.push({ geometry: put(new BoxGeometry(0.04, 0.4, 0.04), sh.post.x - 0.12, 1.1, sh.post.z), color: RED });
  pieces.push({ geometry: put(new BoxGeometry(1.0, 0.04, 1.0), sh.stand.x, 0.02, sh.stand.z), color: '#d8ccb4' });

  // --- the fountains' nozzles on the coping
  for (const f of e.fountains) {
    pieces.push({ geometry: put(new CylinderGeometry(0.05, 0.05, 0.12, 8), f.x, 0.06, f.z), color: '#cfd6dc' });
  }

  // --- the backstroke flags: posts at the ends, and a line of pennants
  const lineLength = pool.maxZ - pool.minZ + 0.6;
  const lineMidZ = (pool.minZ + pool.maxZ) / 2;
  const lineXs = [pool.minX + 5, pool.maxX - 5];
  for (const x of lineXs) {
    for (const z of [pool.minZ - 0.3, pool.maxZ + 0.3]) {
      pieces.push({ geometry: put(new CylinderGeometry(0.03, 0.03, 1.9, 6), x, 0.95, z), color: WHITE });
    }
    pieces.push({ geometry: put(new BoxGeometry(0.02, 0.02, lineLength), x, 1.8, lineMidZ), color: WHITE });
  }
  const pennants = new InstancedMesh(
    pennantGeometry(),
    new MeshLambertMaterial({ side: DoubleSide }),
    FLAGS_PER_LINE * lineXs.length,
  );
  pennants.name = 'backstroke-flags';
  const flagColours = [new Color(RED), new Color('#ffffff'), new Color(BLUE)];
  const flagSpots: { x: number; z: number }[] = [];
  for (const x of lineXs) {
    for (let i = 0; i < FLAGS_PER_LINE; i += 1) {
      const z = pool.minZ - 0.3 + ((i + 0.5) * lineLength) / FLAGS_PER_LINE;
      flagSpots.push({ x, z });
    }
  }
  flagSpots.forEach((_, i) => pennants.setColorAt(i, flagColours[i % flagColours.length]));
  group.add(pennants);
  disposables.push(pennants.geometry, pennants.material as MeshLambertMaterial);

  // --- the flamingo float: a ring, a neck, a head and a beak in one mesh
  const flamingo = new Group();
  flamingo.name = 'flamingo';
  const flamingoPieces: Piece[] = [
    { geometry: put(new TorusGeometry(0.42, 0.1, 10, 24), 0, 0.04, 0, [Math.PI / 2, 0, 0]), color: '#ff8fb0' },
    { geometry: put(new CapsuleGeometry(0.05, 0.3, 3, 6), 0.12, 0.35, 0, [0, 0, -0.25]), color: '#ff8fb0' },
    { geometry: put(new CapsuleGeometry(0.05, 0.2, 3, 6), 0.3, 0.6, 0, [0, 0, -0.5]), color: '#ff8fb0' },
    { geometry: put(new SphereGeometry(0.1, 10, 8), 0.36, 0.72, 0), color: '#ff8fb0' },
    { geometry: put(new BoxGeometry(0.22, 0.05, 0.05), 0.46, 0.68, 0, [0, 0, -0.2]), color: '#ffb07a' },
  ];
  const flamingoMesh = merge(flamingoPieces, 'flamingo-body');
  flamingoMesh.castShadow = true;
  flamingo.add(flamingoMesh);
  group.add(flamingo);
  disposables.push(flamingoMesh.geometry);

  // --- the beach ball: a striped ball, lying in the middle of the court
  const ballGeometry = new SphereGeometry(BALL_RADIUS, 16, 12);
  const ballColours: number[] = [];
  const position = ballGeometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const angle = Math.atan2(position.getZ(i), position.getX(i));
    const stripe = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * BALL_COLOURS.length) % BALL_COLOURS.length;
    const c = BALL_COLOURS[stripe];
    ballColours.push(c.r, c.g, c.b);
  }
  ballGeometry.setAttribute('color', new Float32BufferAttribute(ballColours, 3));
  const beachBall = new Mesh(ballGeometry, new MeshLambertMaterial({ vertexColors: true }));
  beachBall.name = 'beach-ball';
  beachBall.castShadow = true;
  const court = world.equipment.ballCourt.centre;
  beachBall.position.set(court.x, BALL_RADIUS, court.z);
  group.add(beachBall);
  disposables.push(ballGeometry, beachBall.material as MeshLambertMaterial);

  // --- the ping-pong ball: a small white ball, shown only in a rally
  const pingGeometry = new SphereGeometry(0.02, 8, 6);
  const pingBall = new Mesh(pingGeometry, new MeshLambertMaterial({ color: '#ffffff' }));
  pingBall.name = 'ping-pong-ball';
  pingBall.visible = false;
  group.add(pingBall);
  disposables.push(pingGeometry, pingBall.material as MeshLambertMaterial);

  // --- the static parts, in one mesh
  const statics = merge(pieces, 'equipment-static');
  group.add(statics);
  disposables.push(statics.geometry);

  // The shallow third of the pool, where the flamingo drifts, and the walls
  // it keeps from.
  const shallowEnd = pool.minX + (pool.maxX - pool.minX) / 3;
  const drift = {
    xMin: pool.minX + 1,
    xMax: shallowEnd - 0.5,
    zMin: pool.minZ + 1,
    zMax: pool.maxZ - 1,
  };

  // The nozzles throw towards the middle of the pool.
  const nozzles: Nozzle[] = e.fountains.map((f) => ({
    x: f.x,
    y: f.y,
    z: f.z,
    dirX: f.x < (pool.minX + pool.maxX) / 2 ? 1 : -1,
    dirZ: f.z < 0 ? 1 : -1,
    owed: 0,
  }));
  // A drop leaves the nozzle at DROP_SPEED and lands in the water a little
  // further on: where the ripples are made.
  const vy = DROP_SPEED * Math.sin(DROP_ANGLE);
  const vx = DROP_SPEED * Math.cos(DROP_ANGLE);
  const nozzleY = e.fountains[0].y;
  const landT = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * (nozzleY - world.waterY))) / GRAVITY;

  // The bubbles of the hot tub: a few at a time, at random points under the
  // water, and the random numbers come from a counter so they repeat. More
  // people in the tub, more bubbles.
  let occupancy = 0;
  let bubbleClock = 0;
  let bubbleCount = 0;
  let rippleClock = 0;
  let sprayFrame = 0;
  const tmpMatrix = new Matrix4();
  const dummy = new Object3D();

  // The fountains are off while the pool is calm (step 26.7), and run for
  // a while when the pool is busy (step 27.2).
  let calmed = false;
  let forcedUntil = -1;
  // The impulse a click gives the flamingo or the ball: when it started, or -1.
  const nudgedAt = { flamingo: -1, ball: -1 };
  return {
    group,
    update(time, dt) {
      chuteMaterial.uniforms.uTime.value = time;
      tubMaterial.uniforms.uTime.value = time;

      // The hot tub: bubbles every third of a second.
      bubbleClock += dt;
      if (bubbleClock >= 0.3) {
        bubbleClock = 0;
        for (let n = 0; n < 2 + 2 * occupancy; n += 1) {
          bubbleCount += 1;
          const a = unit(bubbleCount * 2.1) * Math.PI * 2;
          const rr = Math.sqrt(unit(bubbleCount * 3.7)) * (tub.radius - 0.25);
          particles.bubbles(
            tub.centre.x + Math.cos(a) * rr,
            0.12 + unit(bubbleCount * 5.3) * 0.25,
            tub.centre.z + Math.sin(a) * rr,
            1,
            0.42,
          );
        }
      }

      // The fountains run for forty seconds out of every hundred and twenty.
      const running = !calmed && (time < forcedUntil || time % FOUNTAIN_PERIOD < FOUNTAIN_ON);
      rippleClock += dt;
      for (const nozzle of nozzles) {
        if (!running) {
          nozzle.owed = 0;
          continue;
        }
        nozzle.owed += dt * DROPS_PER_SECOND;
        while (nozzle.owed >= 1) {
          nozzle.owed -= 1;
          sprayFrame += 1;
          const spread = (unit(sprayFrame * 1.7) - 0.5) * 0.3;
          particles.arc(nozzle.x, nozzle.y, nozzle.z, nozzle.dirX * vx, vy, nozzle.dirZ * spread);
        }
      }
      if (running && rippleClock >= 0.5) {
        rippleClock = 0;
        for (const nozzle of nozzles) {
          water.ripple(nozzle.x + nozzle.dirX * vx * landT, nozzle.z, 0.2);
        }
      }

      // The backstroke flags sway in the breeze, each on its own noise.
      for (let i = 0; i < flagSpots.length; i += 1) {
        const spot = flagSpots[i];
        dummy.position.set(spot.x, 1.8, spot.z);
        dummy.rotation.set(0.15 * fbm(time * 0.6, 1200 + i), 0, 0);
        dummy.updateMatrix();
        tmpMatrix.copy(dummy.matrix);
        pennants.setMatrixAt(i, tmpMatrix);
      }
      pennants.instanceMatrix.needsUpdate = true;

      // The flamingo drifts about the shallow third, on the same slow noise
      // as the toy did.
      const fx = fbm(time * 0.02, 61);
      const fz = fbm(time * 0.017, 67);
      flamingo.position.set(
        clamp(-5.4 + fx * 2.2, drift.xMin, drift.xMax),
        world.waterY + 0.02 + 0.02 * Math.sin(time * 1.1),
        clamp(fz * 3.2, drift.zMin, drift.zMax),
      );
      flamingo.rotation.y = fbm(time * 0.03, 71) * 0.6;

      // A click sets the flamingo and the ball bobbing and turning for a
      // moment. The ball's place is set by the scene each frame, so the bob
      // is added to it, not kept.
      const k = nudgeProgress(nudgedAt.flamingo, time);
      if (k >= 0) {
        flamingo.rotation.y += k * Math.PI * 2;
        flamingo.position.y += Math.sin(k * Math.PI) * 0.18;
      } else {
        nudgedAt.flamingo = -1;
      }
      const b = nudgeProgress(nudgedAt.ball, time);
      if (b >= 0) {
        beachBall.rotation.y = b * Math.PI * 2;
        beachBall.position.y += Math.sin(b * Math.PI) * 0.3;
      } else {
        nudgedAt.ball = -1;
      }
    },
    setBoardFlex(angle) {
      pivot.rotation.z = angle;
    },
    beachBall,
    pingBall,
    setPingBallVisible(visible) {
      pingBall.visible = visible;
    },
    setTablePaddles(visible) {
      tablePaddles.visible = visible;
    },
    setTubOccupancy(n) {
      occupancy = Math.max(0, Math.min(4, n));
    },
    flamingo,
    setCalm(on) {
      calmed = on;
    },
    startFountains(time) {
      forcedUntil = time + FOUNTAIN_ON;
    },
    nudge(what, time) {
      nudgedAt[what] = time;
    },
    setNight() {
      // Nothing is lit at night yet: the night pass (Sprint 26) will use it.
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.traverse((o) => {
        if (o instanceof Mesh && o.name === 'flamingo-body') o.geometry.dispose();
      });
    },
  };
}

/** A repeatable number in [0, 1) from a seed. */
function unit(seed: number): number {
  const v = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
