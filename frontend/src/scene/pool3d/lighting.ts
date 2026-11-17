/**
 * The light of the day, in 3D.
 *
 * The palette (`daylight.ts`) is used as it is: it already
 * knows what the sky, the water and the deck look like at every hour and in
 * every weather. Here it drives a sky dome, a hemisphere light (the sky
 * above and the deck below), and the sun, which casts the shadows. The sun
 * goes round with the hour, so the shadows of the loungers turn through the
 * day.
 */

import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import type { Palette } from './daylight';
import type { World } from './world';
import { nightAmount } from './creatures';

/** How far the sun stands from the middle of the deck, in metres. */
const SUN_DISTANCE = 40;

export interface Lighting {
  sun: DirectionalLight;
  /** Where the sun is, as a unit vector towards it. */
  sunDirection: Vector3;
  apply(palette: Palette, hour: number): void;
  /** The clock of the sky: the stars twinkle with it. */
  setTime(time: number): void;
  setShadowSize(size: number): void;
  dispose(): void;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform float uSun;
uniform float uStars;
uniform float uTime;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 colour = mix(uBottom, uTop, pow(h, 0.6));
  float sun = pow(max(dot(normalize(vDir), uSunDir), 0.0), 600.0) * 2.0
    + pow(max(dot(normalize(vDir), uSunDir), 0.0), 12.0) * 0.18;
  colour += vec3(1.0, 0.92, 0.75) * sun * uSun;
  // The stars: a hashed grid on the dome, only above fifteen degrees, twinkling slowly.
  vec3 d = normalize(vDir);
  if (uStars > 0.0 && d.y > 0.26) {
    vec2 g = floor(d.xz / max(d.y, 0.001) * 90.0);
    float r = fract(sin(dot(g, vec2(12.9898, 78.233))) * 43758.5453);
    float twinkle = 0.6 + 0.4 * sin(uTime * 1.7 + r * 40.0);
    float star = step(0.985, r) * twinkle * smoothstep(0.26, 0.4, d.y);
    colour += vec3(1.0, 0.98, 0.9) * star * uStars;
  }
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
`;

export function createLighting(scene: Scene, world: World): Lighting {
  const skyUniforms = {
    uTop: { value: new Color('#5cb8ea') },
    uBottom: { value: new Color('#cfeefc') },
    uSunDir: { value: new Vector3(0.3, 0.8, 0.2).normalize() },
    uSun: { value: 1 },
    uStars: { value: 0 },
    uTime: { value: 0 },
  };
  const skyMaterial = new ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    depthWrite: false,
  });
  const sky = new Mesh(new SphereGeometry(300, 24, 12), skyMaterial);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  const hemi = new HemisphereLight('#cfeefc', '#e9dcc4', 1.4);
  scene.add(hemi);

  const sun = new DirectionalLight('#fff4e0', 2.2);
  sun.castShadow = true;
  // The shadow camera covers the deck and no more, so the shadow map is
  // spent where the people are.
  const half = Math.max(world.deck.maxX - world.deck.minX, world.deck.maxZ - world.deck.minZ) / 2 + 1;
  sun.shadow.camera.left = -half;
  sun.shadow.camera.right = half;
  sun.shadow.camera.top = half;
  sun.shadow.camera.bottom = -half;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  // The shadow map is the size that the stripes were measured against: at
  // the default of 512 the parasols and the cushions were striped with
  // shadow acne.
  sun.shadow.mapSize.set(2048, 2048);
  // The parasols and the cushions were striped with shadow acne: the
  // shadow of a surface was fighting with the surface itself. The normal
  // bias pushes the shadow along the normal of the surface, so the stripes
  // go.
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  // The shadow camera looks along the sun, which stands a long way off, so
  // its depth range used to spread over ninety metres. The resolution of
  // the depth comparison was so coarse that the thin towel on a back rest
  // striped itself. The sun is always the same distance from the middle of
  // the deck, so the range is worked out from the deck instead.
  const reach = Math.hypot(half, half) + 3;
  sun.shadow.camera.near = Math.max(1, SUN_DISTANCE - reach);
  sun.shadow.camera.far = SUN_DISTANCE + reach;
  const centre = new Vector3(
    (world.deck.minX + world.deck.maxX) / 2,
    0,
    (world.deck.minZ + world.deck.maxZ) / 2,
  );
  sun.target.position.copy(centre);
  scene.add(sun, sun.target);

  scene.fog = new Fog('#cfeefc', 60, 180);

  const sunDirection = new Vector3(0.3, 0.8, 0.2).normalize();

  return {
    sun,
    sunDirection,
    apply(palette, hour) {
      skyUniforms.uTop.value.set(palette.skyTop);
      skyUniforms.uBottom.value.set(palette.skyBottom);
      (scene.fog as Fog).color.set(palette.skyBottom);

      // The sun rises in the east (+x), is highest at one, sets in the
      // west. At night it is the moon, low and weak.
      const day = Math.min(1, Math.max(0, (hour - 6) / 14));
      const arc = day * Math.PI;
      const elevation = Math.max(0.25, Math.sin(arc)) * 1.05;
      sunDirection.set(Math.cos(arc) * 0.9, Math.sin(elevation), -0.45).normalize();
      sun.position.copy(centre).addScaledVector(sunDirection, SUN_DISTANCE);
      skyUniforms.uSunDir.value.copy(sunDirection);
      skyUniforms.uSun.value = palette.light * (1 - palette.clouds * 0.8);
      skyUniforms.uStars.value = palette.stars ? nightAmount(palette.light) : 0;

      const light = palette.light;
      sun.intensity = 0.35 + 2.1 * light * (1 - palette.clouds * 0.55);
      sun.color.set(light < 0.45 ? '#ffd2a8' : '#fff4e0');
      hemi.intensity = 0.55 + 0.95 * light;
      hemi.color.set(palette.skyBottom);
      hemi.groundColor.set(palette.deck);
    },
    setTime(time) {
      skyUniforms.uTime.value = time;
    },
    setShadowSize(size) {
      if (sun.shadow.mapSize.x === size) return;
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    },
    dispose() {
      sky.geometry.dispose();
      skyMaterial.dispose();
      scene.remove(sky, hemi, sun, sun.target);
      sun.shadow.map?.dispose();
    },
  };
}
