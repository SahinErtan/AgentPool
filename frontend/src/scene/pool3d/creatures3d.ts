/**
 * The creatures, drawn: a cat, a duck, two birds and two butterflies.
 *
 * `creatures.ts` decides where they are and what they do; this file only
 * shows it. Each animal is a few merged pieces with vertex colours, in the
 * same toon material as the loungers, so it sits in the scene with the rest
 * of it. The legs, the birds and the butterflies are instanced, so the four
 * kinds cost a handful of draw calls between them. A kind that is not on the
 * screen is hidden, and a hidden mesh costs no draw call at all.
 *
 * Only the cat's body casts a shadow: a shadow pass is a draw call too.
 */

import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { merge, piecesMaterial, put } from './build';
import type { Creature } from './creatures';

export interface Creatures3D {
  group: Group;
  /** Show the creatures as they are now. Reuses its objects, so a frame does not allocate. */
  update(creatures: readonly Creature[], time: number): void;
  dispose(): void;
}

/** The height of the cat's hips above the deck: its body turns about this point. */
const HIP_Y = 0.22;
const GINGER = '#e08a3c';
const WHITE = '#fff6ea';
const DUCK_WHITE = '#f4f1ea';
const DUCK_HEAD = '#3a8a52';
const DUCK_BEAK = '#f2a33a';
const DUCK_WING = '#8d7b68';
const BIRD_GREY = '#3a3f47';
const BUTTERFLY_YELLOW = '#ffd23f';
const BUTTERFLY_BLUE = '#2f8fb8';

/** The hips of the cat's four legs, in its own coordinates: front left, front right, back left, back right. */
const HIPS: readonly [number, number, number][] = [
  [0.07, HIP_Y, 0.14],
  [-0.07, HIP_Y, 0.14],
  [0.07, HIP_Y, -0.14],
  [-0.07, HIP_Y, -0.14],
];

/** One scratch object: the frame writes instance matrices through it, and allocates nothing. */
const dummy = new Object3D();

// --- the cat -------------------------------------------------------------------

/** The cat's body, with its head, ears and muzzle, in coordinates about the hips. */
function catBody(): Mesh {
  const dy = -HIP_Y;
  return merge(
    [
      // The torso: a capsule that lies along the cat.
      { geometry: put(new CapsuleGeometry(0.1, 0.24, 4, 8), 0, 0.26 + dy, 0, [Math.PI / 2, 0, 0]), color: GINGER },
      // The head, the two ears and the white muzzle.
      { geometry: put(new SphereGeometry(0.095, 10, 8), 0, 0.36 + dy, 0.25), color: GINGER },
      { geometry: put(new ConeGeometry(0.035, 0.07, 4), -0.05, 0.45 + dy, 0.25), color: GINGER },
      { geometry: put(new ConeGeometry(0.035, 0.07, 4), 0.05, 0.45 + dy, 0.25), color: GINGER },
      { geometry: put(new SphereGeometry(0.035, 6, 5), 0, 0.33 + dy, 0.33), color: WHITE },
      // The white chest.
      { geometry: put(new SphereGeometry(0.06, 8, 6), 0, 0.2 + dy, 0.2), color: WHITE },
    ],
    'cat-body',
  );
}

/** The tail, with its pivot at its root, in the tail's own coordinates. The tip is white. */
function catTail(): Mesh {
  return merge(
    [
      { geometry: put(new CapsuleGeometry(0.03, 0.12, 3, 6), 0, 0, -0.08, [Math.PI / 2, 0, 0]), color: GINGER },
      { geometry: put(new CapsuleGeometry(0.028, 0.12, 3, 6), 0, 0.02, -0.2, [Math.PI / 2, 0, 0]), color: GINGER },
      { geometry: put(new CapsuleGeometry(0.026, 0.1, 3, 6), 0, 0.05, -0.3, [Math.PI / 2, 0, 0]), color: WHITE },
    ],
    'cat-tail',
  );
}

