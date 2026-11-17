/**
 * The pose driver: what a character is doing, turned into a pose.
 *
 * It knows nothing about drawing. It blends the pose layers, runs the springs
 * and the noise, keeps the character's own clock and decides when the idle
 * activity starts. The rig writes its pose onto the figure in its own way.
 *
 * The weights are damped; the layer oscillations are not. That keeps the
 * strokes crisp while still cross-fading smoothly, and it makes interruption
 * free: an agent that goes idle mid-swim simply has its `swim` weight fall to
 * zero.
 */

import { damp } from '../characters/math';
import { channelSeed, fbm } from '../characters/noise';
import { dampingFor, spring, springStep, type SpringState } from '../characters/spring';
import type { CharacterSpec, SwimStyle } from '../characters/spec';
import {
  addPose,
  blendPose,
  climbPose,
  copyPose,
  loungePose,
  reactionDelta,
  REACTION_DURATION_S,
  resetPose,
  restPose,
  SWIM_STYLES,
  walkPose,
  zeroPose,
  type Motion,
  type Pose,
  type ReactionKind,
} from '../characters/poses';
import { ACTIONS, edgeSitPose, treadPose, type ActionKind } from './actions';
import { DEFAULT_LEISURE, leisureEyes, leisurePose, TEA_PUT_DOWN_U, type LeisureDrawKind, type LeisureOptions } from './leisure';

export type CharState =
  | 'resting'
  | 'walking'
  | 'lounging'
  | 'activity'
  | 'swimming'
  | 'climbing'
  | 'treading'
  | 'edgeSitting';

export interface Weights {
  rest: number;
  lounge: number;
  activity: number;
  walk: number;
  swim: number;
  climb: number;
  tread: number;
  edge: number;
}

/** How long a change of swim style takes to cross-fade, in seconds. */
const STYLE_FADE_S = 0.6;

/** The prop a character holds while it does its idle activity, or carries. */
export type PropKind =
  | 'cup'
  | 'book'
  | 'phone'
  | 'snack'
  | 'newspaper'
  | 'cards'
  | 'icecream'
  | 'bottle'
  | 'paddle'
  | 'paddleDark'
  | 'towel'
  // The towel shaken out, between both hands (the towel errand's shake).
  | 'towelSpread'
  // The lounger's props of Sprint 29. The headphones are worn, not held.
  | 'laptop'
  | 'headphones'
  | 'fan'
  | 'glass'
  | 'crossword';

/** How far a head may turn to look at a place, in radians either way. */
const LOOK_YAW_MAX = 1.2;

/**
 * The prop each idle activity is held with: the seven activities of the
 * lounger (Sprint 29.3) and the original five.
 */
const PROP_FOR: Partial<Record<LeisureDrawKind, PropKind>> = {
  tea: 'cup',
  book: 'book',
  phone: 'phone',
  call: 'phone',
  snack: 'snack',
  newspaper: 'newspaper',
  cards: 'cards',
  lemonade: 'glass',
  laptop: 'laptop',
  music: 'headphones',
  fan: 'fan',
  crossword: 'crossword',
};

export interface PoseDriverOptions {
  /**
   * Default false: the driver starts the spec's idle activity on its own
   * timer. The 3D pool turns this on (Sprint 29.4): its planner decides
   * what a figure does and calls `playActivity`, and the driver only plays it.
   */
  sceneIdle?: boolean;
}

export class PoseDriver {
  readonly spec: CharacterSpec;

  private weights: Weights = { rest: 1, lounge: 0, activity: 0, walk: 0, swim: 0, climb: 0, tread: 0, edge: 0 };
  /** The damped lounge weight before the activity is taken out of it. */
  private loungeRaw = 0;
  /**
   * The blended pose.
   *
   * It is made once and then used again: the layers are blended into it
   * every frame, so the frame does not allocate a pose of its own.
   */
  private readonly pose: Pose = zeroPose();
  private readonly layerRest: Pose = zeroPose();
  private readonly layerLounge: Pose = zeroPose();
  private readonly layerActivity: Pose = zeroPose();
  private readonly layerWalk: Pose = zeroPose();
  private readonly layerSwim: Pose = zeroPose();
  /** The stroke a style change is fading away from. */
  private readonly layerSwimFrom: Pose = zeroPose();
  private readonly layerClimb: Pose = zeroPose();
  private readonly layerTread: Pose = zeroPose();
  private readonly layerEdge: Pose = zeroPose();
  private readonly layerReaction: Pose = zeroPose();
  /** The pose of the action that is playing, if there is one. */
  private readonly layerAction: Pose = zeroPose();

