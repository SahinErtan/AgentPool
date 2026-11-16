/**
 * Small helpers for building the static parts of the pool out of coloured
 * primitives.
 *
 * Every static thing in the pool (the loungers, the fence, the hut, the
 * plants) is a handful of boxes and cylinders with a colour each. They are
 * merged into a few meshes that share one material, so the whole deck costs
 * a few draw calls and not a few hundred.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Curve,
  DataTexture,
  Euler,
  Matrix4,
  Mesh,
  MeshToonMaterial,
  NearestFilter,
  Quaternion,
  RedFormat,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchUnderwater } from './underwater';

export interface Piece {
  geometry: BufferGeometry;
  color: string | number;
}

const m = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const p = new Vector3();
const s = new Vector3();

/** Move, turn and stretch a geometry into place, in place. */
export function put(
  g: BufferGeometry,
  x: number,
  y: number,
  z: number,
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): BufferGeometry {
  q.setFromEuler(e.set(rot[0], rot[1], rot[2]));
  m.compose(p.set(x, y, z), q, s.set(scale[0], scale[1], scale[2]));
  g.applyMatrix4(m);
  return g;
}

let toon: MeshToonMaterial | null = null;

/** Three bands of light, the same as the characters'. */
export function toonGradient(): DataTexture {
  const data = new Uint8Array([110, 180, 255]);
  const texture = new DataTexture(data, data.length, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** The material of everything built out of pieces. */
export function piecesMaterial(): MeshToonMaterial {
  if (!toon) {
    toon = patchUnderwater(new MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() }));
  }
  return toon;
}

/** Merge coloured pieces into one mesh. */
export function merge(pieces: Piece[], name = 'pieces'): Mesh {
  const geometries = pieces.map((piece) => {
    const g = piece.geometry.index ? piece.geometry.toNonIndexed() : piece.geometry;
    if (g !== piece.geometry) piece.geometry.dispose();
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    const count = g.getAttribute('position').count;
    const c = new Color(piece.color);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(geometries, false) ?? new BufferGeometry();
  for (const g of geometries) g.dispose();
  merged.computeBoundingSphere();
  const mesh = new Mesh(merged, piecesMaterial());
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A U-shaped channel along a curve, open at the top.
 *
 * The ring at each sample is built from a frame that keeps "up" up, not from
 * Frenet frames: Frenet frames twist on a spiral. The angles `from` and `to`
 * say how much of the circle is there: a trough is the bottom part only,
 * so its rims stand below the curve and nothing is above it.
 *
 * Each vertex carries `uv = (t, j / radial)`, where `t` is the progress along
 * the curve, so a shader can run stripes down the channel.
 */
export function troughGeometry(
  curve: Curve<Vector3>,
  segments: number,
  radius: number,
  from = Math.PI * 0.12,
  to = Math.PI * 0.88,
  radial = 12,
): BufferGeometry {
  const up = new Vector3(0, 1, 0);
  const point = new Vector3();
  const tangent = new Vector3();
  const side = new Vector3();
  const down = new Vector3();
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent);
    side.crossVectors(tangent, up);
    // A level stretch gives a sideways vector; one straight up has none.
    if (side.lengthSq() < 1e-12) side.set(0, 0, 1);
    side.normalize();
    // Down is the other way round from up: with a level tangent it points
    // down, and the trough opens at the top.
    down.crossVectors(tangent, side).normalize();
    for (let j = 0; j <= radial; j += 1) {
      const a = from + ((to - from) * j) / radial;
      const c = Math.cos(a) * radius;
      const d = Math.sin(a) * radius;
      positions.push(
        point.x + c * side.x + d * down.x,
        point.y + c * side.y + d * down.y,
        point.z + c * side.z + d * down.z,
      );
      uvs.push(t, j / radial);
    }
  }
  const indices: number[] = [];
  const row = radial + 1;
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * row + j;
      const b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
