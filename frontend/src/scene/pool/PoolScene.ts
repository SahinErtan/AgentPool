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

import { Application, Container, Graphics, Text, TilingSprite } from 'pixi.js';
import { CharacterAnimator, type CharState } from '../characters/animator';
import { buildRig, type Rig } from '../characters/rig';
import { specFor, type CharacterSpec, type Role } from '../characters/spec';
import type { AgentView } from '../../net/types';
import { acknowledgeExit } from '../../net/ws';
import { computeLayout, resolveWaypoint, type PoolLayout } from './layout';
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

type Desired = 'swim' | 'lounge' | 'exiting' | 'leaving' | 'offscreen' | 'unknown';

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
  private causticA: TilingSprite | null = null;
  private causticB: TilingSprite | null = null;
  private debugText: Text | null = null;

  private layout: PoolLayout;
  private characters = new Map<string, Character>();
  private time = 0;

  constructor(app: Application) {
    this.app = app;
    this.layout = computeLayout(app.renderer.width, app.renderer.height);

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

    this.maskAbove.renderable = false;
    this.maskBelow.renderable = false;

    this.buildLayers();
    this.app.ticker.add((ticker) => this.update(ticker.deltaMS));
  }

  // -- construction -------------------------------------------------

  private buildLayers(): void {
    const layout = this.layout;

    const sky = new Graphics();
    drawSky(sky, layout);
    this.skyLayer.addChild(sky);

    const deck = new Graphics();
    drawDeck(deck, layout);
    this.deckLayer.addChild(deck);

    const floor = new Graphics();
    drawFloor(floor, layout);
    this.floorLayer.addChild(floor);

    // Two scrolling caustic layers make the water feel alive.
    const texture = makeCausticTexture();
    this.causticA = new TilingSprite({ texture, width: 1, height: 1 });
    this.causticB = new TilingSprite({ texture, width: 1, height: 1 });
    for (const [sprite, scale, alpha] of [
      [this.causticA, 1.6, 0.16],
      [this.causticB, 2.4, 0.1],
    ] as [TilingSprite, number, number][]) {
      sprite.scale.set(scale);
      sprite.alpha = alpha;
      sprite.blendMode = 'add';
      this.causticsLayer.addChild(sprite);
    }

    const water = new Graphics();
    drawWater(water, layout);
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
    }

    for (const [id, character] of [...this.characters.entries()]) {
      if (seen.has(id)) continue;
      character.rig.destroy();
      character.under?.destroy();
      character.label.destroy();
      this.characters.delete(id);
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
    this.surfaceLayer.addChild(rig.root);

    const animator = new CharacterAnimator(rig);

    const label = new Text({
      text: agent.label,
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
      if (this.layout.loungers[lounger]) character.loungerSlot = lounger;
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
        character.y = this.layout.deckY;
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
    this.time += dt;

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
      character.label.visible = character.state !== 'swimming';
    }

    // The caustics drift.
    if (this.causticA && this.causticB) {
      this.causticA.tilePosition.x = this.time * 7;
      this.causticA.tilePosition.y = this.time * 3;
      this.causticB.tilePosition.x = -this.time * 5;
      this.causticB.tilePosition.y = this.time * 9;
      this.causticA.width = this.layout.water.w * 1.4;
      this.causticA.height = this.layout.water.h * 1.4;
      this.causticB.width = this.layout.water.w * 1.8;
      this.causticB.height = this.layout.water.h * 1.8;
      this.causticA.position.set(this.layout.water.x, this.layout.water.y);
      this.causticB.position.set(this.layout.water.x, this.layout.water.y);
    }

    this.foam.clear();
    drawFoam(this.foam, this.layout, this.time);

    if (this.debugText) {
      this.debugText.text = [...this.characters.values()]
        .map(
          (c) =>
            `${c.id.slice(0, 12)} m=${c.lastMode} st=${c.state} x=${Math.round(c.x)} y=${Math.round(
              c.y,
            )} e=${c.entered} t=${c.target ?? '-'}`,
        )
        .join('\n');
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

    // Spread the characters along the ladder so they do not stack up.
    const offset =
      character.target === 'ladder'
        ? (character.laneIndex - 1.5) * this.layout.characterHeight * 0.11
        : 0;

    const dx = target.x + offset - character.x;
    const distance = Math.abs(dx);
    const step = WALK_SPEED * dt;

    if (distance <= step) {
      // Arrive at the *offset* target, otherwise the character oscillates
      // around it and never registers as arrived.
      character.x = target.x + offset;
      if (character.target === 'gate') {
        // The character has walked out through the gate.
        acknowledgeExit(character.id);
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
        character.y = this.layout.deckY;
        return;
      }
      if (character.state === 'walking') {
        // Arrived at the lounger.
        character.state = 'lounging';
        character.entered = true;
        character.y = this.layout.deckY;
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

  // -- layout -------------------------------------------------------

  resize(width: number, height: number): void {
    this.layout = computeLayout(width, height);
    this.buildLayers();
    this.updateMasks();
    for (const character of this.characters.values()) {
      character.rig.root.scale.set(this.layout.scale * character.spec.height);
      character.under?.root.scale.set(this.layout.scale * character.spec.height);
    }
  }

  destroy(): void {
    for (const character of this.characters.values()) {
      character.rig.destroy();
      character.under?.destroy();
      character.label.destroy();
    }
    this.characters.clear();
    this.world.destroy({ children: true });
  }
}
