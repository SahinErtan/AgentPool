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
  /** The length of the torso, from the hip to the shoulder. */
  torsoH: number;
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
    headCY: hipY - torso - headR * 0.78,
    headR,
    torsoW: 0.19 * p.girth,
    hipW: 0.135 * p.girth * p.hipWidth,
    shoulderW: 0.145 * p.girth * p.shoulderWidth,
    torsoH: torso,
    upperArm: arm * 0.52,
    lowerArm: arm * 0.48,
    thigh: leg * 0.52,
    shin: leg * 0.48,
    limb: 0.058 * (0.85 + p.girth * 0.2),
  };
}

/**
 * The ink.
 *
 * A limb has no outline of its own: the parts of the body meet each other,
 * and a line between them reads as a gap. The torso and the head keep one
 * outline each, because those are the edges of the figure against the
 * world.
 */
function outline(g: Graphics, width = 0.01): Graphics {
  return g.stroke({ width, color: 0x101820, alpha: 0.2, join: 'round' });
}

/**
 * The torso, drawn in body-local space with the hip at the origin.
 *
 * It is one shape: the shoulders, the waist and the hips, in a single
 * outline. A rounded rectangle with a line drawn around it reads as a box,
 * and the arms and legs that grow out of a box do not belong to it.
 */
export function drawTorso(spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  // In body-local space the hip is at 0 and the shoulder is at a negative y.
  const top = sk.shoulderY - sk.hipY; // negative
  const height = -top; // positive
  /** A point on the torso, as a fraction from the shoulder to the hip. */
  const yAt = (f: number): number => top + height * f;

  const shoulder = sk.shoulderW / 2;
  const waist = Math.min(sk.shoulderW, sk.hipW) * 0.42;
  const hip = sk.hipW / 2;

  g.moveTo(-shoulder, yAt(0.06));
  // The line of the shoulders dips a little towards the neck.
  g.quadraticCurveTo(-shoulder * 0.55, yAt(0.12), 0, yAt(0.1));
  g.quadraticCurveTo(shoulder * 0.55, yAt(0.12), shoulder, yAt(0.06));
  // Down the side: the shoulder, the waist and then the hip.
  g.quadraticCurveTo(shoulder * 1.05, yAt(0.3), waist, yAt(0.48));
  g.quadraticCurveTo(hip * 1.1, yAt(0.76), hip, yAt(1));
  g.lineTo(-hip, yAt(1));
  g.quadraticCurveTo(-hip * 1.1, yAt(0.76), -waist, yAt(0.48));
  g.quadraticCurveTo(-shoulder * 1.05, yAt(0.3), -shoulder, yAt(0.06));
  g.closePath();
  g.fill(spec.suit);
  outline(g);

  // A lighter band across the chest gives the flat shape some form.
  g.roundRect(
    -sk.torsoW * 0.3,
    yAt(0.14),
    sk.torsoW * 0.6,
    height * 0.24,
    sk.torsoW * 0.2,
  ).fill({ color: 0xffffff, alpha: 0.13 });
  return g;
}

/**
 * The head, centred on the origin.
 *
 * The neck is part of the head: a head that is a ball floating above the
 * shoulders is the thing that made the figure look like a mannequin.
 */
export function drawHead(spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const r = sk.headR;
  // The neck: a short column that runs into the shoulders, so the head is
  // attached to the body instead of hovering over it.
  g.roundRect(-r * 0.36, r * 0.5, r * 0.72, r * 0.95, r * 0.2).fill(spec.skin);
  g.circle(0, 0, r).fill(spec.skin);
  outline(g);
  return g;
}

/**
 * Hair: a cap that covers the top and back of the head.
 *
 * The cap has to sit *on* the skull. It used to be a slab that floated
 * above the head and covered the face, and every figure looked as if it
 * were wearing a bucket.
 */
