/**
 * The pool scene.
 *
 * It owns the layers, the characters and the movement between them. The
 * backend decides *where* an agent belongs (lane, lounger, route); this file
 * turns that into pixels.
 *
 * The character's own state machine runs every frame. The backend's
 * presentation only says what it wants ("swim", "lounge", "leaving"); the
 * scene decides how to get there. That way a character never gets stuck
 * because the backend went quiet.
 */

import { Application, Container, Graphics, Point, Text, TilingSprite } from 'pixi.js';
import { CharacterAnimator, type CharState } from '../characters/animator';
import { buildRig, type Rig } from '../characters/rig';
import { specFor, type CharacterSpec, type Role } from '../characters/spec';
import type { AgentView } from '../../net/types';
import { acknowledgeExit } from '../../net/ws';
import { store } from '../../state/store';
import {
  computeLayout,
  LOUNGER_COUNT,
  resolveWaypoint,
  WAITING_COUNT,
  type PoolLayout,
} from './layout';
import { Ambience } from './ambience';
import { prefersReducedMotion } from '../motion';
import { SleepZ, SpeechBubble, Steam } from '../characters/effects';
import { characterBox, hitTest, type HitBox, type Pose } from './hittest';
import { hourOfDay, mixColour, paletteFor, applyWeather, type Palette } from './daylight';
import { rainAmount, weatherFor, type Weather } from './weather';
import {
  drawDeck,
  drawFloor,
  drawFoam,
  drawSky,
  drawWater,
  makeCausticTexture,
} from './layers';

const WALK_SPEED = 165; // pixels per second
const CLIMB_DURATION = 1.2; // seconds

/** The pose of a character decides the shape of its hit area. */
function poseFor(state: CharState): Pose {
  if (state === 'swimming') return 'swim';
  if (state === 'lounging') return 'lie';
  return 'stand';
}

type Desired =
  | 'swim'
  | 'lounge'
  | 'waiting'
  | 'exiting'
  | 'leaving'
  | 'offscreen'
  | 'unknown';

interface Character {
  id: string;
  spec: CharacterSpec;
  rig: Rig;
  under: Rig | null;
  animator: CharacterAnimator;
  label: Text;
  state: CharState;
  /** What the backend wants this character to be doing. */
  desired: Desired;
  /** The lounger it belongs to, when it has one. */
  loungerSlot: number | null;
  waitingSlot: number | null;
  /** The place in the queue at the gate. */
  gateQueue: number;
  /** Where it goes when it climbs out of the water. */
  exitTarget: string;
  /** Where it is heading. */
  target: string | null;
  /** Where it is on screen (its feet). */
  x: number;
  y: number;
  /** The y it swims at. */
  swimY: number;
  facing: number;
  laneOffset: number;
  laneIndex: number;
  /** True once it has reached the water. */
  entered: boolean;
  /** Set while it is on its way to the ladder. */
  headingForWater: boolean;
  /** Whether the current climb goes into the water or out of it. */
  climbingInto: 'water' | 'deck';
  /** How long the current climb has been running, in seconds. */
  climbTime: number;
  /** The last mode the backend reported, for the debug readout. */
  lastMode: string;
  lastLimit: number;
  /** The direction the character is walking: 1, -1 or 0 when it stands. */
  moveDir: number;
  /** True once it has walked out through the gate and said so. */
  exited: boolean;
  /** Timer between two emissions of the character's idle effect. */
  effectTimer: number;
  /** A fixed random seed for the character's idle chatter. */
  effectSeed: number;
}

export class PoolScene {
  readonly app: Application;
  private world = new Container();
  private skyLayer = new Container();
  private deckLayer = new Container();
  private floorLayer = new Container();
  private causticsLayer = new Container();
  private underLayer = new Container();
  private waterLayer = new Container();
  private surfaceLayer = new Container();
  private fxLayer = new Container();
  private labelLayer = new Container();
  private maskAbove = new Graphics();
  private maskBelow = new Graphics();
  private foam = new Graphics();
  /** A ring under the character the pointer is over. */
  private hoverRing = new Graphics();
  private causticA: TilingSprite | null = null;
  private causticB: TilingSprite | null = null;
  private debugText: Text | null = null;
  private ambience: Ambience;
  private steam = new Steam();
  private sleepZ = new SleepZ();
  private bubble = new SpeechBubble();