  private state: CharState = 'resting';
  /**
   * The character's own clock, in seconds.
   *
   * It used to be the scene's clock, which every character shared: the
   * whole pool breathed at the same moment and looked like a machine.
   * Each character has its own now, and its own noise on top of it.
   */
  private time: number;
  /** The clock and the seed handed to the pose layers. */
  private readonly motion: Motion = { t: 0, seed: 0 };
  private swimPhase: number;
  /** The style the stroke is drawn in now, and the one it is fading from. */
  private styleTo: SwimStyle;
  private styleFrom: SwimStyle;
  /** How far the cross-fade between the two styles has got, 0 to 1. */
  private styleFade = 1;
  /** Multiplies the stroke cadence: 1 is a stroke, 1.3 a sprint. */
  private tempo = 1;
  /**
   * The phase of the walk.
   *
   * It is advanced by the distance the character covered, not by the time
   * that passed. A character that is held up by another one used to keep
   * walking its legs on the spot.
   */
  private walkPhase: number;
  /** How many strokes the character has finished. */
  private strokes = 0;
  private activityU = 0;
  private activityOn = false;
  private idleTimer = 0;
  private cooldownLeft = 0;
  private climbU = 0;
  private blinkTimer: number;
  private blinking = false;
  private blinkProgress = 0;
  /** How open the eyes are, 0 to 1. */
  private eyeOpen = 1;
  /** The reaction that is playing, if any. */
  private reaction: ReactionKind | null = null;
  private reactionU = 0;
  private reactionDuration = REACTION_DURATION_S;
  /** True when the reaction is scrubbed by hand instead of playing. */
  private reactionFrozen = false;

  /**
   * The action that is playing.
   *
   * An action is not a layer of the pose: it either sits on top of the
   * posture as an offset, or takes the place of it. It is written into its
   * own buffer, so the frame does not allocate.
   */
  private actionKind: ActionKind | null = null;
  /** How long the action has been running, in seconds. */
  private actionT = 0;
  /** True while the action is held: it loops until it is released. */
  private actionHeld = false;
  /** True while the action is fading out after a release. */
  private actionEnding = false;
  /**
   * A prop the character carries, whatever it is doing (an errand's bottle
   * or towel). Null for none.
   */
  private carried: PropKind | null = null;
  /**
   * The idle activity an errand has asked for, instead of the spec's; null
   * for the spec's own. It runs for `overrideSeconds`.
   */
  private override: LeisureDrawKind | null = null;
  private overrideSeconds = 0;
  /** False while the scene needs the figure for something else (an errand, a request). */
  private activityAllowed = true;
  /** How much of the action is in the pose, 0 to 1. */
  private actionWeight = 0;
  /** True when the action is scrubbed by hand instead of playing. */
  private actionFrozen = false;
  /** How open the mouth is, 0 to 1. */
  private mouthValue = 0.12;

  /**
   * The springs.
   *
   * A wave says where a thing is. A spring says where a thing is going and
   * how it gets there: it lags, it overshoots and it settles. That lag is
   * what makes a movement read as physical.
   */
  /** The look at a place: the angle, the seconds left, and how much of it shows (0 to 1). */
  private lookYaw = 0;
  private lookYawLeft = 0;
  private lookWeight = 0;
  private readonly headPitchSpring: SpringState = spring(0);
  private readonly headYawSpring: SpringState = spring(0);
  private readonly hairSpring: SpringState = spring(0);
  /** The channel of the noise that the body rides on. */
  private readonly rideSeed: number;

  /** True when the scene, not the driver's own timer, starts the idle activities. */
  private readonly sceneIdle: boolean;
  /**
   * What the activity looks at, how strong the sun is, and the figure's
   * shape (the far hand of a two-handed prop reaches its edge for that shape).
   */
  private leisureOptions: LeisureOptions;

