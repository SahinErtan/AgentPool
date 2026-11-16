/**
 * The order of the agent list, grouped by session (Sprint 28, step 28.9).
 *
 * A session's row comes first and its subagents and workflows are listed
 * under it, indented. A subagent whose session has left the pool — a
 * session that ended its turn while its background subagents work on — is
 * listed under a heading with the session's name, which the backend
 * remembers. Anything else whose session is unknown goes under "Other".
 * When there is no session to group by at all, the list is flat, as it was
 * before the grouping. Pure, so the order is checked without a browser.
 */

import type { AgentView } from '../net/types';
import { specFor } from '../scene/characters/spec';

export type ListItem =
  | { kind: 'agent'; agent: AgentView; depth: 0 | 1 }
  | { kind: 'heading'; text: string };

/** The heading of the agents whose session is not in the list. */
export const OTHER_HEADING = 'Other';

function byCreation(a: AgentView, b: AgentView): number {
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The rows of the list, in the order they are shown and walked with the keys. */
export function arrangeAgents(list: AgentView[]): ListItem[] {
  const sessions = list.filter((agent) => agent.kind === 'session').sort(byCreation);
  const remembered = list.some((agent) => agent.kind !== 'session' && agent.session_name?.trim());
  if (sessions.length === 0 && !remembered) {
    return [...list]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((agent) => ({ kind: 'agent' as const, agent, depth: 0 as const }));
  }

  const sessionIds = new Set(sessions.map((session) => session.id));
  const children = new Map<string, AgentView[]>();
  const orphans: AgentView[] = [];
  for (const agent of list) {
    if (agent.kind === 'session') continue;
    if (agent.parent_id && sessionIds.has(agent.parent_id)) {
      const group = children.get(agent.parent_id);
      if (group) group.push(agent);
      else children.set(agent.parent_id, [agent]);
    } else {
      orphans.push(agent);
    }
  }

  const items: ListItem[] = [];
  for (const session of sessions) {
    items.push({ kind: 'agent', agent: session, depth: 0 });
    for (const child of (children.get(session.id) ?? []).sort(byCreation)) {
      items.push({ kind: 'agent', agent: child, depth: 1 });
    }
  }
  // The subagents of a session that has left, under that session's name.
  const departed = new Map<string, AgentView[]>();
  const others: AgentView[] = [];
  for (const agent of orphans.sort(byCreation)) {
    const name = agent.session_name?.trim();
    if (!name) {
      others.push(agent);
      continue;
    }
    const key = agent.session_id ?? name;
    const group = departed.get(key);
    if (group) group.push(agent);
    else departed.set(key, [agent]);
  }
  for (const group of departed.values()) {
    items.push({ kind: 'heading', text: group[0].session_name!.trim() });
    for (const agent of group) items.push({ kind: 'agent', agent, depth: 1 });
  }
  if (others.length > 0) {
    items.push({ kind: 'heading', text: OTHER_HEADING });
    for (const agent of others) items.push({ kind: 'agent', agent, depth: 0 });
  }
  return items;
}

const suits = new Map<string, string>();

/**
 * The colour of the family an agent belongs to, for the dot in its row: a
 * session's own suit, a subagent's parent suit. It is the colour the pool
 * gives the same agent, so the list and the pool agree.
 */
export function familyColour(agent: AgentView): string | null {
  if (agent.kind === 'session') return suitOf(agent.id, 'session');
  if (agent.kind === 'subagent' && agent.parent_id) {
    const role = agent.parent_id.startsWith('session:') ? 'session' : 'subagent';
    return suitOf(agent.parent_id, role);
  }
  return null;
}

function suitOf(id: string, role: 'session' | 'subagent'): string {
  const key = `${role}|${id}`;
  let suit = suits.get(key);
  if (suit === undefined) {
    suit = specFor(id, role).suit;
    suits.set(key, suit);
  }
  return suit;
}
