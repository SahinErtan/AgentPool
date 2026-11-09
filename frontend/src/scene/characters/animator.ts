/**
 * The animator: blends the pose layers and writes the result onto the rig.
 *
 * The weights are damped; the layer oscillations are not. That is what keeps
 * the strokes crisp while still cross-fading smoothly, and it makes
 * interruption free — an agent that goes idle mid-swim simply has its `swim`
 * weight fall to zero.
 */

import { buildProps, type PropSet, type Rig } from './rig';
import type { CharacterSpec } from './spec';
import {
  activityPose,
  blendPose,
  climbPose,
  copyPose,
  loungePose,
  restPose,
  SWIM_STYLES,
  walkPose,
  zeroPose,
  type Pose,
} from './poses';

export type CharState =
  | 'resting'
  | 'walking'
  | 'lounging'
  | 'activity'
  | 'swimming'
  | 'climbing';

export function damp(current: number, target: number, k: number, dtMs: number): number {
  return current + (target - current) * (1 - Math.exp((-k * dtMs) / 1000));
}

interface Weights {
  rest: number;
  lounge: number;
  activity: number;
  walk: number;
  swim: number;
  climb: number;
}

export class CharacterAnimator {
  readonly rig: Rig;
  readonly spec: CharacterSpec;
  readonly props: PropSet;
  /**
   * The underwater twin of the rig.
   *
   * A swimming character has to be cut by the waterline, and a Pixi container
   * can only have one parent, so the character owns two rigs. The pose is
   * computed once and written to both, which keeps the halves aligned.
   */
  secondary: Rig | null = null;

  private weights: Weights = { rest: 1, lounge: 0, activity: 0, walk: 0, swim: 0, climb: 0 };
  /** The damped lounge weight before the activity is taken out of it. */
  private loungeRaw = 0;
  private pose: Pose = zeroPose();
  private layerRest: Pose = zeroPose();
  private layerLounge: Pose = zeroPose();
  private layerActivity: Pose = zeroPose();
  private layerWalk: Pose = zeroPose();
  private layerSwim: Pose = zeroPose();
  private layerClimb: Pose = zeroPose();

  private state: CharState = 'resting';
  private swimPhase: number;
  private activityU = 0;
  private activityOn = false;
  private idleTimer = 0;
  private cooldownLeft = 0;
  private climbU = 0;
  private blinkTimer: number;
  private blinking = false;
  private blinkProgress = 0;

  constructor(rig: Rig) {
    this.rig = rig;
    this.spec = rig.spec;
    this.props = buildProps(rig.spec, rig.skeleton);
    for (const prop of Object.values(this.props)) {
      prop.visible = false;
      rig.propLayer.addChild(prop);
    }
    this.swimPhase = this.spec.phaseOffset;
    this.blinkTimer = this.spec.blinkInterval * this.spec.phaseOffset;
    this.rig.facing.scale.x = this.spec.flip ? -1 : 1;
  }

  setState(next: CharState): void {
    if (next === this.state) return;
    this.state = next;
    if (next === 'climbing') this.climbU = 0;
  }

  get currentState(): CharState {
    return this.state;
  }

  /** True while the character is performing its idle activity. */
  get isDoingActivity(): boolean {
    return this.activityOn;
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    const w = this.weights;

    const wantSwim = this.state === 'swimming' ? 1 : 0;
    const wantWalk = this.state === 'walking' ? 1 : 0;
    const wantClimb = this.state === 'climbing' ? 1 : 0;
    const wantActivity = this.state === 'activity' ? 1 : 0;
    const wantLounge = this.state === 'lounging' || this.state === 'activity' ? 1 : 0;

    w.swim = damp(w.swim, wantSwim, 10, dtMs);
    w.walk = damp(w.walk, wantWalk, 10, dtMs);
    w.climb = damp(w.climb, wantClimb, 12, dtMs);
    w.activity = damp(w.activity, wantActivity, 6, dtMs);

    // The activity is a *sub-layer* of the lounge, so the lounge weight is
    // damped on its own and the activity is taken out of it. Subtracting the
    // activity from the damped value instead would create a feedback loop
    // whose fixed point is 1 - activity/damping, i.e. a negative weight.
    this.loungeRaw = damp(this.loungeRaw, wantLounge, 8, dtMs);
    const excess = Math.max(0, w.activity - this.loungeRaw);
    w.activity = Math.max(0, w.activity - excess);
    w.lounge = Math.max(0, this.loungeRaw - w.activity);
    w.rest = Math.max(0, 1 - w.lounge - w.activity - w.walk - w.swim - w.climb);

    // --- phases ----------------------------------------------------
    if (this.state === 'swimming') {
      const style = SWIM_STYLES[this.spec.swimStyle];
      this.swimPhase = (this.swimPhase + dt * style.cadence * this.spec.speedScale) % 1;
    } else if (this.state === 'walking') {
      this.swimPhase = (this.swimPhase + dt * 1.6) % 1;
    }
    if (this.state === 'climbing') {
      this.climbU = Math.min(1, this.climbU + dt / 1.2);
    }

    // --- idle activity ---------------------------------------------
    this.updateIdleActivity(dt);

    // --- build the layers ------------------------------------------
    const time = performance.now() / 1000;
    restPose(this.layerRest, time);
    loungePose(this.layerLounge, time);
    walkPose(this.layerWalk, this.swimPhase);
    if (this.state === 'climbing') {
      climbPose(this.layerClimb, this.climbU);
    } else {
      climbPose(this.layerClimb, this.climbU);
    }
    SWIM_STYLES[this.spec.swimStyle].fn(this.layerSwim, this.swimPhase, this.spec);
    if (this.activityOn || w.activity > 0.001) {
      activityPose(this.layerActivity, this.spec.idleActivity, this.activityU, this.spec);
    } else {
      copyPose(this.layerRest, this.layerActivity);
    }

    // --- blend ------------------------------------------------------
    this.pose = zeroPose();
    blendPose(this.pose, this.layerRest, w.rest, this.layerLounge, w.lounge);
    blendPose(this.pose, this.pose, 1, this.layerActivity, w.activity);
    blendPose(this.pose, this.pose, 1, this.layerWalk, w.walk);
    blendPose(this.pose, this.pose, 1, this.layerSwim, w.swim);
    blendPose(this.pose, this.pose, 1, this.layerClimb, w.climb);

    this.applyPose(this.pose);
    this.updateBlink(dtMs);
    this.updateProps();
  }

