/**
 * The planner of the lounger (Sprint 29.4): what an idle figure does next,
 * and for how long. Pure, so it runs in node with no WebGL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32, rngFor, specFor, type IdleActivity } from '../src/scene/characters/spec';
import { PoseDriver } from '../src/scene/motion/driver';
import { LEISURE_KINDS, type LeisureKind } from '../src/scene/motion/leisureKind';
import {
  chooseLeisure,
  durationOf,
  gapAfter,
  repertoireFor,
  restingLine,
  sunFor,
  weightOf,
  type LeisureContext,
} from '../src/scene/pool3d/leisurePlan';

const DAY = 13;
const NIGHT = 23;

/** A context for an idle figure in the middle of a clear day, with everything possible. */
function context(over: Partial<LeisureContext> = {}): LeisureContext {
  return {
    id: 'agent-a',
    hour: DAY,
    weather: 'clear',
    idleFor: 60,
    justFinished: false,
    fatigue: 0,
    neighbour: true,
    catNear: true,
    swimmers: true,
    last: null,
    ...over,
  };
}

/** A figure with the given favourite, as the spec draws it. */
function figure(favourite: IdleActivity) {
  return { idleActivity: favourite };
}

/** An agent id whose repertoire holds the kind, so a test can use it. */
function idWith(kind: LeisureKind, favourite: IdleActivity = 'book'): string {
  for (let i = 0; i < 500; i += 1) {
    const id = `plan-${i}`;
    if (repertoireFor(id, favourite).includes(kind)) return id;
  }
  throw new Error(`no id has ${kind}`);
}

/** Many choices from one figure's stream, in one context: the kinds it picks. */
function draws(spec: { idleActivity: IdleActivity }, ctx: LeisureContext, n: number, seed = 7): (LeisureKind | null)[] {
  const rng = mulberry32(seed);
  const out: (LeisureKind | null)[] = [];
  for (let i = 0; i < n; i += 1) out.push(chooseLeisure(spec, { ...ctx, last: null }, rng));
  return out;
}

test('the choice is deterministic: the same inputs give the same activity', () => {
  const spec = figure('book');
  const ctx = context({ id: 'agent-det' });
  const a = draws(spec, ctx, 40, 99);
  const b = draws(spec, ctx, 40, 99);
  assert.deepEqual(a, b);
});

test('the repertoire is the favourite plus two extras, from the 3D table, and kept for the agent', () => {
  const rep = repertoireFor('agent-rep', 'tea');
  assert.equal(rep.length, 3);
  assert.equal(rep[0], 'tea');
  assert.equal(new Set(rep).size, 3, 'no kind twice');
  for (const kind of rep) assert.ok((LEISURE_KINDS as readonly string[]).includes(kind));
  assert.deepEqual(repertoireFor('agent-rep', 'tea'), rep, 'the same agent keeps its repertoire');
});

test('a figure whose favourite is none has three extras and no favourite', () => {
  const rep = repertoireFor('agent-none', 'none');
  assert.equal(rep.length, 3);
  assert.ok(!(rep as string[]).includes('none'));
});

test('sunbathe is never chosen at night, nor in the rain', () => {
  const spec = figure('sunbathe');
  const id = idWith('sunbathe', 'sunbathe');
  assert.equal(weightOf('sunbathe', spec, context({ id, hour: NIGHT })), 0);
  assert.equal(weightOf('sunbathe', spec, context({ id, hour: 2 })), 0);
  assert.equal(weightOf('sunbathe', spec, context({ id, weather: 'rain' })), 0);
  for (const kind of draws(spec, context({ id, hour: NIGHT }), 300)) assert.notEqual(kind, 'sunbathe');
  for (const kind of draws(spec, context({ id, weather: 'rain' }), 300)) assert.notEqual(kind, 'sunbathe');
});

test('fan is not chosen in the rain either, and nothing outdoor is chosen in the rain', () => {
  const spec = figure('fan');
  const id = idWith('fan', 'fan');
  for (const kind of draws(spec, context({ id, weather: 'rain' }), 300)) {
    assert.notEqual(kind, 'fan');
    assert.notEqual(kind, 'sunbathe');
  }
});

test('chat is never chosen without a neighbour, and cat never without the cat', () => {
  const spec = figure('book');
  const chatId = idWith('chat');
  const catId = idWith('cat');
  for (const kind of draws(spec, context({ id: chatId, neighbour: false }), 400)) assert.notEqual(kind, 'chat');
  for (const kind of draws(spec, context({ id: catId, catNear: false }), 400)) assert.notEqual(kind, 'cat');
  // With the neighbour and the cat there, both can come up.
  assert.ok(draws(figure('chat'), context({ id: chatId }), 400).includes('chat'));
  assert.ok(draws(figure('cat'), context({ id: catId }), 400).includes('cat'));
});

test('watch is never chosen with nobody swimming', () => {
  const spec = figure('watch');
  for (const kind of draws(spec, context({ id: idWith('watch', 'watch'), swimmers: false }), 300)) assert.notEqual(kind, 'watch');
});

test('the first choice after the figure came out of the water is a stretch', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const spec = figure(seed % 2 ? 'phone' : 'book');
    const rng = mulberry32(seed);
    const kind = chooseLeisure(spec, context({ justFinished: true, last: null }), rng);
    assert.equal(kind, 'stretch');
  }
});

test('after the stretch comes a drink: tea or lemonade', () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 40; i += 1) {
    const kind = chooseLeisure(figure('book'), context({ justFinished: true, last: 'stretch' }), rng);
    assert.ok(kind === 'tea' || kind === 'lemonade', `${kind}`);
  }
});

