/**
 * What is under the water looks like it is under the water.
 *
 * The water is a surface, and a fragment below it is simply tinted with the
 * colour of the water, deeper is bluer. One patch, applied
 * to every material that can go into the pool.
 */

import { Color, type Material, type WebGLProgramParametersWithUniforms } from 'three';

/** Shared by every patched material, so the scene sets them once. */
export const underwaterUniforms = {
  uWaterY: { value: -0.18 },
  uWaterColor: { value: new Color('#2f8fb8') },
  uWaterTime: { value: 0 },
};

/**
 * Patch a built-in material so that it tints what is below the water.
 *
 * Works on the materials whose shaders end with `opaque_fragment`, which is
 * all of the lit ones and the basic one.
 */
export function patchUnderwater<T extends Material>(material: T, strength = 1): T {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uWaterY = underwaterUniforms.uWaterY;
    shader.uniforms.uWaterColor = underwaterUniforms.uWaterColor;
    shader.uniforms.uWaterTime = underwaterUniforms.uWaterTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vUnderWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvUnderWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vUnderWorld;
uniform float uWaterY;
uniform vec3 uWaterColor;
uniform float uWaterTime;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
{
  float under = uWaterY - vUnderWorld.y;
  // The line where the water meets the body wobbles a little, so it reads
  // as water and not as a cut.
  under += 0.012 * sin(vUnderWorld.x * 9.0 + uWaterTime * 2.1) * sin(vUnderWorld.z * 7.0 - uWaterTime * 1.7);
  if (under > 0.0) {
    float k = clamp(0.32 + under * 0.32, 0.0, 0.82) * ${strength.toFixed(3)};
    gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.45 + uWaterColor * 0.55, k);
  }
}`,
      );
  };
  // The patch changes the program, so it needs its own cache key.
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|underwater${strength}`;
  return material;
}
