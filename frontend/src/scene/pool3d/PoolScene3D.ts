/**
 * The pool in three dimensions.
 *
 * The same pool, the same agents and the same backend as the 2D scene, seen
 * through a camera that can go round it. The characters walk across the
 * deck and round the water, climb down the ladder, swim lengths in their
 * lanes and turn at the wall, climb out and sit on loungers that face the
 * pool.
 *
 * The scene reads the store in its own frame loop, so React never re-renders
 * for the animation. It talks back to the store only to say what is under
 * the pointer and what was clicked, exactly as the 2D scene does.
 */

import {
  ACESFilmicToneMapping,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  RingGeometry,
  Scene,
  Spherical,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  CapsuleGeometry,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { AgentView } from '../../net/types';
import { acknowledgeExit } from '../../net/ws';
import { matches } from '../../state/filter';
import { store } from '../../state/store';
import { damp } from '../characters/math';
import { fnv1a, rngFor, specFor, type CharacterSpec, type Role } from '../characters/spec';
import { applyPose3D } from '../characters3d/apply3d';
import { buildRig3D, characterMaterial, dimmedMaterial, type Rig3D } from '../characters3d/rig3d';
import { restPosition } from '../characters3d/skeleton3d';
import { PoseDriver } from '../motion/driver';
import { TEA_PUT_DOWN_U } from '../motion/leisure';
import type { ActionKind } from '../motion/actions';
import type { LeisureKind } from '../motion/leisureKind';
import { prefersReducedMotion } from '../motion';
import { applyWeather, hourOfDay, paletteFor, type Palette } from '../pool/daylight';
import { rainAmount, weatherFor, type Weather } from '../pool/weather';
import type { PoolSceneLike } from '../types';
import { MAX_DISTANCE, MAX_POLAR, MIN_DISTANCE, MIN_POLAR, clampTarget, defaultView, viewPosition } from './camera';
import { Particles, Rain } from './effects3d';
import { buildEnvironment, type Environment } from './environment';
import { buildEquipment, type EquipmentView } from './equipment';
import {
  applyPresentation,
  bodyAction,
  bodyActionHeld,
  bodyActionPhase,
  createBody,
  freeWaitingSpot,
  gateQueueLength,
  ladderBusy,
  ladderLoad,
  type BodyEvent,
  type FlowContext,
  settle,
  stepBody,
  swimCentre,
  type Body,
} from './flow';
import { createLighting, type Lighting } from './lighting';
import {
  CreatureDirector,
  type Creature,
  nightAmount,
  sprinklerOn,
  type CreaturePerson,
  type CreatureSplash,
  type CreatureWorld,
} from './creatures';
import { buildCreatures3D, type Creatures3D } from './creatures3d';
import { buildSky, type Sky } from './sky';
import { buildNightLights, type NightLights } from './nightlights';
import type { Walker } from './nav';
import { LabelOverlay } from './overlay';
import { agentNames, type AgentNames } from '../names';
import { cardContent, type CardContent } from '../card';
import { underwaterUniforms } from './underwater';
import { createWater, type Water } from './water';
import { buildWorld, CHARACTER_HEIGHT, entrance, queueSpot, teaSpotOf, type Vec3, type World } from './world';
import type { EntryBusy, EntryKind } from './entries';
import { tickErrands, type ErrandKind, type ErrandState, type SlotBook } from './errands';
import { ballFlight, nextCatcher, pingPongBall } from './games';
import { findRaces, type RaceSwimmer } from './swim';
import { createMomentMemory, detectMoments, type Moment, type MomentMemory } from './moments';
import {
  createTourState,
  createTourView,
  tourStep,
  type Interest,
  type TourState,
  type TourView,
} from './director';
import { fatigueAfter, initialWork, needsYou, smoothWork, toolKind, type WorkKind, type WorkShown } from './work';
import { chooseLeisure, durationOf, gapAfter, restingLine, sunFor, type LeisureContext } from './leisurePlan';
import { TeaTables } from './teaTables';
import { TeaGlasses } from './teaGlasses';

/**
 * The colour of the family an agent belongs to, for the dot before its label:
 * a session's own suit, and a subagent's parent suit (its accent), the colour
 * the family rings show.
 */
function familyColour(character: Character): string {
  return character.agent.kind === 'subagent' ? character.spec.accent : character.spec.suit;
}

/** The planner's activity that is running, as a 3D leisure kind; null for none, and for a rest. */
function activeLeisure(driver: PoseDriver): LeisureKind | null {
  const kind = driver.activeKind;
  return kind === null || kind === 'none' ? null : kind;
}

interface Character {
  id: string;
  agent: AgentView;
  spec: CharacterSpec;
  rig: Rig3D;
  driver: PoseDriver;
  body: Body;
  /** Where the rig is drawn; it follows the body, smoothed. */
  shown: Vector3;
  yaw: number;
  /** The invisible capsule the pointer is tested against. */
  hit: Mesh;
  scale: number;
  lastStrokes: number;
  dimmed: boolean;
  /** Set when a finish happens while the figure is in the water: it cheers once it is out. */
  pendingCheer: boolean;
  /** Seconds until the hop that follows the cheer; 0 when none is due. */
  hopIn: number;
  /** Seconds left in which a session that ended still walks to the gate to be cheered. */
  leaveLeft: number;
  /** True while the session waited for the person in the last frame. */
  wasNeedy: boolean;
  steamTimer: number;
  napTimer: number;
  /** The kind of work the agent does, as the smoothing last saw it. */
  workShown: WorkShown | null;
  /** The values the debug hooks set; they win over what the agent does. */
  forced: { work?: WorkKind; needsYou?: boolean; fatigue?: number };
  /** Seconds until the next "needs you" over the head. */
  attentionTimer: number;
  /** When the agent started to work, in seconds; null while it is not working. */
  workingSince: number | null;
  /** The action the body asked for last, and whether it is held. */
  wantAction: ActionKind | null;
  wantHeld: boolean;
  /** Seconds until a figure on the edge kicks its feet again. */
  kickTimer: number;
  /** The lounge variant the figure is in (Sprint 25), if it is in one, and how long it stays. */
  variant: ActionKind | null;
  variantLeft: number;
  /** Seconds until the figure changes how it lies, and the draw that times it. */
  variantIn: number;
  variantRng: () => number;
  /** Seconds until a figure in the queue fidgets, and the draw that times it. */
  fidgetIn: number;
  fidgetRng: () => number;
  /** Drops of shower water still owed for the frames so far. */
  showerOwed: number;
  /** True while the figure holds a towel over its head, in the rain. */
  covering: boolean;
  /** What the planner keeps for the figure (Sprint 29.4 to 29.6). */
  leisure: LeisureState;
}

/** The planner's memory of one figure. */
interface LeisureState {
  /** The activity it did last, or is doing now; null for none yet, or for a rest. */
  kind: LeisureKind | null;
  /** Seconds of lying still before the next choice. */
  gapLeft: number;
  /** True while the figure was in an activity the frame before. */
  wasActive: boolean;
  /** The figure's own random stream for its choices, durations and marks. */
  rng: () => number;
  /** The lounger whose table the tea glass came from, while the tea lasts; -1 for none. */
  table: number;
  /** The figure it talks with, while they chat; null otherwise. */
  partner: Character | null;
  /** Seconds until its next speech mark; the activity's own clock for marks. */
  markIn: number;
  /** The scene time of its last speech mark: a figure says one at most every few seconds. */
  lastMarkAt: number;
  /** When it came out of the water last, in scene seconds; -Infinity for never. */
  outAt: number;
  wasInWater: boolean;
  /** The aim the activity was last given, so it is only written when it moves. */
  aim: number;
}

/** A ripple that comes a moment after the splash it belongs to. */
interface TimedRipple {
  t: number;
  x: number;
  z: number;
  strength: number;
}

/** How long one frame is at most, so a tab that comes back does not jump. */
const MAX_FRAME_MS = 100;
const FOV = 38;
/** How many rings show the family of the agent under the pointer, at most. */
const FAMILY_RINGS = 8;
/** How long a parent says "go, <name>!" when a sub-agent is born. */
const ANNOUNCE_S = 2.5;
/** How often the pool looks for two swimmers to race, in frames. */
const RACE_EVERY = 60;
/** How long a figure on the edge waits between two kicks, in seconds. */
const KICK_EVERY_S = 1.5;
/** How long a swimmer that won a race treads water, in seconds. */
const WIN_TREAD_S = 2;
/** How long a swimmer treads water for a milestone, in seconds. */
const MILESTONE_TREAD_S = 1.5;
/** How long a finisher cheers before it hops, in seconds. */
const CHEER_S = 1.6;
/** The people that clap for a finisher: at most this many, within this range, in metres. */
const CLAP_MAX = 3;
const CLAP_RANGE = 8;
/** A swimmer this close to a finisher slaps the water, in metres. */
const SLAP_RANGE = 4;
/** A session that left is cheered at the gate, within this range; it is waited for this long. */
const GATE_NEAR = 1.2;
const LEAVE_WAIT_S = 60;
/** A sleeping cat wakes when somebody who is working is this close, in metres. */
const WAKE_RANGE = 3;
/** The camera's close view of a followed agent: its distance, and its angle from straight up. */
const FOLLOW_DISTANCE = 7;
const FOLLOW_POLAR = 1.0;
/** The tour starts by itself after this long with no input, in milliseconds. */
const TOUR_IDLE_MS = 120_000;
/** A pointer that moves this far from where it went down is a drag, in pixels. */
const DRAG_PX = 5;
/** An interest is kept this long for the tour to look at, in seconds, and at most this many are kept. */
const INTEREST_KEEP_S = 10;
const INTEREST_MAX = 32;
/** A click on the agent that is already selected: the head turns for this long, in seconds. */
const GREET_S = 2.5;
/** The cat's body, for a pointer: the height of its middle above the deck, and how near the ray must pass, in metres. */
const CAT_BODY_Y = 0.3;
const CAT_RADIUS = 0.3;
/** The height of the cat's head, where its name's bubble sits, above the deck. */
const CAT_HEAD_Y = 0.45;
/** The flamingo and the ball, for a pointer: how near the ray must pass, in metres. */
const FLAMINGO_RADIUS = 0.9;
const BALL_HIT_RADIUS = 0.4;

/** The light below which it is night for a session that ends: then fireworks, not confetti. */
const NIGHT_PALETTE_LIGHT = 0.3;
/**
 * Three rockets, this far apart in seconds, go up from the far edge of the
 * pool. They were over the garden beyond the far fence once, but from the
 * default view that sky is above the top of the picture.
 */
const ROCKETS = 3;
const ROCKET_GAP_S = 0.8;
/** Where the rockets go up, along the pool's length, as fractions of it. */
const ROCKET_SPOTS = [0.3, 0.55, 0.8];
/** The speed of a racer, as a factor, for the length it races. */
const RACE_BOOST = 1.35;
/** How often a lounging figure changes how it lies, in seconds: every 60 to 150. */
const VARIANT_GAP_MIN_S = 60;
const VARIANT_GAP_SPAN_S = 90;
/** How long a changed lie lasts, in seconds: 20 to 40. */
const VARIANT_LEN_MIN_S = 20;
const VARIANT_LEN_SPAN_S = 20;
/** How often a figure in the queue fidgets, in seconds: every 10 to 20. */
const FIDGET_GAP_MIN_S = 10;
const FIDGET_GAP_SPAN_S = 10;
/** The speech marks of a chat, a call and the music (Sprint 29.6). */
const CHAT_MARKS = ['…', '!', '?', 'ha ha'];
const CALL_MARKS = ['…', '!', 'ha ha'];
const MUSIC_MARK = '♪';
/** A figure says one mark at most every this many seconds. */
const MARK_GAP_S = 3;
/** How long a figure that has just come out of the water counts as just finished, in seconds. */
const JUST_FINISHED_S = 60;
/** The lounger next to a figure's is this far away in x, in metres (the pitch is 1.7). */
const NEXT_LOUNGER_MIN_M = 1.2;
const NEXT_LOUNGER_MAX_M = 2.2;
/** How close the cat must be, asleep, for a figure to stroke it, in metres. */
const CAT_NEAR_M = 2;

/** Drops of water a second from the shower head, and how long a drink is drunk for. */
const SHOWER_DROPS_PER_S = 30;
const DRINK_S = 12;
/** The beach ball: its radius, the height of the hands that throw it, and how long a throw flies. */
const BALL_RADIUS = 0.25;
const HAND_Y = 1.1;
const THROW_S = 0.8;
/** How long a player holds the ball before throwing it on, in seconds. */
const HOLD_S = 1.4;

/** The sprinkler: the arc's half-angle, the time of one sweep, the launch, the speed and the drops a second. */
const SPRINKLER_ARC = 1.2;
const SPRINKLER_SWEEP_S = 8;
const SPRINKLER_LAUNCH = (35 * Math.PI) / 180;
const SPRINKLER_SPEED = 6;
const SPRINKLER_DROPS_PER_S = 25;
/** The rain: how much a walker leans forward in it, in radians. */
const RAIN_LEAN = 0.15;
/** The pool is calm after this many seconds with nobody working. */
const CALM_AFTER_S = 120;
/** Petals: at most this many at once, and one every 20 to 40 seconds. */
const PETALS_AT_ONCE = 6;
const PETAL_GAP_MIN_S = 20;
const PETAL_GAP_SPAN_S = 20;

/** Whether a key is meant for a text field, which the scene's keys must leave alone. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/** The bend of the diving board, in radians, `t` seconds after a bounce. */
function boardFlexAt(t: number): number {
  return t < 3 ? 0.12 * Math.exp(-4 * t) * Math.cos(14 * t) : 0;
}

/** What the debug hooks can say about a character. */
export interface DebugCharacter {
  id: string;
  state: string;
  x: number;
  z: number;
  inWater: boolean;
  action: string | null;
  /** The tool the agent is using. */
  work?: string;
  /** The errand it is on, or null. */
  errand: string | null;
  /** The idle activity it is doing on its lounger now, or null (Sprint 29.4). */
  activity?: string | null;
  /** The lounger it lies on, or null. */
  lounger?: number | null;
  /** What the body and the planner are waiting on (for the console). */
  bodyState?: string;
  desired?: string;
  needsYou?: boolean;
  gap?: number;
  variant?: string | null;
}

/** The hooks the browser console can use to look at one behaviour. */
export interface DebugHooks {
  list(): DebugCharacter[];
  play(id: string, action: ActionKind): void;
  hold(id: string, action: ActionKind | null): void;
  force(id: string, patch: Record<string, unknown> | string): void;
  look(x: number, z: number, distance?: number): void;
  /** Move the scene clock on, so a cycle (the fountains, the stripes) is reached at once. */
  time(seconds: number): void;
  /** Every creature on the screen now. */
  creatures(): DebugCreature[];
  /** Call the duck in now, or the pair of birds over; they come only when they can. */
  creature(name: 'duck' | 'birds'): void;
  /** Show the pool at this hour of the day, or the clock's own with null. */
  clock(hour: number | null): void;
  /** Start a leisure activity on a figure that lies on its lounger now (Sprint 29.4). */
  leisure(id: string, kind: LeisureKind, seconds?: number): void;
  /** Where a figure is on the screen, in CSS pixels of the canvas, for a test to point at it. */
  screenOf(id: string): { x: number; y: number } | null;
}

/** What the hooks say about a creature. */
export interface DebugCreature {
  id: string;
  kind: string;
  state: string;
  x: number;
  z: number;
}

export class PoolScene3D implements PoolSceneLike {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private world: World;
  private environment: Environment;
  private equipment: EquipmentView;
  private readonly water: Water;
  private readonly lighting: Lighting;
  private readonly particles = new Particles();
  private rain: Rain;
  private readonly labels: LabelOverlay;
  /** The creatures: a cat, a duck, two birds and two butterflies (Sprint 26). */
  private readonly creatureDirector = new CreatureDirector(26);
  private readonly creatures3d: Creatures3D = buildCreatures3D();
  private readonly sky: Sky;
  private nightLights: NightLights;
  /** What the creatures are told each frame; the lists are reused. */
  private readonly creaturePeople: CreaturePerson[] = [];
  private readonly creatureSplashes: CreatureSplash[] = [];
  private readonly avoidSpots: { x: number; z: number }[] = [];
  private napSpots: { x: number; z: number }[] = [];
  /** The people as the creatures see them: the objects are kept, and only their values change. */
  private readonly personPool: CreaturePerson[] = [];
  /** Whether the pool has been quiet for a while (step 26.7), and for how long. */
  private calm = false;
  private quietFor = 0;
  /** How calm the water is now, eased from 0 to 1 over ten seconds. */
  private calmK = 0;
  /** The scene time an agent last worked; the pool is calm after two minutes without one. */
  private lastWorkingAt = 0;
  /** How wet the deck is, 0 to 1: it wets in a minute of rain and dries in five. */
  private wetness = 0;
  /** The sprinkler's drops still owed, and the time to the next petal. */
  private sprinklerOwed = 0;
  private petalIn = 25;
  /** The rain as a level from 0 to 1: the clock's own, or the one the hooks forced. */
  private rainLevel = 0;
  /** The weather and the hour the hooks set; null for the clock's own. */
  private forcedWeather: Weather | null = null;
  private clockOverride: number | null = null;
  /** The duck's ripples and the splashes of its take-off are timed by the scene. */
  private duckRippleIn = 0;
  private duckSplashIn = 0;
  private readonly characters = new Map<string, Character>();
  /** The side tables and the glasses of tea on them (Sprint 29.5). */
  private teaTables!: TeaTables;
  private teaGlasses!: TeaGlasses;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly hoverRing: Mesh;
  /** The small rings under the family of the agent under the pointer. */
  private readonly familyRings: Mesh[] = [];
  private readonly familyMaterials: MeshBasicMaterial[] = [];
  private readonly familyGeometry = new RingGeometry(0.34, 0.42, 32);
  /** Where a ring goes; one object is reused for every ring. */
  private readonly ringAt = { x: 0, y: 0, z: 0, scale: 1 };
  private readonly hitGeometry = new CapsuleGeometry(0.28, 1.0, 2, 6);
  private readonly hitMaterial = new MeshBasicMaterial({ visible: false });
  private hoveredId: string | null = null;
  /**
   * The names on the screen, by agent id. They are worked out when the agents
   * sync, never in the frame: the frame only reads them.
   */
  private names = new Map<string, AgentNames>();
  /** The card under the pointer: which agent it is for, in which second, and what it says. */
  private cardId: string | null = null;
  private cardSecond = -1;
  private cardContent: CardContent | null = null;
  /** How many characters have come in, so they do not all start on one spot. */
  private arrivals = 0;
  private payloadKey = '';
  private palette: Palette;
  private paletteStep = -1;
  private weather: Weather = 'clear';
  private time = 0;
  private last = performance.now();
  private frame = 0;
  private width = 1;
  private height = 1;
  private viewReady = false;
  private focusId: string | null = null;
  private userMovedCamera = false;
  private readonly reducedMotion = prefersReducedMotion();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private pointerDownAt: { x: number; y: number } | null = null;
  private running = true;
  private debugText: HTMLDivElement | null = null;
  private fpsFrames = 0;
  private fpsSince = performance.now();
  private fps = 0;
  /** The length of the frame being drawn, in seconds. */
  private lastDt = 0;
  /**
   * The hooks the console uses to look at one behaviour.
   *
   * They exist only when the page was asked for them (`?debug` or
   * `?demo`): a dashboard that nobody is testing does not need them.
   */
  readonly debug?: DebugHooks;

  constructor(host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    host.appendChild(this.renderer.domElement);

    this.world = buildWorld(store.get().scenePayload);
    this.payloadKey = this.keyOf(store.get().scenePayload);
    underwaterUniforms.uWaterY.value = this.world.waterY;

    this.camera = new PerspectiveCamera(FOV, 1, 0.1, 600);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = MIN_POLAR;
    this.controls.maxPolarAngle = MAX_POLAR;
    this.controls.minDistance = MIN_DISTANCE;
    this.controls.maxDistance = MAX_DISTANCE;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('start', this.onControlStart);

    this.lighting = createLighting(this.scene, this.world);
    this.environment = buildEnvironment(this.world);
    this.scene.add(this.environment.group);
    this.buildTeaSet();
    this.water = createWater(this.world);
    this.scene.add(this.water.mesh);
    this.scene.add(this.particles.points);
    this.equipment = buildEquipment(this.world, this.particles, this.water);
    this.scene.add(this.equipment.group);
    this.rain = new Rain(this.world.deck);
    this.scene.add(this.rain.lines);
    this.scene.add(this.creatures3d.group);
    this.sky = buildSky(this.scene, this.world);
    this.nightLights = buildNightLights(this.world);
    this.scene.add(this.nightLights.group);

    this.hoverRing = new Mesh(
      new RingGeometry(0.34, 0.42, 32),
      new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.visible = false;
    this.hoverRing.renderOrder = 4;
    this.scene.add(this.hoverRing);

    for (let i = 0; i < FAMILY_RINGS; i += 1) {
      const material = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false });
      const ring = new Mesh(this.familyGeometry, material);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 3;
      this.scene.add(ring);
      this.familyRings.push(ring);
      this.familyMaterials.push(material);
    }

    this.labels = new LabelOverlay(host);
    // The cat has no name, only the bubble it speaks in (step 27.5).
    this.labels.ensure('cat', '');
    this.palette = paletteFor(12);
    this.applyDaylight(true);

    if (new URLSearchParams(window.location.search).has('debug')) {
      this.debugText = document.createElement('div');
      this.debugText.className = 'pool3d-debug';
      host.appendChild(this.debugText);
    }
    // The hooks are there when the page is being tested, and only then.
    const params = new URLSearchParams(window.location.search);
    if (params.has('debug') || params.has('demo')) this.debug = this.makeDebug();

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.resize(host.clientWidth, host.clientHeight);
    this.renderer.setAnimationLoop(this.tick);
  }

  // -- the agents -------------------------------------------------------

  syncAgents(agents: AgentView[]): void {
    this.rebuildWorldIfNeeded();
    this.names = agentNames(agents);
    const seen = new Set<string>();
    for (const agent of agents) {
      seen.add(agent.id);
      let character = this.characters.get(agent.id);
      if (!character) {
        character = this.createCharacter(agent);
        this.characters.set(agent.id, character);
        // Only the ones that come later are news: the agents already in the
        // pool when the page opens are not born in front of anybody.
        if (this.settled && agent.kind === 'subagent') this.announceChild(character);
      }
      character.agent = agent;
      this.labels.ensure(agent.id, this.names.get(agent.id)?.short ?? agent.label);
      this.labels.setColour(agent.id, familyColour(character));
      applyPresentation(
        character.body,
        agent.presentation,
        this.world,
        () => freeWaitingSpot(this.world, this.bodies(), character.body),
        () => gateQueueLength(this.bodies(), character.body),
      );
      this.refreshWork(character, Date.now() / 1000);
      // The agents that are there when the page opens are already in the
      // pool; only the ones that come later walk in through the gate.
      if (!this.settled) {
        const b = character.body;
        settle(b, this.world);
        character.shown.set(b.x, b.y, b.z);
        character.yaw = b.yaw;
      }
    }
    if (agents.length > 0) this.settled = true;
    for (const [id, character] of [...this.characters.entries()]) {
      if (seen.has(id)) continue;
      this.removeCharacter(character);
    }
    this.noticeMoments(agents);
  }

  /** The board's bend, and the seconds since its last bounce. */
  private boardT = 99;
  private boardFlex = 0;
  /** The ripples still to come after the big splashes. */
  private readonly timedRipples: TimedRipple[] = [];
  /** When each pair of swimmers last raced, by their sorted ids. */
  private readonly raceCooldown = new Map<string, number>();

  /** The slots the errands hold, by place, for the planner and the flow. */
  private readonly errandBook: SlotBook = { taken: new Map() };

  private readonly flowContext: FlowContext = {
    exited: (id) => acknowledgeExit(id),
    entries: { busy: (self) => this.entryBusy(self), reducedMotion: prefersReducedMotion() },
    errands: {
      book: this.errandBook,
      now: () => this.time,
      bodyOf: (id: string) => this.characters.get(id)?.body,
    },
    ladderLoad: (index, self) => ladderLoad(this.bodies(), index, self),
    swimGap: (self) => {
      const mine = self.swim;
      if (!mine || !self.inWater) return Number.POSITIVE_INFINITY;
      let best = Number.POSITIVE_INFINITY;
      for (const c of this.characters.values()) {
        const other = c.body;
        const theirs = other.swim;
        if (other === self || !theirs || !other.inWater || other.lane !== self.lane) continue;
        if (theirs.dir !== mine.dir || theirs.turning > 0) continue;
        const ahead = (theirs.x - mine.x) * mine.dir;
        if (ahead > 0 && ahead < best) best = ahead;
      }
      return best;
    },
  };
  /** False until the first agents have been put in their places. */
  private settled = false;
  /** An errand the debug hooks asked for: the next planning starts it. */
  private forcedErrand: { id: string; kind: ErrandKind } | null = null;
  /** The beach ball game on the court, while three players are in it. */
  private court: {
    key: string;
    holder: number;
    nextAt: number;
    count: number;
    seed: number;
    flight: { from: Vec3; to: Vec3; t0: number; receiver: number } | null;
  } | null = null;

  private *bodies(): Iterable<Body> {
    for (const character of this.characters.values()) yield character.body;
  }

  private createCharacter(agent: AgentView): Character {
    const role: Role =
      agent.kind === 'session' ? 'session' : agent.kind === 'mcp' ? 'mcp' : agent.kind === 'workflow' ? 'workflow' : 'subagent';
    const spec = this.specForAgent(agent, role);
    const rig = buildRig3D(spec);
    const scale = CHARACTER_HEIGHT * spec.height;
    rig.root.scale.setScalar(scale);
    this.scene.add(rig.root);
    // The planner starts the idle activities of the 3D pool, not the driver's own timer.
    const driver = new PoseDriver(spec, { leisure: '3d', sceneIdle: true });

    // A newcomer comes up the path to the gate.
    const start = entrance(this.world, this.arrivals);
    this.arrivals += 1;
    const hipHeight = restPosition(rig.skeleton, 'hips').y * scale;
    const body = createBody(agent.id, scale, hipHeight, spec.speedScale, start);
    // The lounge variant and the queue's fidgets have streams of their own, so
    // that the figures' other attributes stay as they were.
    const variant = rngFor(agent.id, 'lounge-variant');
    const fidgetRng = rngFor(agent.id, 'fidget');

    const hit = new Mesh(this.hitGeometry, this.hitMaterial);
    hit.userData.agentId = agent.id;
    this.scene.add(hit);

    // A newcomer lies still for 6 to 30 seconds before its first activity.
    const leisureRng = rngFor(agent.id, 'leisure-pick');
    const firstGap = 6 + leisureRng() * 24;
    const character: Character = {
      id: agent.id,
      agent,
      spec,
      rig,
      driver,
      body,
      shown: new Vector3(body.x, body.y, body.z),
      yaw: body.yaw,
      hit,
      scale,
      lastStrokes: 0,
      dimmed: false,
      pendingCheer: false,
      hopIn: 0,
      leaveLeft: 0,
      wasNeedy: false,
      steamTimer: 0,
      napTimer: 0,
      workShown: null,
      forced: {},
      attentionTimer: 0,
      workingSince: null,
      wantAction: null,
      wantHeld: false,
      kickTimer: 0,
      variant: null,
      variantLeft: 0,
      variantRng: variant,
      variantIn: VARIANT_GAP_MIN_S + variant() * VARIANT_GAP_SPAN_S,
      fidgetIn: FIDGET_GAP_MIN_S + fidgetRng() * FIDGET_GAP_SPAN_S,
      fidgetRng,
      showerOwed: 0,
      covering: false,
      leisure: {
        kind: null,
        gapLeft: firstGap,
        wasActive: false,
        rng: leisureRng,
        table: -1,
        partner: null,
        markIn: 0,
        lastMarkAt: Number.NEGATIVE_INFINITY,
        outAt: Number.NEGATIVE_INFINITY,
        wasInWater: false,
        aim: 0,
      },
    };
    return character;
  }

  /**
   * Read what an agent is doing, from its tool and its session, into its
   * body. The work is smoothed, so a stroke does not change with every tool.
   */
  private refreshWork(character: Character, nowS: number): void {
    const agent = character.agent;
    const latest: WorkKind = agent.status === 'working' ? toolKind(agent.tool_name) : 'other';
    if (character.workShown === null) character.workShown = initialWork(latest, nowS);
    const shown = smoothWork(character.workShown, latest, nowS);
    const body = character.body;
    // How long the agent has been working decides how tired its swimmer is.
    if (agent.status !== 'working') character.workingSince = null;
    else if (character.workingSince === null) character.workingSince = nowS;
    body.work = character.forced.work ?? shown;
    body.needsYou = character.forced.needsYou ?? needsYou(agent, store.get().feed, nowS);
    body.fatigue =
      character.forced.fatigue ?? (character.workingSince === null ? 0 : fatigueAfter(nowS - character.workingSince));
  }

  /**
   * The look of an agent. A sub-agent keeps its own suit and takes its
   * parent's colour as the trim, so the family can be told apart at a glance.
   */
  private specForAgent(agent: AgentView, role: Role): CharacterSpec {
    if (agent.kind !== 'subagent' || !agent.parent_id) return specFor(agent.id, role);
    const parent = this.characters.get(agent.parent_id);
    const parentSuit = parent
      ? parent.spec.suit
      : specFor(agent.parent_id, agent.parent_id.startsWith('session:') ? 'session' : 'subagent').suit;
    return specFor(agent.id, role, { accent: parentSuit });
  }

  /**
   * A sub-agent has just been born: its parent looks up or waves at it,
   * and says its name.
   */
  private announceChild(child: Character): void {
    const parentId = child.agent.parent_id;
    if (!parentId) return;
    const parent = this.characters.get(parentId);
    if (!parent) return;
    const body = parent.body;
    if (body.inWater && body.state !== 'treading') parent.driver.react('look');
    else if (body.seat !== null) parent.driver.react('waveLying');
    else parent.driver.react('wave');
    const name = this.names.get(child.id)?.short ?? child.agent.label;
    this.labels.say(parent.id, `go, ${name}!`, ANNOUNCE_S);
  }

  private removeCharacter(character: Character): void {
    if (character.leisure.table >= 0) this.teaTables.leave(character.leisure.table, this.time);
    character.rig.destroy();
    this.scene.remove(character.hit);
    this.labels.remove(character.id);
    this.characters.delete(character.id);
    if (this.hoveredId === character.id) {
      this.hoveredId = null;
      store.setHovered(null);
    }
  }

  // -- moments ----------------------------------------------------------

  /** What the agents did since the last look: the moments of step 27.1. */
  private readonly momentMemory: MomentMemory = createMomentMemory();

  // -- the tour and the follow (step 27.4) ------------------------------

  /** Whether the tour runs, its state, and the things it is told about. */
  private touring = false;
  private readonly tour: TourState = createTourState(0.9, 20, 0, { x: 0, y: 0.3, z: 0 });
  private readonly tourView: TourView = createTourView();
  private readonly interests: Interest[] = [];
  private tourListener: ((on: boolean) => void) | null = null;
  /** The last time anybody pointed, pressed a key or turned the wheel, in milliseconds. */
  private lastInputAt = performance.now();
  /** Whether the camera follows the selected agent (F). */
  private following = false;
  private readonly spherical = new Spherical();
  /** Whether the duck was paddling in the last frame, so that its landing is noticed once. */
  private duckWasPaddling = false;

  /** Something worth a look, for the tour: where, how much it matters, and now. */
  private interest(x: number, z: number, weight: number): void {
    this.interests.push({ x, y: 0.5, z, weight, at: this.time });
    if (this.interests.length > INTEREST_MAX) this.interests.shift();
  }

  /** Whether the tour is allowed at all: never with reduced motion. */
  get tourAllowed(): boolean {
    return !this.reducedMotion;
  }

  /** The tour's start and stop, for the button and the chip in the page. */
  setTourListener(listener: ((on: boolean) => void) | null): void {
    this.tourListener = listener;
  }

  /**
   * Start the tour from the view the camera has now. It is never started with
   * reduced motion, since nothing may move the camera but the person.
   */
  startTour(): void {
    if (this.reducedMotion || this.touring) return;
    const target = this.controls.target;
    const offset = this.tmp.copy(this.camera.position).sub(target);
    const s = this.spherical.setFromVector3(offset);
    this.tour.azimuth = s.theta;
    this.tour.polar = s.phi;
    this.tour.distance = s.radius;
    this.tour.look.x = target.x;
    this.tour.look.y = target.y;
    this.tour.look.z = target.z;
    this.tour.focus = null;
    this.tour.focusWeight = 0;
    this.tour.focusUntil = 0;
    // The things that happened before the tour began are old news.
    this.tour.seenAt = this.time;
    this.touring = true;
    this.following = false;
    this.tourListener?.(true);
  }

  /** Stop the tour: the camera stays where the tour left it. */
  stopTour(): void {
    if (!this.touring) return;
    this.touring = false;
    this.tourListener?.(false);
  }

  /** The button in the page: start the tour, or stop it. */
  toggleTour(): void {
    if (this.touring) this.stopTour();
    else this.startTour();
  }

  /**
   * F turns the close follow on for the selected agent, and off again. The
   * follow needs an agent to follow.
   */
  private toggleFollow(): void {
    if (this.following) {
      this.following = false;
      return;
    }
    const selected = store.get().selectedId;
    if (selected && this.characters.has(selected)) this.following = true;
  }

  /** The keys of the scene: T starts the tour, F follows, Escape lets go. Any other key stops the tour. */
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
    this.lastInputAt = performance.now();
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === 't') {
      this.startTour();
      return;
    }
    this.stopTour();
    if (key === 'f') this.toggleFollow();
    else if (key === 'Escape') this.following = false;
  };

  /** The camera's distance and angle ease to the close view of the followed agent. */
  private easeToFollow(dtMs: number): void {
    const offset = this.tmp.copy(this.camera.position).sub(this.controls.target);
    const s = this.spherical.setFromVector3(offset);
    if (this.reducedMotion) {
      s.radius = FOLLOW_DISTANCE;
      s.phi = FOLLOW_POLAR;
    } else {
      s.radius = damp(s.radius, FOLLOW_DISTANCE, 2.2, dtMs);
      s.phi = damp(s.phi, FOLLOW_POLAR, 2.2, dtMs);
    }
    offset.setFromSpherical(s);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  /** Look for the moments since the last look, and show each one. */
  private noticeMoments(agents: AgentView[]): void {
    for (const moment of detectMoments(agents, this.time, this.momentMemory)) this.celebrate(moment);
  }

  /**
   * Show a moment in the pool (step 27.2).
   *
   * With reduced motion there is no confetti, no fireworks and no hop. The
   * labels and the claps stay, because they are small.
   */
  private celebrate(moment: Moment): void {
    switch (moment.kind) {
      case 'finished':
        this.celebrateFinished(moment.id);
        return;
      case 'milestone':
        this.celebrateMilestone(moment.id, moment.count);
        return;
      case 'sessionEnded':
        this.celebrateSessionEnded(moment.id);
        return;
      case 'awake':
        // Work has started again: a cat asleep near a working agent wakes up.
        for (const c of this.characters.values()) {
          if (c.agent.status === 'working') this.creatureDirector.wakeNear(c.body.x, c.body.z, WAKE_RANGE);
        }
        return;
      case 'busy':
        this.equipment.startFountains(this.time);
        return;
      default:
        // 'quiet' needs nothing here: the calm of the water is read from the same clock.
    }
  }

  /**
   * A finished agent gets out. The others look up or wave, as they always
   * did; three people out of the water clap; a swimmer near it slaps the
   * water; and the finisher cheers once it stands on the deck.
   */
  private celebrateFinished(id: string): void {
    const finisher = this.characters.get(id);
    if (!finisher) return;
    let waved = 0;
    for (const other of this.characters.values()) {
      if (other === finisher) continue;
      if (other.body.inWater) {
        other.driver.react('look');
      } else if (waved < 3) {
        other.driver.react('wave');
        waved += 1;
      }
    }
    const body = finisher.body;
    let clapped = 0;
    for (const other of this.nearby(body.x, body.z, CLAP_RANGE, finisher)) {
      if (clapped >= CLAP_MAX) break;
      if (other.body.inWater) continue;
      other.driver.play('clap');
      clapped += 1;
    }
    for (const other of this.nearby(body.x, body.z, SLAP_RANGE, finisher)) {
      if (!other.body.inWater) continue;
      const hand = this.handSpot(other);
      this.splash(hand.x, hand.z, 0.7);
    }
    finisher.pendingCheer = true;
    this.interest(body.x, body.z, 2);
    this.labels.say(finisher.id, 'done!');
  }

  /** A round number of events: confetti over the agent, its label says the count, and it cheers. */
  private celebrateMilestone(id: string, count: number): void {
    const c = this.characters.get(id);
    if (!c) return;
    this.labels.say(id, `${count}!`, 3);
    const body = c.body;
    this.interest(body.x, body.z, 2);
    if (!this.reducedMotion) this.particles.confetti(c.shown.x, c.shown.y + c.scale * 0.92 + 0.6, c.shown.z, 80);
    if (body.inWater) {
      body.celebrate = MILESTONE_TREAD_S;
      c.driver.play('cheer');
    } else if (body.seat !== null) {
      c.driver.play('cheer');
    } else {
      c.driver.play(this.reducedMotion ? 'clap' : 'hop');
    }
  }

  /**
   * A session that ends walks to the gate. There it is cheered: confetti by
   * day, and the two nearest people wave to it (the fireworks come in step 27.3).
   */
  private celebrateSessionEnded(id: string): void {
    const c = this.characters.get(id);
    if (c) c.leaveLeft = LEAVE_WAIT_S;
  }

  /** The rockets still to go up, and the time to the next one. */
  private rocketsLeft = 0;
  private rocketIn = 0;

  /**
   * The fireworks of a night: three rockets over the garden beyond the far
   * fence, 0.8 s apart. Not with reduced motion; the scene does not start them.
   */
  private updateRockets(dt: number): void {
    if (this.rocketsLeft <= 0) return;
    this.rocketIn -= dt;
    if (this.rocketIn > 0) return;
    const pool = this.world.pool;
    const n = ROCKETS - this.rocketsLeft;
    const spot = ROCKET_SPOTS[n % ROCKET_SPOTS.length];
    this.particles.firework(pool.minX + (pool.maxX - pool.minX) * spot, pool.minZ);
    this.rocketsLeft -= 1;
    this.rocketIn = ROCKET_GAP_S;
  }

  /** The people near a spot, nearest first, up to `range` metres away (the one `except` is left out). */
  private nearby(x: number, z: number, range: number, except: Character): Character[] {
    const found: { c: Character; d: number }[] = [];
    for (const c of this.characters.values()) {
      if (c === except) continue;
      const d = Math.hypot(c.body.x - x, c.body.z - z);
      if (d <= range) found.push({ c, d });
    }
    found.sort((a, b) => a.d - b.d);
    return found.map((f) => f.c);
  }

  /** Where a swimmer's hand goes into the water, ahead of its centre. */
  private handSpot(c: Character): { x: number; z: number } {
    const centre = swimCentre(c.body);
    if (!centre) return { x: c.shown.x, z: c.shown.z };
    const ahead = c.scale * 0.45;
    return { x: centre.x + Math.sin(c.yaw) * ahead, z: centre.z + Math.cos(c.yaw) * ahead };
  }

  /**
   * The finisher's cheer and hop, and a leaving session's cheer at the gate.
   * The cheer waits until the figure is out of the water and on its feet.
   */
  private updateCheer(c: Character, dt: number): void {
    const body = c.body;
    const out = !body.inWater && body.climbing === 0 && body.entry === null && body.edgeOut === null;
    if (c.pendingCheer && out) {
      c.pendingCheer = false;
      c.driver.play('cheer');
      c.hopIn = CHEER_S;
    }
    if (c.hopIn > 0) {
      c.hopIn -= dt;
      if (c.hopIn <= 0 && !this.reducedMotion && body.seat === null) c.driver.play('hop');
    }
    if (c.leaveLeft > 0) {
      c.leaveLeft -= dt;
      const gate = this.world.gate;
      if (out && Math.hypot(body.x - gate.x, body.z - gate.z) < GATE_NEAR) {
        c.leaveLeft = 0;
        this.interest(gate.x, gate.z, 1);
        if (!this.reducedMotion && this.palette.light >= NIGHT_PALETTE_LIGHT) {
          this.particles.confetti(gate.x, 1.2, gate.z, 60);
        } else if (!this.reducedMotion) {
          this.rocketsLeft = ROCKETS;
          this.rocketIn = 0;
        }
        for (const other of this.nearby(body.x, body.z, Number.POSITIVE_INFINITY, c).slice(0, 2)) {
          if (other.body.inWater) other.driver.react('look');
          else if (other.body.seat !== null) other.driver.react('waveLying');
          else other.driver.react('wave');
        }
      }
    }
  }

  // -- the world --------------------------------------------------------

  private keyOf(payload: Record<string, unknown> | null): string {
    if (!payload) return '';
    return `${payload.lanes}/${payload.loungers}/${payload.waiting}`;
  }

  /** The backend describes the pool after the first frame; build it again then. */
  private rebuildWorldIfNeeded(): void {
    const payload = store.get().scenePayload;
    const key = this.keyOf(payload);
    if (key === this.payloadKey) return;
    this.payloadKey = key;
    this.world = buildWorld(payload);
    underwaterUniforms.uWaterY.value = this.world.waterY;
    this.scene.remove(this.environment.group);
    this.environment.dispose();
    this.environment = buildEnvironment(this.world);
    this.scene.add(this.environment.group);
    this.scene.remove(this.teaGlasses.mesh);
    this.teaGlasses.dispose();
    this.buildTeaSet();
    this.scene.remove(this.nightLights.group);
    this.nightLights.dispose();
    this.nightLights = buildNightLights(this.world);
    this.scene.add(this.nightLights.group);
    this.scene.remove(this.equipment.group);
    this.equipment.dispose();
    this.equipment = buildEquipment(this.world, this.particles, this.water);
    this.scene.add(this.equipment.group);
    this.scene.remove(this.rain.lines);
    this.rain.dispose();
    this.rain = new Rain(this.world.deck);
    this.scene.add(this.rain.lines);
    // The characters keep their place; their paths are planned again.
    for (const character of this.characters.values()) {
      character.body.goal = null;
      character.body.path = [];
    }
    this.environment.setPalette(this.palette.deck, this.palette.coping, 0x8cc56a, this.palette.tree);
    if (!this.userMovedCamera) this.viewReady = false;
  }

  private applyDaylight(force = false): void {
    const now = new Date();
    const step = now.getHours() * 4 + Math.floor(now.getMinutes() / 15);
    const weather = this.currentWeather(now);
    if (!force && step === this.paletteStep && weather === this.weather) return;
    this.paletteStep = step;
    this.weather = weather;
    const hour = this.clockOverride ?? hourOfDay(now);
    this.palette = applyWeather(paletteFor(hour), weather);
    this.lighting.apply(this.palette, hour);
    this.water.setColours(this.palette.water, this.palette.waterDeep, this.palette.skyBottom, this.palette.light);
    this.water.setSun(this.lighting.sunDirection);
    this.environment.setPalette(this.palette.deck, this.palette.coping, 0x8cc56a, this.palette.tree);
  }

  // -- the frame --------------------------------------------------------

  private tick = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const dtMs = Math.min(MAX_FRAME_MS, now - this.last);
    this.last = now;
    this.update(dtMs);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.updateDebug(now);
  };

  private update(dtMs: number): void {
    const dt = dtMs / 1000;
    this.lastDt = dt;
    this.time += dt;
    this.frame += 1;
    if (this.frame % 60 === 0) this.applyDaylight();
    // The work is looked at once a second as well: a candidate that stopped
    // changing gets shown, and a question that has gone stale stops counting.
    if (this.frame % 60 === 0) {
      const nowS = Date.now() / 1000;
      for (const character of this.characters.values()) this.refreshWork(character, nowS);
    }

    // The board's bend: a bounce sets it swinging, and a rider at the tip
    // holds it a little down.
    this.boardT += dt;
    let onTip = false;
    for (const c of this.characters.values()) {
      if (c.body.entry?.kind === 'board') onTip = true;
    }
    this.boardFlex = boardFlexAt(this.boardT) + (onTip ? 0.04 : 0);
    this.equipment.setBoardFlex(this.boardFlex);
    if (this.frame % RACE_EVERY === RACE_EVERY / 2) this.startRaces();
    // The errands are planned once a second, a little after the work is read.
    if (this.frame % 60 === 30) this.planErrands();
    // The moments the time alone brings (a quiet pool) are looked for once a second.
    if (this.frame % 60 === 45) this.noticeMoments([...store.get().agents.values()]);
    // The tour starts by itself after two minutes with no input, while the page is shown.
    if (
      !this.touring &&
      !this.reducedMotion &&
      document.visibilityState === 'visible' &&
      performance.now() - this.lastInputAt >= TOUR_IDLE_MS
    ) {
      this.startTour();
    }
    while (this.interests.length > 0 && this.interests[0].at < this.time - INTEREST_KEEP_S) this.interests.shift();

    const walkers: Walker[] = [];
    for (const c of this.characters.values()) {
      const b = c.body;
      if (b.inWater || b.seat !== null || b.climbing !== 0 || b.entry !== null || b.edgeOut !== null) continue;
      walkers.push({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 });
    }

    const filter = store.get().filter;
    const filtering = filter.status !== 'all' || filter.kind !== 'all';

    for (const character of this.characters.values()) {
      const body = character.body;
      body.boardFlex = this.boardFlex;
      // In the rain a walker hurries, and the outdoor errands end (the flow does that).
      body.hurry = this.rainLevel > 0.3;
      stepBody(body, this.world, dt, walkers, this.flowContext, (index) =>
        ladderBusy(this.bodies(), index, body),
      );
      this.drainEvents(character);

      const driver = character.driver;
      // What the errand carries, and whether the figure may start an idle
      // activity of its own: never during an errand, or while it needs the person.
      driver.setCarry(body.carry);
      this.updateVariant(character, dt);
      this.updateFidget(character, dt);
      this.updateLeisure(character, dt);
      driver.allowActivity(body.errand === null && !body.needsYou && character.variant === null);
      this.updateShower(character, dt);
      // The stroke and the tempo are what the work asks for. The driver
      // does nothing when they have not changed.
      driver.setSwimStyle(body.swimStyle);
      driver.setTempo(body.tempo);
      this.syncAction(character);
      this.raiseHandFor(character);
      this.updateCheer(character, dt);
      this.coverUnderRain(character);
      // The driver keeps its own activity; the body says whether there is
      // room for one.
      if (body.state === 'lounging') {
        if (driver.currentState !== 'activity') driver.setState('lounging');
      } else {
        driver.setState(body.state);
      }
      if (body.strideCycles > 0) driver.advanceWalk(body.strideCycles);
      const pose = driver.update(dtMs);
      // A walker in the rain leans forward a little, as if it were hurrying against it.
      if (body.hurry && body.state === 'walking') pose.bodyPitch += RAIN_LEAN;

      // The rig follows the body, a little smoothed: sitting down and
      // stepping off the ladder are moves, not jumps. An entry is quick, so
      // the rig keeps up with it.
      const rate = body.entry !== null || body.edgeOut !== null ? 60 : body.state === 'walking' ? 30 : 9;
      character.shown.x = damp(character.shown.x, body.x, rate, dtMs);
      character.shown.y = damp(character.shown.y, body.y, rate, dtMs);
      character.shown.z = damp(character.shown.z, body.z, rate, dtMs);
      character.yaw = damp(character.yaw, body.yaw, 10, dtMs);
      const root = character.rig.root;
      root.position.copy(character.shown);
      root.rotation.y = character.yaw;
      applyPose3D(character.rig, pose, {
        eyes: driver.eyes,
        hair: driver.hair,
        mouth: driver.mouth,
        ponytail: driver.ponytail,
        prop: driver.prop,
      });

      // The pointer is tested against a capsule round the figure.
      const lying = body.inWater && body.state !== 'treading';
      character.hit.position.set(
        character.shown.x + (lying ? Math.sin(character.yaw) * character.scale * 0.5 : 0),
        character.shown.y + (lying ? 0.1 : character.scale * 0.5),
        character.shown.z + (lying ? Math.cos(character.yaw) * character.scale * 0.5 : 0),
      );
      character.hit.rotation.set(lying ? Math.PI / 2 : 0, character.yaw, 0, 'YXZ');
      character.hit.scale.setScalar(character.scale / CHARACTER_HEIGHT);

      // A figure on the edge kicks its feet, and the water shows it.
      if (body.state === 'edgeSitting') {
        character.kickTimer -= dt;
        if (character.kickTimer <= 0) {
          character.kickTimer = KICK_EVERY_S;
          this.water.ripple(body.x + Math.sin(body.yaw) * 0.5, body.z + Math.cos(body.yaw) * 0.5, 0.12);
        }
      }

      // A hand going into the water: a ring and a few drops.
      if (driver.strokeCount !== character.lastStrokes) {
        character.lastStrokes = driver.strokeCount;
        const centre = swimCentre(body);
        if (centre) {
          const ahead = character.scale * 0.45;
          const x = centre.x + Math.sin(character.yaw) * ahead;
          const z = centre.z + Math.cos(character.yaw) * ahead;
          this.water.ripple(x, z, 1);
          if (!this.reducedMotion) this.particles.splash(x, this.world.waterY + 0.02, z, 0.7);
        }
      }
      // The wake: small rings left behind the swimmer as it goes.
      if (body.inWater && this.frame % 20 === (character.spec.seed % 20)) {
        const centre = swimCentre(body);
        if (centre) this.water.ripple(centre.x, centre.z, 0.35);
      }
      // The foam: a swimmer leaves a white trail behind its feet. A
      // swimmer that treads water stays where it is and leaves none.
      if (!this.reducedMotion && body.inWater && body.state !== 'treading' && body.swim && this.frame % 4 === character.spec.seed % 4) {
        const centre = swimCentre(body);
        if (centre) {
          const back = character.scale * 0.55;
          this.particles.foam(
            centre.x - Math.sin(character.yaw) * back,
            centre.z - Math.cos(character.yaw) * back,
            this.world.waterY + 0.012,
            character.spec.swimStyle === 'butterfly' ? 0.2 : 0.12,
          );
        }
      }

      // Steam over a cup of tea, and a nap that says so.
      if (driver.prop === 'cup') {
        character.steamTimer -= dt;
        if (character.steamTimer <= 0) {
          character.steamTimer = 0.18;
          character.rig.props.cup.getWorldPosition(this.tmp);
          this.particles.steam(this.tmp.x, this.tmp.y + 0.08, this.tmp.z);
        }
      }
      if (driver.activeKind === 'nap') {
        character.napTimer -= dt;
        if (character.napTimer <= 0) {
          character.napTimer = 4;
          this.labels.say(character.id, 'z z z', 2.2);
        }
      }

      // The filter of the agent list dims the ones it hides.
      const dimmed = filtering && !matches(character.agent, filter);
      if (dimmed !== character.dimmed) {
        character.dimmed = dimmed;
        character.rig.mesh.material = dimmed ? dimmedMaterial() : characterMaterial();
        character.rig.outline.visible = !dimmed;
      }
    }

    this.updateCourt();
    this.updateTable();
    this.teaTables.tick(this.time);
    this.teaGlasses.sync((i) => this.teaTables.has(i));
    this.updateCalm(dt);
    this.updateCreatures(dt);
    this.updateGarden(dt);
    this.updateRockets(dt);
    this.runTimedRipples(dt);
    this.particles.update(dt, this.world.waterY);
    // The rain is the same clock as the 2D pool's; drops that land in the
    // water leave a ring.
    const pool = this.world.pool;
    this.rainLevel = this.forcedWeather !== null ? (this.forcedWeather === 'rain' ? 1 : 0) : rainAmount(Date.now() / 1000);
    this.rain.update(dt, this.reducedMotion ? 0 : this.rainLevel, this.world.waterY, (x, z) => {
      if (x > pool.minX && x < pool.maxX && z > pool.minZ && z < pool.maxZ) this.water.ripple(x, z, 0.25);
    });
    this.water.update(this.time);
    // The deck wets in a minute of rain and dries in five; the lamps follow the light.
    this.wetness = this.rainLevel > 0.3 ? Math.min(1, this.wetness + dt / 60) : Math.max(0, this.wetness - dt / 300);
    this.environment.setWetness(this.wetness);
    this.environment.setNight(nightAmount(this.palette.light));
    this.environment.update(this.time, this.wetness);
    const night = nightAmount(this.palette.light);
    this.water.setNight(night);
    this.nightLights.update(this.time, night);
    this.sky.update(this.time, dt, this.palette);
    this.lighting.setTime(this.time);
    this.updateHotTubSteam(night);
    this.equipment.update(this.time, dt);
    this.updateHoverRing();
    this.updateFamilyRings();
    this.updateCamera(dtMs);
  }

  /**
   * Play the action the body asks for, when it has changed. A held action
   * is held until the body asks for something else.
   */
  private syncAction(character: Character): void {
    const body = character.body;
    const want = bodyAction(body);
    const held = want !== null && bodyActionHeld(body);
    if (want === character.wantAction && held === character.wantHeld) return;
    if (want === null) {
      if (character.wantAction !== null) character.driver.release();
    } else if (held) {
      character.driver.hold(want, bodyActionPhase(body));
    } else {
      character.driver.play(want);
    }
    character.wantAction = want;
    character.wantHeld = held;
  }

  /** Show what a body reports: the splashes, the board's bounce, the wall a racer reached. */
  private drainEvents(character: Character): void {
    const events = character.body.events;
    if (events.length === 0) return;
    for (const event of events) this.showEvent(event, character);
    events.length = 0;
  }

  private showEvent(event: BodyEvent, character: Character): void {
    const waterY = this.world.waterY;
    // A splash is news for the creatures too: a duck or a cat is startled by a big one.
    if (event.name === 'splash:huge' || event.name === 'splash:big' || event.name === 'splash:small') {
      const size = event.name === 'splash:huge' ? 2.2 : event.name === 'splash:big' ? 1.4 : 0.7;
      this.creatureSplashes.push({ x: event.x, z: event.z, size });
    }
    // What is worth a look: a landing from the slide or the block, a cannonball, a board's bounce and a race's wall.
    if (event.name === 'splash:big' || event.name === 'splash:huge' || event.name === 'board:bounce') {
      this.interest(event.x, event.z, 1.5);
    } else if (event.name === 'race:wall') {
      this.interest(event.x, event.z, 1);
    }
    switch (event.name) {
      case 'splash:big':
        this.splash(event.x, event.z, 1.4);
        return;
      case 'splash:small':
        this.splash(event.x, event.z, 0.7);
        return;
      case 'splash:huge': {
        // A cannonball: the splash, three rings a little apart, and a shower
        // of drops. The swimmers near it look, and a lounger may wave.
        this.splash(event.x, event.z, 2.2);
        this.timedRipples.push({ t: 0.15, x: event.x, z: event.z, strength: 1.2 });
        this.timedRipples.push({ t: 0.3, x: event.x, z: event.z, strength: 1.2 });
        if (!this.reducedMotion) {
          this.particles.splash(event.x, waterY + 0.02, event.z, 1.6);
          this.particles.splash(event.x, waterY + 0.02, event.z, 1.6);
        }
        for (const other of this.characters.values()) {
          if (other === character) continue;
          const dist = Math.hypot(other.body.x - event.x, other.body.z - event.z);
          if (other.body.inWater && dist < 3) other.driver.react('look');
          else if (other.body.seat !== null && dist < 6 && (other.spec.seed + Math.round(this.time * 10)) % 10 < 3) {
            other.driver.react('wave');
          }
        }
        return;
      }
      case 'drip':
        // The water runs off a swimmer that climbs out over the edge.
        if (!this.reducedMotion) {
          for (let k = 0; k < 6; k += 1) {
            this.particles.arc(event.x + (k % 3 - 1) * 0.08, 0.35, event.z, 0, 0.1, 0);
          }
        }
        return;
      case 'board:bounce':
        this.boardT = 0;
        return;
      case 'drink:icecream':
        // A customer back from the kiosk with an ice cream: it is eaten on the lounger.
        character.driver.playActivity('snack', DRINK_S);
        return;
      case 'drink:bottle':
        character.driver.playActivity('tea', DRINK_S);
        return;
      case 'race:wall': {
        // The first racer to reach the wall ahead wins; the other looks up.
        const partner = character.body.racePartner;
        character.body.racePartner = null;
        if (partner === null) return;
        const other = this.characters.get(partner);
        if (!other) return;
        other.body.racePartner = null;
        if (other.body.raceBoost <= 1) return;
        character.body.celebrate = WIN_TREAD_S;
        character.driver.play('cheer');
        this.labels.say(character.id, 'first!', 2);
        other.driver.react('look');
        return;
      }
      default:
    }
  }

  /** A splash in the water, with the rings and the drops of a body landing. */
  private splash(x: number, z: number, strength: number): void {
    this.water.ripple(x, z, strength);
    if (!this.reducedMotion) this.particles.splash(x, this.world.waterY + 0.02, z, strength);
  }

  /** The ripples that come a moment after a big splash, when their time has come. */
  private runTimedRipples(dt: number): void {
    for (let i = this.timedRipples.length - 1; i >= 0; i -= 1) {
      const r = this.timedRipples[i];
      r.t -= dt;
      if (r.t > 0) continue;
      this.water.ripple(r.x, r.z, r.strength);
      this.timedRipples.splice(i, 1);
    }
  }

  /**
   * The race finder, once in a while: two swimmers in neighbouring lanes
   * that swim the same way and come level may race for a length.
   */
  private startRaces(): void {
    const swimmers: RaceSwimmer[] = [];
    for (const c of this.characters.values()) {
      const b = c.body;
      if (!b.inWater || b.swim === null || b.entry !== null || b.edgeOut !== null) continue;
      swimmers.push({
        id: b.id,
        lane: b.lane,
        x: b.swim.x,
        dir: b.swim.dir,
        racing: b.raceBoost > 1,
        style: b.swimStyle,
        work: b.work,
        needsYou: b.needsYou,
      });
    }
    const pool = this.world.pool;
    for (const [a, b] of findRaces(swimmers, this.time, this.raceCooldown, pool)) {
      const first = this.characters.get(a);
      const second = this.characters.get(b);
      if (!first || !second) continue;
      first.body.raceBoost = RACE_BOOST;
      second.body.raceBoost = RACE_BOOST;
      first.body.racePartner = b;
      second.body.racePartner = a;
    }
  }

  /**
   * What the entries need to know about the others: who is on the slide,
   * the board, a starting block, and where the water is busy.
   */
  private entryBusy(self: Body): EntryBusy {
    let slide = false;
    let board = false;
    for (const c of this.characters.values()) {
      const other = c.body;
      if (other === self || other.entry === null) continue;
      if (other.entry.kind === 'slide' && other.entry.phase !== 'wait') slide = true;
      if (other.entry.kind === 'board') board = true;
    }
    return {
      slide,
      board,
      block: (lane: number) => {
        for (const c of this.characters.values()) {
          const o = c.body;
          if (o !== self && o.entry !== null && o.entry.kind === 'block' && o.lane === lane) return true;
        }
        return false;
      },
      waterNear: (x: number, z: number, radius: number) => {
        for (const c of this.characters.values()) {
          const o = c.body;
          if (o === self || !o.inWater || o.swim === null) continue;
          if (Math.hypot(o.swim.x - x, o.swim.z - z) < radius) return true;
        }
        return false;
      },
    };
  }

  /**
   * A session that waits for the person raises a hand, wherever its figure
   * is: treading in the water, lying on a lounger, or standing at the edge
   * or at the gate.
   */
  private raiseHandFor(character: Character): void {
    const body = character.body;
    const driver = character.driver;
    let want: ActionKind | null = null;
    if (body.needsYou) {
      if (body.state === 'treading') want = 'raiseHand';
      else if (body.seat !== null) want = 'raiseHandLying';
      else if ((body.state === 'resting' || body.state === 'edgeSitting') && !body.inWater && body.climbing === 0) want = 'raiseHand';
    }
    if (want !== null) {
      driver.hold(want);
    } else if (driver.action === 'raiseHand' || driver.action === 'raiseHandLying') {
      driver.release();
    }
    // A session that starts to wait for the person is the most worth a look.
    if (body.needsYou && !character.wasNeedy) this.interest(body.x, body.z, 3);
    character.wasNeedy = body.needsYou;
    // The bubble says so again every eight seconds, for as long as it waits.
    if (body.needsYou) {
      character.attentionTimer -= this.lastDt;
      if (character.attentionTimer <= 0) {
        character.attentionTimer = 8;
        this.labels.say(character.id, 'needs you', 3);
      }
    } else {
      character.attentionTimer = 0;
    }
  }

  private updateHoverRing(): void {
    const id = this.hoveredId ?? store.get().selectedId;
    const character = id ? this.characters.get(id) : null;
    if (!character) {
      this.hoverRing.visible = false;
      return;
    }
    this.ringSpot(character, this.ringAt);
    this.hoverRing.position.set(this.ringAt.x, this.ringAt.y, this.ringAt.z);
    this.hoverRing.scale.setScalar(this.ringAt.scale);
    this.hoverRing.visible = true;
  }

  /** Where a ring goes under a character, and how big: written into `out`. */
  private ringSpot(character: Character, out: { x: number; y: number; z: number; scale: number }): void {
    const body = character.body;
    const centre = swimCentre(body);
    out.x = centre ? centre.x : character.shown.x;
    out.z = centre ? centre.z : character.shown.z;
    out.y = body.inWater ? this.world.waterY + 0.03 : body.seat !== null ? 0.4 : 0.02;
    out.scale = body.inWater || body.seat !== null ? 2.1 : 1;
  }

  /**
   * The family of the agent under the pointer, or the selected one, has a
   * small ring under its parent and under each of its children.
   */
  private updateFamilyRings(): void {
    const id = this.hoveredId ?? store.get().selectedId;
    const focus = id ? this.characters.get(id) : undefined;
    let used = 0;
    if (focus) {
      const parent = focus.agent.parent_id ? this.characters.get(focus.agent.parent_id) : undefined;
      if (parent) used = this.showFamilyRing(parent, used);
      for (const child of this.characters.values()) {
        if (used >= FAMILY_RINGS) break;
        if (child.agent.parent_id === focus.id) used = this.showFamilyRing(child, used, focus.spec.suit);
      }
    }
    for (let i = used; i < FAMILY_RINGS; i += 1) this.familyRings[i].visible = false;
  }

  /**
   * Put the next family ring under a character, in the colour of its family.
   *
   * @param colour The family's colour; a parent's ring is in its own suit.
   * @returns how many rings are in use now.
   */
  private showFamilyRing(character: Character, used: number, colour = character.spec.suit): number {
    const ring = this.familyRings[used];
    const material = this.familyMaterials[used];
    this.ringSpot(character, this.ringAt);
    ring.position.set(this.ringAt.x, this.ringAt.y, this.ringAt.z);
    ring.scale.setScalar(this.ringAt.scale * 0.7);
    // The colour is only set when it changes: setting it every frame would
    // parse the colour string every frame.
    if (ring.userData.colour !== colour) {
      material.color.set(colour);
      ring.userData.colour = colour;
    }
    ring.visible = true;
    return used + 1;
  }

  // -- the garden: the sprinkler and the petals -------------------------

  /**
   * The sprinkler sweeps its arc from 07:00 to 09:00, and petals come off the
   * garden trees now and then by day. Neither runs in the rain or with
   * reduced motion.
   */
  private updateGarden(dt: number): void {
    const raining = this.rainLevel > 0.3;
    if (sprinklerOn(this.clockHour(), raining, this.reducedMotion)) {
      const head = this.world.sprinkler;
      // The arc: from one side to the other and back, in eight seconds.
      const u = (this.time / SPRINKLER_SWEEP_S) % 1;
      const angle = SPRINKLER_ARC * (u < 0.5 ? 4 * u - 1 : 3 - 4 * u);
      const horizontal = SPRINKLER_SPEED * Math.cos(SPRINKLER_LAUNCH);
      const up = SPRINKLER_SPEED * Math.sin(SPRINKLER_LAUNCH);
      this.sprinklerOwed += dt * SPRINKLER_DROPS_PER_S;
      while (this.sprinklerOwed >= 1) {
        this.sprinklerOwed -= 1;
        const a = angle + (Math.random() - 0.5) * 0.15;
        this.particles.arc(head.x, 0.3, head.z, Math.sin(a) * horizontal, up, Math.cos(a) * horizontal);
      }
    } else {
      this.sprinklerOwed = 0;
    }
    if (!raining && !this.reducedMotion && this.palette.light > 0.3) {
      this.petalIn -= dt;
      if (this.petalIn <= 0) {
        this.petalIn = PETAL_GAP_MIN_S + Math.random() * PETAL_GAP_SPAN_S;
        const trees = this.world.trees;
        const tree = trees[Math.floor(Math.random() * trees.length)];
        if (tree && this.particles.petalCount() < PETALS_AT_ONCE) {
          this.particles.petal(tree.x + (Math.random() - 0.5) * 1.2, 3.0, tree.z + (Math.random() - 0.5) * 1.2);
        }
      }
    }
  }

  /**
   * In the rain a figure on its lounger holds a towel over its head, until the
   * rain stops or it wants something else. It is not done during an errand, an
   * idle activity or a request for the person.
   */
  private coverUnderRain(character: Character): void {
    const body = character.body;
    const driver = character.driver;
    const want =
      this.rainLevel > 0.3 &&
      body.state === 'lounging' &&
      body.errand === null &&
      !body.needsYou &&
      !body.inWater &&
      body.entry === null &&
      !driver.isDoingActivity &&
      character.variant === null;
    if (want) {
      driver.setCarry('towel');
      driver.hold('cover');
      character.covering = true;
    } else if (character.covering) {
      driver.release();
      character.covering = false;
    }
  }

  /**
   * The calm of the pool: after two minutes with nobody working, the water
   * settles, the fountains stop and the cat watches the still water.
   */
  private updateCalm(dt: number): void {
    let working = false;
    for (const c of this.characters.values()) {
      if (c.agent.status === 'working') {
        working = true;
        break;
      }
    }
    if (working) this.lastWorkingAt = this.time;
    this.quietFor = this.time - this.lastWorkingAt;
    this.calm = this.quietFor >= CALM_AFTER_S;
    this.calmK += ((this.calm ? 1 : 0) - this.calmK) * Math.min(1, dt / 10);
    this.water.setCalm(this.calmK);
    this.equipment.setCalm(this.calm);
  }

  /** At night the hot tub steams: three wisps off its surface, every 0.4 s. */
  private updateHotTubSteam(night: number): void {
    if (night < 0.5 || this.frame % 24 !== 0) return;
    const tub = this.world.equipment.hotTub;
    for (let k = 0; k < 3; k += 1) {
      const a = (k * 2 * Math.PI) / 3 + this.time * 0.5;
      this.particles.steam(tub.centre.x + Math.cos(a) * tub.radius * 0.5, tub.rim - 0.05, tub.centre.z + Math.sin(a) * tub.radius * 0.5);
    }
  }

  // -- the creatures ---------------------------------------------------

  /** The weather now: the one the hooks forced, or the clock's own. */
  private currentWeather(now: Date): Weather {
    return this.forcedWeather ?? weatherFor(now.getTime() / 1000);
  }

  /** The hour the pool shows: the clock's own, or the one the hooks set. */
  private clockHour(): number {
    return this.clockOverride ?? hourOfDay(new Date());
  }

  /**
   * Tell the creatures what the pool is like, and draw them where they are.
   *
   * The lists the creatures read are kept between frames, so this does not
   * allocate: the people are the same objects every frame, with new values.
   */
  private updateCreatures(dt: number): void {
    const hour = this.clockHour();
    const raining = this.rainLevel > 0.3;
    const people = this.creaturePeople;
    people.length = 0;
    for (const c of this.characters.values()) {
      const b = c.body;
      let p = this.personPool[people.length];
      if (!p) {
        p = { x: 0, z: 0, yaw: 0, moving: false, inWater: false };
        this.personPool.push(p);
      }
      p.x = b.x;
      p.z = b.z;
      p.yaw = b.yaw;
      p.moving = b.path.length > 0 || b.swim !== null;
      p.inWater = b.inWater;
      people.push(p);
    }
    this.avoidSpots.length = 0;
    for (const c of this.characters.values()) {
      if (c.body.errand !== null) this.avoidSpots.push(c.body.errand.spot);
    }
    // The places behind the loungers that have someone on them: the cat naps there.
    if (this.frame % 30 === 0) {
      this.napSpots = [];
      for (const c of this.characters.values()) {
        const b = c.body;
        if (b.seat === null || b.errand !== null || b.lounger === null) continue;
        const l = this.world.loungers[b.lounger];
        if (l) this.napSpots.push({ x: l.x, z: l.z - l.facing.z * (l.length / 2 + 0.5) });
      }
    }
    const env: CreatureWorld = {
      world: this.world,
      hour,
      light: this.palette.light,
      raining,
      reducedMotion: this.reducedMotion,
      calm: this.calm,
      sprinkler: sprinklerOn(hour, raining, this.reducedMotion),
      people,
      splashes: this.creatureSplashes,
      avoid: this.avoidSpots,
      naps: this.napSpots,
    };
    this.creatureDirector.step(dt, this.time, env);
    this.creatures3d.update(this.creatureDirector.creatures, this.time);
    this.creatureSplashes.length = 0;
    for (const c of this.creatureDirector.creatures) {
      if (c.kind !== 'duck') continue;
      this.duckWater(c.state, c.x, c.z, dt);
      // The duck coming down on the water is worth a look, once.
      const paddling = c.state === 'paddle';
      if (paddling && !this.duckWasPaddling) this.interest(c.x, c.z, 1);
      this.duckWasPaddling = paddling;
    }
  }

  /** The duck's rings on the water while it paddles, and the drops as it takes off. */
  private duckWater(state: string, x: number, z: number, dt: number): void {
    if (state === 'paddle') {
      this.duckRippleIn -= dt;
      if (this.duckRippleIn <= 0) {
        this.duckRippleIn = 1;
        this.water.ripple(x, z, 0.5);
      }
    } else {
      this.duckRippleIn = 0;
    }
    if (state === 'takeOff' && !this.reducedMotion) {
      this.duckSplashIn -= dt;
      if (this.duckSplashIn <= 0) {
        this.duckSplashIn = 0.25;
        this.particles.splash(x, this.world.waterY + 0.02, z, 0.5);
      }
    } else {
      this.duckSplashIn = 0;
    }
  }

  // -- the leisure: what an idle figure does on its lounger (Sprint 29.4 to 29.6)

  /** The side tables and their glasses, for the loungers of the current world. */
  private buildTeaSet(): void {
    this.teaTables = new TeaTables(this.world.loungers.length);
    this.teaGlasses = new TeaGlasses(this.world.loungers.map(teaSpotOf));
    this.scene.add(this.teaGlasses.mesh);
  }

  /**
   * A figure on its lounger that is not busy: when its gap is over, the
   * planner picks what it does next. The activities in progress are followed
   * here too, so their end is seen, and the glass goes back on its table.
   */
  private updateLeisure(c: Character, dt: number): void {
    const body = c.body;
    const driver = c.driver;
    const L = c.leisure;
    // The water: a figure that came out of it has just finished.
    if (L.wasInWater && !body.inWater) L.outAt = this.time;
    L.wasInWater = body.inWater;

    const active = driver.isDoingActivity;
    if (active) {
      L.kind = activeLeisure(driver);
      this.steerAim(c, L.kind);
      // The tea glass is set down on its table at the put-down, before the activity ends.
      if (L.table >= 0 && driver.activeProgress >= TEA_PUT_DOWN_U) this.putDownGlass(c);
    } else if (L.wasActive) {
      this.endLeisure(c);
    }
    L.wasActive = active;
    this.updateMarks(c, dt);
    if (active || !this.restsOnLounger(c)) return;
    L.gapLeft -= dt;
    if (L.gapLeft > 0) return;
    this.startLeisure(c);
  }

  /** Whether a figure lies on its lounger with nothing else to do: the planner may choose for it. */
  private restsOnLounger(c: Character): boolean {
    const body = c.body;
    return (
      body.state === 'lounging' &&
      body.seat !== null &&
      body.lounger !== null &&
      body.desired === 'lounge' &&
      body.errand === null &&
      !body.needsYou &&
      !body.inWater &&
      c.variant === null
    );
  }

  /** A figure that is free to talk, lying on the next lounger, or null. */
  private neighbourOf(c: Character): Character | null {
    const body = c.body;
    if (body.lounger === null) return null;
    const me = this.world.loungers[body.lounger];
    if (!me) return null;
    for (const o of this.characters.values()) {
      if (o === c) continue;
      const ob = o.body;
      if (ob.lounger === null || ob.seat === null) continue;
      const other = this.world.loungers[ob.lounger];
      if (!other || Math.abs(other.z - me.z) > 0.05) continue;
      const gap = Math.abs(other.x - me.x);
      if (gap < NEXT_LOUNGER_MIN_M || gap > NEXT_LOUNGER_MAX_M) continue;
      if (this.restsOnLounger(o) && !o.driver.isDoingActivity && o.variant === null) return o;
    }
    return null;
  }

  /** Whether a figure is on its lounger, awake, with the cat asleep within reach. */
  private catNear(body: Body): boolean {
    const cat = this.catCreature();
    if (!cat || cat.state !== 'sleep' || body.lounger === null) return false;
    const l = this.world.loungers[body.lounger];
    return !!l && Math.hypot(cat.x - l.x, cat.z - l.z) < CAT_NEAR_M;
  }

  /** The nearest figure in the water, or null: what `watch` looks at. */
  private nearestSwimmer(from: Body): Body | null {
    let best: Body | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const o of this.bodies()) {
      if (o === from || !o.inWater || o.swim === null) continue;
      const d = Math.hypot(o.x - from.x, o.z - from.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /**
   * The yaw of the thing an activity looks at, relative to the figure. Chat
   * looks at its partner, watch at the nearest swimmer, the cat at the cat.
   * Zero (straight ahead) for the rest.
   */
  private aimOf(c: Character, kind: LeisureKind | null): number {
    const body = c.body;
    let tx: number | null = null;
    let tz: number | null = null;
    if (kind === 'chat' && c.leisure.partner) {
      tx = c.leisure.partner.body.x;
      tz = c.leisure.partner.body.z;
    } else if (kind === 'watch') {
      const swimmer = this.nearestSwimmer(body);
      if (swimmer) {
        tx = swimmer.x;
        tz = swimmer.z;
      }
    } else if (kind === 'cat') {
      const cat = this.catCreature();
      if (cat) {
        tx = cat.x;
        tz = cat.z;
      }
    }
    if (tx === null || tz === null) return 0;
    let yaw = Math.atan2(tx - body.x, tz - body.z) - body.yaw;
    while (yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw < -Math.PI) yaw += Math.PI * 2;
    return yaw;
  }

  /** Point the activity's head at its target, when the target has moved on. */
  private steerAim(c: Character, kind: LeisureKind | null): void {
    if (kind !== 'chat' && kind !== 'watch' && kind !== 'cat') return;
    const aim = this.aimOf(c, kind);
    if (Math.abs(aim - c.leisure.aim) < 0.01) return;
    c.leisure.aim = aim;
    c.driver.setLeisureOptions({ aim, sun: sunFor(this.clockHour()), calm: this.reducedMotion });
  }

  /** The planner's choice for a figure that has finished its gap, and the activity it starts. */
  private startLeisure(c: Character): void {
    const body = c.body;
    const L = c.leisure;
    const mate = this.neighbourOf(c);
    const nowS = Date.now() / 1000;
    const ctx: LeisureContext = {
      id: c.id,
      hour: this.clockHour(),
      weather: this.weather,
      idleFor: this.idleSeconds(c, nowS),
      justFinished: this.time - L.outAt < JUST_FINISHED_S,
      fatigue: body.fatigue,
      neighbour: mate !== null,
      catNear: this.catNear(body),
      swimmers: this.nearestSwimmer(body) !== null,
      last: L.kind,
    };
    const kind = chooseLeisure(c.spec, ctx, L.rng);
    if (kind === null) {
      // The figure lies still for a while: a rest, and the next choice comes later.
      L.kind = null;
      L.gapLeft = gapAfter(c.spec, ctx.idleFor, L.rng);
      return;
    }
    this.beginLeisure(c, kind, durationOf(kind, L.rng), mate);
  }

  /**
   * Start an activity on a figure's lounger: its head, its tea glass and its
   * partner (a chat takes the neighbour too). The planner and the debug hook use it.
   */
  private beginLeisure(c: Character, kind: LeisureKind, seconds: number, mate: Character | null): void {
    const body = c.body;
    const L = c.leisure;
    L.aim = this.aimOf(c, kind);
    c.driver.setLeisureOptions({ aim: L.aim, sun: sunFor(this.clockHour()), calm: this.reducedMotion });
    c.driver.playActivity(kind, seconds);
    L.kind = kind;
    L.wasActive = true;
    L.gapLeft = 0;
    L.markIn = 1.5 + L.rng() * 2;
    if (kind === 'tea' && body.lounger !== null && this.teaTables.take(body.lounger)) {
      L.table = body.lounger;
    }
    if (kind === 'chat' && mate) {
      // Two neighbours talk: the neighbour takes the chat too, turned to this figure.
      L.partner = mate;
      mate.leisure.partner = c;
      mate.leisure.aim = this.aimOf(mate, 'chat');
      mate.driver.setLeisureOptions({ aim: mate.leisure.aim, sun: sunFor(this.clockHour()), calm: this.reducedMotion });
      mate.driver.playActivity('chat', seconds);
      mate.leisure.kind = 'chat';
      mate.leisure.wasActive = true;
      mate.leisure.gapLeft = 0;
      // The neighbour answers after this figure has spoken.
      mate.leisure.markIn = 2.6 + mate.leisure.rng() * 0.6;
    }
  }

  /**
   * The tea glass goes back on its table, where the figure set it down. If
   * the figure has gone from its lounger, the table stays empty.
   */
  private putDownGlass(c: Character): void {
    const body = c.body;
    const L = c.leisure;
    const back = body.lounger === L.table && body.seat !== null && body.errand === null && !body.needsYou;
    if (back) this.teaTables.putBack(L.table);
    else this.teaTables.leave(L.table, this.time);
    L.table = -1;
  }

  /** An activity has ended: the glass goes back, and the figure lies still before the next one. */
  private endLeisure(c: Character): void {
    const L = c.leisure;
    // A glass still in the hand (the activity was cut short) goes back now.
    if (L.table >= 0) this.putDownGlass(c);
    L.partner = null;
    L.gapLeft = gapAfter(c.spec, this.idleSeconds(c, Date.now() / 1000), L.rng);
  }

  /**
   * The speech marks of an activity: a chat in turns between two neighbours,
   * a call in bursts, the music now and then. At most one a few seconds per figure.
   */
  private updateMarks(c: Character, dt: number): void {
    const L = c.leisure;
    if (!c.driver.isDoingActivity) return;
    if (L.kind === 'chat' && L.partner) {
      L.markIn -= dt;
      if (L.markIn > 0) return;
      if (!this.speak(c, CHAT_MARKS[Math.floor(L.rng() * CHAT_MARKS.length)], 2.2)) return;
      // The neighbour answers a moment later, and this figure speaks again after that.
      L.partner.leisure.markIn = 2.2 + L.rng() * 1;
      L.markIn = 3.2 + L.rng() * 1.8;
    } else if (L.kind === 'call') {
      L.markIn -= dt;
      if (L.markIn > 0) return;
      if (!this.speak(c, CALL_MARKS[Math.floor(L.rng() * CALL_MARKS.length)], 1.8)) return;
      L.markIn = 6 + L.rng() * 4;
    } else if (L.kind === 'music') {
      L.markIn -= dt;
      if (L.markIn > 0) return;
      if (!this.speak(c, MUSIC_MARK, 1.6)) return;
      L.markIn = 5 + L.rng() * 3;
    }
  }

  /** Say a short line over a figure, unless it said one less than MARK_GAP_S ago. */
  private speak(c: Character, text: string, seconds: number): boolean {
    const L = c.leisure;
    if (this.time - L.lastMarkAt < MARK_GAP_S) return false;
    L.lastMarkAt = this.time;
    this.labels.say(c.id, text, seconds);
    return true;
  }

  /**
   * How long an agent has been idle, in seconds: from when it finished, or
   * from its last event. Zero while it works.
   */
  private idleSeconds(c: Character, nowS: number): number {
    const a = c.agent;
    if (a.status === 'working') return 0;
    const since = a.finished_at ?? a.last_event_at;
    return since ? Math.max(0, nowS - since) : 0;
  }

  /** What the card says the figure does on its lounger, or null when it is not lying on one. */
  private restingFor(c: Character): string | null {
    if (c.body.seat === null || c.agent.status === 'working') return null;
    return restingLine(activeLeisure(c.driver), this.idleSeconds(c, Date.now() / 1000));
  }

  // -- the errands -----------------------------------------------------

  /** Plan the errands of the idle agents, and show how many are in the tub. */
  private planErrands(): void {
    const hour = Math.floor(this.clockOverride ?? new Date().getHours());
    const night = hour >= 19 || hour < 7;
    const force = this.forcedErrand;
    this.forcedErrand = null;
    tickErrands([...this.bodies()], this.world, this.errandBook, this.time, this.weather === 'rain', night, force);
    let inTub = 0;
    for (const c of this.characters.values()) {
      const e = c.body.errand;
      if (e !== null && e.kind === 'hotTub' && e.phase === 'using') inTub += 1;
    }
    this.equipment.setTubOccupancy(inTub);
  }

  /**
   * A figure on its lounger now and then changes how it lies, on its side or
   * sitting up, for a while. It never does so during an errand, an idle
   * activity or a request for the person.
   */
  private updateVariant(c: Character, dt: number): void {
    const body = c.body;
    const busy = body.errand !== null || body.needsYou || body.desired !== 'lounge' || body.inWater;
    if (c.variant !== null) {
      c.variantLeft -= dt;
      if (busy || body.state !== 'lounging' || c.variantLeft <= 0) {
        c.driver.release();
        c.variant = null;
        c.variantIn = VARIANT_GAP_MIN_S + c.variantRng() * VARIANT_GAP_SPAN_S;
      }
      return;
    }
    if (busy || body.state !== 'lounging' || c.driver.isDoingActivity) return;
    c.variantIn -= dt;
    if (c.variantIn > 0) return;
    c.variant = c.variantRng() < 0.5 ? 'loungeSide' : 'loungeSitUp';
    c.variantLeft = VARIANT_LEN_MIN_S + c.variantRng() * VARIANT_LEN_SPAN_S;
    c.driver.hold(c.variant);
  }

  /** A figure waiting in the gate queue shifts its weight, checks its watch or stretches. */
  private updateFidget(c: Character, dt: number): void {
    const body = c.body;
    const queued =
      body.desired === 'waiting' &&
      body.waiting === null &&
      body.path.length === 0 &&
      body.state === 'resting' &&
      body.errand === null &&
      !body.inWater &&
      !body.needsYou;
    if (!queued || c.driver.action !== null) return;
    c.fidgetIn -= dt;
    if (c.fidgetIn > 0) return;
    const pick = c.fidgetRng();
    c.driver.play(pick < 1 / 3 ? 'checkWatch' : pick < 2 / 3 ? 'shiftWeight' : 'stretchArms');
    c.fidgetIn = FIDGET_GAP_MIN_S + c.fidgetRng() * FIDGET_GAP_SPAN_S;
  }

  /** The water of the shower: drops from the head, while the figure stands under it. */
  private updateShower(c: Character, dt: number): void {
    const e = c.body.errand;
    if (this.reducedMotion || e === null || e.kind !== 'shower' || e.phase !== 'using') {
      c.showerOwed = 0;
      return;
    }
    const head = this.world.equipment.shower.head;
    c.showerOwed += dt * SHOWER_DROPS_PER_S;
    while (c.showerOwed >= 1) {
      c.showerOwed -= 1;
      this.particles.arc(head.x + (Math.random() - 0.5) * 0.12, head.y, head.z + (Math.random() - 0.5) * 0.12, 0, 0, 0);
    }
  }

  /**
   * The beach ball game: three players on the court throw the ball round, one
   * at a time. The ball is in the hands of the one that holds it, and in the
   * air between the two.
   */
  private updateCourt(): void {
    const members = new Map<number, Character>();
    const ids: string[] = [];
    for (const c of this.characters.values()) {
      const e = c.body.errand;
      if (e === null || e.kind !== 'ballGame' || e.phase !== 'using') continue;
      members.set(e.index, c);
      ids.push(c.id);
    }
    const ball = this.equipment.beachBall;
    const centre = this.world.equipment.ballCourt.centre;
    if (members.size < 3) {
      this.court = null;
      ball.position.set(centre.x, BALL_RADIUS, centre.z);
      return;
    }
    const key = ids.sort().join('|');
    if (this.court === null || this.court.key !== key) {
      this.court = { key, holder: 0, nextAt: this.time + 1, count: 0, seed: fnv1a(key), flight: null };
    }
    const court = this.court;
    const spots = this.world.equipment.ballCourt.spots;
    if (court.flight !== null) {
      const u = (this.time - court.flight.t0) / THROW_S;
      const p = ballFlight(court.flight.from, court.flight.to, u);
      ball.position.set(p.x, p.y, p.z);
      if (u >= 1) {
        members.get(court.flight.receiver)?.driver.play('catch');
        court.holder = court.flight.receiver;
        court.flight = null;
        court.nextAt = this.time + HOLD_S;
      }
      return;
    }
    const held = spots[court.holder];
    ball.position.set(held.x + Math.sin(held.yaw) * 0.4, HAND_Y, held.z + Math.cos(held.yaw) * 0.4);
    if (this.time < court.nextAt) return;
    const thrower = court.holder;
    const receiver = nextCatcher(thrower, court.count, court.seed);
    court.count += 1;
    members.get(thrower)?.driver.play('throw');
    const a = spots[thrower];
    const b = spots[receiver];
    court.flight = {
      from: { x: a.x, y: HAND_Y, z: a.z },
      to: { x: b.x, y: HAND_Y, z: b.z },
      t0: this.time,
      receiver,
    };
  }

  /**
   * The ping-pong table: the paddles lie on it, unless somebody has them,
   * and the ball is in the air while a rally is on.
   */
  private updateTable(): void {
    let rally: ErrandState | null = null;
    let busy = false;
    for (const c of this.characters.values()) {
      const e = c.body.errand;
      if (e === null || e.kind !== 'pingPong') continue;
      busy = true;
      if (e.index === 0 && e.phase === 'using') rally = e;
    }
    this.equipment.setTablePaddles(!busy);
    if (rally === null) {
      this.equipment.setPingBallVisible(false);
      return;
    }
    const p = pingPongBall(rally.t, this.world.equipment.pingPong.ends);
    this.equipment.pingBall.position.set(p.x, p.y, p.z);
    this.equipment.setPingBallVisible(true);
  }

  // -- the camera -------------------------------------------------------

  private onControlStart = (): void => {
    this.userMovedCamera = true;
  };

  private updateCamera(dtMs: number): void {
    if (!this.viewReady) {
      this.viewReady = true;
      const view = defaultView(this.world, this.width / this.height, FOV);
      const p = viewPosition(view);
      this.controls.target.set(view.target.x, view.target.y, view.target.z);
      this.camera.position.set(p.x, p.y, p.z);
      this.controls.update();
    }

    // The tour: the camera goes where the tour says, and nothing else moves it.
    // The tour is slower while the pool is calm.
    if (this.touring) {
      this.tour.speed = this.calm ? 0.5 : 1;
      const v = tourStep(this.tour, dtMs / 1000, this.time, this.interests, this.world, this.tourView);
      this.controls.target.set(v.target.x, v.target.y, v.target.z);
      const p = viewPosition(v);
      this.camera.position.set(p.x, p.y, p.z);
      this.controls.update();
      return;
    }

    // When an agent is picked, the camera turns to look at it; when the
    // person moves the camera by hand, it leaves it where they put it.
    const selected = store.get().selectedId;
    if (selected !== this.focusId) {
      this.focusId = selected;
    }
    if (!selected) this.following = false;
    const character = selected ? this.characters.get(selected) : null;
    // With reduced motion the camera does not glide, unless the person has asked to follow.
    if (character && (!this.reducedMotion || this.following)) {
      const centre = swimCentre(character.body);
      const fx = centre ? centre.x : character.shown.x;
      const fz = centre ? centre.z : character.shown.z;
      const target = this.controls.target;
      const before = this.tmp2.copy(target);
      target.x = damp(target.x, fx, 2.2, dtMs);
      target.z = damp(target.z, fz, 2.2, dtMs);
      target.y = damp(target.y, 0.3, 2.2, dtMs);
      // The camera moves with the point it looks at, so the view keeps its
      // angle and only slides over.
      this.camera.position.add(this.tmp.copy(target).sub(before));
    }
    if (character && this.following) this.easeToFollow(dtMs);
    clampTarget(this.world, this.controls.target);
    this.controls.update(dtMs / 1000);
  }

  /** Back to the view the pool opened with. */
  resetView(): void {
    this.userMovedCamera = false;
    this.viewReady = false;
  }

  // -- labels -----------------------------------------------------------

  private updateLabels(): void {
    const selected = store.get().selectedId;
    const w = this.width;
    const h = this.height;
    for (const character of this.characters.values()) {
      // Over the head: the head bone, a little above it.
      character.rig.bones.head.getWorldPosition(this.tmp);
      this.tmp.y += character.scale * 0.16;
      const depth = this.tmp.distanceTo(this.camera.position);
      this.tmp.project(this.camera);
      const onScreen = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1;
      const x = (this.tmp.x * 0.5 + 0.5) * w;
      const y = (-this.tmp.y * 0.5 + 0.5) * h;
      // A session that waits for the person is ranked with the hovered one,
      // so its label is not hidden by the others.
      const attention = character.body.needsYou;
      const rank = character.id === selected ? 0 : character.id === this.hoveredId || attention ? 1 : 2;
      // Far away, only the important labels are worth the space.
      const wanted = onScreen && !character.dimmed && (rank < 2 || depth < 40);
      this.labels.place(character.id, x, y, wanted, rank, depth, character.id === selected, attention);
    }
    // The cat's bubble is placed where its head is; it has no name to show.
    const cat = this.catCreature();
    if (cat) {
      this.tmp.set(cat.x, CAT_HEAD_Y, cat.z);
      const depth = this.tmp.distanceTo(this.camera.position);
      this.tmp.project(this.camera);
      const onScreen = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1;
      const x = (this.tmp.x * 0.5 + 0.5) * w;
      const y = (-this.tmp.y * 0.5 + 0.5) * h;
      this.labels.place('cat', x, y, onScreen, 2, depth, false, false);
    }
    this.labels.flush();
    this.updateCard();
  }

  /**
   * The card under the pointer: what the agent is doing, and for how long.
   *
   * The content is rebuilt once a second, or when the pointer moves to
   * another agent; the card is moved with its character every frame.
   */
  private updateCard(): void {
    const id = this.hoveredId;
    if (id === null) {
      this.cardId = null;
      this.labels.showCard(null, null, this.width, this.height);
      return;
    }
    const nowS = Date.now() / 1000;
    const second = Math.floor(nowS);
    if (id !== this.cardId || second !== this.cardSecond) {
      this.cardId = id;
      this.cardSecond = second;
      const character = this.characters.get(id);
      if (character) {
        const parentId = character.agent.parent_id;
        const parentName = parentId
          ? this.names.get(parentId)?.full ?? (character.agent.session_name?.trim() || null)
          : null;
        this.cardContent = cardContent(
          character.agent,
          this.names.get(id),
          parentName,
          nowS,
          character.body.needsYou,
          this.restingFor(character),
        );
      } else {
        this.cardContent = null;
      }
    }
    this.labels.showCard(id, this.cardContent, this.width, this.height);
  }

  private updateDebug(now: number): void {
    this.fpsFrames += 1;
    if (now - this.fpsSince >= 1000) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsSince);
      this.fpsFrames = 0;
      this.fpsSince = now;
      if (this.debugText) {
        const info = this.renderer.info;
        this.debugText.textContent =
          `3D · ${this.fps.toFixed(0)} fps · ${info.render.calls} calls · ` +
          `${(info.render.triangles / 1000).toFixed(0)}k tris · ${this.characters.size} agents`;
      }
    }
  }

  /** Numbers for the console and the tests that drive the page. */
  stats(): { fps: number; calls: number; triangles: number; agents: number; props: number } {
    const info = this.renderer.info;
    // The props in the hands that are drawn now, for the budget of Sprint 29.
    let props = 0;
    for (const c of this.characters.values()) {
      for (const prop of Object.values(c.rig.props)) if (prop.visible) props += 1;
    }
    return { fps: this.fps, calls: info.render.calls, triangles: info.render.triangles, agents: this.characters.size, props };
  }

  /** The hooks the console uses to look at one behaviour. */
  private makeDebug(): DebugHooks {
    return {
      list: () => {
        const out: DebugCharacter[] = [];
        for (const character of this.characters.values()) {
          out.push({
            id: character.id,
            state: character.agent.status,
            x: character.body.x,
            z: character.body.z,
            inWater: character.body.inWater,
            action: character.driver.action,
            work: character.agent.tool_name ?? undefined,
            errand: character.body.errand?.kind ?? null,
            activity: activeLeisure(character.driver),
            lounger: character.body.lounger,
            bodyState: character.body.state,
            desired: character.body.desired,
            needsYou: character.body.needsYou,
            gap: character.leisure.gapLeft,
            variant: character.variant,
          });
        }
        return out;
      },
      play: (id, action) => {
        this.characters.get(id)?.driver.play(action);
      },
      hold: (id, action) => {
        const character = this.characters.get(id);
        if (!character) return;
        if (action === null) character.driver.release();
        else character.driver.hold(action);
      },
      force: (id, patch) => {
        // The weather is not a character: force('weather', 'rain') makes it rain.
        if (id === 'weather') {
          const kind = typeof patch === 'string' ? patch : '';
          this.forcedWeather = kind === 'clear' || kind === 'cloudy' || kind === 'rain' ? kind : null;
          this.paletteStep = -1;
          this.applyDaylight(true);
          return;
        }
        if (typeof patch === 'string') return;
        const character = this.characters.get(id);
        if (!character) return;
        const body = character.body;
        if (typeof patch.x === 'number') body.x = patch.x;
        if (typeof patch.z === 'number') body.z = patch.z;
        if (typeof patch.yaw === 'number') body.yaw = patch.yaw;
        // A null clears the override: the agent's own work is back.
        if ('work' in patch) {
          if (typeof patch.work === 'string') character.forced.work = patch.work as WorkKind;
          else delete character.forced.work;
        }
        if ('needsYou' in patch) {
          if (typeof patch.needsYou === 'boolean') character.forced.needsYou = patch.needsYou;
          else delete character.forced.needsYou;
        }
        if ('fatigue' in patch) {
          if (typeof patch.fatigue === 'number') character.forced.fatigue = patch.fatigue;
          else delete character.forced.fatigue;
        }
        // The next way in is this one. A swimmer in the water is first put
        // on the deck, at the gate, so that it walks to the entry at once.
        if (typeof patch.entry === 'string') {
          body.forcedEntry = patch.entry as EntryKind;
          if (body.inWater || body.entry !== null || body.climbing !== 0 || body.edgeOut !== null) {
            const at = queueSpot(this.world, 0);
            body.entry = null;
            body.edgeOut = null;
            body.climbing = 0;
            body.inWater = false;
            body.swim = null;
            body.exitingWater = false;
            body.x = at.x;
            body.z = at.z;
            body.y = 0;
            body.state = 'resting';
          }
          body.pendingEntry = null;
          body.entryAt = null;
          body.goal = null;
          body.path = [];
        }
        if ('work' in patch || 'needsYou' in patch || 'fatigue' in patch) {
          this.refreshWork(character, Date.now() / 1000);
        }
        // An errand of a kind, now, for a figure on its lounger (with partners if it needs them).
        if (typeof patch.errand === 'string') {
          this.forcedErrand = { id, kind: patch.errand as ErrandKind };
          this.planErrands();
        }
        // The rig follows the body, so it is put there at once and does not
        // slide into the place.
        character.shown.set(body.x, body.y, body.z);
        character.yaw = body.yaw;
      },
      time: (seconds) => {
        this.time += seconds;
      },
      creatures: () =>
        this.creatureDirector.creatures.map((c) => ({ id: c.id, kind: c.kind, state: c.state, x: c.x, z: c.z })),
      creature: (name) => {
        if (name === 'duck') this.creatureDirector.callDuck();
        else this.creatureDirector.callBirds();
      },
      screenOf: (id) => {
        const c = this.characters.get(id);
        if (!c) return null;
        this.tmp.set(c.shown.x, c.shown.y + c.scale * 0.5, c.shown.z).project(this.camera);
        const rect = this.renderer.domElement.getBoundingClientRect();
        return { x: rect.left + ((this.tmp.x * 0.5 + 0.5) * rect.width), y: rect.top + ((-this.tmp.y * 0.5 + 0.5) * rect.height) };
      },
      leisure: (id, kind, seconds = 20) => {
        const c = this.characters.get(id);
        if (!c || !this.restsOnLounger(c)) return;
        this.beginLeisure(c, kind, seconds, kind === 'chat' ? this.neighbourOf(c) : null);
      },
      clock: (hour) => {
        this.clockOverride = hour;
        this.paletteStep = -1;
        this.applyDaylight(true);
      },
      look: (x, z, distance = 8) => {
        // The camera keeps the angle it has and moves to the new place.
        this.userMovedCamera = true;
        const target = this.controls.target;
        const direction = this.tmp.copy(this.camera.position).sub(target).normalize();
        target.set(x, 0.3, z);
        this.camera.position.copy(target).addScaledVector(direction, distance);
        this.controls.update();
      },
    };
  }

  // -- the pointer ------------------------------------------------------

  /** Aim the ray from the camera through the pointer. False when the canvas has no size. */
  private aim(event: PointerEvent | MouseEvent): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return true;
  }

  /** The agent under the aimed ray, or null. */
  private pickAgent(): string | null {
    const targets: Mesh[] = [];
    for (const character of this.characters.values()) targets.push(character.hit);
    const hits = this.raycaster.intersectObjects(targets, false);
    const first = hits[0];
    return first ? (first.object.userData.agentId as string) : null;
  }

  private pick(event: PointerEvent | MouseEvent): string | null {
    return this.aim(event) ? this.pickAgent() : null;
  }

  /** Whether the aimed ray passes within `radius` of a point: for the things that have no mesh to hit. */
  private rayPasses(x: number, y: number, z: number, radius: number): boolean {
    this.tmp.set(x, y, z);
    return this.raycaster.ray.distanceSqToPoint(this.tmp) <= radius * radius;
  }

  /** The cat, if it is on the screen. */
  private catCreature(): Creature | null {
    for (const c of this.creatureDirector.creatures) if (c.id === 'cat') return c;
    return null;
  }

  /**
   * What a click does (step 27.5). An agent is selected, or, when it is the
   * one already selected, greeted. The cat runs off, the flamingo or the ball
   * moves, or the water ripples; the rest of the deck clears the selection,
   * as it always did. Only an agent's click changes the selection.
   */
  private click(event: PointerEvent): void {
    if (!this.aim(event)) return;
    const hit = this.pickAgent();
    if (hit !== null) {
      if (hit === store.get().selectedId) {
        const c = this.characters.get(hit);
        if (c) this.greet(c);
      } else {
        store.select(hit);
      }
      return;
    }
    if (this.clickCat() || this.clickEquipment() || this.clickWater()) return;
    store.select(null);
  }

  /** A click on the agent that is already selected: its head turns to the camera, and it waves. */
  private greet(c: Character): void {
    const cam = this.camera.position;
    let turn = Math.atan2(cam.x - c.shown.x, cam.z - c.shown.z) - c.yaw;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    c.driver.setLookYaw(turn, GREET_S);
    if (c.body.inWater) c.driver.react('look');
    else if (c.body.seat !== null) c.driver.react('waveLying');
    else c.driver.react('wave');
  }

  /** A click on the cat: it runs off, and says so in a bubble. */
  private clickCat(): boolean {
    const cat = this.catCreature();
    if (!cat || !this.rayPasses(cat.x, CAT_BODY_Y, cat.z, CAT_RADIUS)) return false;
    this.creatureDirector.scare(cat.x, cat.z);
    this.labels.say('cat', 'mrrp', 2.2);
    return true;
  }

  /** A click on the flamingo or the beach ball: it bobs and turns. */
  private clickEquipment(): boolean {
    const flamingo = this.equipment.flamingo.getWorldPosition(this.tmp2);
    if (this.rayPasses(flamingo.x, flamingo.y + 0.25, flamingo.z, FLAMINGO_RADIUS)) {
      this.equipment.nudge('flamingo', this.time);
      return true;
    }
    const ball = this.equipment.beachBall.getWorldPosition(this.tmp2);
    if (this.rayPasses(ball.x, ball.y, ball.z, BALL_HIT_RADIUS)) {
      this.equipment.nudge('ball', this.time);
      return true;
    }
    return false;
  }

  /** A click on the water inside the pool: a ring, a splash, and the swimmers near it look up. */
  private clickWater(): boolean {
    const hit = this.raycaster.intersectObject(this.water.mesh, false)[0];
    if (!hit) return false;
    const p = hit.point;
    const pool = this.world.pool;
    if (p.x < pool.minX || p.x > pool.maxX || p.z < pool.minZ || p.z > pool.maxZ) return false;
    this.water.ripple(p.x, p.z, 1);
    if (!this.reducedMotion) this.particles.splash(p.x, this.world.waterY + 0.02, p.z, 0.5);
    for (const c of this.characters.values()) {
      if (c.body.inWater && Math.hypot(c.body.x - p.x, c.body.z - p.z) < 2) c.driver.react('look');
    }
    return true;
  }

  private onPointerMove = (event: PointerEvent): void => {
    this.lastInputAt = performance.now();
    if (event.buttons !== 0) {
      // A drag turns the camera by hand: a follow lets go of the agent.
      const down = this.pointerDownAt;
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > DRAG_PX) this.following = false;
      return;
    }
    const hit = this.pick(event);
    if (hit === this.hoveredId) return;
    this.hoveredId = hit;
    store.setHovered(hit);
    this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
  };

  private onPointerLeave = (): void => {
    if (this.hoveredId === null) return;
    this.hoveredId = null;
    store.setHovered(null);
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
    this.lastInputAt = performance.now();
    this.stopTour();
  };

  /** The wheel zooms by hand, so it stops the tour and lets go of a follow (the follow holds the distance). */
  private onWheel = (): void => {
    this.lastInputAt = performance.now();
    this.stopTour();
    this.following = false;
  };

  private onPointerUp = (event: PointerEvent): void => {
    const down = this.pointerDownAt;
    this.pointerDownAt = null;
    // A drag turns the camera; only a click picks.
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > DRAG_PX) return;
    this.click(event);
  };

  private onDoubleClick = (event: MouseEvent): void => {
    const hit = this.pick(event);
    if (hit) {
      // A double-click on an agent follows it.
      store.select(hit);
      this.following = true;
      return;
    }
    this.resetView();
  };

  private onVisibility = (): void => {
    // A hidden tab draws nothing; when it comes back the clock does not
    // jump, because one frame is never longer than MAX_FRAME_MS.
    const hidden = document.visibilityState === 'hidden';
    this.renderer.setAnimationLoop(hidden ? null : this.tick);
    this.last = performance.now();
  };

  // -- size and teardown ------------------------------------------------

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.renderer.setSize(this.width, this.height, true);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (!this.userMovedCamera) this.viewReady = false;
  }

  destroy(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.controls.dispose();
    for (const character of [...this.characters.values()]) this.removeCharacter(character);
    this.environment.dispose();
    this.equipment.dispose();
    this.water.dispose();
    this.lighting.dispose();
    this.particles.dispose();
    this.rain.dispose();
    this.creatures3d.dispose();
    this.sky.dispose();
    this.nightLights.dispose();
    this.hitGeometry.dispose();
    this.hitMaterial.dispose();
    this.hoverRing.geometry.dispose();
    (this.hoverRing.material as MeshBasicMaterial).dispose();
    this.familyGeometry.dispose();
    for (const material of this.familyMaterials) material.dispose();
    this.labels.destroy();
    this.debugText?.remove();
    this.renderer.dispose();
    canvas.remove();
  }
}
