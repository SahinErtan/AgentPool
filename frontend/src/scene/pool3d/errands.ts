/**
 * The errands of the deck: what an idle agent gets up to between two spells
 * on its lounger.
 *
 * A lounger used to be the whole life of an agent that had nothing to do. Now
 * it gets up from time to time and walks to a place of the deck: the shower,
 * the kiosk, the hot tub, a game of ping-pong or of ball, a little talk with
 * its neighbours, a stroll round the pool, or a towel shaken out where it
 * lies. This module decides which errand, with whom, and at which place. It is
 * pure: the same bodies and the same clock give the same plan. The walking
 * and the using are in `flow.ts`, which owns the body.
 *
 * One rule runs through all of it: an errand never hides work. The moment an
 * agent wants something else, its errand is dropped (`flow.ts`), so nothing
 * here may hold a body that is working.
 */

import { fnv1a, mulberry32 } from '../characters/spec';
import type { PropKind } from '../motion/driver';
import { findPath, reachable, EDGE_CLEARANCE } from './nav';
import type { Body } from './flow';
import { inPool, onDeck, loungerApproach, type Spot, type Vec2, type World } from './world';

export type ErrandKind =
  | 'shower'
  | 'kiosk'
  | 'hotTub'
  | 'pingPong'
  | 'ballGame'
  | 'chat'
  | 'stroll'
  | 'towel'
  | 'sunscreen';

export type ErrandPhase = 'going' | 'queued' | 'using' | 'leaving';

export interface ErrandState {
  kind: ErrandKind;
  phase: ErrandPhase;
  /** Where it stands or sits to do it. */
  spot: Spot;
  /** The slot key it holds, e.g. 'hotTub:2', or '' for none. */
  slot: string;
  /** Seconds into the phase. */
  t: number;
  /** How long the use lasts. */
  useFor: number;
  /** The others it does it with (ping-pong, ball, chat), by id. */
  with: string[];
  /** For a stroll: the corners still to pass. */
  route: Vec2[];
  /** Which place of its group this body has: 0 and 1 for the two ends of the table, the seat of the tub. */
  index: number;
  /** Where a body was when it began to leave the tub, so it leaves from there. */
  from: { x: number; y: number; z: number };
}

export interface ErrandCandidate {
  id: string;
  /** The lounger it belongs to. */
  lounger: number;
  /** Seconds since it last sat down; 0 when not seated. */
  seatedFor: number;
  needsYou: boolean;
  errand: ErrandState | null;
  /** The scene time of the next errand; negative until the first sit-down sets it. */
  nextErrandAt: number;
  /** The scene time it last left the water, or null. */
  leftWaterAt: number | null;
  errandsDone: number;
}

export interface SlotBook {
  /** Slot key to the id of the body that holds it. */
  taken: Map<string, string>;
}

/** One errand that starts now, for the bodies `ids`, in the order given. */
export interface ErrandStart {
  ids: string[];
  kind: ErrandKind;
  spots: Spot[];
  slots: string[];
  /** Where each body stands in its group. */
  indexes: number[];
  useFor: number;
  /** For a stroll: the corners, the first of which is where it starts. */
  route: Vec2[];
}

/** What the flow needs from the scene: the slots, the clock and the other bodies. */
export interface ErrandContext {
  book: SlotBook;
  now(): number;
  bodyOf(id: string): Body | undefined;
}

