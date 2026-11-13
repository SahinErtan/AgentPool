/**
 * The filter of the agent list.
 *
 * The list holds everything; the filter is what makes it readable when
 * there are twenty agents in it. The scene uses the same rule, so that
 * the characters that the list hides are the characters that the pool
 * dims.
 */

import type { AgentView } from '../net/types';
import type { Filter } from './store';

export function matches(agent: AgentView, filter: Filter): boolean {
  if (filter.status === 'working' && agent.status !== 'working') return false;
  if (filter.status === 'idle' && agent.status !== 'idle') return false;
  if (
    filter.status === 'done' &&
    agent.status !== 'finished' &&
    agent.status !== 'leaving'
  ) {
    return false;
  }
  if (filter.kind !== 'all' && agent.kind !== filter.kind) return false;
  return true;
}
