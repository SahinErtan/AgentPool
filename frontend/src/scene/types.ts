/**
 * What the page needs from a pool scene, whichever one it is.
 *
 * The 2D scene (PixiJS) and the 3D one (Three.js) both take the agents from
 * the store, follow the size of their box and clean up after themselves.
 * Nothing else crosses: the hover and the selection go through the store.
 */

import type { AgentView } from '../net/types';

export interface PoolSceneLike {
  syncAgents(agents: AgentView[]): void;
  resize(width: number, height: number): void;
  destroy(): void;
}