/** One leg with its white paw, hanging from the hip at the origin. */
function catLeg(): BufferGeometry {
  return merge(
    [
      { geometry: put(new CapsuleGeometry(0.03, 0.12, 3, 6), 0, -0.1, 0), color: GINGER },
      { geometry: put(new SphereGeometry(0.036, 6, 5), 0, -0.2, 0.01), color: WHITE },
    ],
    'cat-leg',
  ).geometry;
}

interface CatRig {
  root: Group;
  body: Group;
  tail: Group;
  legs: InstancedMesh;
  /** Where the cat was last frame, to tell a walk from a stand. */
  lastX: number;
  lastZ: number;
  /** 0 standing, 1 walking, eased so the legs wind down rather than stop. */
  walk: number;
}

function buildCat(group: Group): CatRig {
  const root = new Group();
  root.name = 'cat';
  root.visible = false;
  const body = new Group();
  body.position.set(0, HIP_Y, 0);
  root.add(body);
  const bodyMesh = catBody();
  // A shadow for the cat: its body only, since a shadow is a draw call.
  bodyMesh.castShadow = true;
  body.add(bodyMesh);
  const tail = new Group();
  tail.position.set(0, 0.08, -0.2);
  body.add(tail);
  const tailMesh = catTail();
  tailMesh.castShadow = false;
  tail.add(tailMesh);
  const legs = new InstancedMesh(catLeg(), piecesMaterial(), 4);
  legs.castShadow = false;
  legs.instanceMatrix.setUsage(DynamicDrawUsage);
  root.add(legs);
  group.add(root);
  return { root, body, tail, legs, lastX: 0, lastZ: 0, walk: 0 };
}