/** Seconds a body must have sat on its lounger before it may go out. */
export const SIT_BEFORE_ERRAND_S = 20;
/** Most errands running at once, as a share of the candidates. */
const RUNNING_SHARE = 0.4;
/** The room behind the shower's stand, and the spacing of the kiosk's queue. */
const SHOWER_QUEUE_BEHIND = 0.9;
const KIOSK_QUEUE_GAP = 0.8;
/** How far a chat meeting point is moved towards the pool from the lounger feet. */
const CHAT_TOWARDS_POOL = 0.6;
/** The circle the members of a chat stand on, round the meeting point. */
const CHAT_RADIUS = 0.55;
/** The least distance a chat's meeting point keeps from the water, in metres. */
const CHAT_FROM_WATER = 0.8;
/** How far from the pool's edge the chat's members may stand. */
const CHAT_CLEAR_OBSTACLE = 0.3;
/** How far a stroll corner keeps from the equipment. */
const STROLL_CLEAR = EDGE_CLEARANCE;
/** How far the pool's corners are grown for the stroll. */
const CORNER_CLEARANCE = 0.8;
/** A chat's partners are within this many loungers of each other. */
const CHAT_NEAR = 2;
/** How many chat groups may run at once. The table and the court hold one group each. */
const MAX_CHAT_GROUPS = 2;

/** The weights of the kinds, in the order the draw takes them. */
const WEIGHTS: Record<ErrandKind, number> = {
  stroll: 18,
  kiosk: 16,
  hotTub: 14,
  towel: 12,
  sunscreen: 10,
  shower: 8,
  chat: 14,
  pingPong: 8,
  ballGame: 6,
};

/** The shower's bonus, for a swimmer that has only just left the water. */
const SHOWER_BONUS = 30;
const SHOWER_BONUS_WINDOW_S = 120;

/** The number of seconds each kind is used for, as a range (or a value). */
const USE_RANGE: Record<ErrandKind, [number, number]> = {
  shower: [8, 12],
  kiosk: [4, 4],
  hotTub: [30, 60],
  pingPong: [25, 40],
  ballGame: [30, 45],
  chat: [15, 30],
  stroll: [0, 0],
  towel: [4, 4],
  sunscreen: [6, 6],
};

/** The slots of each place, in the order a queue moves up them. */
const SHOWER_SLOTS = ['shower:stand', 'shower:q0'];
const KIOSK_SLOTS = ['kiosk:use', 'kiosk:q0', 'kiosk:q1'];

/** Mixed into the seed of the kind draw, so each errand of a body draws a new kind. */
const KIND_MIX = 0x85ebca6b;

/** The seed of a draw that belongs to one body and one purpose. */
function drawFor(id: string, salt: string): () => number {
  return mulberry32(fnv1a(`${id}#${salt}`));
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A slot is free when nobody holds it. */
function free(book: SlotBook, key: string): boolean {
  return !book.taken.has(key);
}

function anyFree(book: SlotBook, keys: readonly string[]): string | null {
  for (const key of keys) if (free(book, key)) return key;
  return null;
}

/** How many groups of the given kind are running, each counted once. */
function groupsRunning(candidates: readonly ErrandCandidate[], kind: ErrandKind): number {
  const keys = new Set<string>();
  for (const c of candidates) {
    const e = c.errand;
    if (!e || e.kind !== kind) continue;
    keys.add([c.id, ...e.with].sort().join('|'));
  }
  return keys.size;
}

/**
 * The stroll's corners: the pool grown by a margin, two or three of them, from
 * the nearest corner on, clockwise. Null when there is no such way round.
 */
function strollRoute(world: World, from: Vec2): Vec2[] | null {
  const p = world.pool;
  const m = CORNER_CLEARANCE;
  const corners: Vec2[] = [
    { x: p.minX - m, z: p.minZ - m },
    { x: p.maxX + m, z: p.minZ - m },
    { x: p.maxX + m, z: p.maxZ + m },
    { x: p.minX - m, z: p.maxZ + m },
  ];
  const ok = corners.map((c) => onDeck(world, c) && !blockedBy(world, c, STROLL_CLEAR));
  let start = -1;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < corners.length; i += 1) {
    if (!ok[i]) continue;
    const d = Math.hypot(corners[i].x - from.x, corners[i].z - from.z);
    if (d < best) {
      best = d;
      start = i;
    }
  }
  if (start < 0 || !reachesCorner(world, from, corners[start])) return null;
  // Two or three corners, in turn, so the stroll is a loop round the pool.
  const route: Vec2[] = [];
  for (let k = 0; k < corners.length && route.length < 3; k += 1) {
    const i = (start + k) % corners.length;
    if (!ok[i]) break;
    route.push(corners[i]);
  }
  return route.length >= 2 ? route : null;
}

