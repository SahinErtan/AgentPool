/**
 * The animator: the 2D rig's half of the motion.
 *
 * The pose itself comes from the `PoseDriver`, which knows nothing about
 * drawing and is shared with the 3D scene. This class writes that pose onto
 * the Pixi rig: the joint rotations, the blink, the hair and the prop in the
 * hand.
 */

import { damp } from './math';
import { buildProps, type PropSet, type Rig } from './rig';
import type { CharacterSpec } from './spec';
import type { Pose, ReactionKind } from './poses';
import { PoseDriver, type CharState, type Weights } from '../motion/driver';

export type { CharState };
export { damp };

export class CharacterAnimator {
  readonly rig: Rig;
  readonly spec: CharacterSpec;
  readonly props: PropSet;
  /** The half that computes the pose. */
  readonly driver: PoseDriver;
  /**
   * The underwater twin of the rig.
   *
   * A swimming character has to be cut by the waterline, and a Pixi container
   * can only have one parent, so the character owns two rigs. The pose is
   * computed once and written to both, which keeps the halves aligned.
   */
  secondary: Rig | null = null;

  constructor(rig: Rig) {
    this.rig = rig;
    this.spec = rig.spec;
    this.driver = new PoseDriver(rig.spec);
    this.props = buildProps(rig.spec, rig.skeleton);
    for (const prop of Object.values(this.props)) {
      prop.visible = false;
      rig.propLayer.addChild(prop);
    }
    this.rig.facing.scale.x = this.spec.flip ? -1 : 1;
  }

  setState(next: CharState): void {
    this.driver.setState(next);
  }

  get currentState(): CharState {
    return this.driver.currentState;
  }

  /** True while the character is performing its idle activity. */
  get isDoingActivity(): boolean {
    return this.driver.isDoingActivity;
  }

  /** React to something that happened in the pool. */
  react(kind: ReactionKind, duration?: number): void {
    this.driver.react(kind, duration);
  }

  /** True while a reaction is playing. */
  get isReacting(): boolean {
    return this.driver.isReacting;
  }

  /**
   * Bring the character one frame further.
   *
   * @param dtMs The time that passed, in milliseconds.
   */
  update(dtMs: number): void {
    const pose = this.driver.update(dtMs);
    this.applyPose(pose);
    const eyes = this.driver.eyes;
    this.rig.eyes.scale.y = eyes;
    this.updateProps(pose);
    // The hair swings about after the head.
    const hair = this.driver.hair * 0.5;
    this.rig.hair.rotation = hair;
    if (this.secondary) {
      this.secondary.hair.rotation = hair;
      this.secondary.eyes.scale.y = eyes;
    }
  }

  private updateProps(pose: Pose): void {
    const prop = this.driver.prop;
    const cup = this.props.cup;
    const book = this.props.book;
    const phone = this.props.phone;
    const snack = this.props.snack;
    const newspaper = this.props.newspaper;
    const cards = this.props.cards;

    cup.visible = prop === 'cup';
    book.visible = prop === 'book';
    phone.visible = prop === 'phone';
    snack.visible = prop === 'snack';
    newspaper.visible = prop === 'newspaper';
    cards.visible = prop === 'cards';

    // The prop sits in the hand; the layer counter-rotates so a raised cup
    // stays upright instead of tipping with the wrist.
    const layer = this.rig.propLayer;
    // The rig turns the hand by -(arm + elbow) on top of the lean of the
    // body, so the prop turns back by exactly that much. It used to turn
    // the wrong way, which was right only while the rig was backwards.
    layer.rotation = pose.armR + pose.elbowR - pose.bodyPitch - pose.bodyRoll;
    layer.position.set(0, 0);

    if (cup.visible) cup.position.set(0, -this.rig.skeleton.limb * 1.4);
    if (book.visible) book.position.set(0, -this.rig.skeleton.limb * 1.6);
    if (phone.visible) phone.position.set(0, -this.rig.skeleton.limb * 1.2);
    if (snack.visible) snack.position.set(0, -this.rig.skeleton.limb * 1.3);
    if (newspaper.visible) newspaper.position.set(0, -this.rig.skeleton.limb * 1.2);
    if (cards.visible) cards.position.set(0, -this.rig.skeleton.limb * 1.1);
  }

  /** Give the character its underwater twin. */
  setSecondary(rig: Rig): void {
    this.secondary = rig;
    rig.facing.scale.x = this.rig.facing.scale.x;
    this.applyPose(this.driver.currentPose);
  }

  /** Write a pose onto the rig. */
  applyPose(pose: Pose): void {
    this.applyPoseTo(this.rig, pose);
    if (this.secondary) this.applyPoseTo(this.secondary, pose);
  }

  private applyPoseTo(rig: Rig, pose: Pose): void {
    rig.root.rotation = pose.rootRot;
    rig.bob.position.y = -pose.bob;
    rig.bob.rotation = pose.bodyRoll;
    rig.body.rotation = pose.bodyPitch;
    rig.body.position.y = rig.skeleton.hipY + pose.bodyY;
    rig.headPivot.rotation = -pose.headPitch;
    rig.headPivot.rotation += pose.headYaw * 0.25;

    // The angles are negated here, and that is the whole point of the
    // convention: a limb is drawn downwards from its pivot, and Pixi's
    // positive rotation turns a downwards limb *backwards*. The poses are
    // written the other way round — a positive angle means "towards the
    // facing direction" — so the sign has to be flipped here.
    //
    // It used to be missing, and every limb in the pool was backwards: the
    // crawl reached behind the swimmer instead of in front, the knee of the
    // walk bent on the wrong half of the stride, and the wave pointed at
    // the deck.
    rig.armL.rotation = -pose.armL;
    rig.armR.rotation = -pose.armR;
    rig.elbowL.rotation = -pose.elbowL;
    rig.elbowR.rotation = -pose.elbowR;
    rig.legL.rotation = -pose.legL;
    rig.legR.rotation = -pose.legR;
    rig.kneeL.rotation = -pose.kneeL;
    rig.kneeR.rotation = -pose.kneeR;
  }

  /** The current layer weights, for the debug overlay. */
  get layerWeights(): Readonly<Weights> {
    return this.driver.layerWeights;
  }

  /** The current blended pose, for the debug overlay. */
  get currentPose(): Pose {
    return this.driver.currentPose;
  }

  /** Debug helper: freeze the swim / walk phase so a stroke can be scrubbed. */
  setPhase(phase: number): void {
    this.driver.setPhase(phase);
  }

  /** Advance the walk by the distance the character covered. */
  advanceWalk(cycles: number): void {
    this.driver.advanceWalk(cycles);
  }

  /** How many strokes the character has finished. */
  get strokeCount(): number {
    return this.driver.strokeCount;
  }

  /** The phase of the walk, for the debug overlay. */
  get walkCycle(): number {
    return this.driver.walkCycle;
  }

  /** Debug helper: force the idle activity to a given progress. */
  forceActivity(progress = 0.4): void {
    this.driver.forceActivity(progress);
  }

  /** Debug helper: hold a reaction at a given progress. */
  scrubReaction(kind: ReactionKind, progress = 0.5): void {
    this.driver.scrubReaction(kind, progress);
  }

  destroy(): void {
    this.rig.destroy();
  }
}
