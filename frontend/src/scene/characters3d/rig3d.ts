/**
 * The 3D character: one skinned mesh per agent, built from code.
 *
 * Every body part is a low-poly primitive (capsules, spheres, a box for a
 * foot) placed where its bone is at rest, coloured with vertex colours and
 * bound to exactly one bone with a weight of one. All the parts are merged
 * into one geometry, so a whole character is one draw call, and all the
 * characters share one material. A second draw of the same geometry, pushed
 * out along the normals and drawn from the back, is the ink line round the
 * figure.
 *
 * The character is a pure function of its spec: the same
 * agent id gives the same person, with no assets anywhere.
 */

import {
  Bone,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  Euler,
  CylinderGeometry,
  LatheGeometry,
  DataTexture,
  Group,
  Matrix4,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  Object3D,
  Quaternion,
  RedFormat,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  BackSide,
  Mesh,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CharacterSpec } from '../characters/spec';
import type { PropKind } from '../motion/driver';
import { patchUnderwater } from '../pool3d/underwater';
import { GLASS_COLOUR, SAUCER, SAUCER_COLOUR, TEA_COLOUR, TEA_GLASS_PROFILE, TEA_LIQUID_PROFILE, TEA_SURFACE } from './teaGlassShape';
import { hairStyleFor } from './hair';
import { GRIPS, METRES_PER_UNIT, type Grip } from './grips';
import { BONES, boneLayout, buildSkeleton3D, restPosition, type BoneName, type Skeleton3D } from './skeleton3d';

export interface Rig3D {
  /** Put this in the scene; move it, turn it about y and scale it to metres. */
  root: Group;
  mesh: SkinnedMesh;
  outline: SkinnedMesh;
  bones: Record<BoneName, Bone>;
  skeleton: Skeleton3D;
  spec: CharacterSpec;
  props: Record<PropKind, Object3D>;
  /** The group the props hang in, under the right hand. */
  propLayer: Group;
  destroy(): void;
}

// --- the shared materials ---------------------------------------------

let toon: MeshToonMaterial | null = null;
let ink: MeshBasicMaterial | null = null;
let propToon: MeshToonMaterial | null = null;

/** Three bands of light: lit, half-lit and in shadow. */
function gradientMap(): DataTexture {
  const data = new Uint8Array([90, 170, 255]);
  const texture = new DataTexture(data, data.length, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** The material every character is drawn with. */
export function characterMaterial(): MeshToonMaterial {
  if (!toon) {
    toon = patchUnderwater(new MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() }));
  }
  return toon;
}

let dim: MeshToonMaterial | null = null;

/**
 * The material of a character the agent list's filter hides: the same,
 * faded, so the ones that match stand out.
 */
export function dimmedMaterial(): MeshToonMaterial {
  if (!dim) {
    dim = patchUnderwater(
      new MeshToonMaterial({
        vertexColors: true,
        gradientMap: gradientMap(),
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
  }
  return dim;
}

/** The material of the props in the hands; they are coloured the same way. */
function propMaterial(): MeshToonMaterial {
  if (!propToon) {
    propToon = patchUnderwater(new MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() }));
  }
  return propToon;
}

/**
 * The ink line round the figure.
 *
 * The same skinned geometry, drawn from the back and pushed out along its
 * normals: what shows round the edges is the outline. It is a few lines
 * in the vertex shader; a full-screen outline pass costs a render of its
 * own and gets confused at the waterline.
 */
export function inkMaterial(): MeshBasicMaterial {
  if (!ink) {
    const material = new MeshBasicMaterial({ color: '#1b2430', side: BackSide });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `#ifdef USE_SKINNING
  transformed += normalize(objectNormal) * 0.011;
#endif
#include <project_vertex>`,
      );
    };
    material.customProgramCacheKey = () => 'agentpool-ink';
    ink = patchUnderwater(material, 0.6);
  }
  return ink;
}

// --- building the geometry --------------------------------------------

interface Part {
  geometry: BufferGeometry;
  bone: BoneName;
  color: string;
}

/** Make a geometry ready to be merged: colour, bone, no uv. */
function finish(part: Part, boneIndex: number): BufferGeometry {
  const g = part.geometry;
  g.deleteAttribute('uv');
  const count = g.getAttribute('position').count;
  const color = new Color(part.color);
  const colors = new Float32Array(count * 3);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    skinIndex[i * 4] = boneIndex;
    skinWeight[i * 4] = 1;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  return g;
}