test('over a simulated 30 minutes idle, the share of naps grows', () => {
  const id = idWith('nap', 'book');
  const rng = mulberry32(21);
  const share = (from: number, to: number): number => {
    let naps = 0;
    let n = 0;
    for (let i = 0; i < 600; i += 1) {
      const idle = from + ((to - from) * i) / 600;
      const kind = chooseLeisure(figure('book'), context({ id, idleFor: idle, last: null }), rng);
      n += 1;
      if (kind === 'nap') naps += 1;
    }
    return naps / n;
  };
  const early = share(0, 120);
  const late = share(1500, 1800);
  assert.ok(late > early * 2, `early ${early.toFixed(3)}, late ${late.toFixed(3)}`);
});

test('no activity is chosen twice in a row, unless it is the only one possible', () => {
  const id = idWith('tea', 'tea');
  const spec = figure('tea');
  const rng = mulberry32(5);
  let last: LeisureKind | null = null;
  for (let i = 0; i < 400; i += 1) {
    const ctx = context({ id, last });
    const kind = chooseLeisure(spec, ctx, rng);
    if (kind !== null) {
      if (kind === last) {
        // Only allowed if no other activity of the repertoire can be chosen now.
        const others = repertoireFor(id, 'tea').filter((k) => k !== last && weightOf(k, spec, ctx) > 0);
        assert.equal(others.length, 0, `${kind} twice with ${others.join(', ')} possible`);
      }
      last = kind;
    }
  }
});

test('in a crowd of 24 idle figures at one moment, at least six different activities are on screen', () => {
  // The 24 figures of the demo: each with its own favourite, repertoire and stream.
  const agents = Array.from({ length: 24 }, (_, i) => `crowd-${i}`);
  const kinds = new Set<LeisureKind>();
  for (const id of agents) {
    const spec = specFor(id, 'subagent');
    const i = agents.indexOf(id);
    const ctx = context({
      id,
      hour: DAY,
      idleFor: 90,
      neighbour: i % 2 === 0,
      swimmers: i % 3 !== 0,
      catNear: i === 5,
    });
    const kind = chooseLeisure(spec, ctx, rngFor(id, 'leisure-pick'));
    if (kind !== null) kinds.add(kind);
  }
  assert.ok(kinds.size >= 6, `only ${kinds.size}: ${[...kinds].join(', ')}`);
});

test('a figure lies still before its first activity for 6 to 30 seconds, and the gap grows with the idle time', () => {
  const rng = mulberry32(8);
  for (let i = 0; i < 200; i += 1) {
    const gap = gapAfter(figure('book'), 0, rng);
    assert.ok(gap >= 10 && gap <= 40, `${gap}`);
  }
  const short = gapAfter(figure('book'), 0, mulberry32(1));
  const long = gapAfter(figure('book'), 1800, mulberry32(1));
  assert.ok(long > short * 1.9, `${short} ${long}`);
  assert.ok(gapAfter(figure('none'), 0, mulberry32(1)) > short, 'a figure with no favourite rests longer');
});

test('each activity lasts for its own time: a tea for 15 to 25 s, a nap for 45 to 120 s, a stretch for 6 to 12 s', () => {
  const rng = mulberry32(13);
  const range = (kind: LeisureKind) => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 300; i += 1) {
      const s = durationOf(kind, rng);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    return [lo, hi];
  };
  const [teaLo, teaHi] = range('tea');
  assert.ok(teaLo >= 15 && teaHi <= 25);
  const [napLo, napHi] = range('nap');
  assert.ok(napLo >= 45 && napHi <= 120);
  const [stLo, stHi] = range('stretch');
  assert.ok(stLo >= 6 && stHi <= 12);
});

test('the sun is up in the day and gone at night, highest at midday', () => {
  assert.equal(sunFor(NIGHT), 0);
  assert.equal(sunFor(3), 0);
  assert.ok(sunFor(12) > sunFor(8));
  assert.ok(sunFor(12) > sunFor(17));
  assert.ok(sunFor(12) <= 1);
});

test('the card line says what a napper does, and what the rest do', () => {
  assert.equal(restingLine('nap', 32 * 60), 'asleep (32 min idle)');
  assert.equal(restingLine('tea', 0), 'tea');
  assert.equal(restingLine('book', 900), 'reading');
  assert.equal(restingLine(null, 900), 'lounging');
});

test('a 3D driver with the scene in charge does not start an activity on its own', () => {
  const spec = specFor('driver-scene', 'subagent', { idleActivity: 'tea', idleStartDelay: 1, idleDuration: 5, idleCooldown: 1 });
  const driver = new PoseDriver(spec, { leisure: '3d', sceneIdle: true });
  driver.setState('lounging');
  for (let i = 0; i < 600; i += 1) driver.update(100);
  assert.equal(driver.isDoingActivity, false, 'the scene decides, not the driver');
  driver.playActivity('book', 5);
  assert.equal(driver.activeKind, 'book');
  for (let i = 0; i < 60; i += 1) driver.update(100);
  assert.equal(driver.isDoingActivity, false, 'the activity the scene asked for ends on its own');
});

test('the 2D driver still starts its own activity', () => {
  const spec = specFor('driver-2d', 'subagent', { idleActivity: 'tea', idleStartDelay: 1, idleDuration: 5, idleCooldown: 1 });
  const driver = new PoseDriver(spec);
  driver.setState('lounging');
  let started = false;
  for (let i = 0; i < 100 && !started; i += 1) {
    driver.update(100);
    started = driver.isDoingActivity;
  }
  assert.equal(started, true);
});
