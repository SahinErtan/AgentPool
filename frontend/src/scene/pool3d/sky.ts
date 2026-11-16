/**
 * The sky above the pool: clouds that drift over the deck and throw their
 * shadows on it, and a moon at night.
 *
 * The clouds are one instanced mesh: each puff is a cluster of icosahedrons,
 * flat underneath, and every puff is an instance of the same geometry. The
 * cloud shadows are not geometry at all: the deck, the lawn and the pieces
 * are patched so that the light on them dims where a cloud's shadow falls,
 * which costs no draw call.
 */

import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Scene,
  SphereGeometry,
  Vector3,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Palette } from '../pool/daylight';
import { windAt } from './creatures';
import { piecesMaterial } from './build';
import type { World } from './world';

/** How many puffs there are on a clear day, and how many more under an overcast sky. */
const CLEAR_PUFFS = 6;
const PUFFS = 10;
/** The square the clouds drift over, in metres, and how fast they go at full wind. */
const SQUARE = 220;
const DRIFT = 0.6;
/** The shadow's strength when it is at its most (see `patchCloudShadow`). */
const SHADOW = 0.22;

/** Shared by every patched material, so the scene sets them once a frame. */
export const cloudUniforms = {
  uCloudShadow: { value: 0 },
  uCloudTime: { value: 0 },
  /** The wind's drift, in metres a second, along x. */
  uCloudDrift: { value: 0 },
};

const CLOUD_GLSL = /* glsl */ `
uniform float uCloudShadow;
uniform float uCloudTime;
uniform float uCloudDrift;
varying vec3 vCloudWorld;
float cloudHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float cloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cloudHash(i);
  float b = cloudHash(i + vec2(1.0, 0.0));
  float c = cloudHash(i + vec2(0.0, 1.0));
  float d = cloudHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
/** Where a cloud's shadow is, on the ground: a smoothed noise that drifts with the clouds. */
float cloudMask(vec2 p) {
  vec2 q = p * 0.035 - vec2(uCloudTime * uCloudDrift * 0.035, 0.0);
  float n = cloudNoise(q) * 0.6 + cloudNoise(q * 2.1 + 3.7) * 0.4;
  return smoothstep(0.5, 0.75, n);
}
`;

/**
 * Patch a material so that the light dims under the clouds' shadows.
 *
 * It keeps whatever patch the material already has (the underwater tint, the
 * caustics), and runs after them. The patched programs are keyed apart.
 */
