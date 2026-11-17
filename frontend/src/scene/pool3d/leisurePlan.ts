/**
 * What an idle figure does on its lounger, and for how long (Sprint 29.4).
 *
 * A figure used to keep one activity for its whole life. Now it has a small
 * repertoire: its favourite (the spec's own
 * `idleActivity`) and two more drawn from the 3D table. Each time it lies
 * down, or finishes an activity and has paused, the planner picks the next
 * one from the moment: the hour, the weather, how long the agent has been
 * idle, whether it has just come out of the water, how tired it is, and
 * who is near it.
 *
 * Pure: no Three.js and no `Math.random`. The caller passes the figure's
 * random stream, so the same inputs give the same pool.
 */

import { rngFor, type CharacterSpec, type IdleActivity } from '../characters/spec';
import { LEISURE_KINDS, type LeisureKind } from '../motion/leisureKind';
import type { Weather } from './weather';

/** What the planner knows about a figure and its surroundings. */
export interface LeisureContext {
  /** The agent's id: the repertoire is drawn from its own stream. */
  id: string;
  /** The hour of the day the pool shows, 0 to 24. */
  hour: number;
  weather: Weather;
  /** How long the agent has been idle, in seconds. */
  idleFor: number;
  /** True in the first minute after the figure came out of the water. */
  justFinished: boolean;
  /** How tired the agent is, 0 to 1 (from `work.ts`). */
  fatigue: number;
  /** True when a free figure lies on the next lounger, for `chat`. */
  neighbour: boolean;
  /** True when the cat is asleep within two metres, for `cat`. */
  catNear: boolean;
  /** True when somebody is in the water, for `watch`. */
  swimmers: boolean;
  /** The activity this figure did last, or null. */
  last: LeisureKind | null;
}

/** The activities that are drinks: a figure that has stretched has one. */
const DRINKS: readonly LeisureKind[] = ['tea', 'lemonade'];

/** The stream the extra activities are drawn from. A new channel, so no other attribute moves. */
export const EXTRA_CHANNEL = 'leisure-extra';

/** How long each activity lasts, in seconds, as a range. */
const SECONDS: Record<LeisureKind, readonly [number, number]> = {
  tea: [15, 25],
  lemonade: [15, 25],
  book: [30, 60],
  newspaper: [30, 60],
  laptop: [30, 60],
  crossword: [30, 60],
  cards: [30, 60],
  sunbathe: [30, 60],
  nap: [45, 120],
  phone: [20, 40],
  music: [20, 40],
  call: [20, 40],
  chat: [20, 40],
  stretch: [6, 12],
  snack: [6, 12],
  fan: [6, 12],
  watch: [20, 30],
  cat: [15, 30],
};

/** The idle time at which a nap grows, in seconds: ten minutes, then half an hour. */
const NAP_AFTER_S = 600;
const NAP_LONG_AFTER_S = 1800;
/** A figure whose favourite is `none` lies still between its activities this often. */
const REST_CHANCE = 0.35;

/** Hours: the morning, the midday, the evening; the night is the rest. Daylight is 6 to 19. */
function isMorning(hour: number): boolean {
  return hour >= 6 && hour < 11;
}
function isMidday(hour: number): boolean {
  return hour >= 11 && hour < 17;
}
function isEvening(hour: number): boolean {
  return hour >= 17 && hour < 21;
}
function isDaylight(hour: number): boolean {
  return hour >= 6 && hour < 19;
}

/**
 * The repertoire of a figure: its favourite, and two more from the 3D table.
 *
 * A figure whose favourite is `none` has no favourite, and three extras. The
 * extras are drawn once per agent, from `rngFor(id, 'leisure-extra')`, so a
 * figure keeps its small set all afternoon.
 */
export function repertoireFor(id: string, favourite: IdleActivity): LeisureKind[] {
  const rng = rngFor(id, EXTRA_CHANNEL);
  const pool: LeisureKind[] = LEISURE_KINDS.filter((kind) => kind !== favourite);
  const extras = favourite === 'none' ? 3 : 2;
  const out: LeisureKind[] = favourite === 'none' ? [] : [favourite];
  for (let i = 0; i < extras && pool.length > 0; i += 1) {
    const at = Math.floor(rng() * pool.length);
    out.push(pool.splice(at, 1)[0]);
  }
  return out;
}