  private layout: PoolLayout;
  private characters = new Map<string, Character>();
  /** The status the backend reported last time, to notice the changes. */
  private lastStatus = new Map<string, string>();
  /** The colours of the pool at this moment of the day. */
  private palette: Palette;
  /** The hour the palette was last built for, in quarters of an hour. */
  private paletteStep = -1;
  /** What the weather is doing. */
  private weather: Weather = 'clear';
  /** How much rain is falling, from 0 to 1. */
  private rain = 0;
  private time = 0;
  private lastDt = 0;
  /** The agent the pointer is over, if any. */
  private hoveredId: string | null = null;
  /** A reusable point, so the pointer handling does not allocate. */
  private readonly pointerPoint = new Point();
  /** Where the pointer lands in the scene's own space. */
  private readonly localPoint = new Point();
  /** How many loungers the layout was built with. */
  private loungerCount = LOUNGER_COUNT;
  /** How many waiting spots the layout was built with. */
  private waitingCount = WAITING_COUNT;

  constructor(app: Application) {
    this.app = app;
    const now = new Date();
    const clock = now.getTime() / 1000;
    this.weather = weatherFor(clock);
    this.rain = rainAmount(clock);
    this.palette = applyWeather(paletteFor(hourOfDay(now)), this.weather);
    this.paletteStep = this.paletteStepFor(now);
    // The sky reaches past the pool, so the background behind it follows
    // the time of day as well.
    this.app.renderer.background.color = this.palette.skyTop;
    this.loungerCount = this.requestedLoungers();
    this.waitingCount = this.requestedWaiting();
    this.layout = computeLayout(
      app.renderer.width,
      app.renderer.height,
      this.loungerCount,
      this.waitingCount,
    );

    this.world.addChild(
      this.skyLayer,
      this.deckLayer,
      this.floorLayer,
      this.causticsLayer,
      this.underLayer,
      this.waterLayer,
      this.surfaceLayer,
      this.fxLayer,
      this.labelLayer,
    );
    app.stage.addChild(this.world);

    // The masks stay renderable. In PixiJS v8 a mask is drawn into the
    // stencil buffer and left out of the colour pass, so it never shows up
    // on the screen — but taking it out of the render pass as well makes
    // the whole layer disappear in some browsers.

    this.ambience = new Ambience(this.layout);
    this.world.addChild(this.ambience.container);
    this.world.addChild(this.steam.container, this.sleepZ.container, this.bubble.container);
    this.fxLayer.addChild(this.hoverRing);

    this.buildLayers();
    this.bindPointer();
    this.app.ticker.add((ticker) => {
      try {
        this.update(ticker.deltaMS);
      } catch (error) {
        // A broken frame must not take the whole scene down, and the debug
        // readout is where the reason shows up.
        if (this.debugText) {
          this.debugText.text = `ERROR: ${(error as Error)?.message ?? String(error)}`;
        }
        console.error('AgentPool: the frame failed', error);
      }
    });
  }

  /**
   * The number of loungers the scene description asks for.
   *
   * The backend owns the world model, so the deck is built to fit the
   * scene it is showing rather than the other way round.
   */
  private requestedLoungers(): number {
    const payload = store.get().scenePayload;
    const count = Number(payload?.loungers ?? LOUNGER_COUNT);
    return Number.isFinite(count) && count > 0 ? Math.round(count) : LOUNGER_COUNT;
  }

  /** How many agents can wait at the pool edge, according to the scene. */
  private requestedWaiting(): number {
    const payload = store.get().scenePayload;
    const count = Number(payload?.waiting ?? WAITING_COUNT);
    return Number.isFinite(count) && count >= 0 ? Math.round(count) : WAITING_COUNT;
  }

  /**
   * The quarter of an hour the clock is in.
   *
   * The palette is rebuilt when this changes, so the colours move with
   * the day without the scene being redrawn every frame.
   */
  private paletteStepFor(date: Date): number {
    return Math.floor(hourOfDay(date) * 4);
  }

  // -- construction -------------------------------------------------

