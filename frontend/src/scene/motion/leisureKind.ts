/**
 * What a figure does on its lounger, as the 3D pool names it.
 *
 * The spec only knows the eleven `IdleActivity` values. The
 * 3D lounger has seven more (Sprint 29). They are kept apart on purpose:
 * `ACTIVITY_TABLE` is what `specFor` draws from, and adding a kind to it
 * would change the look of every existing agent.
 */

import type { IdleActivity } from '../characters/spec';

/** The activities that exist only in 3D. */
export const NEW_LEISURE_KINDS = ['laptop', 'music', 'fan', 'lemonade', 'crossword', 'watch', 'cat'] as const;

export type NewLeisureKind = (typeof NEW_LEISURE_KINDS)[number];

/** Every activity a figure can do on a lounger in 3D. `none` is not one of them. */
export type LeisureKind = Exclude<IdleActivity, 'none'> | NewLeisureKind;

/** Every 3D activity, in the order the lab shows them. */
export const LEISURE_KINDS: readonly LeisureKind[] = [
  'tea', 'book', 'phone', 'sunbathe', 'nap', 'stretch', 'snack', 'chat', 'newspaper', 'cards', 'call',
  ...NEW_LEISURE_KINDS,
];