/** The weight of one activity now. Zero means it cannot be chosen. */
export function weightOf(kind: LeisureKind, spec: Pick<CharacterSpec, 'idleActivity'>, ctx: LeisureContext): number {
  const h = ctx.hour;
  const rain = ctx.weather === 'rain';
  let w = kind === spec.idleActivity ? 3 : 1;
  switch (kind) {
    case 'chat':
      if (!ctx.neighbour) return 0;
      break;
    case 'cat':
      if (!ctx.catNear) return 0;
      w *= 4;
      break;
    case 'watch':
      if (!ctx.swimmers) return 0;
      w *= 2;
      break;
    case 'sunbathe':
      if (!isDaylight(h) || rain) return 0;
      if (isMidday(h)) w *= 1.5;
      break;
    case 'fan':
      if (!isDaylight(h) || rain) return 0;
      if (isMidday(h)) w *= 3;
      break;
    case 'lemonade':
      if (isMidday(h)) w *= 3;
      break;
    case 'tea':
    case 'newspaper':
      if (isMorning(h)) w *= 2;
      break;
    case 'crossword':
      if (isMorning(h)) w *= 3;
      if (isEvening(h)) w *= 2;
      break;
    case 'phone':
    case 'laptop':
      if (isEvening(h)) w *= 2;
      break;
    case 'music':
      if (isEvening(h)) w *= 2;
      w *= 1 + ctx.fatigue;
      break;
    case 'nap': {
      // Night is the rest of the day, and a long idle makes a nap likelier.
      if (h >= 21 || h < 6) w *= 3;
      if (ctx.idleFor >= NAP_LONG_AFTER_S) w *= 6;
      else if (ctx.idleFor >= NAP_AFTER_S) w *= 3;
      w *= 1 + 2 * ctx.fatigue;
      break;
    }
    default:
      break;
  }
  return w;
}

/**
 * The activity the figure takes next, or null when it lies still for a while.
 *
 * - Just finished (out of the water in the last minute): a stretch first, then
 *   a drink (tea, or lemonade at midday).
 * - Otherwise a weighted choice from the repertoire. The one just done is not
 *   chosen again, unless nothing else can be.
 * - A figure whose favourite is `none` sometimes lies still instead.
 */
export function chooseLeisure(
  spec: Pick<CharacterSpec, 'idleActivity'>,
  ctx: LeisureContext,
  rng: () => number,
): LeisureKind | null {
  if (ctx.justFinished) {
    if (ctx.last === 'stretch') return isMidday(ctx.hour) && rng() < 0.5 ? 'lemonade' : 'tea';
    if (ctx.last !== null && DRINKS.includes(ctx.last)) {
      // A drink already had: the figure goes on with the ordinary choice.
    } else {
      return 'stretch';
    }
  }
  if (spec.idleActivity === 'none' && rng() < REST_CHANCE) return null;

  const repertoire = repertoireFor(ctx.id, spec.idleActivity);
  let options: [LeisureKind, number][] = [];
  for (const kind of repertoire) {
    const w = weightOf(kind, spec, ctx);
    if (w > 0) options.push([kind, w]);
  }
  const others = options.filter(([kind]) => kind !== ctx.last);
  if (others.length > 0) options = others;
  if (options.length === 0) return 'stretch';

  let total = 0;
  for (const [, w] of options) total += w;
  let pick = rng() * total;
  for (const [kind, w] of options) {
    pick -= w;
    if (pick < 0) return kind;
  }
  return options[options.length - 1][0];
}

/** How long the activity lasts, in seconds, drawn from the figure's stream. */
export function durationOf(kind: LeisureKind, rng: () => number): number {
  const [a, b] = SECONDS[kind];
  return a + (b - a) * rng();
}

/**
 * The lying still between two activities, in seconds: 10 to 40, and longer
 * the longer the agent has been idle (up to twice as long at half an hour).
 * A figure whose favourite is `none` rests twice as long.
 */
export function gapAfter(spec: Pick<CharacterSpec, 'idleActivity'>, idleFor: number, rng: () => number): number {
  const idle = Math.min(1, Math.max(0, idleFor) / NAP_LONG_AFTER_S);
  const rest = spec.idleActivity === 'none' ? 2 : 1;
  return (10 + 30 * rng()) * (1 + idle) * rest;
}

/** What the card says a figure is doing on its lounger (Sprint 29.7). */
const RESTING_NAMES: Record<LeisureKind, string> = {
  tea: 'tea',
  book: 'reading',
  phone: 'phone',
  call: 'on a call',
  sunbathe: 'sunbathing',
  nap: 'asleep',
  stretch: 'stretching',
  snack: 'ice lolly',
  chat: 'chatting',
  newspaper: 'newspaper',
  cards: 'cards',
  laptop: 'laptop',
  music: 'music',
  fan: 'fanning',
  lemonade: 'lemonade',
  crossword: 'crossword',
  watch: 'watching the pool',
  cat: 'with the cat',
};

/**
 * The line of the card for a figure that rests: `asleep (N min idle)` for a
 * nap, the activity's name otherwise, and `lounging` between activities.
 */
export function restingLine(kind: LeisureKind | null, idleS: number): string {
  if (kind === 'nap') return `asleep (${Math.max(0, Math.floor(idleS / 60))} min idle)`;
  return kind === null ? 'lounging' : RESTING_NAMES[kind];
}

/** The sun's height, 0 (night, or the day's ends) to 1 (midday), from the hour. */
export function sunFor(hour: number): number {
  if (!isDaylight(hour)) return 0;
  return Math.sin((Math.PI * (hour - 6)) / 13);
}