  constructor(spec: CharacterSpec, options: PoseDriverOptions = {}) {
    this.spec = spec;
    this.sceneIdle = options.sceneIdle ?? false;
    this.leisureOptions = { ...DEFAULT_LEISURE, archetype: spec.archetype };
    this.swimPhase = spec.phaseOffset;
    this.styleTo = spec.swimStyle;
    this.styleFrom = spec.swimStyle;
    this.walkPhase = spec.phaseOffset;
    this.blinkTimer = spec.blinkInterval * spec.phaseOffset;
    // The clock starts at a different place for every character, so two
    // characters that arrive at the same moment are not in the same place
    // in their own cycle either.
    this.time = spec.phaseOffset * 7;
    this.motion.seed = spec.noiseSeed;
    this.rideSeed = channelSeed(spec.noiseSeed, 7);
  }

  setState(next: CharState): void {
    if (next === this.state) return;
    this.state = next;
    if (next === 'climbing') this.climbU = 0;
  }

  get currentState(): CharState {
    return this.state;
  }

  /**
   * Swim this style instead of the spec's, or the spec's again with null.
   *
   * A change cross-fades over STYLE_FADE_S, so a swimmer that goes from a
   * crawl to a butterfly does not snap into the new stroke.
   */
  setSwimStyle(style: SwimStyle | null): void {
    const next = style ?? this.spec.swimStyle;
    if (next === this.styleTo) return;
    this.styleFrom = this.styleTo;
    this.styleTo = next;
    this.styleFade = 0;
  }

  /** Multiply the stroke cadence: 1 is a normal stroke, 1.3 a sprint. */
  setTempo(k: number): void {
    this.tempo = k;
  }

  /** The swim style the stroke is drawn in now. */
  get swimStyleNow(): SwimStyle {
    return this.styleTo;
  }

  /** True while the character is performing its idle activity. */
  get isDoingActivity(): boolean {
    return this.activityOn;
  }

  /** The idle activity that is running now, or null when none is. */
  get activeKind(): LeisureDrawKind | null {
    return this.activityOn ? this.activityKind : null;
  }

  /**
   * React to something that happened in the pool.
   *
   * The reaction is played on top of whatever the character is doing, and
   * it does not interrupt it: a character that is swimming keeps swimming
   * and merely lifts its head.
   */
  react(kind: ReactionKind, duration = REACTION_DURATION_S): void {
    this.reaction = kind;
    this.reactionU = 0;
    this.reactionDuration = duration;
  }

  /** True while a reaction is playing. */
  get isReacting(): boolean {
    return this.reaction !== null;
  }

  /**
   * Turn the head towards a place for `seconds`: `yaw` is the angle about y,
   * relative to the body, and the head eases to it and back. Null lets it go.
   * It is added to the pose, so it is clamped to what a head can do.
   */
  setLookYaw(yaw: number | null, seconds = 2.5): void {
    if (yaw === null) {
      this.lookYawLeft = 0;
      return;
    }
    this.lookYaw = Math.max(-LOOK_YAW_MAX, Math.min(LOOK_YAW_MAX, yaw));
    this.lookYawLeft = seconds;
  }

  /**
   * Hold the prop in the hand while walking or doing anything else, or let it
   * go with null. It shows before the idle activity's prop.
   */
  setCarry(prop: PropKind | null): void {
    this.carried = prop;
  }

  /**
   * Do an idle activity now, whatever the spec's own is, for `seconds`. The
   * drink from the kiosk is drunk this way, once the customer has sat down.
   */
  playActivity(kind: LeisureDrawKind, seconds: number): void {
    this.override = kind;
    this.overrideSeconds = seconds;
    this.activityOn = true;
    this.idleTimer = 0;
    this.activityU = 0;
    this.cooldownLeft = 0;
    this.setState('activity');
  }

  /** What the activity looks at, and how strong the sun is. */
  setLeisureOptions(options: Partial<LeisureOptions>): void {
    this.leisureOptions = { ...this.leisureOptions, ...options };
  }

