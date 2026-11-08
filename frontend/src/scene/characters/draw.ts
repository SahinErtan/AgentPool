/**
 * Vector body parts. Everything is drawn with PixiJS Graphics primitives —
 * there are no image assets anywhere in this project.
 *
 * Unit space: the character is 1.0 unit tall, the origin is at the feet and
 * `y` grows downward. The scene scales the rig to pixels.
 */

import { Graphics } from 'pixi.js';
import type { CharacterSpec } from './spec';

export interface Skeleton {
  /** Total height in units (always 1). */
  height: number;
  hipY: number;
  kneeY: number;
  ankleY: number;
  shoulderY: number;
  neckY: number;
  headCY: number;
  headR: number;
  torsoW: number;
  hipW: number;
  shoulderW: number;
  upperArm: number;
  lowerArm: number;
  thigh: number;
  shin: number;
  limb: number;
}

/** Compute the skeleton from the archetype proportions, normalised to height 1. */
export function buildSkeleton(spec: CharacterSpec): Skeleton {
  const table: Record<string, { leg: number; torso: number; arm: number; headR: number; hipWidth: number; shoulderWidth: number; girth: number }> = {
    bean: { leg: 0.22, torso: 0.42, arm: 0.26, headR: 0.17, hipWidth: 1.0, shoulderWidth: 1.0, girth: 1.15 },
    pear: { leg: 0.3, torso: 0.38, arm: 0.28, headR: 0.15, hipWidth: 1.25, shoulderWidth: 0.95, girth: 1.0 },
    tall: { leg: 0.38, torso: 0.34, arm: 0.32, headR: 0.14, hipWidth: 0.95, shoulderWidth: 0.95, girth: 0.85 },
    squat: { leg: 0.18, torso: 0.4, arm: 0.24, headR: 0.19, hipWidth: 1.1, shoulderWidth: 1.2, girth: 1.1 },
    round: { leg: 0.22, torso: 0.36, arm: 0.25, headR: 0.2, hipWidth: 1.05, shoulderWidth: 1.05, girth: 1.2 },
  };
  const p = table[spec.archetype];

  const total = p.leg + p.torso + 2 * p.headR;
  const leg = p.leg / total;
  const torso = p.torso / total;
  const arm = p.arm / total;
  const headR = p.headR / total;

  const hipY = -leg;
  return {
    height: 1,
    hipY,
    kneeY: -leg * 0.5,
    ankleY: -leg * 0.08,
    shoulderY: hipY - torso,
    neckY: hipY - torso * 0.92,
    headCY: hipY - torso - headR * 0.95,
    headR,
    torsoW: 0.19 * p.girth,
    hipW: 0.135 * p.girth * p.hipWidth,
    shoulderW: 0.145 * p.girth * p.shoulderWidth,
    upperArm: arm * 0.52,
    lowerArm: arm * 0.48,
    thigh: leg * 0.52,
    shin: leg * 0.48,
    limb: 0.058 * (0.85 + p.girth * 0.2),
  };
}

function outline(g: Graphics, width = 0.012): Graphics {
  return g.stroke({ width, color: 0x101820, alpha: 0.22, join: 'round' });
}

/** The torso, drawn in body-local space with the hip at the origin. */
export function drawTorso(spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  // In body-local space the hip is at 0 and the shoulder is at a negative y.
  const top = sk.shoulderY - sk.hipY; // negative
  const height = -top; // positive
  const w = sk.torsoW;
  // A slightly tapered body reads better than a plain rectangle.
  g.roundRect(-w / 2, top, w, height, w * 0.42).fill(spec.suit);
  outline(g);
  // A lighter belly band gives the flat shape some form.
  g.roundRect(-w * 0.34, top + height * 0.45, w * 0.68, height * 0.4, w * 0.3).fill({
    color: 0xffffff,
    alpha: 0.14,
  });
  return g;
}

/** The head, centred on the origin. */
export function drawHead(spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  g.circle(0, 0, sk.headR).fill(spec.skin);
  outline(g);
  return g;
}

/** Hair: a cap that covers the top and back of the head. */
export function drawHair(spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const r = sk.headR;
  // A cap over the top and back of the head, leaving the face clear.
  // In Pixi (y down) 180 deg points left, 270 deg points up, so the arc from
  // 180 to 306 degrees covers the back and the top of the skull.
  g.arc(0, 0, r * 1.04, Math.PI, Math.PI * 1.7).fill(spec.hair);
  g.circle(-r * 0.46, r * 0.16, r * 0.5).fill(spec.hair);
  return g;
}

/** The mouth. The eyes live in their own container so they can blink. */
export function drawMouth(_spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const r = sk.headR;
  g.moveTo(-r * 0.16, r * 0.42)
    .quadraticCurveTo(0, r * 0.52, r * 0.16, r * 0.42)
    .stroke({ width: r * 0.08, color: 0x2a2118, alpha: 0.75, cap: 'round' });
  return g;
}

/** The two eyes. */
export function drawEyes(_spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const r = sk.headR;
  g.ellipse(-r * 0.3, r * 0.06, r * 0.11, r * 0.15).fill(0x2a2118);
  g.ellipse(r * 0.3, r * 0.06, r * 0.11, r * 0.15).fill(0x2a2118);
  return g;
}

