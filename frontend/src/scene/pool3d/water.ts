/**
 * The water: a surface you can see into, that moves and that answers the
 * swimmers.
 *
 * - The surface is one plane with its own shader. Its waves are a few
 *   travelling sines that never line up, so the pattern does not repeat.
 * - The colour depends on the depth of the pool under it, and on how
 *   steeply it is seen: looked at from the side, water mirrors the sky
 *   (Fresnel), looked at from above you see into it.
 * - Ripples: a ring buffer of sources. A stroke or a splash adds one, and
 *   the shader draws its ring going out and fading. That is the wake behind
 *   a swimmer, without a simulation.
 * - Caustics: the floor and the walls get the bright net of light that a
 *   wavy surface throws, as a patch on their material.
 */

import {
  Color,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  Vector4,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { underwaterUniforms } from './underwater';
import type { World } from './world';

export const RIPPLES = 24;

export interface Water {
  mesh: Mesh;
  /** Start a ring on the surface at (x, z). */
  ripple(x: number, z: number, strength: number): void;
  update(time: number): void;
  setColours(shallow: number, deep: number, sky: number, light: number): void;
  setSun(direction: Vector3): void;
  /** 0 by day .. 1 at night: the water glows from the lights under it. */
  setNight(amount: number): void;
  /** 0 lively .. 1 calm: a calm pool has smaller waves. */
  setCalm(amount: number): void;
  dispose(): void;
}

const SURFACE_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SURFACE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform float uLight;
uniform vec4 uPool; // minX, maxX, minZ, maxZ
uniform vec4 uRipples[${RIPPLES}]; // x, z, start time, strength
uniform float uNightGlow;
uniform float uCalm;
varying vec3 vWorld;

// The height of the surface: a few waves that never line up, and the rings.
float height(vec2 p) {
  float h = 0.0;
  h += 0.018 * sin(dot(p, vec2(0.92, 0.38)) * 2.1 + uTime * 1.3);
  h += 0.013 * sin(dot(p, vec2(-0.45, 0.89)) * 2.9 + uTime * 1.7);
  h += 0.009 * sin(dot(p, vec2(0.21, -0.98)) * 4.3 + uTime * 2.3);
  h += 0.006 * sin(dot(p, vec2(-0.83, -0.56)) * 6.1 + uTime * 2.9);
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 r = uRipples[i];
    if (r.w <= 0.0) continue;
    float age = uTime - r.z;
    if (age < 0.0 || age > 3.5) continue;
    float d = distance(p, r.xy);
    float front = age * 0.9;
    float band = exp(-abs(d - front) * 5.0);
    h += r.w * 0.05 * sin((d - front) * 18.0) * band * exp(-age * 1.1) / (1.0 + d * 2.0);
  }
  // A calm pool has smaller waves: the amplitudes are scaled by how calm it is.
  return h * (1.0 - 0.6 * uCalm);
}