  /**
   * Whether the idle activity may start at all. The scene turns it off during
   * an errand, and while the figure is lying in a pose it was asked for.
   */
  allowActivity(allowed: boolean): void {
    this.activityAllowed = allowed;
  }

  /**
   * Play an action once.
   *
   * It replaces whatever action was running: a character that is already
   * cheering and is told to clap stops cheering and claps.
   */
  play(kind: ActionKind): void {
    this.actionKind = kind;
    this.actionT = 0;
    this.actionHeld = false;
    this.actionEnding = false;
    this.actionFrozen = false;
    this.actionWeight = 0;
  }

  /**
   * Hold an action: it loops until it is released.
   *
   * Holding the action that is already held does nothing, so a caller can
   * ask for it every frame without restarting it. `phase` is where the loop
   * starts, 0 to 1, so that two figures holding the same action are not in
   * step.
   */
  hold(kind: ActionKind, phase = 0): void {
    if (this.actionKind === kind && this.actionHeld && !this.actionEnding) return;
    this.actionKind = kind;
    this.actionT = phase * ACTIONS[kind].seconds;
    this.actionHeld = true;
    this.actionEnding = false;
    this.actionFrozen = false;
    this.actionWeight = 0;
  }

  /** Let the held action go: it fades out and the character goes back. */
  release(): void {
    if (this.actionKind === null) return;
    this.actionEnding = true;
  }

  /** The action that is playing, if there is one. */
  get action(): ActionKind | null {
    return this.actionKind;
  }

  /** How far the current action has got, 0 to 1. */
  get actionProgress(): number {
    if (this.actionKind === null) return 0;
    const seconds = ACTIONS[this.actionKind].seconds;
    if (seconds <= 0) return 1;
    const u = this.actionT / seconds;
    return this.actionHeld ? u % 1 : Math.min(1, u);
  }

  /** Debug helper: hold an action at a given progress. */
  scrubAction(kind: ActionKind, progress = 0.5): void {
    const seconds = ACTIONS[kind].seconds;
    this.actionKind = kind;
    this.actionHeld = true;
    this.actionEnding = false;
    this.actionFrozen = true;
    this.actionT = Math.min(1, Math.max(0, progress)) * seconds;
    this.actionWeight = 1;
  }