/** A capsule limb, drawn from the pivot downwards. */
export function drawLimb(length: number, thickness: number, color: string): Graphics {
  const g = new Graphics();
  g.roundRect(-thickness / 2, 0, thickness, length, thickness / 2).fill(color);
  outline(g, thickness * 0.22);
  return g;
}

/** A hand: a small circle at the end of the forearm. */
export function drawHand(thickness: number, color: string): Graphics {
  const g = new Graphics();
  g.circle(0, 0, thickness * 0.62).fill(color);
  return g;
}

/** A foot: a small rounded shape pointing forwards. */
export function drawFoot(thickness: number, color: string): Graphics {
  const g = new Graphics();
  g.roundRect(-thickness * 0.5, -thickness * 0.35, thickness * 1.35, thickness * 0.7, thickness * 0.3).fill(
    color,
  );
  return g;
}

/** A swim cap or sun hat. */
export function drawHat(spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const r = sk.headR;
  if (spec.accessory === 'sunhat') {
    g.ellipse(0, -r * 0.22, r * 1.55, r * 0.34).fill(spec.accent);
    g.circle(0, -r * 0.5, r * 0.72).fill(spec.accent);
    g.ellipse(0, -r * 0.5, r * 0.72, r * 0.4).fill({ color: 0xffffff, alpha: 0.16 });
  } else if (spec.accessory === 'cap') {
    g.circle(0, -r * 0.42, r * 0.86).fill(spec.accent);
    g.roundRect(r * 0.2, -r * 0.44, r * 1.15, r * 0.26, r * 0.13).fill(spec.accent);
  }
  return g;
}

/** Goggles: worn on the face while the character is in the water. */
export function drawGoggles(spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const r = sk.headR;
  g.roundRect(-r * 0.86, -r * 0.16, r * 1.72, r * 0.42, r * 0.16).fill(spec.accent);
  g.circle(-r * 0.42, r * 0.05, r * 0.22).fill({ color: 0xffffff, alpha: 0.55 });
  g.circle(r * 0.42, r * 0.05, r * 0.22).fill({ color: 0xffffff, alpha: 0.55 });
  return g;
}

/** A snorkel tube that pokes up out of the water. */
export function drawSnorkel(spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const r = sk.headR;
  g.roundRect(-r * 0.1, -r * 1.7, r * 0.22, r * 1.6, r * 0.11).fill(spec.accent);
  g.roundRect(-r * 0.5, r * 0.12, r * 0.66, r * 0.36, r * 0.14).fill(spec.accent);
  return g;
}

/** An inflatable ring around the torso. */
export function drawFloatie(_spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const y = (sk.shoulderY - sk.hipY) * 0.45;
  const rx = sk.torsoW * 0.55;
  g.ellipse(0, y, rx, rx * 0.42).stroke({ width: sk.torsoW * 0.18, color: 0xe8823f, cap: 'round' });
  g.ellipse(0, y, rx, rx * 0.42).stroke({ width: sk.torsoW * 0.05, color: 0xffffff, alpha: 0.35 });
  return g;
}

/* ------------------------------------------------------------------ */
/* Idle activity props                                                */
/* ------------------------------------------------------------------ */

/** A teacup and saucer. */
export function drawTeacup(spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const s = sk.limb * 1.5;
  g.ellipse(0, s * 0.42, s * 0.85, s * 0.28).fill(0xf3f0ea);
  g.roundRect(-s * 0.42, -s * 0.45, s * 0.84, s * 0.85, s * 0.16).fill(0xfbf8f2);
  g.ellipse(0, -s * 0.45, s * 0.42, s * 0.15).fill(spec.accent);
  g.moveTo(s * 0.42, -s * 0.18)
    .quadraticCurveTo(s * 0.78, -s * 0.12, s * 0.44, s * 0.18)
    .stroke({ width: s * 0.12, color: 0xfbf8f2, cap: 'round' });
  return g;
}

/** An open book. */
export function drawBook(_spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const s = sk.limb * 1.7;
  g.moveTo(0, 0).lineTo(-s * 0.85, -s * 0.24).lineTo(-s * 0.85, s * 0.4).lineTo(0, s * 0.62).closePath()
    .fill(0xfbf8f2);
  g.moveTo(0, 0).lineTo(s * 0.85, -s * 0.24).lineTo(s * 0.85, s * 0.4).lineTo(0, s * 0.62).closePath()
    .fill(0xf1ece2);
  g.moveTo(0, 0).lineTo(0, s * 0.62).stroke({ width: s * 0.07, color: 0x8a8071 });
  return g;
}

/** A phone with a lit screen. */
export function drawPhone(_spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const s = sk.limb * 1.1;
  g.roundRect(-s * 0.42, -s * 0.75, s * 0.84, s * 1.5, s * 0.18).fill(0x2b3038);
  g.roundRect(-s * 0.32, -s * 0.63, s * 0.64, s * 1.24, s * 0.12).fill(0x8fd8ff);
  return g;
}

/** An ice lolly. */
export function drawSnack(spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const s = sk.limb * 1.2;
  g.roundRect(-s * 0.09, 0, s * 0.18, s * 0.8, s * 0.09).fill(0xd8c39a);
  g.circle(0, -s * 0.28, s * 0.42).fill(spec.accent);
  g.circle(-s * 0.14, -s * 0.42, s * 0.16).fill({ color: 0xffffff, alpha: 0.35 });
  return g;
}