/** What the cat does in each state: its pitch, its squash, and where its legs go. */
function poseCat(rig: CatRig, c: Creature, time: number): void {
  const moved = Math.hypot(c.x - rig.lastX, c.z - rig.lastZ);
  rig.lastX = c.x;
  rig.lastZ = c.z;
  const walking = moved > 1e-4 || c.state === 'flee' ? 1 : 0;
  rig.walk += (walking - rig.walk) * 0.2;

  rig.root.position.set(c.x, 0, c.z);
  rig.root.rotation.set(0, c.yaw, 0);

  let pitch = 0;
  let squash = 1;
  let bodyY = 0;
  let tailYaw = 0.35 * Math.sin(time * 2.3 + c.x);
  // The legs at rest: the front ones, and the back ones.
  let front = 0;
  let back = 0;
  switch (c.state) {
    case 'sit':
    case 'shelter':
    case 'watch':
    case 'groom':
      // Sitting: the front up, the back legs folded under.
      pitch = -0.45;
      back = -0.8;
      if (c.state === 'watch') tailYaw = 0.5 * Math.sin(time * 4 + c.x);
      if (c.state === 'groom') front = -1.2;
      break;
    case 'sleep':
      // Curled up: squashed, the legs tucked, the tail wrapped round.
      squash = 0.7;
      bodyY = -0.06;
      front = 0.7;
      back = 0.7;
      tailYaw = 0.9;
      break;
    case 'stretch':
      // The front legs out in front, the back up.
      pitch = 0.25;
      front = -1.1;
      break;
    default:
      break;
  }
  // The gait: the diagonal pairs swing together, front left with back right.
  const s = 0.5 * Math.sin(c.cycle * Math.PI * 2) * rig.walk;
  const swing = [front + s, front - s, back - s, back + s];

  rig.body.rotation.x = pitch;
  rig.body.scale.set(1, squash, 1);
  rig.body.position.set(0, HIP_Y + bodyY, 0);
  rig.tail.rotation.set(0, tailYaw, 0);
  for (let i = 0; i < 4; i += 1) {
    const [hx, hy, hz] = HIPS[i];
    dummy.position.set(hx, hy, hz);
    dummy.rotation.set(swing[i], 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    rig.legs.setMatrixAt(i, dummy.matrix);
  }
}

// --- the duck -----------------------------------------------------------------

interface DuckRig {
  root: Group;
  body: Group;
  wings: Mesh;
}

function buildDuck(group: Group): DuckRig {
  const root = new Group();
  root.name = 'duck';
  root.visible = false;
  const body = new Group();
  root.add(body);
  // The body floats low: a flattened ball, a head, and a beak.
  const bodyMesh = merge(
    [
      { geometry: put(new SphereGeometry(0.13, 12, 9), 0, 0.05, 0, [0, 0, 0], [1, 0.7, 1.4]), color: DUCK_WHITE },
      { geometry: put(new SphereGeometry(0.07, 10, 8), 0, 0.14, 0.13), color: DUCK_HEAD },
      { geometry: put(new BoxGeometry(0.05, 0.03, 0.07), 0, 0.12, 0.21), color: DUCK_BEAK },
    ],
    'duck-body',
  );
  // Only the body is a shadow: a duck's shadow on the water is not worth a call.
  bodyMesh.castShadow = false;
  body.add(bodyMesh);
  // The wings, both in one piece: folded flat on the water, and beating in the air.
  const wings = merge(
    [
      { geometry: put(new BoxGeometry(0.2, 0.02, 0.08), -0.1, 0.09, 0, [0, 0, 0.1]), color: DUCK_WING },
      { geometry: put(new BoxGeometry(0.2, 0.02, 0.08), 0.1, 0.09, 0, [0, 0, -0.1]), color: DUCK_WING },
    ],
    'duck-wings',
  );
  wings.castShadow = false;
  body.add(wings);
  group.add(root);
  return { root, body, wings };
}

function poseDuck(rig: DuckRig, c: Creature, time: number): void {
  rig.root.position.set(c.x, c.y + 0.01 * Math.sin(time * 2.2), c.z);
  rig.root.rotation.set(0, c.yaw, 0);
  const flying = c.state === 'flyIn' || c.state === 'takeOff' || c.state === 'leave';
  // The wings are folded on the water, and beat in the air.
  rig.wings.scale.set(1, flying ? 0.4 + 0.6 * Math.abs(Math.sin(c.cycle * Math.PI)) : 0.45, 1);
  // Dabbling: the head goes under, and the tail comes up.
  rig.body.rotation.x = c.state === 'dabble' ? -0.7 : 0;
}

// --- birds and butterflies ----------------------------------------------------

/** A bird's body: a small ball, a little long. */
function birdBody(): BufferGeometry {
  return merge(
    [{ geometry: put(new SphereGeometry(0.1, 8, 6), 0, 0, 0, [0, 0, 0], [1, 0.8, 1.8]), color: '#ffffff' }],
    'bird-body',
  ).geometry;
}

/** A bird's wings: a V that is flapped by scaling it up and down about the body. */
function birdWings(): BufferGeometry {
  return merge(
    [
      { geometry: put(new BoxGeometry(0.34, 0.02, 0.1), -0.16, 0.02, 0, [0, 0, 0.35]), color: '#ffffff' },
      { geometry: put(new BoxGeometry(0.34, 0.02, 0.1), 0.16, 0.02, 0, [0, 0, -0.35]), color: '#ffffff' },
    ],
    'bird-wings',
  ).geometry;
}

/** A butterfly's wings: two upright quads that meet at the body. */
function butterflyWings(): BufferGeometry {
  const left = put(new PlaneGeometry(0.1, 0.08), -0.05, 0.02, 0, [0, 0.4, 0]);
  const right = put(new PlaneGeometry(0.1, 0.08), 0.05, 0.02, 0, [0, -0.4, 0]);
  const g = mergeGeometries([left, right], false) ?? new BufferGeometry();
  left.dispose();
  right.dispose();
  return g;
}

function poseBird(bodies: InstancedMesh, wings: InstancedMesh, i: number, c: Creature): void {
  dummy.position.set(c.x, c.y, c.z);
  dummy.rotation.set(0, c.yaw, 0);
  dummy.scale.set(1, 1, 1);
  dummy.updateMatrix();
  bodies.setMatrixAt(i, dummy.matrix);
  // The wings fold when it sits on the parasol, and beat in the air.
  const beat = c.state === 'perch' ? 0.15 : 0.55 + 0.45 * Math.abs(Math.sin(c.cycle * Math.PI));
  dummy.scale.set(1, beat, 1);
  dummy.updateMatrix();
  wings.setMatrixAt(i, dummy.matrix);
}

function poseButterfly(mesh: InstancedMesh, i: number, c: Creature): void {
  dummy.position.set(c.x, c.y, c.z);
  dummy.rotation.set(0, c.yaw, 0);
  // The wings open and close with the beat, and stay closed on a flower.
  const open = c.state === 'land' ? 0.15 : 0.25 + 0.75 * Math.abs(Math.cos(c.cycle * Math.PI));
  dummy.scale.set(open, 1, 1);
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
}

// --- the whole -----------------------------------------------------------------

export function buildCreatures3D(): Creatures3D {
  const group = new Group();
  group.name = 'creatures';

  const cat = buildCat(group);
  const duck = buildDuck(group);

  // The birds: the bodies and the wings, one instanced mesh each for the pair.
  const birdBodies = new InstancedMesh(birdBody(), piecesMaterial(), 2);
  const birdWingMesh = new InstancedMesh(birdWings(), piecesMaterial(), 2);
  const grey = new Color(BIRD_GREY);
  for (const mesh of [birdBodies, birdWingMesh]) {
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.setColorAt(0, grey);
    mesh.setColorAt(1, grey);
    group.add(mesh);
  }
  birdWingMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  birdBodies.instanceMatrix.setUsage(DynamicDrawUsage);

  // The butterflies: a basic material, so the wings read the same from both sides.
  const butterflyMaterial = new MeshBasicMaterial({ color: '#ffffff', side: DoubleSide });
  const butterflies = new InstancedMesh(butterflyWings(), butterflyMaterial, 2);
  butterflies.count = 0;
  butterflies.visible = false;
  butterflies.setColorAt(0, new Color(BUTTERFLY_YELLOW));
  butterflies.setColorAt(1, new Color(BUTTERFLY_BLUE));
  butterflies.instanceMatrix.setUsage(DynamicDrawUsage);
  group.add(butterflies);

  return {
    group,
    update(creatures, time) {
      let catSeen = false;
      let duckSeen = false;
      let birdsSeen = 0;
      let birdCount = 0;
      let butterflyCount = 0;
      for (const c of creatures) {
        switch (c.id) {
          case 'cat':
            catSeen = true;
            poseCat(cat, c, time);
            break;
          case 'duck':
            duckSeen = true;
            poseDuck(duck, c, time);
            break;
          case 'bird-0':
          case 'bird-1': {
            const i = c.id === 'bird-0' ? 0 : 1;
            birdsSeen += 1;
            birdCount = Math.max(birdCount, i + 1);
            poseBird(birdBodies, birdWingMesh, i, c);
            break;
          }
          case 'butterfly-0':
          case 'butterfly-1': {
            const i = c.id === 'butterfly-0' ? 0 : 1;
            butterflyCount = Math.max(butterflyCount, i + 1);
            poseButterfly(butterflies, i, c);
            break;
          }
          default:
        }
      }
      cat.root.visible = catSeen;
      duck.root.visible = duckSeen;
      // The instances in use are the first ones; a kind with none is not drawn.
      birdBodies.count = birdCount;
      birdWingMesh.count = birdCount;
      birdBodies.visible = birdsSeen > 0;
      birdWingMesh.visible = birdsSeen > 0;
      butterflies.count = butterflyCount;
      butterflies.visible = butterflyCount > 0;
      if (birdsSeen > 0) {
        birdBodies.instanceMatrix.needsUpdate = true;
        birdWingMesh.instanceMatrix.needsUpdate = true;
      }
      if (butterflyCount > 0) butterflies.instanceMatrix.needsUpdate = true;
      if (catSeen) cat.legs.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof Mesh || o instanceof InstancedMesh) o.geometry.dispose();
      });
      butterflyMaterial.dispose();
      group.clear();
    },
  };
}