  /**
   * Bring the character one frame further.
   *
   * @param dtMs The time that passed, in milliseconds.
   */
  update(dtMs: number): Pose {
    const dt = dtMs / 1000;
    const w = this.weights;
    // The character keeps its own time.
    this.time += dt;
    this.motion.t = this.time;

    const wantSwim = this.state === 'swimming' ? 1 : 0;
    const wantWalk = this.state === 'walking' ? 1 : 0;
    const wantClimb = this.state === 'climbing' ? 1 : 0;
    const wantTread = this.state === 'treading' ? 1 : 0;
    const wantActivity = this.state === 'activity' ? 1 : 0;
    const wantLounge = this.state === 'lounging' || this.state === 'activity' ? 1 : 0;
    const wantEdge = this.state === 'edgeSitting' ? 1 : 0;

    w.swim = damp(w.swim, wantSwim, 10, dtMs);
    w.walk = damp(w.walk, wantWalk, 10, dtMs);
    w.climb = damp(w.climb, wantClimb, 12, dtMs);
    w.tread = damp(w.tread, wantTread, 10, dtMs);
    w.activity = damp(w.activity, wantActivity, 6, dtMs);
    w.edge = damp(w.edge, wantEdge, 8, dtMs);

    // The activity is a *sub-layer* of the lounge, so the lounge weight is
    // damped on its own and the activity is taken out of it. Subtracting the
    // activity from the damped value instead would create a feedback loop
    // whose fixed point is 1 - activity/damping, i.e. a negative weight.
    this.loungeRaw = damp(this.loungeRaw, wantLounge, 8, dtMs);
    const excess = Math.max(0, w.activity - this.loungeRaw);
    w.activity = Math.max(0, w.activity - excess);
    w.lounge = Math.max(0, this.loungeRaw - w.activity);
    w.rest = Math.max(0, 1 - w.lounge - w.activity - w.walk - w.swim - w.climb - w.tread - w.edge);

    // --- phases ----------------------------------------------------
    if (this.styleFade < 1) {
      this.styleFade = Math.min(1, this.styleFade + dt / STYLE_FADE_S);
    }
    if (this.state === 'swimming') {
      const style = SWIM_STYLES[this.styleTo];
      const before = this.swimPhase;
      this.swimPhase = (this.swimPhase + dt * style.cadence * this.spec.speedScale * this.tempo) % 1;
      // The phase wrapped: a stroke is over.
      if (this.swimPhase < before) this.strokes += 1;
    }
    // The walk is not advanced here: it is advanced by the distance the
    // character covered, so a character that is held up by another one
    // stops walking its legs.
    if (this.state === 'climbing') {
      this.climbU = Math.min(1, this.climbU + dt / 1.2);
    }

    // --- idle activity ---------------------------------------------
    this.updateIdleActivity(dt);

    // --- build the layers ------------------------------------------
    //
    // Only the layers that are wanted are built. A swimmer has no weight
    // on the rest and the lounge, and a figure on the deck has no weight
    // on the swim, and the pool is meant to hold sixty of them.
    if (w.rest > 0.001) restPose(this.layerRest, this.motion);
    if (w.lounge + w.activity > 0.001) loungePose(this.layerLounge, this.motion);
    if (w.walk > 0.001) walkPose(this.layerWalk, this.walkPhase);
    if (w.climb > 0.001) climbPose(this.layerClimb, this.climbU);
    if (w.edge > 0.001) edgeSitPose(this.layerEdge, this.motion.t, this.spec.noiseSeed);
    if (w.swim > 0.001) {
      this.buildSwim();
      // The body rides on the stroke, and the ride is never quite the same
      // twice. The stroke itself stays a cycle, because a crawl *is* a
      // cycle; it is the layer on top of it that wanders.
      this.layerSwim.bob += fbm(this.time * 0.42, this.rideSeed) * 0.014;
      this.layerSwim.bodyRoll += fbm(this.time * 0.31, this.rideSeed + 1) * 0.015;
      this.layerSwim.roll += fbm(this.time * 0.31, this.rideSeed + 1) * 0.08;
    }
    if (w.tread > 0.001) treadPose(this.layerTread, (this.time / ACTIONS.tread.seconds) % 1);
    if (this.activityOn || w.activity > 0.001) {
      leisurePose(this.layerActivity, this.activityKind, this.activityU, this.motion, this.leisureOptions);
    } else {
      copyPose(this.layerRest, this.layerActivity);
    }

    // --- blend ------------------------------------------------------
    // The pose is reused, so it is put back to zero first: nothing of the
    // frame before may leak into this one.
    resetPose(this.pose);
    blendPose(this.pose, this.layerRest, w.rest, this.layerLounge, w.lounge);
    blendPose(this.pose, this.pose, 1, this.layerActivity, w.activity);
    blendPose(this.pose, this.pose, 1, this.layerWalk, w.walk);
    blendPose(this.pose, this.pose, 1, this.layerSwim, w.swim);
    blendPose(this.pose, this.pose, 1, this.layerClimb, w.climb);
    blendPose(this.pose, this.pose, 1, this.layerEdge, w.edge);
    // Treading water replaces the posture rather than adding to it: a
    // swimmer that treads holds itself upright.
    blendPose(this.pose, this.pose, 1 - w.tread, this.layerTread, w.tread);

    // The action sits on top of the state layers and under the reaction.
    // It is the only layer that may take the place of the posture instead
    // of adding to it, which is what treading water needs.
    this.updateAction(dt, dtMs);

    // The reaction sits on top of the pose. It fades in and out on its
    // own, so the character goes back to what it was doing without a jump.
    if (this.reaction !== null) {
      if (!this.reactionFrozen) {
        this.reactionU = Math.min(1, this.reactionU + dt / this.reactionDuration);
      }
      const weight = Math.sin(this.reactionU * Math.PI) ** 2;
      reactionDelta(this.layerReaction, this.reaction, this.reactionU);
      addPose(this.pose, this.layerReaction, weight);
      if (this.reactionU >= 1 && !this.reactionFrozen) this.reaction = null;
    }

    // The look: the head turns to the place it was asked to, and lets go after its time.
    this.lookYawLeft = Math.max(0, this.lookYawLeft - dt);
    this.lookWeight = damp(this.lookWeight, this.lookYawLeft > 0 ? 1 : 0, 6, dtMs);
    if (this.lookWeight > 0.001) {
      this.pose.headYaw = Math.max(-LOOK_YAW_MAX, Math.min(LOOK_YAW_MAX, this.pose.headYaw + this.lookYaw * this.lookWeight));
    }

    // The head arrives a moment after the body, and the hair a moment
    // after the head.
    springStep(this.headPitchSpring, this.pose.headPitch, 14, dampingFor(14, 0.7), dtMs);
    this.pose.headPitch = this.headPitchSpring.value;
    springStep(this.headYawSpring, this.pose.headYaw, 11, dampingFor(11, 0.7), dtMs);
    this.pose.headYaw = this.headYawSpring.value;
    springStep(this.hairSpring, this.pose.headPitch, 9, dampingFor(9, 0.5), dtMs);

    this.updateBlink(dtMs);
    return this.pose;
  }