  private buildLayers(): void {
    const layout = this.layout;

    // Building the layers is idempotent: a resize empties them first, so
    // the scene never ends up with two skies and two decks.
    for (const layer of [
      this.skyLayer,
      this.deckLayer,
      this.floorLayer,
      this.causticsLayer,
      this.waterLayer,
    ]) {
      for (const child of layer.removeChildren()) child.destroy();
    }
    this.causticA = null;
    this.causticB = null;

    const sky = new Graphics();
    drawSky(sky, layout, this.palette);
    this.skyLayer.addChild(sky);

    const deck = new Graphics();
    drawDeck(deck, layout, this.palette);
    this.deckLayer.addChild(deck);

    const floor = new Graphics();
    drawFloor(floor, layout, this.palette);
    this.floorLayer.addChild(floor);

    // Two scrolling caustic layers make the water feel alive.
    const texture = makeCausticTexture();
    this.causticA = new TilingSprite({ texture, width: 1, height: 1 });
    this.causticB = new TilingSprite({ texture, width: 1, height: 1 });
    for (const [sprite, scale, alpha] of [
      [this.causticA, 1.6, 0.16 * this.palette.light],
      [this.causticB, 2.4, 0.1 * this.palette.light],
    ] as [TilingSprite, number, number][]) {
      sprite.scale.set(scale);
      sprite.alpha = alpha;
      sprite.blendMode = 'add';
      this.causticsLayer.addChild(sprite);
    }

    const water = new Graphics();
    drawWater(water, layout, this.palette);
    this.waterLayer.addChild(water);

    this.fxLayer.addChild(this.foam);

    this.underLayer.mask = this.maskBelow;
    this.surfaceLayer.mask = this.maskAbove;
    this.world.addChild(this.maskBelow, this.maskAbove);
    this.updateMasks();

    // The debug readout is opt-in: ?debug in the query string.
    const debugOn = new URLSearchParams(window.location.search).has('debug');
    if (debugOn && !this.debugText) {
      this.debugText = new Text({
        text: '',
        style: { fontFamily: 'monospace', fontSize: 11, fill: 0x10202c },
      });
      this.debugText.position.set(10, 10);
      this.world.addChild(this.debugText);
    } else if (!debugOn && this.debugText) {
      this.debugText.visible = false;
    }
  }

  private updateMasks(): void {
    const layout = this.layout;
    this.maskAbove.clear();
    this.maskAbove.rect(0, 0, layout.width, layout.surfaceY).fill(0xffffff);
    this.maskBelow.clear();
    this.maskBelow
      .rect(0, layout.surfaceY, layout.width, layout.height - layout.surfaceY)
      .fill(0xffffff);
  }

  // -- agents -------------------------------------------------------

  /** Create, update and remove the characters to match the agent list. */
  syncAgents(agents: AgentView[]): void {
    const seen = new Set<string>();

    for (const agent of agents) {
      seen.add(agent.id);
      let character = this.characters.get(agent.id);

      if (!character) {
        character = this.createCharacter(agent);
        this.characters.set(agent.id, character);
      }
      this.applyPresentation(character, agent);
      this.noticeStatus(agent);
    }

    for (const [id, character] of [...this.characters.entries()]) {
      if (seen.has(id)) continue;
      character.rig.destroy();
      character.under?.destroy();
      character.label.destroy();
      this.characters.delete(id);
      this.lastStatus.delete(id);
    }
  }

  /**
   * Notice that an agent has finished, and let the others react.
   *
   * This is the moment that makes the pool feel like a place where
   * something is happening: one character gets out of the water and the
   * others look up and wave.
   */
  private noticeStatus(agent: AgentView): void {
    const previous = this.lastStatus.get(agent.id);
    this.lastStatus.set(agent.id, agent.status);
    if (previous === undefined || previous === agent.status) return;
    if (agent.status !== 'finished') return;
    this.celebrate(agent.id);
  }

  /** Let the pool react to a character that has finished. */
  private celebrate(agentId: string): void {
    let waved = 0;
    for (const character of this.characters.values()) {
      if (character.id === agentId) continue;
      const state = character.animator.currentState;
      if (state === 'swimming') {
        // In the water it only lifts its head.
        character.animator.react('look');
      } else if (waved < 3) {
        // The ones on the deck wave. Three is enough; a full pool would
        // look like a stadium. A character that lies down waves with the
        // other arm, because its body is turned a quarter turn.
        const lying = state === 'lounging' || state === 'activity';
        character.animator.react(lying ? 'waveLying' : 'wave');
        waved += 1;
      }
    }
  }