  private updateIdleActivity(dt: number): void {
    if (this.spec.idleActivity === 'none') return;
    if (this.state !== 'lounging' && this.state !== 'activity') {
      this.activityOn = false;
      return;
    }
    if (this.activityOn) {
      this.idleTimer += dt;
      this.activityU = Math.min(1, this.idleTimer / this.spec.idleDuration);
      if (this.idleTimer >= this.spec.idleDuration) {
        this.activityOn = false;
        this.idleTimer = 0;
        this.cooldownLeft = this.spec.idleCooldown;
      }
    } else if (this.cooldownLeft > 0) {
      this.cooldownLeft -= dt;
    } else {
      this.idleTimer += dt;
      if (this.idleTimer >= this.spec.idleStartDelay) {
        this.activityOn = true;
        this.idleTimer = 0;
        this.activityU = 0;
      }
    }
    // The state machine follows the activity so the blend target is right.
    if (this.activityOn && this.state === 'lounging') {
      this.setState('activity');
    } else if (!this.activityOn && this.state === 'activity') {
      this.setState('lounging');
    }
  }

  private updateBlink(dtMs: number): void {
    this.blinkTimer += dtMs / 1000;
    if (!this.blinking && this.blinkTimer >= this.spec.blinkInterval) {
      this.blinking = true;
      this.blinkProgress = 0;
      this.blinkTimer = 0;
    }
    if (this.blinking) {
      this.blinkProgress += dtMs / 120;
      const p = Math.min(1, this.blinkProgress);
      this.rig.eyes.scale.y = Math.abs(Math.cos(p * Math.PI));
      if (p >= 1) {
        this.blinking = false;
        this.rig.eyes.scale.y = 1;
      }
    }
  }

  private updateProps(): void {
    const showing = this.state === 'activity' && this.activityOn;
    const cup = this.props.cup;
    const book = this.props.book;
    const phone = this.props.phone;
    const snack = this.props.snack;

    cup.visible = showing && this.spec.idleActivity === 'tea';
    book.visible = showing && this.spec.idleActivity === 'book';
    phone.visible = showing && this.spec.idleActivity === 'phone';
    snack.visible = showing && this.spec.idleActivity === 'snack';

    // The prop sits in the hand; the layer counter-rotates so a raised cup
    // stays upright instead of tipping with the wrist.
    const layer = this.rig.propLayer;
    layer.rotation = -(this.pose.armR + this.pose.elbowR);
    layer.position.set(0, 0);

    if (cup.visible) cup.position.set(0, -this.rig.skeleton.limb * 1.4);
    if (book.visible) book.position.set(0, -this.rig.skeleton.limb * 1.6);
    if (phone.visible) phone.position.set(0, -this.rig.skeleton.limb * 1.2);
    if (snack.visible) snack.position.set(0, -this.rig.skeleton.limb * 1.3);
  }

  /** Give the character its underwater twin. */
  setSecondary(rig: Rig): void {
    this.secondary = rig;
    rig.facing.scale.x = this.rig.facing.scale.x;
    this.applyPose(this.pose);
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

    rig.armL.rotation = pose.armL;
    rig.armR.rotation = pose.armR;
    rig.elbowL.rotation = pose.elbowL;
    rig.elbowR.rotation = pose.elbowR;
    rig.legL.rotation = pose.legL;
    rig.legR.rotation = pose.legR;
    rig.kneeL.rotation = pose.kneeL;
    rig.kneeR.rotation = pose.kneeR;
  }

  /** The current layer weights, for the debug overlay. */
  get layerWeights(): Readonly<Weights> {
    return this.weights;
  }

  /** The current blended pose, for the debug overlay. */
  get currentPose(): Pose {
    return this.pose;
  }

  /** Debug helper: freeze the swim / walk phase so a stroke can be scrubbed. */
  setPhase(phase: number): void {
    this.swimPhase = ((phase % 1) + 1) % 1;
  }

  /** Debug helper: force the idle activity to a given progress. */
  forceActivity(progress = 0.4): void {
    this.activityOn = true;
    this.activityU = progress;
    this.idleTimer = progress * this.spec.idleDuration;
    this.cooldownLeft = 0;
    this.setState('activity');
  }

  destroy(): void {
    this.rig.destroy();
  }
}