  /**
   * The stroke, in the style it is drawn in now.
   *
   * During a cross-fade both styles are drawn and blended by how far the
   * fade has got. Both read the same phase, so the arms of the two strokes
   * stay in step while one turns into the other.
   */
  private buildSwim(): void {
    if (this.styleFade >= 1) {
      SWIM_STYLES[this.styleTo].fn(this.layerSwim, this.swimPhase, this.spec);
      return;
    }
    const f = this.styleFade;
    const eased = f * f * (3 - 2 * f);
    SWIM_STYLES[this.styleFrom].fn(this.layerSwimFrom, this.swimPhase, this.spec);
    SWIM_STYLES[this.styleTo].fn(this.layerSwim, this.swimPhase, this.spec);
    blendPose(this.layerSwim, this.layerSwimFrom, 1 - eased, this.layerSwim, eased);
  }

  private updateAction(dt: number, dtMs: number): void {
    const kind = this.actionKind;
    if (kind === null) {
      // The mouth closes again when nothing is going on.
      this.mouthValue = damp(this.mouthValue, 0.12, 10, dtMs);
      return;
    }
    const spec = ACTIONS[kind];
    if (!this.actionFrozen && !this.actionHeld && !this.actionEnding) this.actionT += dt;
    const u = spec.seconds > 0 ? this.actionT / spec.seconds : 1;
    const done = !this.actionHeld && u >= 1;
    const cu = this.actionHeld ? (u % 1) : Math.min(1, u);
    spec.pose(this.layerAction, cu, this.motion);

    // The weight of the action: it fades in while it runs and out after it.
    const fading = done || this.actionEnding;
    this.actionWeight = damp(this.actionWeight, fading ? 0 : 1, 8, dtMs);
    let w = this.actionWeight;
    // A one-shot action fades at both ends of itself, so it starts and ends
    // softly instead of snapping on and off.
    if (!this.actionHeld && !fading) w *= Math.min(1, cu * 6) * Math.min(1, (1 - cu) * 6);

    if (spec.mode === 'replace') blendPose(this.pose, this.pose, 1 - w, this.layerAction, w);
    else addPose(this.pose, this.layerAction, w);

    // The mouth of a character that is cheering is open.
    this.mouthValue = damp(this.mouthValue, spec.mouth?.(cu) ?? 0.12, 10, dtMs);

    if (fading && this.actionWeight < 0.01) {
      this.actionKind = null;
      this.actionHeld = false;
      this.actionEnding = false;
      this.actionFrozen = false;
      this.actionWeight = 0;
    }
  }

  /** The idle activity that is shown: the errand's, or the spec's own. */
  private get activityKind(): LeisureDrawKind {
    return this.override ?? this.spec.idleActivity;
  }

