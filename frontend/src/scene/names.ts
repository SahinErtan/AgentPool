/**
 * What each agent is called on the screen (Sprint 28).
 *
 * A name is chosen from the fields the backend sends, in a fixed order, and
 * the first one that exists wins. The backend's own `name` is only the first
 * candidate: the rule is applied here as well, so that an older backend, which
 * sends none of the new fields, still gets sensible names from `label`.
 *
 * The screen must never show two agents under one name, so when two names
 * collide the rule adds the shortest thing that tells them apart. The frontend
 * does this, not the backend, because only the frontend knows which agents are
 * on the screen together. Pure: no Three.js, no DOM, no clock.
 */

import type { AgentView } from '../net/types';

/** The longest name on the screen, in characters. */
export const MAX_NAME = 24;

/**
 * Words that are not a name. They are what the backend (and the hooks) write
 * when they know nothing better; they never win over a real name.
 */
const PLACEHOLDERS = new Set(['main', 'session', 'subagent', 'task', '']);

/** Whether a name is one of the placeholders. */
export function isPlaceholder(text: string | null | undefined): boolean {
  return PLACEHOLDERS.has((text ?? '').replace(/\s+/g, ' ').trim().toLowerCase());
}

/**
 * A text with its whitespace collapsed and cut to `max` characters.
 *
 * It is cut at a word boundary and an ellipsis says that something is
 * missing. A single word with no boundary inside the limit is cut in the
 * middle, because a longer name would break the panel.
 */
export function tidyName(text: string, max: number = MAX_NAME): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  if (space > 0) return `${head.slice(0, space).trimEnd()}…`;
  return `${head}…`;
}

/** The last folder of a working directory, or null when there is none. */
export function lastFolder(path: string | null | undefined): string | null {
  if (!path) return null;
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/** The project an agent works in: the backend's word, or the folder of its cwd. */
export function projectOf(agent: AgentView): string | null {
  const project = agent.project?.trim();
  if (project) return project;
  return lastFolder(agent.cwd);
}

/** The first candidate that is a real name, flattened. */
function firstName(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const flat = candidate.replace(/\s+/g, ' ').trim();
    if (flat && !isPlaceholder(flat)) return flat;
  }
  return null;
}

/** The session's id without its prefix, for the last fallback of a session. */
function sessionKey(agent: AgentView): string {
  return agent.session_id ?? agent.id.replace(/^session:/, '');
}

/**
 * The name of an agent before any duplicate handling, uncut.
 *
 * Session: its name on the disk, else the project, else `session ` and the
 * first four characters of its id.
 * Subagent: the description its parent gave it, else its type, else `subagent`.
 * Workflow: its description, else its name or type, else `task`.
 */
export function fullName(agent: AgentView): string {
  if (agent.kind === 'session') {
    return (
      firstName(agent.name, agent.label, projectOf(agent)) ??
      `session ${sessionKey(agent).slice(0, 4)}`
    );
  }
  if (agent.kind === 'subagent') {
    return firstName(agent.name, agent.description, agent.subagent_type, agent.label) ?? 'subagent';
  }
  return firstName(agent.name, agent.description, agent.subagent_type, agent.label) ?? 'task';
}

/**
 * The context a duplicate is told apart by: a session by its project, a
 * subagent or workflow by the name of its parent session. Empty when there
 * is none.
 */
function contextOf(agent: AgentView, parentName: string | null): string {
  if (agent.kind === 'session') {
    const project = projectOf(agent);
    return project ? ` · ${project}` : '';
  }
  return parentName ? ` · ${parentName}` : '';
}

/** Cut a text to `max` characters, with an ellipsis at the end when it is cut. */
function hardCut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * A name made of a base and a tail, that fits in `room` characters.
 *
 * The base keeps its own words as long as it can: the tail (the context) is
 * cut first, but never below half of the room, so that a long project does
 * not leave the base as a stub.
 */