/** True when a point is inside an obstacle, grown by `by`. */
function blockedBy(world: World, p: Vec2, by: number): boolean {
  for (const o of world.obstacles) {
    const a = o.area;
    if (p.x > a.minX - by && p.x < a.maxX + by && p.z > a.minZ - by && p.z < a.maxZ + by) return true;
  }
  return false;
}

/**
 * The spots where a chat's members stand: a circle round the meeting point,
 * which is the mean of their feet, moved towards the pool. Null when the
 * meeting point or one of the spots is not a fair place to stand.
 */
function chatSpots(world: World, feet: Vec2[]): Spot[] | null {
  let mx = 0;
  let mz = 0;
  for (const p of feet) {
    mx += p.x / feet.length;
    mz += p.z / feet.length;
  }
  // Towards the pool, from the feet of the loungers.
  const towards = { x: -mx, z: -mz };
  const len = Math.hypot(towards.x, towards.z) || 1;
  let cx = mx + (towards.x / len) * CHAT_TOWARDS_POOL;
  let cz = mz + (towards.z / len) * CHAT_TOWARDS_POOL;
  // The walkway between the water and the loungers is only 1.6 m wide, so the
  // meeting point is held at the least distance from the water, on the walk.
  const p = world.pool;
  if (cz > p.minZ - CHAT_FROM_WATER && cz < p.minZ) cz = p.minZ - CHAT_FROM_WATER;
  if (inPool(world, { x: cx, z: cz }, CHAT_FROM_WATER)) return null;
  if (blockedBy(world, { x: cx, z: cz }, 0)) return null;
  const n = feet.length;
  const spots: Spot[] = [];
  for (let k = 0; k < n; k += 1) {
    const a = (k / n) * Math.PI * 2 + Math.PI / 2;
    const x = cx + CHAT_RADIUS * Math.cos(a);
    const z = cz + CHAT_RADIUS * Math.sin(a);
    if (!onDeck(world, { x, z }) || blockedBy(world, { x, z }, CHAT_CLEAR_OBSTACLE)) return null;
    spots.push({ x, z, yaw: Math.atan2(cx - x, cz - z) });
  }
  return spots;
}

/** The spot of a queue place behind the shower or the kiosk. */
function queueSpot(world: World, slot: string): Spot | null {
  const e = world.equipment;
  if (slot === 'shower:q0') {
    const s = e.shower.stand;
    return { x: s.x + SHOWER_QUEUE_BEHIND, z: s.z, yaw: s.yaw };
  }
  const k = /^kiosk:q(\d)$/.exec(slot);
  if (k) {
    const u = e.kiosk.use;
    return { x: u.x, z: u.z - KIOSK_QUEUE_GAP * (Number(k[1]) + 1), yaw: u.yaw };
  }
  return null;
}

/** The place a slot is at, for a slot that stands on the ground (not a chat's). */
export function slotSpot(world: World, slot: string): Spot | null {
  const e = world.equipment;
  if (slot === 'shower:stand') return e.shower.stand;
  if (slot === 'kiosk:use') return e.kiosk.use;
  const pp = /^pingPong:(\d)$/.exec(slot);
  if (pp) return e.pingPong.ends[Number(pp[1])];
  const bc = /^ballCourt:(\d)$/.exec(slot);
  if (bc) return e.ballCourt.spots[Number(bc[1])];
  return queueSpot(world, slot);
}

/** True when the stroll's first corner can be walked to from where the body sits. */
function reachesCorner(world: World, from: Vec2, to: Vec2): boolean {
  return findPath(world, from, to) !== null;
}