export function patchCloudShadow<T extends Material>(material: T): T {
  if (material.userData.cloudShadow) return material;
  material.userData.cloudShadow = true;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uCloudShadow = cloudUniforms.uCloudShadow;
    shader.uniforms.uCloudTime = cloudUniforms.uCloudTime;
    shader.uniforms.uCloudDrift = cloudUniforms.uCloudDrift;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCloudWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvCloudWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLOUD_GLSL}`)
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
gl_FragColor.rgb *= 1.0 - uCloudShadow * ${SHADOW.toFixed(2)} * cloudMask(vCloudWorld.xz);`,
      );
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|cloudshadow`;
  return material;
}

/** The pieces are shared by the loungers, the fence and the rest: they all take the shadow. */
export function patchPiecesShadow(): void {
  patchCloudShadow(piecesMaterial());
}

export interface Sky {
  group: Group;
  update(time: number, dt: number, palette: Palette): void;
  dispose(): void;
}

/** A puff: a few icosahedrons, flattened underneath, merged into one geometry. */
function puffGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const lumps: [number, number, number, number][] = [
    [0, 0, 0, 1],
    [0.9, -0.1, 0.3, 0.75],
    [-0.8, -0.15, -0.2, 0.7],
    [0.3, 0.45, -0.4, 0.6],
    [-0.4, 0.4, 0.5, 0.55],
    [1.5, -0.25, -0.2, 0.5],
  ];
  for (const [x, y, z, r] of lumps) {
    const g = new IcosahedronGeometry(r, 1);
    g.scale(1, 0.75, 1);
    g.translate(x, y, z);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false) ?? new BufferGeometry();
  for (const g of parts) g.dispose();
  return merged;
}

export function buildSky(scene: Scene, world: World): Sky {
  const group = new Group();
  group.name = 'sky';
  const centre = new Vector3(
    (world.deck.minX + world.deck.maxX) / 2,
    0,
    (world.deck.minZ + world.deck.maxZ) / 2,
  );

  // --- the clouds: one instanced mesh, every puff an instance
  const cloudMaterial = new MeshLambertMaterial({ color: '#ffffff' });
  const clouds = new InstancedMesh(puffGeometry(), cloudMaterial, PUFFS);
  clouds.castShadow = false;
  clouds.receiveShadow = false;
  clouds.instanceMatrix.setUsage(DynamicDrawUsage);
  clouds.count = CLEAR_PUFFS;
  const xs = new Float32Array(PUFFS);
  const ys = new Float32Array(PUFFS);
  const zs = new Float32Array(PUFFS);
  const sizes = new Float32Array(PUFFS);
  for (let i = 0; i < PUFFS; i += 1) {
    // Spread over the square, with a seeded hash so the same sky comes every time.
    const h = (k: number) => {
      const v = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    xs[i] = centre.x - SQUARE / 2 + SQUARE * h(1);
    ys[i] = 35 + 20 * h(2);
    zs[i] = centre.z - 60 + 120 * h(3);
    sizes[i] = 5 + 4 * h(4);
  }
  group.add(clouds);
  const dummy = new Object3D();
  const cloudColour = new Color();
  const grey = new Color('#8a94a0');
  const white = new Color('#ffffff');
  const left = centre.x - SQUARE / 2;
  const matrix = new Matrix4();

  // --- the moon, at night: a pale disc in the sky, in the opposite part of the sky to the sun.
  const moonDirection = new Vector3(-0.45, 0.55, -0.7).normalize();
  const moon = new Mesh(
    new SphereGeometry(7, 16, 12),
    new MeshBasicMaterial({ color: '#f4f1d8', fog: false }),
  );
  moon.position.copy(centre).addScaledVector(moonDirection, 260);
  moon.visible = false;
  group.add(moon);

  scene.add(group);

  return {
    group,
    update(time, dt, palette) {
      cloudUniforms.uCloudTime.value = time;
      cloudUniforms.uCloudDrift.value = DRIFT * windAt(time);
      // The shadows are as strong as the light and as thick as the clouds.
      cloudUniforms.uCloudShadow.value = palette.light * (0.4 + 0.6 * palette.clouds);

      const overcast = palette.clouds > 0.6;
      clouds.count = overcast ? PUFFS : CLEAR_PUFFS;
      const drift = DRIFT * windAt(time) * dt;
      // A colour for the day: white, greyed as the sky clouds over, and dimmer at night.
      cloudColour.copy(white).lerp(grey, palette.clouds * 0.7).multiplyScalar(0.45 + 0.55 * palette.light);
      for (let i = 0; i < PUFFS; i += 1) {
        xs[i] += drift;
        if (xs[i] > left + SQUARE) xs[i] -= SQUARE;
        dummy.position.set(xs[i], ys[i], zs[i]);
        dummy.scale.setScalar(sizes[i]);
        dummy.updateMatrix();
        matrix.copy(dummy.matrix);
        clouds.setMatrixAt(i, matrix);
        clouds.setColorAt(i, cloudColour);
      }
      clouds.instanceMatrix.needsUpdate = true;
      if (clouds.instanceColor) clouds.instanceColor.needsUpdate = true;

      moon.visible = palette.light < 0.3;
    },
    dispose() {
      clouds.geometry.dispose();
      cloudMaterial.dispose();
      moon.geometry.dispose();
      (moon.material as Material).dispose();
      scene.remove(group);
    },
  };
}
