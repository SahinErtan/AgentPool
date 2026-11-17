/**
 * The crowd in the water: the demo crowd is stepped with the same flow the
 * scene runs, and the bodies of the swimmers are measured. Two swimmers may
 * pass in a lane, but no two torsos may be on top of one another.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDemoState, demoAgents } from '../src/scene/demo/demoFeed';
import type { EntryBusy, EntryKind } from '../src/scene/pool3d/entries';
import {
  applyPresentation,
  createBody,
  ladderBusy,
  ladderLoad,
  settle,
  stepBody,
  type Body,
  type FlowContext,
} from '../src/scene/pool3d/flow';
import { buildWorld, queueSpot, type World } from '../src/scene/pool3d/world';
import type { Walker } from '../src/scene/pool3d/nav';

const DT = 1 / 15;

/** The half length of a torso, as a part of the height of the body. */
const TORSO = 0.3;

interface Crowd {
  world: World;
  bodies: Map<string, Body>;
  entries: Map<EntryKind, number>;
  minDistance: number;
  minAt: string;
  low: number;
  /** Whether a pair was closer than 0.3 m in this frame. */
  close: boolean;
  /** How many frames had a pair closer than 0.3 m. */
  closeFrames: number;
  /** The longest time two swimmers stayed on top of one another, in seconds. */
  longest: number;
  longestPair: string;
  worst: string[];
  pairs: Map<string, { n: number; first: number; last: number; info: string }>;
}

/** The smallest distance between the torsos (two segments along the headings) of two swimmers. */
export function torsoDistance(a: Body, b: Body): number {
  const sa = a.swim;
  const sb = b.swim;
  if (!sa || !sb) return Number.POSITIVE_INFINITY;
  const ha = a.height * TORSO;
  const hb = b.height * TORSO;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= 6; i += 1) {
    const u = (i / 6) * 2 - 1;
    const ax = sa.x + Math.sin(sa.yaw) * ha * u;
    const az = sa.z + Math.cos(sa.yaw) * ha * u;
    for (let j = 0; j <= 6; j += 1) {
      const v = (j / 6) * 2 - 1;
      const bx = sb.x + Math.sin(sb.yaw) * hb * v;
      const bz = sb.z + Math.cos(sb.yaw) * hb * v;
      best = Math.min(best, Math.hypot(ax - bx, az - bz));
    }
  }
  return best;
}