void main() {
  vec2 p = vWorld.xz;
  float e = 0.04;
  float hx = height(p + vec2(e, 0.0)) - height(p - vec2(e, 0.0));
  float hz = height(p + vec2(0.0, e)) - height(p - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));

  vec3 toEye = normalize(cameraPosition - vWorld);
  float facing = clamp(dot(n, toEye), 0.0, 1.0);
  float fresnel = 0.03 + 0.97 * pow(1.0 - facing, 4.0);

  // Deeper towards the deep end, and darker near the walls where the
  // shadow of the coping falls.
  float along = clamp((p.x - uPool.x) / (uPool.y - uPool.x), 0.0, 1.0);
  float depth = smoothstep(0.3, 1.0, along);
  vec3 body = mix(uShallow, uDeep, depth);
  // At night the lights under the water make it glow from inside.
  body += vec3(0.1, 0.45, 0.55) * uNightGlow * (1.0 - depth * 0.5);
  float edge = min(min(p.x - uPool.x, uPool.y - p.x), min(p.y - uPool.z, uPool.w - p.y));
  body *= mix(0.82, 1.0, smoothstep(0.0, 0.6, edge));

  vec3 colour = mix(body, uSky, fresnel * 0.85);
  // The sun on the water.
  vec3 h = normalize(uSunDir + toEye);
  float glint = pow(max(dot(n, h), 0.0), 220.0) * 2.2 * uLight;
  colour += vec3(1.0, 0.97, 0.9) * glint;
  // Foam on the crests of the rings.
  float crest = smoothstep(0.012, 0.03, height(p) - 0.02);
  colour = mix(colour, vec3(1.0), crest * 0.35);

  // The water is clearer over the shallow end and less clear over the
  // deep one, so the floor shows through at one end and not at the other.
  float alpha = mix(0.52, 0.9, fresnel) + depth * 0.1 + glint * 0.3;
  gl_FragColor = vec4(colour, clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

export function createWater(world: World): Water {
  const w = world.pool.maxX - world.pool.minX;
  const d = world.pool.maxZ - world.pool.minZ;
  const geometry = new PlaneGeometry(w, d, 1, 1);
  geometry.rotateX(-Math.PI / 2);

  const ripples = Array.from({ length: RIPPLES }, () => new Vector4(0, 0, -100, 0));
  const uniforms = {
    uTime: { value: 0 },
    uShallow: { value: new Color('#57c6e0') },
    uDeep: { value: new Color('#1f6f9f') },
    uSky: { value: new Color('#bfe6f7') },
    uSunDir: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
    uLight: { value: 1 },
    uPool: {
      value: new Vector4(world.pool.minX, world.pool.maxX, world.pool.minZ, world.pool.maxZ),
    },
    uRipples: { value: ripples },
    uNightGlow: { value: 0 },
    uCalm: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: SURFACE_VERT,
    fragmentShader: SURFACE_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.set((world.pool.minX + world.pool.maxX) / 2, world.waterY, (world.pool.minZ + world.pool.maxZ) / 2);
  mesh.renderOrder = 2;
  mesh.name = 'water';

  let next = 0;
  return {
    mesh,
    ripple(x, z, strength) {
      const r = ripples[next];
      r.set(x, z, uniforms.uTime.value, strength);
      next = (next + 1) % RIPPLES;
    },
    update(time) {
      uniforms.uTime.value = time;
      underwaterUniforms.uWaterTime.value = time;
    },
    setColours(shallow, deep, sky, light) {
      uniforms.uShallow.value.set(shallow);
      uniforms.uDeep.value.set(deep);
      uniforms.uSky.value.set(sky);
      uniforms.uLight.value = light;
      underwaterUniforms.uWaterColor.value.set(deep);
    },
    setSun(direction) {
      uniforms.uSunDir.value.copy(direction).normalize();
    },
    setNight(amount) {
      uniforms.uNightGlow.value = Math.min(1, Math.max(0, amount));
    },
    setCalm(amount) {
      uniforms.uCalm.value = Math.min(1, Math.max(0, amount));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Shared by the floor and the walls. */
export const causticUniforms = {
  uCausticLight: { value: 1 },
};

/**
 * Patch a material so that the light through the waves plays on it.
 *
 * Only the parts below the water get it, and it fades with depth.
 */
export function patchCaustics<T extends Material>(material: T): T {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uWaterY = underwaterUniforms.uWaterY;
    shader.uniforms.uWaterTime = underwaterUniforms.uWaterTime;
    shader.uniforms.uWaterColor = underwaterUniforms.uWaterColor;
    shader.uniforms.uCausticLight = causticUniforms.uCausticLight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCausticWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvCausticWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vCausticWorld;
uniform float uWaterY;
uniform float uWaterTime;
uniform vec3 uWaterColor;
uniform float uCausticLight;
float causticNet(vec2 p, float t) {
  vec2 q = p * 1.35;
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    q += vec2(sin(q.y * 1.7 + t * 0.8), cos(q.x * 1.5 - t * 0.65)) * 0.55;
    c += 0.33 / (1.0 + 9.0 * abs(sin(q.x * 1.3) * sin(q.y * 1.3)));
  }
  return c;
}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
{
  float under = uWaterY - vCausticWorld.y;
  if (under > 0.0) {
    float net = causticNet(vCausticWorld.xz + vec2(vCausticWorld.y * 0.3), uWaterTime);
    float fade = exp(-under * 0.35);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.55 + uWaterColor * 0.45, clamp(0.25 + under * 0.18, 0.0, 0.7));
    gl_FragColor.rgb += vec3(0.85, 0.97, 1.0) * pow(net, 2.2) * 0.42 * fade * uCausticLight;
  }
}`,
      );
  };
  material.customProgramCacheKey = () => 'agentpool-caustics';
  return material;
}