export function drawHair(spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const r = sk.headR;
  // The cap follows the skull: it is a little outside it, so that it
  // covers the outline of the head at the top.
  g.moveTo(-r * 0.99, -r * 0.1);
  g.quadraticCurveTo(-r * 0.78, -r * 1.0, 0, -r * 0.99);
  g.quadraticCurveTo(r * 0.78, -r * 1.0, r * 0.99, -r * 0.1);
  // The fringe across the forehead, above the eyes.
  g.quadraticCurveTo(r * 0.52, -r * 0.46, 0, -r * 0.42);
  g.quadraticCurveTo(-r * 0.52, -r * 0.46, -r * 0.99, -r * 0.1);
  g.closePath();
  g.fill(spec.hair);
  // A bun at the back of the head.
  g.circle(-r * 0.88, r * 0.16, r * 0.38).fill(spec.hair);
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

/**
 * A capsule limb, drawn from the pivot downwards.
 *
 * It has no outline: the arm grows out of the torso and the leg out of the
 * hip, and a line between them reads as a crack in the figure. The shape
 * tapers towards the far end, so the figure is not a stack of tubes.
 */
export function drawLimb(length: number, thickness: number, color: string): Graphics {
  const g = new Graphics();
  const root = thickness / 2;
  const tip = thickness * 0.38;
  g.moveTo(-root, 0);
  g.quadraticCurveTo(-root * 1.05, length * 0.55, -tip, length);
  g.quadraticCurveTo(0, length + tip * 0.9, tip, length);
  g.quadraticCurveTo(root * 1.05, length * 0.55, root, 0);
  g.closePath();
  g.fill(color);
  return g;
}

/** A hand: a small circle at the end of the forearm. */
export function drawHand(thickness: number, color: string): Graphics {
  const g = new Graphics();
  g.circle(0, 0, thickness * 0.6).fill(color);
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

/**
 * A swim cap or a sun hat.
 *
 * The brim used to be a wide ellipse, which is a hat seen from the front:
 * from the side it came out as a plank across the head. The brim is a
 * short ledge at the back of the head now.
 */
export function drawHat(spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const r = sk.headR;
  if (spec.accessory === 'sunhat') {
    // The crown of the hat.
    g.moveTo(-r * 0.98, -r * 0.12);
    g.quadraticCurveTo(-r * 0.8, -r * 1.1, 0, -r * 1.06);
    g.quadraticCurveTo(r * 0.8, -r * 1.1, r * 0.98, -r * 0.12);
    g.closePath();
    g.fill(spec.accent);
    // The brim: a short ledge behind the head.
    g.ellipse(-r * 0.32, -r * 0.2, r * 1.02, r * 0.2).fill(spec.accent);
    g.ellipse(-r * 0.32, -r * 0.26, r * 0.9, r * 0.12).fill({ color: 0xffffff, alpha: 0.16 });
  } else if (spec.accessory === 'cap') {
    g.moveTo(-r * 0.98, -r * 0.1);
    g.quadraticCurveTo(-r * 0.7, -r * 1.05, 0, -r * 1);
    g.quadraticCurveTo(r * 0.7, -r * 1.05, r * 0.98, -r * 0.1);
    g.closePath();
    g.fill(spec.accent);
    // The peak of the cap points the way the figure faces.
    g.ellipse(r * 0.78, -r * 0.16, r * 0.62, r * 0.16).fill(spec.accent);
  }
  return g;
}

/** Goggles: worn on the face while the character is in the water. */
export function drawGoggles(_spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const r = sk.headR;
  // The strap goes round the head, and the lens sits over the eye.
  //
  // The strap used to be as wide as the head and as bright as the accent
  // colour, and it came out as a band laid across the face.
  g.roundRect(-r * 0.92, -r * 0.14, r * 1.84, r * 0.1, r * 0.05).fill({
    color: 0x2b3038,
    alpha: 0.5,
  });
  g.ellipse(r * 0.32, -r * 0.02, r * 0.34, r * 0.24).fill(0x2b3038);
  g.ellipse(r * 0.32, -r * 0.04, r * 0.19, r * 0.13).fill({ color: 0xffffff, alpha: 0.5 });
  return g;
}

/** A snorkel tube that pokes up out of the water. */
export function drawSnorkel(_spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const r = sk.headR;
  // The tube comes out of the side of the head, not out of the top of
  // it, and it is dark: a bright tube up the middle of the skull came
  // out as a stick laid over the face.
  g.roundRect(-r * 0.86, -r * 1.5, r * 0.18, r * 1.4, r * 0.09).fill(0x39424c);
  g.roundRect(-r * 0.98, -r * 0.05, r * 0.42, r * 0.3, r * 0.12).fill(0x39424c);
  return g;
}

/**
 * An inflatable ring around the torso.
 *
 * It used to be an ellipse drawn with a thick stroke, which is a ring seen
 * from above: on a figure lying in the water it came out as an orange
 * diamond across the chest. A band around the chest reads the same at
 * every size and from every angle.
 */
export function drawFloatie(_spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const y = (sk.shoulderY - sk.hipY) * 0.42;
  const w = sk.torsoW * 1.02;
  const h = sk.torsoW * 0.2;
  g.roundRect(-w / 2, y - h / 2, w, h, h * 0.5).fill(0xef9a5c);
  // A band of light along the top of it.
  g.roundRect(-w * 0.42, y - h * 0.34, w * 0.84, h * 0.24, h * 0.12).fill({
    color: 0xffffff,
    alpha: 0.32,
  });
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

/** A folded newspaper, with the columns of print on it. */
export function drawNewspaper(_spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const s = sk.limb * 1.8;
  g.moveTo(0, -s * 0.5).lineTo(s * 0.92, -s * 0.2).lineTo(s * 0.92, s * 0.5).lineTo(0, s * 0.72)
    .closePath()
    .fill(0xf7f4ec);
  g.moveTo(0, -s * 0.5).lineTo(s * 0.92, -s * 0.2).stroke({ width: s * 0.05, color: 0x9a9184 });
  // The columns of print.
  for (let column = 0; column < 2; column += 1) {
    const x = s * (0.2 + column * 0.36);
    for (let line = 0; line < 4; line += 1) {
      const y = -s * 0.28 + line * s * 0.2;
      g.moveTo(x, y).lineTo(x + s * 0.28, y + s * 0.06).stroke({
        width: s * 0.045,
        color: 0x8f877a,
        alpha: 0.8,
      });
    }
  }
  return g;
}

/** Two cards, one in each hand. */
export function drawCards(_spec: CharacterSpec, sk: Skeleton): Graphics {
  const g = new Graphics();
  const s = sk.limb * 0.8;
  g.roundRect(-s * 0.5, -s * 0.72, s, s * 1.44, s * 0.12).fill(0xfdfdfb);
  g.roundRect(-s * 0.42, -s * 0.62, s * 0.84, s * 1.24, s * 0.1).fill(0xffffff);
  g.circle(0, 0, s * 0.26).fill(0xd8484f);
  g.moveTo(-s * 0.5, -s * 0.72).lineTo(s * 0.5, s * 0.72).stroke({
    width: s * 0.06,
    color: 0xb9b2a6,
    alpha: 0.7,
  });
  return g;
}
