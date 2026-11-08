/**
 * The rig: a tree of pivot containers that mirrors the skeleton.
 *
 * Every joint is a `Container` whose origin sits exactly on the joint, so
 * rotating the container rotates the limb about that joint. Each body part is
 * drawn once as a `Graphics` and never redrawn — only transforms change.
 */

import { Container, Graphics } from 'pixi.js';
import type { CharacterSpec } from './spec';
import {
  buildSkeleton,
  drawBook,
  drawEyes,
  drawFloatie,
  drawFoot,
  drawGoggles,
  drawHair,
  drawHand,
  drawHat,
  drawHead,
  drawLimb,
  drawMouth,
  drawPhone,
  drawSnack,
  drawSnorkel,
  drawTeacup,
  drawTorso,
  type Skeleton,
} from './draw';

export interface Rig {
  root: Container;
  /** Mirrors the character when it faces left; keeps the root scale free. */
  facing: Container;
  bob: Container;
  body: Container;
  headPivot: Container;
  eyes: Container;
  accessories: {
    hat: Container;
    goggles: Container;
    snorkel: Container;
    floatie: Container;
  };
  armL: Container;
  armR: Container;
  elbowL: Container;
  elbowR: Container;
  handL: Container;
  handR: Container;
  legL: Container;
  legR: Container;
  kneeL: Container;
  kneeR: Container;
  footL: Container;
  footR: Container;
  /** Props (cup, book, ...) live here so they follow the hand. */
  propLayer: Container;
  skeleton: Skeleton;
  spec: CharacterSpec;
  destroy(): void;
}

export function buildRig(spec: CharacterSpec): Rig {
  const sk = buildSkeleton(spec);

  const root = new Container();
  const facing = new Container();
  const bob = new Container();
  const body = new Container();

  root.addChild(facing);
  facing.addChild(bob);
  bob.addChild(body);

  // Body-local space: the hip is at the origin, up is -y.
  body.position.set(0, sk.hipY);

  const torso = drawTorso(spec, sk);
  body.addChild(torso);

  // --- head -------------------------------------------------------
  const headPivot = new Container();
  headPivot.position.set(0, sk.headCY - sk.hipY);
  body.addChild(headPivot);

  const head = drawHead(spec, sk);
  const hair = drawHair(spec, sk);
  const mouth = drawMouth(spec, sk);
  const eyes = new Container();
  // The eyes live in their own container so a blink can scale them vertically.
  eyes.addChild(drawEyes(spec, sk));

  headPivot.addChild(head, hair, eyes, mouth);

  const hat = new Container();
  hat.addChild(drawHat(spec, sk));
  const goggles = new Container();
  goggles.addChild(drawGoggles(spec, sk));
  const snorkel = new Container();
  snorkel.addChild(drawSnorkel(spec, sk));
  headPivot.addChild(hat, goggles, snorkel);

  // --- arms -------------------------------------------------------
  const makeArm = (side: -1 | 1) => {
    const shoulder = new Container();
    shoulder.position.set((side * sk.shoulderW) / 2, sk.shoulderY - sk.hipY);
    body.addChild(shoulder);

    const upper = drawLimb(sk.upperArm, sk.limb, spec.suit);
    shoulder.addChild(upper);

    const elbow = new Container();
    elbow.position.set(0, sk.upperArm);
    shoulder.addChild(elbow);

    const lower = drawLimb(sk.lowerArm, sk.limb * 0.9, spec.skin);
    elbow.addChild(lower);

    const hand = drawHand(sk.limb, spec.skin);
    elbow.addChild(hand);

    return { shoulder, elbow, hand };
  };

  const left = makeArm(-1);
  const right = makeArm(1);

  // --- legs -------------------------------------------------------
  const makeLeg = (side: -1 | 1) => {
    const hip = new Container();
    hip.position.set((side * sk.hipW) / 2, 0);
    body.addChild(hip);

    const thigh = drawLimb(sk.thigh, sk.limb * 1.05, spec.suit);
    hip.addChild(thigh);

    const knee = new Container();
    knee.position.set(0, sk.thigh);
    hip.addChild(knee);

    const shin = drawLimb(sk.shin, sk.limb * 0.92, spec.skin);
    knee.addChild(shin);

    const foot = drawFoot(sk.limb, spec.skin);
    foot.position.set(0, sk.shin);
    knee.addChild(foot);

    return { hip, knee, foot };
  };

  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  // --- accessories ------------------------------------------------
  const floatie = new Container();
  floatie.addChild(drawFloatie(spec, sk));
  body.addChildAt(floatie, 1);

  // --- props ------------------------------------------------------
  const propLayer = new Container();
  right.hand.addChild(propLayer);

  return {
    root,
    facing,
    bob,
    body,
    headPivot,
    eyes,
    accessories: { hat, goggles, snorkel, floatie },
    armL: left.shoulder,
    armR: right.shoulder,
    elbowL: left.elbow,
    elbowR: right.elbow,
    handL: left.hand,
    handR: right.hand,
    legL: leftLeg.hip,
    legR: rightLeg.hip,
    kneeL: leftLeg.knee,
    kneeR: rightLeg.knee,
    footL: leftLeg.foot,
    footR: rightLeg.foot,
    propLayer,
    skeleton: sk,
    spec,
    destroy() {
      root.destroy({ children: true });
    },
  };
}

/** The props an idle activity can hold, drawn once and toggled by visibility. */
export interface PropSet {
  cup: Graphics;
  book: Graphics;
  phone: Graphics;
  snack: Graphics;
}

export function buildProps(spec: CharacterSpec, sk: Skeleton): PropSet {
  return {
    cup: drawTeacup(spec, sk),
    book: drawBook(spec, sk),
    phone: drawPhone(spec, sk),
    snack: drawSnack(spec, sk),
  };
}