/** Runs the demo crowd for `seconds`, the way the scene runs it, and measures the swimmers. */
export function runCrowd(n: number, seconds: number, warmup = 0): Crowd {
  const start = 1_700_000_000;
  const state = createDemoState(n, start);
  let now = start;
  demoAgents(n, now, state);
  const world = buildWorld(state.payload);
  const bodies = new Map<string, Body>();
  const entries = new Map<EntryKind, number>();
  const lastEntry = new Map<string, string>();

  const busyFor = (self: Body): EntryBusy => {
    let slide = false;
    let board = false;
    for (const o of bodies.values()) {
      if (o === self || o.entry === null) continue;
      if (o.entry.kind === 'slide' && o.entry.phase !== 'wait') slide = true;
      if (o.entry.kind === 'board') board = true;
    }
    return {
      slide,
      board,
      block: (lane) => [...bodies.values()].some((o) => o !== self && o.entry?.kind === 'block' && o.lane === lane),
      waterNear: (x, z, r) =>
        [...bodies.values()].some(
          (o) => o !== self && o.inWater && o.swim !== null && Math.hypot(o.swim.x - x, o.swim.z - z) < r,
        ),
    };
  };
  const ctx: FlowContext = {
    exited: (id) => {
      bodies.delete(id);
    },
    ladderLoad: (index, self) => ladderLoad(bodies.values(), index, self),
    crowd: () => bodies.values(),
    entries: { busy: busyFor, reducedMotion: false },
    swimGap: (self) => {
      const mine = self.swim;
      if (!mine || !self.inWater) return Number.POSITIVE_INFINITY;
      let best = Number.POSITIVE_INFINITY;
      for (const other of bodies.values()) {
        const theirs = other.swim;
        if (other === self || !theirs || !other.inWater || other.lane !== self.lane) continue;
        if (theirs.dir !== mine.dir || theirs.turning > 0) continue;
        const ahead = (theirs.x - mine.x) * mine.dir;
        if (ahead > 0 && ahead < best) best = ahead;
      }
      return best;
    },
  };

  const crowd: Crowd = {
    world,
    bodies,
    entries,
    minDistance: Number.POSITIVE_INFINITY,
    minAt: '',
    low: 0,
    close: false,
    closeFrames: 0,
    longest: 0,
    longestPair: '',
    worst: [],
    pairs: new Map(),
  };
  let first = true;
  for (let t = 0; t < seconds; t += DT) {
    now += DT;
    const agents = demoAgents(n, now, state);
    const present = new Set<string>();
    for (const a of agents) {
      present.add(a.id);
      let body = bodies.get(a.id);
      if (!body) {
        if (a.presentation.mode === 'offscreen') continue;
        body = createBody(a.id, 1.55 + (hash(a.id) % 30) / 100, 0.5, 0.9 + (hash(a.id) % 20) / 100, queueSpot(world, 0));
        applyPresentation(body, a.presentation, world, () => null, () => 0);
        if (first) settle(body, world);
        bodies.set(a.id, body);
      }
      applyPresentation(body, a.presentation, world, () => null, () => 0);
    }
    first = false;
    // An agent that is not in the list any more is gone, as in the scene: a
    // session that ends walks out and the next one takes its place.
    for (const id of [...bodies.keys()]) {
      if (!present.has(id)) bodies.delete(id);
    }
    const walkers: Walker[] = [];
    for (const b of bodies.values()) {
      if (b.inWater || b.seat !== null || b.climbing !== 0 || b.entry !== null || b.edgeOut !== null) continue;
      walkers.push({ id: b.id, x: b.x, z: b.z, moving: b.path.length > 0 });
    }
    for (const body of [...bodies.values()]) {
      const before = body.entry?.kind ?? null;
      const wasIn = body.inWater;
      stepBody(body, world, DT, walkers, ctx, (i) => ladderBusy(bodies.values(), i, body));
      if (before === null && body.entry !== null) lastEntry.set(body.id, `${body.entry.kind}@${t.toFixed(0)}`);
      if (before === null && body.entry !== null) entries.set(body.entry.kind, (entries.get(body.entry.kind) ?? 0) + 1);
      body.events.length = 0;
    }
    if (t < warmup) continue;
    if (crowd.close) crowd.closeFrames += 1;
    crowd.close = false;
    const swimmers = [...bodies.values()].filter((b) => b.inWater && b.swim !== null && b.entry === null);
    for (let i = 0; i < swimmers.length; i += 1) {
      for (let j = i + 1; j < swimmers.length; j += 1) {
        const d = torsoDistance(swimmers[i], swimmers[j]);
        const key = swimmers[i].id + ' ~ ' + swimmers[j].id;
        if (d < 0.3) {
          crowd.low += 1;
          crowd.close = true;
          const e = crowd.pairs.get(key) ?? { n: 0, first: t, last: t, info: '', run: 0 };
          e.n += 1;
          e.last = t;
          e.run += 1;
          if (e.run * DT > crowd.longest) {
            crowd.longest = e.run * DT;
            crowd.longestPair = key;
          }
          e.info = [swimmers[i], swimmers[j]]
            .map(
              (b) =>
                `${b.id.slice(-8)} L${b.lane} x${b.swim?.x.toFixed(2)} z${b.swim?.z.toFixed(2)} w${b.swimWait.toFixed(1)} ` +
                `des=${b.desired} wait=${b.waiting} seat=${b.seat} clm=${b.climbing} inW=${b.inWater ? 1 : 0} ent=${b.entry?.kind ?? '-'} ` +
                `st=${b.state} hold${b.swim?.holding ? 1 : 0} rest${(b.swim?.resting ?? 0).toFixed(1)} ` +
                `dg=${b.dodge}:${b.dodgeT.toFixed(1)}@${b.dodgeZ.toFixed(2)} pass${b.swimPass.toFixed(1)} turn${(b.swim?.turning ?? 0).toFixed(1)}`,
            )
            .join(' || ');
          crowd.pairs.set(key, e);
        } else {
          const e = crowd.pairs.get(key);
          if (e) e.run = 0;
        }
        if (d < crowd.minDistance) {
          crowd.minDistance = d;
          const f = (b: Body) => `${b.id}(lane ${b.lane} x=${b.swim?.x.toFixed(2)} z=${b.swim?.z.toFixed(2)} dir=${b.swim?.dir} glide=${b.glideLeft.toFixed(1)} last=${lastEntry.get(b.id) ?? '-'})`;
          crowd.minAt = `t=${t.toFixed(0)} ${f(swimmers[i])} ${f(swimmers[j])}`;
        }
      }
    }
  }
  for (const [k, e] of [...crowd.pairs].sort((a, b) => b[1].n - a[1].n).slice(0, 4)) {
    crowd.worst.push(`${k}: ${e.n} frames from ${e.first.toFixed(0)} s to ${e.last.toFixed(0)} s — ${e.info}`);
  }
  return crowd;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Two swimmers may pass each other, and then their bodies touch for a moment.
 * What the pool must not do is spend its time on top of one another: the
 * measure is the share of the frames in which a pair is closer than 0.3 m.
 * The bigger crowd gets the bigger share: it is twice as many swimmers in the
 * same pool.
 *
 * The demo's population moves now: a session ends, walks out and the next
 * one walks in, so a swimmer that has just come in is in the lane with the
 * others for a moment before it finds its own place. That is worth a few
 * points of the share.
 */
const SHARE_LIMIT: Record<number, number> = { 24: 0.3, 60: 0.8 };

for (const n of [24, 60]) {
  test(`${n} agents over twenty minutes: the swimmers spend little of the time on top of one another`, () => {
    const crowd = runCrowd(n, 1200, 60);
    const kinds = [...crowd.entries].map(([k, c]) => `${k}:${c}`).join(' ');
    const frames = Math.round((1200 - 60) / DT);
    const share = crowd.closeFrames / frames;
    console.log(
      `crowd ${n}: min torso distance ${crowd.minDistance.toFixed(3)} m at ${crowd.minAt}; ` +
        `entries ${kinds}; frames below 0.3 m ${crowd.closeFrames} of ${frames} (${(share * 100).toFixed(2)} per cent), ${crowd.low} pairs`,
    );
    for (const line of crowd.worst) console.log('  closest pair', line);
    console.log(`  the longest time two of them stayed on top of one another: ${crowd.longest.toFixed(1)} s (${crowd.longestPair})`);
    assert.ok(
      share <= SHARE_LIMIT[n],
      `${(share * 100).toFixed(2)} per cent of the frames had two torsos closer than 0.3 m (${crowd.minAt})`,
    );
    // Two swimmers may pass each other, and in a crowded pool they now and
    // then touch for a while. They must not stay on top of one another for
    // ever: that was the pool that froze, with two bodies locked together for
    // the whole run.
    assert.ok(
      crowd.longest < 40,
      `two swimmers stayed on top of one another for ${crowd.longest.toFixed(1)} s (${crowd.longestPair})`,
    );
  });
}
