/**
 * The pool's weather and quiet rules: the rain's towel and lean, and the calm
 * that settles the water after two minutes with nobody working. Pure, so the
 * scene's decisions are checked without a browser (Sprint 26.6 and 26.7).
 */

/** The rain level above which it counts as raining. */
export const RAINING_ABOVE = 0.3;

export function isRaining(level: number): boolean {
  return level > RAINING_ABOVE;
}

// --- the rain: the lean and the towel -----------------------------------------

/** How far a walker leans forward in the rain, in radians. */
export const RAIN_LEAN = 0.15;

/** A walker that hurries in the rain leans forward; nothing else leans. */
export function rainLean(hurry: boolean, walking: boolean): number {
  return hurry && walking ? RAIN_LEAN : 0;
}

/** The prop a figure holds over its head, in the rain. */
export const COVER_PROP = 'towel' as const;

/** What the scene knows about a figure when it asks whether it should cover up. */
export interface CoverInputs {
  raining: boolean;
  lounging: boolean;
  onErrand: boolean;
  needsYou: boolean;
  inWater: boolean;
  inEntry: boolean;
  doingActivity: boolean;
  hasVariant: boolean;
}

/**
 * A figure on its lounger covers its head in the rain, unless it is on an
 * errand, doing an idle activity, in a lounge variant, or wanted by the person.
 */
export function wantsCover(s: CoverInputs): boolean {
  return (
    s.raining &&
    s.lounging &&
    !s.onErrand &&
    !s.needsYou &&
    !s.inWater &&
    !s.inEntry &&
    !s.doingActivity &&
    !s.hasVariant
  );
}

// --- the calm: after two minutes with nobody working --------------------------

/** The pool is calm after this many seconds with nobody working. */
export const CALM_AFTER_S = 120;
/** The calm and its end each take this many seconds to ease through. */
export const CALM_EASE_S = 10;
/** The waves, at full calm, are this fraction of their size. */
export const CALM_WAVES = 0.4;

/** The scene time an agent last worked: now, if one is working, else the old time. */
export function workedAt(lastWorkingAt: number, time: number, anyoneWorking: boolean): number {
  return anyoneWorking ? time : lastWorkingAt;
}

/** Whether the pool is calm after `quietFor` seconds with nobody working. */
export function isCalm(quietFor: number): boolean {
  return quietFor >= CALM_AFTER_S;
}

/**
 * Move the calm's progress (0 lively .. 1 calm) one frame towards the target,
 * linearly, so that it takes CALM_EASE_S seconds to get from one end to the other.
 */
export function stepCalm(progress: number, calm: boolean, dt: number): number {
  const target = calm ? 1 : 0;
  const step = dt / CALM_EASE_S;
  if (progress < target) return Math.min(target, progress + step);
  return Math.max(target, progress - step);
}

/** The eased amount of calm for a progress: smooth at both ends, 0 at 0 and 1 at 1. */
export function calmAmount(progress: number): number {
  const u = Math.min(1, Math.max(0, progress));
  return u * u * (3 - 2 * u);
}

/** The scale on the waves' size at a calm amount: 1 lively, CALM_WAVES at full calm. */
export function waveScale(amount: number): number {
  const a = Math.min(1, Math.max(0, amount));
  return 1 - (1 - CALM_WAVES) * a;
}