/**
 * The places that can be walked to from the gate, cached per world and per
 * place. The layout keeps every place reachable for one to eight lanes (a test
 * checks it); a place that is sealed off all the same is not offered.
 */
const reachCache = new WeakMap<World, Map<string, boolean>>();

function reachableFromGate(world: World, p: Vec2): boolean {
  let cache = reachCache.get(world);
  if (!cache) {
    cache = new Map();
    reachCache.set(world, cache);
  }
  const key = `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
  let ok = cache.get(key);
  if (ok === undefined) {
    ok = reachable(world, world.gate, p);
    cache.set(key, ok);
  }
  return ok;
}

/**
 * An errand a candidate could start with the given partners. It is only
 * made when the place is free, reachable and allowed now.
 */
interface Option {
  kind: ErrandKind;
  ids: string[];
  spots: Spot[];
  slots: string[];
  indexes: number[];
  route: Vec2[];
}

function optionFor(
  kind: ErrandKind,
  self: ErrandCandidate,
  partners: ErrandCandidate[],
  world: World,
  book: SlotBook,
  candidates: readonly ErrandCandidate[],
  night: boolean,
): Option | null {
  const e = world.equipment;
  const lounger = world.loungers[self.lounger];
  const solo = (spot: Spot, slot: string, index = 0): Option => ({
    kind,
    ids: [self.id],
    spots: [spot],
    slots: slot ? [slot] : [],
    indexes: [index],
    route: [],
  });
  switch (kind) {
    case 'stroll': {
      if (!lounger) return null;
      const route = strollRoute(world, loungerApproach(lounger));
      if (!route) return null;
      // The stroll starts at the first corner; the body walks the others.
      return { ...solo({ x: route[0].x, z: route[0].z, yaw: 0 }, ''), route };
    }
    case 'kiosk': {
      const slot = anyFree(book, KIOSK_SLOTS);
      if (!slot) return null;
      const spot = slotSpot(world, slot);
      return spot ? solo(spot, slot) : null;
    }
    case 'hotTub': {
      const seat = e.hotTub.seats.findIndex((_, i) => free(book, `hotTub:${i}`));
      if (seat < 0) return null;
      // The walk ends at the step; the body gets in from there.
      return solo(e.hotTub.step, `hotTub:${seat}`, seat);
    }
    case 'towel': {
      if (!lounger) return null;
      return solo({ ...loungerApproach(lounger), yaw: lounger.facing.z > 0 ? Math.PI : 0 }, '');
    }
    case 'sunscreen': {
      if (night || !lounger) return null;
      return solo({ ...loungerApproach(lounger), yaw: 0 }, '');
    }
    case 'shower': {
      const slot = anyFree(book, SHOWER_SLOTS);
      if (!slot) return null;
      const spot = slotSpot(world, slot);
      return spot ? solo(spot, slot) : null;
    }
    case 'pingPong': {
      if (partners.length < 1) return null;
      if (!free(book, 'pingPong:0') || !free(book, 'pingPong:1')) return null;
      const other = partners[0];
      return {
        kind,
        ids: [self.id, other.id],
        spots: [e.pingPong.ends[0], e.pingPong.ends[1]],
        slots: ['pingPong:0', 'pingPong:1'],
        indexes: [0, 1],
        route: [],
      };
    }
    case 'ballGame': {
      if (partners.length < 2) return null;
      if (!free(book, 'ballCourt:0') || !free(book, 'ballCourt:1') || !free(book, 'ballCourt:2')) return null;
      const three = [self, partners[0], partners[1]];
      return {
        kind,
        ids: three.map((c) => c.id),
        spots: e.ballCourt.spots.slice(0, 3),
        slots: ['ballCourt:0', 'ballCourt:1', 'ballCourt:2'],
        indexes: [0, 1, 2],
        route: [],
      };
    }
    case 'chat': {
      if (partners.length < 1) return null;
      if (groupsRunning(candidates, 'chat') >= MAX_CHAT_GROUPS) return null;
      const group = [self, ...partners.slice(0, 2)];
      const feet: Vec2[] = [];
      for (const c of group) {
        const l = world.loungers[c.lounger];
        if (!l) return null;
        feet.push(loungerApproach(l));
      }
      const spots = chatSpots(world, feet);
      if (!spots) return null;
      // The members keep one key for the group, so the slots are its own.
      const key = group.map((c) => c.id).sort().join('|');
      return {
        kind,
        ids: group.map((c) => c.id),
        spots,
        slots: group.map((_, k) => `chat:${key}:${k}`),
        indexes: group.map((_, k) => k),
        route: [],
      };
    }
  }
}

/** The partners nearest the lounger of `self`, among the eligible others, in order. */
function nearestPartners(self: ErrandCandidate, others: ErrandCandidate[], within: number): ErrandCandidate[] {
  return others
    .filter((o) => Math.abs(o.lounger - self.lounger) <= within)
    .sort((a, b) => Math.abs(a.lounger - self.lounger) - Math.abs(b.lounger - self.lounger) || byId(a, b));
}

/**
 * The option of one kind for `self`, with the partners it needs taken from
 * `others`. Null when the kind cannot start now: the place is taken, out of
 * reach, or not allowed in the rain or at night.
 */
function optionOf(
  kind: ErrandKind,
  self: ErrandCandidate,
  others: ErrandCandidate[],
  world: World,
  book: SlotBook,
  candidates: readonly ErrandCandidate[],
  raining: boolean,
  night: boolean,
): Option | null {
  if (raining && kind !== 'towel' && kind !== 'hotTub') return null;
  let partners: ErrandCandidate[] = [];
  if (kind === 'chat') partners = nearestPartners(self, others, CHAT_NEAR).slice(0, 2);
  else if (kind === 'pingPong') partners = nearestTo(self, others).slice(0, 1);
  else if (kind === 'ballGame') partners = nearestTo(self, others).slice(0, 2);
  if (kind === 'chat' && partners.length === 0) return null;
  const option = optionFor(kind, self, partners, world, book, candidates, night);
  if (!option) return null;
  // Every place the errand uses must be walked to from the deck.
  if (!option.spots.every((spot) => reachableFromGate(world, spot))) return null;
  if (!option.route.every((corner) => reachableFromGate(world, corner))) return null;
  return option;
}

/** The others, nearest lounger first, then by id. */
function nearestTo(self: ErrandCandidate, others: ErrandCandidate[]): ErrandCandidate[] {
  return [...others].sort(
    (a, b) => Math.abs(a.lounger - self.lounger) - Math.abs(b.lounger - self.lounger) || byId(a, b),
  );
}

/** The errand's length, drawn once for the body from its own seed. */
function useFor(self: ErrandCandidate, kind: ErrandKind): number {
  const [lo, hi] = USE_RANGE[kind];
  return hi > lo ? lo + drawFor(self.id, `use:${kind}`)() * (hi - lo) : lo;
}

/** Take the slots of an option in the book, so the next candidate sees them held. */
function commit(option: Option, book: SlotBook, length: number): ErrandStart {
  option.slots.forEach((slot, k) => {
    if (slot) book.taken.set(slot, option.ids[k]);
  });
  return {
    ids: option.ids,
    kind: option.kind,
    spots: option.spots,
    slots: option.slots,
    indexes: option.indexes,
    useFor: option.kind === 'stroll' ? 0 : length,
    route: option.route,
  };
}

/**
 * Which new errands to start now. Pure; called once a second.
 *
 * Each eligible candidate, in id order, draws one kind with its weight: a
 * kind whose place is not free, or that is not allowed now, has no weight.
 * The group kinds take their partners from the candidates still eligible,
 * and the partners are not drawn again this tick.
 *
 * The slots of the starts are taken in `book` as they are planned, so the
 * next candidate sees them as held.
 */
export function planErrands(
  candidates: readonly ErrandCandidate[],
  world: World,
  book: SlotBook,
  now: number,
  raining: boolean,
  night = false,
): ErrandStart[] {
  const eligible = candidates
    .filter((c) => c.errand === null && !c.needsYou && c.seatedFor >= SIT_BEFORE_ERRAND_S && now >= c.nextErrandAt)
    .sort(byId);
  const running = candidates.filter((c) => c.errand !== null).length;
  const limit = Math.max(1, Math.floor(RUNNING_SHARE * candidates.length));
  const taken = new Set<string>();
  const starts: ErrandStart[] = [];
  let active = running;

  for (const self of eligible) {
    if (active >= limit) break;
    if (taken.has(self.id)) continue;
    const others = eligible.filter((o) => o !== self && !taken.has(o.id));
    const rng = mulberry32(((fnv1a(self.id) ^ Math.imul(self.errandsDone, KIND_MIX)) >>> 0) || 1);

    // The kinds that could start now, with their weights.
    const options: { option: Option; weight: number }[] = [];
    for (const kind of Object.keys(WEIGHTS) as ErrandKind[]) {
      const option = optionOf(kind, self, others, world, book, candidates, raining, night);
      if (!option) continue;
      let weight = WEIGHTS[kind];
      if (kind === 'shower' && self.leftWaterAt !== null && now - self.leftWaterAt < SHOWER_BONUS_WINDOW_S) {
        weight += SHOWER_BONUS;
      }
      options.push({ option, weight });
    }
    const total = options.reduce((sum, o) => sum + o.weight, 0);
    if (total <= 0) continue;
    let roll = rng() * total;
    let chosen = options[options.length - 1];
    for (const o of options) {
      roll -= o.weight;
      if (roll < 0) {
        chosen = o;
        break;
      }
    }
    const option = chosen.option;
    if (active + option.ids.length > limit) continue;
    starts.push(commit(option, book, useFor(self, option.kind)));
    for (const id of option.ids) taken.add(id);
    active += option.ids.length;
  }
  return starts;
}

/**
 * One errand of a given kind, for a seated body that is not on one: the
 * debug hooks use it to look at a kind that the draw is slow to choose.
 * Null when the kind cannot start for it now.
 */
export function forceErrand(
  kind: ErrandKind,
  id: string,
  candidates: readonly ErrandCandidate[],
  world: World,
  book: SlotBook,
  night = false,
): ErrandStart | null {
  const self = candidates.find((c) => c.id === id);
  if (!self || self.errand !== null) return null;
  const others = candidates.filter((c) => c !== self && c.errand === null && !c.needsYou).sort(byId);
  const option = optionOf(kind, self, others, world, book, candidates, false, night);
  if (!option) return null;
  return commit(option, book, useFor(self, kind));
}

/**
 * Move the queued errands up the queue, when the place in front of them has
 * come free. A body in the queue that is first in line walks to the place.
 */
export function promoteQueued(candidates: readonly ErrandCandidate[], world: World, book: SlotBook): void {
  for (const c of [...candidates].sort(byId)) {
    const e = c.errand;
    if (!e || e.phase !== 'queued') continue;
    const chain = e.kind === 'shower' ? SHOWER_SLOTS : e.kind === 'kiosk' ? KIOSK_SLOTS : null;
    if (!chain) continue;
    const here = chain.indexOf(e.slot);
    for (let k = 0; k < here; k += 1) {
      if (!free(book, chain[k])) continue;
      if (book.taken.get(e.slot) === c.id) book.taken.delete(e.slot);
      book.taken.set(chain[k], c.id);
      e.slot = chain[k];
      const spot = slotSpot(world, chain[k]);
      if (spot) e.spot = spot;
      if (k === 0) e.phase = 'going';
      break;
    }
  }
}

/** Make the errand state a body takes on when its errand starts. */
function errandFor(start: ErrandStart, k: number): ErrandState {
  const id = start.ids[k];
  const slot = start.slots[k] ?? '';
  // A place in a queue is waited for; the sunscreen is put on where the body lies.
  const queued = /^(shower|kiosk):q\d$/.test(slot);
  return {
    kind: start.kind,
    phase: start.kind === 'sunscreen' ? 'using' : queued ? 'queued' : 'going',
    spot: start.spots[k],
    slot,
    t: 0,
    useFor: start.useFor,
    with: start.ids.filter((o) => o !== id),
    route: start.kind === 'stroll' ? start.route.slice() : [],
    index: start.indexes[k] ?? 0,
    from: { x: 0, y: 0, z: 0 },
  };
}

/**
 * One tick of the errands, once a second: count the first errand of each new
 * seated body, plan the new errands and give them to the bodies.
 *
 * Returns how many errands started. The bodies are changed in place; the
 * book is changed as the starts are planned.
 */
export function tickErrands(
  bodies: readonly Body[],
  world: World,
  book: SlotBook,
  now: number,
  raining: boolean,
  night = false,
  force: { id: string; kind: ErrandKind } | null = null,
): number {
  const candidates: ErrandCandidate[] = [];
  const byBody = new Map<string, Body>();
  for (const b of bodies) {
    byBody.set(b.id, b);
    if (b.desired !== 'lounge' || b.seat === null) continue;
    if (b.entry !== null || b.climbing !== 0 || b.inWater || b.edgeOut !== null) continue;
    // The first errand of a body comes after a while, not at once.
    if (b.nextErrandAt < 0) b.nextErrandAt = now + 40 + (fnv1a(b.id) % 110);
    candidates.push({
      id: b.id,
      lounger: b.lounger ?? b.seat,
      seatedFor: b.seatedFor,
      needsYou: b.needsYou,
      errand: b.errand,
      nextErrandAt: b.nextErrandAt,
      leftWaterAt: b.leftWaterAt,
      errandsDone: b.errandsDone,
    });
  }
  // The candidates share their errand objects with the bodies, so a queue
  // that moves on is the body's own state at once.
  promoteQueued(candidates, world, book);
  const starts = planErrands(candidates, world, book, now, raining, night);
  if (force) {
    const forced = forceErrand(force.kind, force.id, candidates, world, book, night);
    if (forced) starts.push(forced);
  }
  for (const start of starts) {
    for (let k = 0; k < start.ids.length; k += 1) {
      const b = byBody.get(start.ids[k]);
      if (!b) continue;
      b.errand = errandFor(start, k);
      b.walkScale = start.kind === 'stroll' ? STROLL_WALK : 1;
      // A sunscreen is put on where the body lies, so it is carried from now.
      b.carry = carryFor(start.kind, start.indexes[k] ?? 0);
    }
  }
  return starts.length;
}

/** The walking speed of a stroll, as a factor of a walk. */
export const STROLL_WALK = 0.75;

/**
 * What a body holds in its hand from the start of its errand, or null. The
 * towel is taken up when the body is standing at the lounger's foot, so it is
 * not here.
 */
export function carryFor(kind: ErrandKind, index: number): PropKind | null {
  switch (kind) {
    case 'towel':
      return null;
    case 'sunscreen':
      return 'bottle';
    case 'pingPong':
      return index === 0 ? 'paddle' : 'paddleDark';
    default:
      return null;
  }
}

/** A number in [0, 1) that belongs to one body and one purpose: the same every time. */
export function errandDraw(id: string, salt: string): number {
  return drawFor(id, salt)();
}

/**
 * Which of a ping-pong pair loses the rally, as an index into the pair: the
 * same for both players, and different every time they meet. The loser
 * shakes its head, and the winner cheers.
 */
export function rallyLoser(ids: readonly string[]): number {
  return fnv1a([...ids].sort().join('|')) & 1;
}