  private updateIdleActivity(dt: number): void {
    if (this.spec.idleActivity === 'none' && this.override === null) return;
    if (this.state !== 'lounging' && this.state !== 'activity') {
      this.activityOn = false;
      this.override = null;
      return;
    }
    if (!this.activityAllowed) {
      this.activityOn = false;
      this.override = null;
    } else if (this.activityOn) {
      const seconds = this.activitySeconds;
      this.idleTimer += dt;
      this.activityU = Math.min(1, this.idleTimer / seconds);
      if (this.idleTimer >= seconds) {
        this.activityOn = false;
        this.override = null;
        this.idleTimer = 0;
        this.cooldownLeft = this.spec.idleCooldown;
      }
    } else if (this.cooldownLeft > 0) {
      this.cooldownLeft -= dt;
    } else if (!this.sceneIdle) {
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
      this.eyeOpen = Math.abs(Math.cos(p * Math.PI));
      if (p >= 1) {
        this.blinking = false;
        this.eyeOpen = 1;
      }
    }
  }

  /**
   * How open the eyes are, 0 (shut) to 1 (open).
   *
   * A sunbather or a napper keeps its eyes shut for its whole activity;
   * the blink is only for the rest.
   */
  get eyes(): number {
    if (this.activityOn) return Math.min(this.eyeOpen, leisureEyes(this.activityKind));
    return this.eyeOpen;
  }

  /** The swing of the hair, which follows the head a moment late. */
  get hair(): number {
    return this.hairSpring.value;
  }

  /** How open the mouth is, 0 (shut) to 1 (wide). */
  get mouth(): number {
    return this.mouthValue;
  }

  /** The swing of a ponytail, which follows the head a moment late. */
  get ponytail(): number {
    return this.hairSpring.value * 1.6;
  }

  /** The prop in the hand, or null when the hand is empty. */
  get prop(): PropKind | null {
    // The towel is spread between both hands while it is shaken out.
    if (this.carried === 'towel' && this.actionKind === 'towelShake') return 'towelSpread';
    if (this.carried !== null) return this.carried;
    const showing = this.state === 'activity' && this.activityOn;
    if (!showing) return null;
    // The tea glass is set down on its table at the put-down: the hand is empty after it.
    if (this.activityKind === 'tea' && this.activityU >= TEA_PUT_DOWN_U) return null;
    return PROP_FOR[this.activityKind] ?? null;
  }

  /** How far the activity that is running has got, 0 to 1 (0 when none is running). */
  get activeProgress(): number {
    return this.activityOn ? this.activityU : 0;
  }

  /**
   * How long the idle activity that is running lasts, in seconds: the
   * errand's own time, or the spec's.
   */
  private get activitySeconds(): number {
    return this.override !== null ? this.overrideSeconds : this.spec.idleDuration;
  }

  /** The current layer weights, for the debug overlay. */
  get layerWeights(): Readonly<Weights> {
    return this.weights;
  }

  /** The current blended pose. */
  get currentPose(): Pose {
    return this.pose;
  }

  /** Debug helper: freeze the swim / walk phase so a stroke can be scrubbed. */
  setPhase(phase: number): void {
    this.swimPhase = ((phase % 1) + 1) % 1;
    this.walkPhase = this.swimPhase;
  }

  /**
   * Advance the walk by the distance the character covered.
   *
   * @param cycles How many whole strides the character took.
   */
  advanceWalk(cycles: number): void {
    this.walkPhase = (this.walkPhase + cycles) % 1;
  }

  /**
   * How many strokes the character has finished.
   *
   * The scene listens to this: a hand that goes into the water pushes
   * some of it up, and that is what tells the pool that somebody is
   * swimming in it.
   */
  get strokeCount(): number {
    return this.strokes;
  }

  /** The phase of the stroke, 0 to 1. */
  get strokePhase(): number {
    return this.swimPhase;
  }

  /** The phase of the walk, for the debug overlay. */
  get walkCycle(): number {
    return this.walkPhase;
  }

  /** Debug helper: force the idle activity to a given progress. */
  forceActivity(progress = 0.4): void {
    this.activityOn = true;
    this.activityU = progress;
    this.idleTimer = progress * this.activitySeconds;
    this.cooldownLeft = 0;
    this.setState('activity');
  }

  /** Debug helper: hold a reaction at a given progress. */
  scrubReaction(kind: ReactionKind, progress = 0.5): void {
    this.reaction = kind;
    this.reactionU = Math.min(1, Math.max(0, progress));
    this.reactionFrozen = true;
  }
}