const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpScale = new Vector3();
const tmpPos = new Vector3();
const tmpEuler = new Euler();

/** A geometry moved, turned and stretched into place. */
function placed(
  g: BufferGeometry,
  at: { x: number; y: number; z: number },
  scale: [number, number, number] = [1, 1, 1],
  rotX = 0,
  rotZ = 0,
): BufferGeometry {
  tmpQuat.setFromEuler(tmpEuler.set(rotX, 0, rotZ));
  tmpMatrix.compose(tmpPos.set(at.x, at.y, at.z), tmpQuat, tmpScale.set(...scale));
  g.applyMatrix4(tmpMatrix);
  return g;
}

/** Shade a colour: darker below 1, lighter above. */
function shade(hex: string, k: number): string {
  const c = new Color(hex);
  if (k < 0) {
    // A negative factor darkens the colour towards black. Multiplying by
    // it as it is would turn the colour inside out.
    c.multiplyScalar(1 + k);
  } else if (k < 1) {
    c.multiplyScalar(k);
  } else {
    c.lerp(new Color('#ffffff'), k - 1);
  }
  return `#${c.getHexString()}`;
}

function bodyParts(spec: CharacterSpec, sk: Skeleton3D): Part[] {
  const at = (bone: BoneName) => restPosition(sk, bone);
  const parts: Part[] = [];
  const skin = spec.skin;
  const suit = spec.suit;
  const accent = spec.accent;

  // --- the trunk: hips, belly and chest, as overlapping rounded shapes.
  const hips = at('hips');
  const spine = at('spine');
  const neck = at('neck');
  const head = at('head');
  parts.push({
    geometry: placed(new SphereGeometry(1, 14, 10), { x: 0, y: hips.y + 0.012, z: 0 }, [
      sk.hipHalfW * 1.08,
      sk.waist * 0.62,
      sk.depth * 1.05,
    ]),
    bone: 'hips',
    color: suit,
  });
  parts.push({
    geometry: placed(new SphereGeometry(1, 14, 10), { x: 0, y: spine.y - 0.005, z: 0 }, [
      sk.waistHalfW,
      sk.waist * 0.55,
      sk.depth * 0.95,
    ]),
    bone: 'hips',
    color: suit,
  });
  parts.push({
    geometry: placed(new SphereGeometry(1, 14, 10), { x: 0, y: spine.y + sk.chest * 0.52, z: 0 }, [
      sk.chestHalfW * 1.05,
      sk.chest * 0.62,
      sk.depth * 1.08,
    ]),
    bone: 'spine',
    color: suit,
  });
  // A band of the accent colour round the middle: the swimsuit's trim.
  parts.push({
    geometry: placed(new CylinderGeometry(1, 1, 1, 16, 1, true), { x: 0, y: spine.y + 0.004, z: 0 }, [
      sk.waistHalfW * 1.04,
      0.018,
      sk.depth * 1.0,
    ]),
    bone: 'hips',
    color: accent,
  });

  // --- the neck and the head.
  parts.push({
    geometry: placed(new CylinderGeometry(sk.armR * 1.25, sk.armR * 1.4, sk.neck * 1.6, 10), {
      x: 0,
      y: neck.y + sk.neck * 0.25,
      z: 0,
    }),
    bone: 'neck',
    color: skin,
  });
  parts.push({
    geometry: placed(new SphereGeometry(sk.headR, 18, 14), head),
    bone: 'head',
    color: skin,
  });
  // The nose and the ears say which way the head looks, from any side.
  parts.push({
    geometry: placed(new SphereGeometry(sk.headR * 0.16, 8, 6), {
      x: 0,
      y: head.y - sk.headR * 0.12,
      z: head.z + sk.headR * 0.97,
    }),
    bone: 'head',
    color: shade(skin, 0.9),
  });
  for (const side of [-1, 1]) {
    parts.push({
      geometry: placed(new SphereGeometry(sk.headR * 0.2, 8, 6), {
        x: side * sk.headR * 0.97,
        y: head.y,
        z: head.z - sk.headR * 0.05,
      }, [0.55, 1, 0.85]),
      bone: 'head',
      color: shade(skin, 0.92),
    });
  }
  // The eyes, on their own bone so they can blink.
  const eyes = at('eyes');
  for (const side of [-1, 1]) {
    parts.push({
      geometry: placed(new SphereGeometry(sk.headR * 0.13, 8, 6), {
        x: side * sk.headR * 0.36,
        y: eyes.y,
        z: eyes.z,
      }, [1, 1.25, 0.6]),
      bone: 'eyes',
      color: '#1a1410',
    });
  }
  // The hair: a cap over the head in the style this character has. It is on
  // its own bone, so it swings after the head.
  const style = hairStyleFor(spec.seed);
  const crop = () =>
    parts.push({
      geometry: placed(
        new SphereGeometry(sk.headR * 1.04, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
        { x: 0, y: head.y + sk.headR * 0.05, z: head.z },
        [1, 0.85, 1],
        -0.38,
      ),
      bone: 'hair' as BoneName,
      color: spec.hair,
    });
  switch (style) {
    case 'bob':
      // It comes down to the jaw at the sides and at the back.
      parts.push({
        geometry: placed(
          new SphereGeometry(sk.headR * 1.04, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.6),
          { x: 0, y: head.y + sk.headR * 0.05, z: head.z },
          [1.1, 1, 1.06],
          -0.38,
        ),
        bone: 'hair',
        color: spec.hair,
      });
      break;
    case 'bun':
      crop();
      parts.push({
        geometry: placed(new SphereGeometry(sk.headR * 0.36, 12, 8), {
          x: 0,
          y: head.y + sk.headR * 0.75,
          z: head.z - sk.headR * 0.55,
        }),
        bone: 'hair',
        color: spec.hair,
      });
      break;
    case 'ponytail': {
      crop();
      // The tail hangs from its own bone, so it swings after the head.
      const tail = at('ponytail');
      parts.push({
        geometry: placed(new CapsuleGeometry(sk.headR * 0.16, sk.headR * 1.1, 3, 8), {
          x: tail.x,
          y: tail.y - sk.headR * 0.55,
          z: tail.z,
        }),
        bone: 'ponytail',
        color: spec.hair,
      });
      break;
    }
    case 'buzz':
      // A thin layer of very short hair.
      parts.push({
        geometry: placed(
          new SphereGeometry(sk.headR * 1.01, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
          { x: 0, y: head.y + sk.headR * 0.05, z: head.z },
          [1, 0.85, 1],
          -0.38,
        ),
        bone: 'hair',
        color: shade(spec.hair, 0.15),
      });
      break;
    case 'crop':
    default:
      crop();
      break;
  }

  // The mouth: a small dark shape on its own bone, so it can open.
  const mouth = at('mouth');
  parts.push({
    geometry: placed(new SphereGeometry(sk.headR * 0.2, 10, 8), mouth, [1, 0.32, 0.45]),
    bone: 'mouth',
    color: shade(skin, -0.45),
  });

  // --- the arms.
  for (const [shoulder, elbow, hand] of [
    ['shoulderL', 'elbowL', 'handL'],
    ['shoulderR', 'elbowR', 'handR'],
  ] as const) {
    const s = at(shoulder);
    const e = at(elbow);
    const h = at(hand);
    parts.push({
      geometry: placed(new SphereGeometry(sk.armR * 1.35, 10, 8), s),
      bone: shoulder,
      color: suit,
    });
    parts.push({
      geometry: placed(new CapsuleGeometry(sk.armR, sk.upperArm, 3, 8), {
        x: s.x,
        y: (s.y + e.y) / 2,
        z: 0,
      }),
      bone: shoulder,
      color: skin,
    });
    parts.push({
      geometry: placed(new CapsuleGeometry(sk.armR * 0.92, sk.lowerArm, 3, 8), {
        x: e.x,
        y: (e.y + h.y) / 2,
        z: 0,
      }),
      bone: elbow,
      color: skin,
    });
    parts.push({
      geometry: placed(new SphereGeometry(sk.armR * 1.25, 8, 6), { x: h.x, y: h.y - sk.armR * 0.6, z: 0 }, [
        0.8,
        1.1,
        1,
      ]),
      bone: hand,
      color: skin,
    });
  }

  // --- the legs.
  for (const [leg, knee, foot] of [
    ['legL', 'kneeL', 'footL'],
    ['legR', 'kneeR', 'footR'],
  ] as const) {
    const l = at(leg);
    const k = at(knee);
    const f = at(foot);
    parts.push({
      geometry: placed(new CapsuleGeometry(sk.legR * 1.12, sk.thigh * 0.55, 3, 8), {
        x: l.x,
        y: l.y - sk.thigh * 0.3,
        z: 0,
      }),
      bone: leg,
      color: suit,
    });
    parts.push({
      geometry: placed(new CapsuleGeometry(sk.legR, sk.thigh, 3, 8), {
        x: l.x,
        y: (l.y + k.y) / 2,
        z: 0,
      }),
      bone: leg,
      color: skin,
    });
    parts.push({
      geometry: placed(new CapsuleGeometry(sk.legR * 0.9, sk.shin, 3, 8), {
        x: k.x,
        y: (k.y + f.y) / 2,
        z: 0,
      }),
      bone: knee,
      color: skin,
    });
    parts.push({
      geometry: placed(new SphereGeometry(1, 10, 6), {
        x: f.x,
        y: f.y + 0.004,
        z: sk.legR * 0.9,
      }, [sk.legR * 0.95, 0.03, sk.legR * 2.0]),
      bone: foot,
      color: shade(skin, 0.95),
    });
  }

  // --- the one accessory this character was given.
  const top = { x: 0, y: head.y + sk.headR * 0.62, z: head.z };
  switch (spec.accessory) {
    case 'sunhat':
      parts.push({
        geometry: placed(new CylinderGeometry(sk.headR * 1.75, sk.headR * 1.8, sk.headR * 0.08, 20), top),
        bone: 'head',
        color: accent,
      });
      parts.push({
        geometry: placed(new CylinderGeometry(sk.headR * 0.8, sk.headR * 1.0, sk.headR * 0.55, 16), {
          x: 0,
          y: top.y + sk.headR * 0.22,
          z: top.z,
        }),
        bone: 'head',
        color: accent,
      });
      parts.push({
        geometry: placed(new CylinderGeometry(sk.headR * 1.01, sk.headR * 1.01, sk.headR * 0.12, 16, 1, true), {
          x: 0,
          y: top.y + sk.headR * 0.05,
          z: top.z,
        }),
        bone: 'head',
        color: shade(suit, 0.8),
      });
      break;
    case 'cap':
      parts.push({
        geometry: placed(
          new SphereGeometry(sk.headR * 1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
          { x: 0, y: head.y + sk.headR * 0.05, z: head.z },
        ),
        bone: 'head',
        color: accent,
      });
      parts.push({
        geometry: placed(new BoxGeometry(sk.headR * 1.3, sk.headR * 0.06, sk.headR * 0.85), {
          x: 0,
          y: head.y + sk.headR * 0.42,
          z: head.z + sk.headR * 1.05,
        }, [1, 1, 1], 0.18),
        bone: 'head',
        color: shade(accent, 0.85),
      });
      break;
    case 'goggles':
      for (const side of [-1, 1]) {
        parts.push({
          geometry: placed(new TorusGeometry(sk.headR * 0.22, sk.headR * 0.07, 6, 12), {
            x: side * sk.headR * 0.36,
            y: eyes.y,
            z: eyes.z + sk.headR * 0.08,
          }),
          bone: 'head',
          color: accent,
        });
      }
      parts.push({
        geometry: placed(new CylinderGeometry(sk.headR * 1.02, sk.headR * 1.02, sk.headR * 0.12, 18, 1, true), {
          x: 0,
          y: eyes.y,
          z: head.z,
        }),
        bone: 'head',
        color: '#22262c',
      });
      break;
    case 'snorkel':
      parts.push({
        geometry: placed(new CylinderGeometry(sk.headR * 0.09, sk.headR * 0.09, sk.headR * 1.6, 8), {
          x: -sk.headR * 1.0,
          y: head.y + sk.headR * 0.55,
          z: head.z + sk.headR * 0.1,
        }),
        bone: 'head',
        color: accent,
      });
      parts.push({
        geometry: placed(new BoxGeometry(sk.headR * 1.0, sk.headR * 0.4, sk.headR * 0.2), {
          x: 0,
          y: eyes.y,
          z: eyes.z + sk.headR * 0.12,
        }),
        bone: 'head',
        color: '#22262c',
      });
      break;
    case 'floatie':
      parts.push({
        geometry: placed(
          new TorusGeometry(sk.waistHalfW + sk.armR * 2.2, sk.armR * 1.9, 8, 18),
          { x: 0, y: spine.y + 0.01, z: 0 },
          [1, 1, sk.depth / sk.waistHalfW + 0.25],
          Math.PI / 2,
        ),
        bone: 'hips',
        color: accent,
      });
      break;
    case 'none':
    default:
      break;
  }

  return parts;
}

/** Build the bones, in their rest pose, in the unit space of the character. */
function buildBones(sk: Skeleton3D): Record<BoneName, Bone> {
  const layout = boneLayout(sk);
  const bones = {} as Record<BoneName, Bone>;
  for (const name of BONES) {
    const bone = new Bone();
    bone.name = name;
    const place = layout[name];
    bone.position.set(place.x, place.y, place.z);
    bones[name] = bone;
  }
  for (const name of BONES) {
    const parent = layout[name].parent;
    if (parent) bones[parent].add(bones[name]);
  }
  // The shoulders turn about their own axis last of all: applyPose3D's twist
  // is the turn of the upper arm about its own length, and that needs the
  // Y turn applied before the swing and the lift (see there).
  bones.shoulderL.rotation.order = 'XZY';
  bones.shoulderR.rotation.order = 'XZY';
  return bones;
}

// --- props --------------------------------------------------------------
//
// The props are drawn in metres and scaled into the unit figure, so a book
// is the size of a book beside a hand. Each prop is one merged mesh, and its
// grip (`grips.ts`) is set on the mesh. Only the prop in use is visible, so
// a prop that is not held costs no draw call.

/** Put a geometry drawn in metres into the unit space, at a place and a turn. */
function metric(
  g: BufferGeometry,
  at: readonly [number, number, number] = [0, 0, 0],
  turn: readonly [number, number, number] = [0, 0, 0],
): BufferGeometry {
  const k = 1 / METRES_PER_UNIT;
  tmpQuat.setFromEuler(tmpEuler.set(turn[0], turn[1], turn[2]));
  tmpMatrix.compose(tmpPos.set(at[0] * k, at[1] * k, at[2] * k), tmpQuat, tmpScale.set(k, k, k));
  g.applyMatrix4(tmpMatrix);
  return g;
}

/** A part of a prop: its geometry, its colour, on the root bone. */
function piece(geometry: BufferGeometry, color: string): Part {
  return { geometry, bone: 'root', color };
}

/** A prop: its parts merged into one mesh, placed by its grip. */
function propMesh(parts: Part[], grip: Grip): Mesh {
  const geometries = parts.map((part) => finish(part, 0));
  const merged = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();
  const mesh = new Mesh(merged ?? new BufferGeometry(), propMaterial());
  const k = 1 / METRES_PER_UNIT;
  mesh.position.set(grip.x * k, grip.y * k, grip.z * k);
  mesh.rotation.set(grip.rx, grip.ry, grip.rz);
  // A prop in the hand casts no shadow. Its shadow is a few pixels under the
  // figure's own, and it would cost a second draw call for every prop shown:
  // with a crowd on the loungers that broke the budget of README.md.
  mesh.castShadow = false;
  return mesh;
}

/**
 * The Turkish tea glass (an ince belli) with its saucer and a spoon. The
 * glass, the tea and the saucer are shared with the glass on the side table
 * (`teaGlassShape.ts`).
 *
 * The glass is centred on its bowl: its foot is `base` below the prop's
 * origin, which is the grip's point.
 */
function teaParts(spec: CharacterSpec): Part[] {
  const base = -0.077;
  const glass = TEA_GLASS_PROFILE.map(([x, y]) => new Vector2(x, y));
  const tea = TEA_LIQUID_PROFILE.map(([x, y]) => new Vector2(x, y));
  return [
    piece(metric(new LatheGeometry(glass, 14), [0, base, 0]), GLASS_COLOUR),
    piece(metric(new LatheGeometry(tea, 14), [0, base, 0]), TEA_COLOUR),
    piece(metric(new CircleGeometry(TEA_SURFACE.radius, 14), [0, base + TEA_SURFACE.y, 0], [-Math.PI / 2, 0, 0]), TEA_COLOUR),
    // The saucer lies under the glass, its top four millimetres above the foot.
    piece(metric(new CylinderGeometry(SAUCER.radiusTop, SAUCER.radiusBottom, SAUCER.thickness, 16), [0, base + SAUCER.thickness / 2, 0]), SAUCER_COLOUR),
    piece(metric(new TorusGeometry(0.026, 0.0025, 4, 12), [0, base + SAUCER.thickness, 0], [Math.PI / 2, 0, 0]), spec.accent),
    // The spoon lies on the saucer, its bowl at the end of the handle.
    piece(metric(new CylinderGeometry(0.0025, 0.0025, 0.08, 6), [0.028, base + 0.0065, 0.02], [0, 0, Math.PI / 2]), '#cfd3d8'),
    piece(metric(new SphereGeometry(0.007, 8, 6), [0.064, base + 0.0065, 0.02]), '#cfd3d8'),
  ];
}

/**
 * The open book: two boards in a shallow V, each with a white edge of pages.
 *
 * The spine is in the middle and the pages face the reader (+z). Each board
 * turns about the spine, so the wings come up towards the reader.
 */
function bookParts(spec: CharacterSpec): Part[] {
  const boardW = 0.17;
  const boardH = 0.23;
  const parts: Part[] = [];
  for (const side of [-1, 1]) {
    const turn = -side * 0.22;
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    // The middle of the board, turned about the spine at the origin.
    const mx = side * boardW * 0.5 * c;
    const mz = -side * boardW * 0.5 * sn;
    // The pages lie 4 mm in front of the cover, along the board's normal.
    const px = mx + 0.004 * sn;
    const pz = mz + 0.004 * c;
    parts.push(
      piece(metric(new BoxGeometry(boardW, boardH, 0.008), [mx, 0, mz], [0, turn, 0]), spec.accent),
      piece(metric(new BoxGeometry(boardW - 0.012, boardH - 0.014, 0.01), [px, 0, pz], [0, turn, 0]), '#fdfbf6'),
    );
  }
  return parts;
}

/** The broadsheet, folded once, with two grey bands of print. */
function newspaperParts(): Part[] {
  return [
    piece(metric(new BoxGeometry(0.42, 0.28, 0.003)), '#efece4'),
    piece(metric(new BoxGeometry(0.36, 0.034, 0.002), [0, 0.07, 0.002]), '#8c939c'),
    piece(metric(new BoxGeometry(0.36, 0.034, 0.002), [0, -0.03, 0.002]), '#8c939c'),
    // The fold, a crease down the middle.
    piece(metric(new BoxGeometry(0.004, 0.28, 0.0035)), '#d9d4c7'),
  ];
}

/**
 * A fan of five cards, pivoting about the hand, and a small pile on the lap.
 *
 * The cards are spread over 0.8 radians. The colours alternate, so the fan
 * reads as separate cards.
 */
function cardParts(): Part[] {
  const parts: Part[] = [];
  [-0.4, -0.2, 0, 0.2, 0.4].forEach((a, i) => {
    const colour = i % 2 === 0 ? '#fdfbf6' : '#c0392b';
    parts.push(piece(metric(new BoxGeometry(0.065, 0.095, 0.002), [-Math.sin(a) * 0.05, Math.cos(a) * 0.05, i * 0.0005], [0, 0, a]), colour));
  });
  // The pile on the lap: four cards flat, a little below the hand.
  for (let i = 0; i < 4; i += 1) {
    parts.push(piece(metric(new BoxGeometry(0.065, 0.012, 0.095), [0.02, -0.12 - i * 0.003, 0.06]), i % 2 ? '#3b6fb6' : '#fdfbf6'));
  }
  return parts;
}

/**
 * The laptop, lying flat: the base and its keyboard, and the screen on the
 * far hinge, leaning back towards the typist. The screen is pale, so it reads
 * as lit. A true emissive part would need a second material, and every prop
 * shares this one.
 */
function laptopParts(): Part[] {
  return [
    piece(metric(new BoxGeometry(0.3, 0.012, 0.21)), '#b8bec6'),
    piece(metric(new BoxGeometry(0.26, 0.002, 0.1), [0, 0.007, -0.02]), '#2b3138'),
    piece(metric(new BoxGeometry(0.3, 0.2, 0.008), [0, 0.1, 0.071], [-0.35, 0, 0]), '#cfeeff'),
  ];
}

/** The folding hand fan: a fan of six pleats on its hinge, and a handle. */
function fanParts(spec: CharacterSpec): Part[] {
  const parts: Part[] = [];
  const half = 0.6;
  for (let i = 0; i < 6; i += 1) {
    const start = Math.PI / 2 - half + (i * 2 * half) / 6;
    const colour = i % 2 === 0 ? '#f7e7d0' : spec.accent;
    parts.push(piece(metric(new CircleGeometry(0.12, 4, start, (2 * half) / 6)), colour));
  }
  parts.push(piece(metric(new BoxGeometry(0.012, 0.06, 0.004), [0, -0.03, 0]), '#8a5a2b'));
  return parts;
}

/** Lemonade in a tumbler, with a straw leaning out of the top. */
function glassParts(): Part[] {
  return [
    piece(metric(new CylinderGeometry(0.038, 0.032, 0.13, 14)), '#ffd54a'),
    piece(metric(new TorusGeometry(0.038, 0.003, 4, 14), [0, 0.065, 0], [Math.PI / 2, 0, 0]), '#eef6fa'),
    piece(metric(new CylinderGeometry(0.0035, 0.0035, 0.2, 6), [0.012, 0.1, 0], [0, 0, -0.3]), '#e8504a'),
  ];
}

/** The crossword: a sheet with its grid of dark squares, and a pencil on it. */
function crosswordParts(): Part[] {
  const parts: Part[] = [piece(metric(new BoxGeometry(0.21, 0.15, 0.002)), '#fffdf5')];
  for (const [x, y] of [[-0.06, 0.04], [-0.02, 0.04], [0.02, 0.04], [-0.06, -0.01], [0.06, -0.01], [0.06, -0.05], [-0.02, -0.05]]) {
    parts.push(piece(metric(new BoxGeometry(0.018, 0.018, 0.001), [x, y, 0.0015]), '#2b2f36'));
  }
  parts.push(piece(metric(new CylinderGeometry(0.0045, 0.0045, 0.17, 6), [0.02, -0.07, 0.006], [0, 0, Math.PI / 2]), '#f2c230'));
  parts.push(piece(metric(new CylinderGeometry(0.0005, 0.0045, 0.012, 6), [0.1, -0.07, 0.006], [0, 0, -Math.PI / 2]), '#3a3a3a'));
  return parts;
}

/** A phone, its screen to the face. */
function phoneParts(): Part[] {
  return [
    piece(metric(new BoxGeometry(0.075, 0.14, 0.008), [0, 0, 0.004]), '#1d232b'),
    piece(metric(new BoxGeometry(0.063, 0.125, 0.002), [0, 0, -0.004]), '#8fc3e6'),
  ];
}

/** An ice lolly on its stick. */
function snackParts(): Part[] {
  return [
    piece(metric(new CylinderGeometry(0.0045, 0.0045, 0.07, 6), [0, -0.03, 0]), '#d9c29a'),
    piece(metric(new CapsuleGeometry(0.02, 0.02, 3, 8), [0, 0.03, 0]), '#ff8fa3'),
  ];
}

/**
 * The headphones, worn on the head: a band over the top, and a cup at each
 * ear. They are drawn in the head's own space, so they turn with the head.
 */
function headphonesMesh(sk: Skeleton3D): Mesh {
  const r = sk.headR;
  const dark = '#22262c';
  const parts: Part[] = [
    { geometry: placed(new TorusGeometry(r * 1.1, r * 0.07, 6, 16, Math.PI), { x: 0, y: 0, z: 0 }), bone: 'root', color: dark },
  ];
  for (const side of [-1, 1]) {
    parts.push({
      geometry: placed(new CylinderGeometry(r * 0.42, r * 0.42, r * 0.42, 10), { x: side * r * 1.1, y: -r * 0.05, z: -r * 0.05 }, [1, 1, 1], 0, Math.PI / 2),
      bone: 'root',
      color: dark,
    });
  }
  const mesh = new Mesh(mergeGeometries(parts.map((part) => finish(part, 0)), false) ?? new BufferGeometry(), propMaterial());
  // No shadow, for the same reason as the props in the hand.
  mesh.castShadow = false;
  return mesh;
}

/** The colour of the towel in the hand: the teal of the errand's towel. */
const TOWEL_COLOUR = '#7ad3c9';

/** The props held in the right hand (and the headphones, worn). */
function buildProps(spec: CharacterSpec, sk: Skeleton3D): Record<PropKind, Object3D> {
  const r = sk.armR;
  // The errands' props (Sprint 25) are drawn in the unit space with the
  // sizes they always had: they keep their placement, so their grip is zero.
  const hand = (g: BufferGeometry, color: string, y = 0, z = 0, scale: [number, number, number] = [1, 1, 1]) => ({
    geometry: placed(g, { x: 0, y, z }, scale),
    bone: 'root' as BoneName,
    color,
  });
  const none = GRIPS.icecream;
  return {
    cup: propMesh(teaParts(spec), GRIPS.cup),
    book: propMesh(bookParts(spec), GRIPS.book),
    phone: propMesh(phoneParts(), GRIPS.phone),
    snack: propMesh(snackParts(), GRIPS.snack),
    newspaper: propMesh(newspaperParts(), GRIPS.newspaper),
    cards: propMesh(cardParts(), GRIPS.cards),
    laptop: propMesh(laptopParts(), GRIPS.laptop),
    headphones: headphonesMesh(sk),
    fan: propMesh(fanParts(spec), GRIPS.fan),
    glass: propMesh(glassParts(), GRIPS.glass),
    crossword: propMesh(crosswordParts(), GRIPS.crossword),
    icecream: propMesh([
      hand(new CylinderGeometry(r * 0.9, 0.001, r * 2.2, 8), '#e7b97a', -r * 1.2, r * 1.2),
      hand(new SphereGeometry(r * 1.0, 8, 6), '#ff9ec4', -r * 2.8, r * 1.2),
    ], none),
    bottle: propMesh([hand(new CapsuleGeometry(r * 0.55, r * 2.0, 3, 8), '#4aa3df', -r * 1.8, r * 1.4)], none),
    paddle: propMesh([hand(new CylinderGeometry(r * 1.8, r * 1.8, r * 0.3, 12), '#e85d4f', -r * 1.2, r * 1.2)], none),
    paddleDark: propMesh([hand(new CylinderGeometry(r * 1.8, r * 1.8, r * 0.3, 12), '#222222', -r * 1.2, r * 1.2)], none),
    // The towel is folded in the palm, and spread between both hands for the shake.
    towel: propMesh([piece(metric(new BoxGeometry(0.2, 0.05, 0.14)), TOWEL_COLOUR)], GRIPS.towel),
    towelSpread: propMesh([piece(metric(new BoxGeometry(0.72, 0.02, 0.2)), TOWEL_COLOUR)], GRIPS.towelSpread),
  };
}

// --- the rig -------------------------------------------------------------

export function buildRig3D(spec: CharacterSpec): Rig3D {
  const sk = buildSkeleton3D(spec);
  const bones = buildBones(sk);
  const index = new Map<BoneName, number>(BONES.map((name, i) => [name, i]));

  const parts = bodyParts(spec, sk);
  const geometries = parts.map((part) => finish(part, index.get(part.bone) ?? 0));
  const geometry = mergeGeometries(geometries, false) ?? new BufferGeometry();
  for (const g of geometries) g.dispose();
  geometry.computeBoundingSphere();

  const root = new Group();
  const mesh = new SkinnedMesh(geometry, characterMaterial());
  mesh.castShadow = true;
  mesh.add(bones.root);
  mesh.updateMatrixWorld(true);
  const skeleton = new Skeleton(BONES.map((name) => bones[name]));
  mesh.bind(skeleton);
  // The bones move far from where they were bound (a swimmer lies down), so
  // the bounding sphere of the rest pose would cull a swimmer whose head is
  // still on the screen.
  mesh.frustumCulled = false;

  const outline = new SkinnedMesh(geometry, inkMaterial());
  outline.bind(skeleton, mesh.bindMatrix);
  outline.frustumCulled = false;

  root.add(mesh, outline);

  // The props hang from the right hand, except the headphones, which are
  // worn: they go on the head, so they turn with it.
  const propLayer = new Group();
  bones.handR.add(propLayer);
  const props = buildProps(spec, sk);
  for (const [kind, prop] of Object.entries(props)) {
    prop.visible = false;
    if (kind === 'headphones') bones.head.add(prop);
    else propLayer.add(prop);
  }

  return {
    root,
    mesh,
    outline,
    bones,
    skeleton: sk,
    spec,
    props,
    propLayer,
    destroy() {
      root.removeFromParent();
      geometry.dispose();
      skeleton.dispose();
      for (const prop of Object.values(props)) {
        if (prop instanceof Mesh) prop.geometry.dispose();
      }
    },
  };
}
