/**
 * The lights of the pool after dark: six lamps under the water, the string
 * lights over the terrace, and two real lights that go on with the night.
 *
 * Everything glows by day too, a little, so the change from day to night is
 * a change of brightness and not a switch. The point lights are the only
 * ones that cost anything per pixel, so there are at most two of them.
 */

import {
  CircleGeometry,
  Color,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  PointLight,
  SphereGeometry,
  BoxGeometry,
  CylinderGeometry,
} from 'three';
import { merge, put, type Piece } from './build';
import type { World } from './world';

/** The colours of the lamps: the wall's own colour by day, a cool light at night. */
const UNDERWATER_DAY = new Color('#7fa8b5');
const UNDERWATER_NIGHT = new Color('#9ff3ff');
/** The bulbs of the string: dull by day, warm at night. */
const BULB_DAY = new Color('#5c5a4f');
const BULB_NIGHT = new Color('#ffe3a3');
/** The two point lights' strength at full night, and how far they reach. */
const POINT_INTENSITY = 1.2;
const POINT_DISTANCE = 12;
/** The string is two lines over the terrace, with this many bulbs on each. */
const BULBS_PER_LINE = 15;
const STRING_HEIGHT = 2.4;
const STRING_SAG = 0.35;

export interface NightLights {
  group: Group;
  /** `night` is 0 by day .. 1 at night, and `time` drives the flicker of the string. */
  update(time: number, night: number): void;
  dispose(): void;
}

export function buildNightLights(world: World): NightLights {
  const group = new Group();
  group.name = 'night-lights';
  const pool = world.pool;
  const deck = world.deck;
  const midZ = (pool.minZ + pool.maxZ) / 2;
  const disposables: { dispose(): void }[] = [];

  // --- six lamps under the water, three on each long wall, half a metre down
  const lampGeometry = new CircleGeometry(0.12, 12);
  const lampMaterial = new MeshBasicMaterial({ color: UNDERWATER_DAY });
  const lamps = new InstancedMesh(lampGeometry, lampMaterial, 6);
  lamps.castShadow = false;
  const dummy = new Object3D();
  const width = pool.maxX - pool.minX;
  for (let k = 0; k < 6; k += 1) {
    const wall = k < 3 ? pool.minZ + 0.02 : pool.maxZ - 0.02;
    const x = pool.minX + 2 + ((width - 4) * (k % 3)) / 2;
    dummy.position.set(x, world.waterY - 0.5, wall);
    dummy.rotation.set(0, k < 3 ? 0 : Math.PI, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    lamps.setMatrixAt(k, dummy.matrix);
  }
  group.add(lamps);
  disposables.push(lampGeometry, lampMaterial);

  // --- the string lights: two lines between posts, across the terrace
  const x0 = pool.maxX + 0.8;
  const x1 = deck.maxX - 0.8;
  const lines = [midZ - 2.6, midZ + 3.0];
  const wirePieces: Piece[] = [];
  for (const z of lines) {
    for (const x of [x0, x1]) {
      wirePieces.push({ geometry: put(new CylinderGeometry(0.03, 0.03, STRING_HEIGHT + 0.2, 6), x, (STRING_HEIGHT + 0.2) / 2, z), color: '#f4f1ea' });
    }
    // The wire: short straight pieces along the sag.
    const segments = 16;
    for (let i = 0; i < segments; i += 1) {
      const u0 = i / segments;
      const u1 = (i + 1) / segments;
      const a = stringPoint(x0, x1, z, u0);
      const b = stringPoint(x0, x1, z, u1);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      wirePieces.push({
        geometry: put(new BoxGeometry(len, 0.012, 0.012), (a.x + b.x) / 2, (a.y + b.y) / 2, z, [0, 0, Math.atan2(b.y - a.y, b.x - a.x)]),
        color: '#2f3a44',
      });
    }
  }
  const wire = merge(wirePieces, 'string-wire');
  group.add(wire);
  disposables.push(wire.geometry);

  // The bulbs: one instanced mesh for all thirty.
  const bulbGeometry = new SphereGeometry(0.05, 6, 5);
  const bulbMaterial = new MeshBasicMaterial({ color: '#ffffff' });
  const bulbs = new InstancedMesh(bulbGeometry, bulbMaterial, BULBS_PER_LINE * lines.length);
  bulbs.castShadow = false;
  let n = 0;
  for (const z of lines) {
    for (let i = 0; i < BULBS_PER_LINE; i += 1) {
      const u = (i + 0.5) / BULBS_PER_LINE;
      const p = stringPoint(x0, x1, z, u);
      dummy.position.set(p.x, p.y - 0.06, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bulbs.setMatrixAt(n, dummy.matrix);
      bulbs.setColorAt(n, BULB_DAY);
      n += 1;
    }
  }
  group.add(bulbs);
  disposables.push(bulbGeometry, bulbMaterial);

  // --- the two real lights: over the lounger rows, and over the terrace
  const lightA = new PointLight('#ffd28a', 0, POINT_DISTANCE, 1);
  lightA.position.set(0, 2.6, pool.minZ - 2.6);
  lightA.castShadow = false;
  const lightB = new PointLight('#ffd28a', 0, POINT_DISTANCE, 1);
  lightB.position.set(deck.maxX - 6, 2.6, midZ);
  lightB.castShadow = false;
  group.add(lightA, lightB);

  const bulbColour = new Color();
  return {
    group,
    update(time, night) {
      const k = Math.min(1, Math.max(0, night));
      lampMaterial.color.copy(UNDERWATER_DAY).lerp(UNDERWATER_NIGHT, k);
      for (let i = 0; i < BULBS_PER_LINE * lines.length; i += 1) {
        // A slow, seeded flicker of eight per cent.
        const flicker = 1 + 0.08 * Math.sin(time * 2.3 + i * 1.9);
        bulbColour.copy(BULB_DAY).lerp(BULB_NIGHT, k).multiplyScalar(flicker);
        bulbs.setColorAt(i, bulbColour);
      }
      if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
      lightA.intensity = POINT_INTENSITY * k;
      lightB.intensity = POINT_INTENSITY * k;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}

/** A point on the string: from the left post to the right one, sagging in the middle. */
function stringPoint(x0: number, x1: number, z: number, u: number): { x: number; y: number; z: number } {
  return {
    x: x0 + (x1 - x0) * u,
    y: STRING_HEIGHT - STRING_SAG * 4 * u * (1 - u),
    z,
  };
}