function compose(base: string, tail: string, room: number): string {
  if (base.length + tail.length <= room) return base + tail;
  if (!tail) return tidyName(base, room);
  const keep = Math.min(base.length, Math.floor(room / 2));
  const tailText = tail.length > room - keep ? hardCut(tail, room - keep) : tail;
  return tidyName(base, room - tailText.length) + tailText;
}

/** The name with its number, when it is not the first: ` 2`, ` 3` and so on. */
function numbered(base: string, tail: string, number: number, max: number): string {
  if (number <= 1) return compose(base, tail, max);
  const suffix = ` ${number}`;
  return compose(base, tail, max - suffix.length) + suffix;
}

/** The two names an agent has: the short one for the screen and the full one for the card. */
export interface AgentNames {
  /** At most MAX_NAME characters: the label over the head, the list, the inspector. */
  short: string;
  /** Uncut, with the same distinguishing context: the card under the pointer. */
  full: string;
}

function byCreation(a: AgentView, b: AgentView): number {
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The names of a set of agents, by id.
 *
 * The rule, in order:
 * 1. Every agent gets its name from `fullName`.
 * 2. Agents that share a name are told apart by their context, but only when
 *    the context splits them: two sessions by project (`pool-sprint · AgentPool`),
 *    subagents by their parent (`Explore · pool-sprint`). If all of them have
 *    the same context, the context does not help and it is left out.
 * 3. Whatever still collides gets a number, in the order the agents were
 *    created. The oldest keeps the bare name, so a name does not change when
 *    a newer agent arrives (`Explore`, `Explore 2`, `Explore 3`).
 *
 * The result is unique: no two agents in `agents` have the same short name.
 */
export function agentNames(agents: AgentView[]): Map<string, AgentNames> {
  const ordered = [...agents].sort(byCreation);
  const byId = new Map<string, AgentView>();
  for (const agent of agents) byId.set(agent.id, agent);

  const full = new Map<string, string>();
  for (const agent of ordered) full.set(agent.id, fullName(agent));

  const parentNameOf = (agent: AgentView): string | null => {
    if (agent.kind === 'session' || !agent.parent_id) return null;
    const parent = byId.get(agent.parent_id);
    // A session that ended its turn has left the pool, but its background
    // subagents have not: the backend still knows the session's name.
    return parent ? full.get(parent.id) ?? null : agent.session_name?.trim() || null;
  };

  // The context of each agent, and the groups of agents that share a short base.
  const tails = new Map<string, string>();
  const groups = new Map<string, AgentView[]>();
  for (const agent of ordered) {
    tails.set(agent.id, contextOf(agent, parentNameOf(agent)));
    const key = tidyName(full.get(agent.id) ?? '');
    const group = groups.get(key);
    if (group) group.push(agent);
    else groups.set(key, [agent]);
  }
  for (const group of groups.values()) {
    // The context is only kept when it tells the members of a clash apart:
    // a name that nobody shares keeps its bare form.
    const contexts = new Set(group.map((agent) => tails.get(agent.id) ?? ''));
    if (group.length > 1 && contexts.size > 1) continue;
    for (const agent of group) tails.set(agent.id, '');
  }

  // The numbers, in the order the agents were created.
  const used = new Set<string>();
  const out = new Map<string, AgentNames>();
  for (const agent of ordered) {
    const base = full.get(agent.id) ?? '';
    const tail = tails.get(agent.id) ?? '';
    let number = 1;
    let short = numbered(base, tail, number, MAX_NAME);
    while (used.has(short)) {
      number += 1;
      short = numbered(base, tail, number, MAX_NAME);
    }
    used.add(short);
    out.set(agent.id, {
      short,
      full: numbered(base, tail, number, Number.POSITIVE_INFINITY),
    });
  }
  return out;
}

/** The short names only, by id: what the labels and the panels show. */
export function displayNames(agents: AgentView[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, names] of agentNames(agents)) out.set(id, names.short);
  return out;
}
