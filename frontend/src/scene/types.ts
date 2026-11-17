/**
 * What the page needs from the pool scene.
 *
 * The pool (Three.js) takes the agents from the store, follows the size of
 * its box and cleans up after itself.
 * Nothing else crosses: the hover and the selection go through the store.
 */

import type { AgentView } from '../net/types';

export interface PoolSceneLike {
  syncAgents(agents: AgentView[]): void;
  resize(width: number, height: number): void;
  destroy(): void;
}
