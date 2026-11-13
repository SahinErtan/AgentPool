/**
 * The keyboard of the agent list.
 *
 * The list is the accessible twin of the pool: somebody who cannot use a
 * mouse works the very same rows with the arrow keys. All of the arithmetic
 * lives here, in pure functions, so that it can be tested without a browser
 * and so that the component only has to apply the result.
 */

/** What a key asks the panel to do. */
export type KeyAction = 'move' | 'open' | 'close' | 'none';

/** The keys that walk along the list. */
const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End']);

/** The keys that put the focus into the inspector. */
const OPEN_KEYS = new Set(['Enter', ' ']);

/**
 * What the key wants.
 *
 * `move` walks the list, `open` puts the focus into the inspector, `close`
 * takes it back out again, and `none` means the key is none of our business.
 */
export function keyAction(key: string): KeyAction {
  if (MOVE_KEYS.has(key)) return 'move';
  if (OPEN_KEYS.has(key)) return 'open';
  if (key === 'Escape') return 'close';
  return 'none';
}

/**
 * The row the list should be on after the key.
 *
 * The movement is clamped at the ends: the arrow keys do not wrap around, so
 * that holding one of them does not fly through the whole list. A key that
 * is not ours leaves the selection alone, and Escape clears it — that is
 * the way the inspector is closed.
 */
export function nextSelection(
  ids: string[],
  current: string | null,
  key: string,
): string | null {
  if (key === 'Escape') return null;
  if (keyAction(key) === 'none') return current;
  // Nothing to walk through: there is no row to land on.
  if (ids.length === 0) return null;
  if (key === 'Home') return ids[0];
  if (key === 'End') return ids[ids.length - 1];
  if (OPEN_KEYS.has(key)) {
    // Enter opens the row the cursor is on, and nothing else.
    return current !== null && ids.includes(current) ? current : null;
  }

  const index = current === null ? -1 : ids.indexOf(current);
  if (key === 'ArrowDown') {
    // From nowhere, the cursor starts at the top of the list.
    if (index < 0) return ids[0];
    return ids[Math.min(index + 1, ids.length - 1)];
  }
  if (key === 'ArrowUp') {
    // From nowhere, the cursor starts at the bottom, so that the arrow
    // always moves towards the list.
    if (index < 0) return ids[ids.length - 1];
    return ids[Math.max(index - 1, 0)];
  }
  return current;
}