  private createCharacter(agent: AgentView): Character {
    const role: Role =
      agent.kind === 'session'
        ? 'session'
        : agent.kind === 'mcp'
          ? 'mcp'
          : agent.kind === 'workflow'
            ? 'workflow'
            : 'subagent';

    const spec = specFor(agent.id, role);
    const rig = buildRig(spec);
    rig.root.scale.set(this.layout.scale * spec.height);
    rig.root.tint = mixColour(0xffffff, 0x6f7f9c, 1 - this.palette.light);
    this.surfaceLayer.addChild(rig.root);

    const animator = new CharacterAnimator(rig);

    const label = new Text({
      // The full name lives in the agent list and the inspector; on the
      // scene only a short tag is readable without covering the pool.
      text: agent.label.length > 14 ? `${agent.label.slice(0, 13)}…` : agent.label,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: Math.max(9, Math.round(this.layout.characterHeight * 0.11)),
        fill: 0xffffff,
        stroke: { color: 0x10202c, width: 3, join: 'round' },
      },
    });
    label.anchor.set(0.5, 1);
    this.labelLayer.addChild(label);

    return {
      id: agent.id,
      spec,
      rig,
      under: null,
      animator,
      label,
      state: 'resting',
      desired: 'unknown',
      loungerSlot: null,
      waitingSlot: null,
      gateQueue: 0,
      lastLimit: Number.POSITIVE_INFINITY,
      moveDir: 0,
      exited: false,
      exitTarget: 'lounger:0',
      target: null,
      x: this.layout.gate.x,
      y: this.layout.deckY,
      swimY: this.layout.surfaceY,
      facing: 1,
      laneOffset: 0,
      laneIndex: 0,
      entered: false,
      headingForWater: false,
      climbingInto: 'water',
      climbTime: 0,
      lastMode: '',
      effectTimer: 0,
      effectSeed: (spec.seed % 1000) / 1000,
    };
  }

  /** Record what the backend wants. The state machine does the rest. */
  private applyPresentation(character: Character, agent: AgentView): void {
    const mode = agent.presentation.mode;
    const props = agent.presentation.props;
    character.lastMode = `${mode}/${agent.status}`;

    character.desired =
      mode === 'swim'
        ? 'swim'
        : mode === 'lounge'
          ? 'lounge'
          : mode === 'waiting'
            ? 'waiting'
          : mode === 'exiting'
            ? 'exiting'
            : mode === 'leaving'
              ? 'leaving'
              : mode === 'offscreen'
                ? 'offscreen'
                : 'unknown';

    if (character.desired === 'swim') {
      const lane = Number(props.lane ?? 0);
      character.facing = Number(props.direction ?? 1) >= 0 ? 1 : -1;
      character.laneOffset = Number(props.lane_offset ?? 0);
      character.laneIndex = lane;
      // Every swimmer is at the surface: the waterline cuts it lengthwise,
      // so the head and the back stay above the water.
      character.swimY =
        this.layout.surfaceY -
        this.layout.characterHeight * 0.06 +
        character.laneOffset * this.layout.characterHeight * 0.16;
      this.ensureUnderwaterRig(character);
      if (character.rig.facing.scale.x !== character.facing) {
        character.rig.facing.scale.x = character.facing;
        if (character.under) character.under.facing.scale.x = character.facing;
      }
      return;
    }

    if (character.desired === 'lounge') {
      const lounger = Number(props.lounger ?? -1);
      if (!this.layout.loungers[lounger]) {
        // The pool is full: the agent waits at the gate.
        character.desired = 'waiting';
        character.waitingSlot = null;
        character.loungerSlot = null;
        character.state = 'walking';
        character.target = 'gate';
        return;
      }
      if (character.loungerSlot !== lounger) {
        // Either the character walked in from the gate, or a lounger became
        // free and it was promoted from the waiting area.
        character.loungerSlot = lounger;
        character.waitingSlot = null;
        character.state = 'walking';
        character.target = `lounger:${lounger}`;
      }
      return;
    }

    if (character.desired === 'waiting') {
      const slot = Number(props.waiting ?? -1);
      if (slot < 0 || !this.layout.waiting[slot]) {
        // Not even the pool edge has a place: the agent waits at the gate.
        // The queue tells it where in the line it stands.
        const queue = Number(props.queue ?? 0);
        if (character.gateQueue !== queue || character.target === null) {
          character.gateQueue = queue;
          character.waitingSlot = null;
          character.loungerSlot = null;
          character.state = 'walking';
        }
        return;
      }
      if (character.waitingSlot !== slot) {
        character.waitingSlot = slot;
        character.loungerSlot = null;
        character.state = 'walking';
        character.target = `waiting:${slot}`;
      }
      return;
    }

    if (character.desired === 'exiting') {
      character.exitTarget = String(props.to ?? `lounger:${character.loungerSlot ?? 0}`);
    }
  }

  private ensureUnderwaterRig(character: Character): void {
    if (character.under) return;
    const under = buildRig(character.spec);
    under.root.scale.set(this.layout.scale * character.spec.height);
    this.underLayer.addChild(under.root);
    character.under = under;
    character.animator.setSecondary(under);
  }

  /**
   * Put the character in the light of the day.
   *
   * In the evening the characters are in the same blue as the pool, so the
   * scene reads as one picture instead of bright people on a dark deck.
   */
  private applyLight(character: Character): void {
    const tint = mixColour(0xffffff, 0x6f7f9c, 1 - this.palette.light);
    character.rig.root.tint = tint;
    if (character.under) character.under.root.tint = tint;
  }

  // -- the state machine --------------------------------------------

  /**
   * Steer the character towards what the backend wants.
   *
   * Runs every frame, so it never depends on the backend sending an update.
   */
  private updateState(character: Character, dt: number): void {
    switch (character.desired) {
      case 'swim': {
        if (!character.entered) {
          // Not in the water yet: walk to the ladder and climb down.
          if (character.state !== 'climbing') {
            character.state = 'walking';
            character.target = 'ladder';
            character.headingForWater = true;
          }
          break;
        }
        if (character.state !== 'swimming') {
          character.state = 'swimming';
          character.target = null;
        }
        character.y = character.swimY;
        break;
      }

      case 'lounge': {
        const target =
          character.loungerSlot === null ? null : `lounger:${character.loungerSlot}`;
        // While it walks, its height is settled by the waypoint it walks to.
        if (character.state !== 'walking') character.y = this.layout.deckY;
        if (!character.entered) {
          // Walking in through the gate towards its lounger.
          character.state = 'walking';
          character.target = target;
          break;
        }
        if (character.state === 'climbing' || character.state === 'walking') {
          character.state = 'walking';
          character.target = target;
        } else {
          character.state = 'lounging';
        }
        break;
      }

      case 'waiting': {
        // The agent has no lounger: it waits at the pool edge until one
        // frees up. When even the edge is full it waits at the gate.
        const slot = character.waitingSlot;
        character.target = slot === null ? `gate:${character.gateQueue}` : `waiting:${slot}`;
        if (character.state !== 'walking') {
          const spot = slot === null ? null : this.layout.waiting[slot];
          character.state = 'resting';
          character.y = spot ? spot.y : this.layout.deckY;
        }
        break;
      }

      case 'exiting': {
        if (character.state !== 'climbing') {
          character.state = 'climbing';
          character.climbingInto = 'deck';
          character.climbTime = 0;
          character.target = 'ladder';
        } else {
          character.target = character.exitTarget;
        }
        break;
      }

      case 'leaving': {
        character.state = 'walking';
        character.target = 'gate';
        character.y = this.layout.deckY;
        break;
      }

      default:
        break;
    }

    // The climb runs for a fixed time and then hands over to the next state.
    if (character.state === 'climbing') {
      character.climbTime += dt;
      if (character.climbTime >= CLIMB_DURATION) {
        character.climbTime = 0;
        character.entered = true;
        character.headingForWater = false;
        if (character.climbingInto === 'water') {
          character.state = 'swimming';
          character.y = character.swimY;
        } else {
          character.state = 'lounging';
          character.y = this.layout.deckY;
        }
      }
    }
  }

  // -- the frame ----------------------------------------------------

  private update(dtMs: number): void {
    const dt = dtMs / 1000;
    this.lastDt = dtMs;
    this.time += dt;

    // The scene description arrives after the first frame, so the deck is
    // rebuilt once the backend has told us how many loungers it wants.
    if (
      this.requestedLoungers() !== this.loungerCount ||
      this.requestedWaiting() !== this.waitingCount
    ) {
      this.resize(this.app.renderer.width, this.app.renderer.height);
    }

    // The light of the day and the weather on top of it. The layers are
    // rebuilt when either of them changes.
    const now = new Date();
    const clock = now.getTime() / 1000;
    const weather = weatherFor(clock);
    const step = this.paletteStepFor(now);
    if (step !== this.paletteStep || weather !== this.weather) {
      this.paletteStep = step;
      this.weather = weather;
      this.palette = applyWeather(paletteFor(hourOfDay(now)), weather);
      // The sky reaches past the pool, so the background behind it has to
      // follow the time of day as well.
      this.app.renderer.background.color = this.palette.skyTop;
      this.buildLayers();
      this.updateMasks();
      // The characters are in the same light as the pool.
      for (const character of this.characters.values()) this.applyLight(character);
    }
    this.rain = rainAmount(clock);

    for (const character of this.characters.values()) {
      this.updateState(character, dt);
      this.moveCharacter(character, dt);
      character.animator.setState(character.state);
      character.animator.update(dtMs);
      character.rig.root.position.set(character.x, character.y);
      if (character.under) character.under.root.position.set(character.x, character.y);

      // The label floats above the character: over the head for a swimmer,
      // above the body for one that is lying down.
      const span = character.spec.height * this.layout.characterHeight;
      if (character.state === 'swimming') {
        character.label.position.set(character.x + span * 0.55, character.y - span * 0.42);
      } else {
        character.label.position.set(character.x + span * 0.45, character.y - span * 0.3);
      }
      // The label would pile up on a row of loungers, so it is only shown
      // for the selected agent, for the one under the pointer, and for the
      // ones that are on the move.
      character.label.visible =
        character.id === store.get().selectedId ||
        character.id === this.hoveredId ||
        (character.state !== 'swimming' &&
          character.state !== 'lounging' &&
          character.state !== 'resting');
    }

    // A ring under the character the pointer is over, so the click target
    // is visible before it is clicked.
    this.hoverRing.clear();
    const marked = this.hoveredId ?? store.get().selectedId;
    if (marked) {
      const character = this.characters.get(marked);
      if (character) {
        const span = character.spec.height * this.layout.characterHeight;
        this.hoverRing
          .ellipse(character.x, character.y, span * 0.42, span * 0.11)
          .stroke({ color: 0x52d273, width: 2, alpha: 0.9 });
      }
    }

    // The little effects that make the loungers look inhabited.
    for (const character of this.characters.values()) {
      if (!character.animator.isDoingActivity) continue;
      const activity = character.spec.idleActivity;
      character.effectTimer += dt;

      if (activity === 'tea' && character.effectTimer > 0.28) {
        character.effectTimer = 0;
        const cup = character.rig.propLayer.getGlobalPosition();
        this.steam.emit(cup.x, cup.y - this.layout.characterHeight * 0.06);
      } else if (activity === 'nap' && character.effectTimer > 1.3) {
        character.effectTimer = 0;
        const head = character.rig.headPivot.getGlobalPosition();
        this.sleepZ.emit(head.x, head.y - this.layout.characterHeight * 0.2);
      } else if ((activity === 'chat' || activity === 'call') && character.effectTimer > 2.2) {
        character.effectTimer = 0;
        const head = character.rig.headPivot.getGlobalPosition();
        const lines =
          activity === 'call'
            ? ['yes?', 'I will', 'hold on', 'can you hear me?', 'bye']
            : ['…', 'really?', 'ship it', 'one more test', 'ok, done'];
        const message = lines[Math.floor(character.effectSeed * lines.length) % lines.length];
        this.bubble.show(
          head.x,
          head.y - this.layout.characterHeight * 0.45,
          message,
        );
      }
    }
    this.steam.update(dt);
    this.sleepZ.update(dt);
    this.bubble.update(dt);

    // The decoration stops when the screen asks for less motion. The
    // characters keep moving: that is what the pool is for.
    const reduced = prefersReducedMotion();
    if (!reduced) {
      this.ambience.update(dt, this.palette.light, this.rain);
    }

    // The caustics drift.
    if (this.causticA && this.causticB) {
      if (!reduced) {
        this.causticA.tilePosition.x = this.time * 7;
        this.causticA.tilePosition.y = this.time * 3;
        this.causticB.tilePosition.x = -this.time * 5;
        this.causticB.tilePosition.y = this.time * 9;
      }
      this.causticA.width = this.layout.water.w * 1.4;
      this.causticA.height = this.layout.water.h * 1.4;
      this.causticB.width = this.layout.water.w * 1.8;
      this.causticB.height = this.layout.water.h * 1.8;
      this.causticA.position.set(this.layout.water.x, this.layout.water.y);
      this.causticB.position.set(this.layout.water.x, this.layout.water.y);
    }

    this.foam.clear();
    drawFoam(this.foam, this.layout, reduced ? 0 : this.time);

    if (this.debugText) {
      this.debugText.text = [
        `fps ${Math.round(this.app.ticker.FPS)}  canvas ${this.layout.width}x${this.layout.height} loungers=${this.layout.loungers.length} waiting=${this.layout.waiting.length} deckY=${this.layout.deckY} surfaceY=${this.layout.surfaceY} dt=${this.lastDt} time=${this.time.toFixed(2)}`,
        ...[...this.characters.values()]
        .map(
          (c) =>
            `${c.id.slice(0, 12)} m=${c.lastMode} st=${c.state} x=${Math.round(c.x)} y=${Math.round(
              c.y,
            )} e=${c.entered} t=${c.target ?? '-'} lim=${c.lastLimit}`,
        ),
      ].join('\n');
    }
  }

  private laneFor(character: Character): { x: number; w: number } {
    return this.layout.lanes[character.laneIndex] ?? this.layout.lanes[0];
  }

  private moveCharacter(character: Character, dt: number): void {
    if (character.state === 'swimming') {
      // Swim along the lane and wrap around at its ends.
      const speed = WALK_SPEED * 1.6 * character.spec.speedScale;
      character.x += character.facing * speed * dt;
      const lane = this.laneFor(character);
      const left = lane.x + 12;
      const right = lane.x + lane.w - 12;
      if (character.x > right) character.x = left;
      if (character.x < left) character.x = right;
      return;
    }

    if (
      character.state !== 'walking' &&
      character.state !== 'climbing' &&
      character.state !== 'lounging'
    ) {
      return;
    }

    const target = character.target ? resolveWaypoint(this.layout, character.target) : null;
    if (!target) return;
    character.lastLimit = -4;

    // Spread the characters along the ladder so they do not stack up.
    const offset =
      character.target === 'ladder'
        ? (character.laneIndex - 1.5) * this.layout.characterHeight * 0.11
        : 0;

    // The character also walks towards the height of its waypoint, so a
    // character that is promoted from the pool edge climbs onto the deck
    // instead of teleporting there.
    character.y += (target.y - character.y) * Math.min(1, dt * 8);

    const dx = target.x + offset - character.x;
    const distance = Math.abs(dx);
    let step = WALK_SPEED * dt;
    character.moveDir = Math.sign(dx);

    // The characters that walk on the deck keep their distance from each
    // other, so they queue up at the gate instead of walking through one
    // another.
    let limit = Number.POSITIVE_INFINITY;
    if (character.state === 'walking') {
      const gap = this.layout.characterHeight * 0.42;
      limit = this.clearanceAhead(character, Math.sign(dx), gap);
      if (limit < step) step = Math.max(0, limit);
    }
    character.lastLimit = limit;

    if (distance <= step) {
      // Arrive at the *offset* target, otherwise the character oscillates
      // around it and never registers as arrived.
      character.x = target.x + offset;
      if (character.target?.startsWith('gate')) {
        if (character.desired === 'waiting') {
          // The pool is full: the character waits at the gate instead of
          // walking out of the scene.
          character.state = 'resting';
          character.entered = true;
          return;
        }
        // The character has walked out through the gate. It says so once:
        // the character stays at the gate until the backend has taken it
        // away, and every frame it is still there.
        if (!character.exited) {
          character.exited = true;
          acknowledgeExit(character.id);
        }
        return;
      }
      if (character.headingForWater && character.target === 'ladder') {
        // At the ladder: climb down into the water.
        character.headingForWater = false;
        character.state = 'climbing';
        character.climbingInto = 'water';
        character.climbTime = 0;
        character.target = 'ladder';
        return;
      }
      if (character.state === 'climbing') {
        // Climbed out onto the deck.
        character.state = 'lounging';
        character.entered = true;
        character.y = target.y;
        return;
      }
      if (character.state === 'walking') {
        // Arrived at the lounger or at the waiting spot.
        character.state = character.desired === 'waiting' ? 'resting' : 'lounging';
        character.entered = true;
        character.y = target.y;
      }
      return;
    }

    character.x += Math.sign(dx) * step;
    character.facing = Math.sign(dx) || character.facing;
    if (character.rig.facing.scale.x !== character.facing) {
      character.rig.facing.scale.x = character.facing;
      if (character.under) character.under.facing.scale.x = character.facing;
    }
  }

  /**
   * How far a character may still walk before it bumps into the one ahead.
   *
   * Returns the distance to the closest character on the same stretch of
   * deck, minus the gap that has to be kept between them. When two
   * characters stand exactly on top of each other — which happens at the
   * gate, where they all arrive from the same point — the one with the
   * lower id yields, so the pair never deadlocks.
   */
  private clearanceAhead(character: Character, direction: number, gap: number): number {
    if (direction === 0) return Number.POSITIVE_INFINITY;
    let nearest = Number.POSITIVE_INFINITY;

    for (const other of this.characters.values()) {
      if (other === character) continue;
      if (other.state !== 'walking' && other.state !== 'climbing') continue;
      // A character that has nowhere to go stands still, so it must not
      // block the queue behind it.
      if (other.target === null) continue;
      // Two characters walking towards each other pass by, they do not
      // queue up behind one another.
      if (other.moveDir !== 0 && other.moveDir !== direction) continue;
      if (Math.abs(other.y - character.y) > this.layout.characterHeight) continue;

      const ahead = (other.x - character.x) * direction;
      if (ahead > 0.5) {
        // It is in front: I may walk until the gap between us is restored.
        nearest = Math.min(nearest, Math.max(0, ahead - gap));
      } else if (Math.abs(ahead) <= 2 && other.id > character.id) {
        // Exactly on top of each other: the higher id yields, so the pair
        // never deadlocks.
        nearest = 0;
      }
    }

    return nearest;
  }

  // -- the pointer --------------------------------------------------

  /**
   * Let the person click a character.
   *
   * The characters are drawn on a canvas, so there is nothing to click on:
   * the click is matched against the geometry the characters already have.
   * The listeners sit on the canvas element rather than in Pixi's own event
   * system, because the layers that sit on top of the water would have to
   * share the hit testing with the characters.
   */
  private bindPointer(): void {
    const canvas = this.app.canvas;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
  }

  private unbindPointer(): void {
    const canvas = this.app.canvas;
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
  }

  private onPointerMove = (event: PointerEvent): void => {
    const point = this.scenePoint(event);
    if (!point) return;
    const hit = this.pickAt(point.x, point.y);
    if (hit === this.hoveredId) return;
    this.hoveredId = hit;
    store.setHovered(hit);
    this.app.canvas.style.cursor = hit ? 'pointer' : 'auto';
  };

  private onPointerLeave = (): void => {
    if (this.hoveredId === null) return;
    this.hoveredId = null;
    store.setHovered(null);
    this.app.canvas.style.cursor = 'auto';
  };

  private onPointerDown = (event: PointerEvent): void => {
    const point = this.scenePoint(event);
    if (!point) return;
    // Clicking a character opens its inspector; clicking the water closes
    // the one that is open.
    store.select(this.pickAt(point.x, point.y));
  };

  /**
   * Where the pointer is, in the coordinates of the scene.
   *
   * The canvas may be laid out at any size, so the position is scaled by
   * the ratio between the canvas and the scene.
   */
  private scenePoint(event: PointerEvent): Point | null {
    const rect = this.app.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((event.clientX - rect.left) / rect.width) * this.layout.width;
    const y = ((event.clientY - rect.top) / rect.height) * this.layout.height;
    // The world may be moved or scaled one day — the camera — so the
    // position is taken into the scene's own space.
    return this.world.toLocal(this.pointerPoint.set(x, y), undefined, this.localPoint);
  }

  /** The agent under the given point, if there is one. */
  private pickAt(x: number, y: number): string | null {
    const boxes: HitBox[] = [];
    for (const character of this.characters.values()) {
      const height = character.spec.height * this.layout.characterHeight;
      boxes.push(
        characterBox(character.id, character.x, character.y, height, poseFor(character.state)),
      );
    }
    return hitTest(boxes, x, y);
  }

  // -- layout -------------------------------------------------------

  resize(width: number, height: number): void {
    if (width === this.layout.width && height === this.layout.height) return;
    this.loungerCount = this.requestedLoungers();
    this.waitingCount = this.requestedWaiting();
    this.layout = computeLayout(width, height, this.loungerCount, this.waitingCount);
    this.ambience.resize(this.layout);
    this.buildLayers();
    this.updateMasks();
    for (const character of this.characters.values()) {
      character.rig.root.scale.set(this.layout.scale * character.spec.height);
      character.under?.root.scale.set(this.layout.scale * character.spec.height);
    }
  }

  destroy(): void {
    this.unbindPointer();
    for (const character of this.characters.values()) {
      character.rig.destroy();
      character.under?.destroy();
      character.label.destroy();
    }
    this.characters.clear();
    this.world.destroy({ children: true });
  }
}
