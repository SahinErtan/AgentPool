/**
 * What the card under the pointer says about an agent (Sprint 28, step 28.8).
 *
 * The labels over the heads carry only the name. The card carries the rest:
 * what kind of agent it is, where it belongs, what it is doing and for how
 * long. Rows with nothing in them are left out. Pure: the caller passes the
 * clock and the names, so the card is checked here without a browser.
 */

import type { AgentView } from '../net/types';
import { projectOf, type AgentNames } from './names';
import { cutAtWord, plainText } from './text';

export interface CardLine {
  text: string;
  /** True for the line that says the session waits for the person. */
  attention: boolean;
}

export interface CardContent {
  /** The full name, uncut. */
  title: string;
  lines: CardLine[];
}

/** How long the last prompt may be on the card: about two lines. */
export const PROMPT_LIMIT = 100;

/** How long an agent has been doing what it does, in words. */
export function elapsedText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The kind of an agent, as the card names it: a subagent by its type. */
function kindOf(agent: AgentView): string {
  if (agent.kind === 'subagent') return agent.subagent_type?.trim() || 'subagent';
  return agent.kind;
}

/**
 * The card of an agent.
 *
 * @param names The agent's names; the title is its full name.
 * @param parentName The full name of the parent session, when it is on the screen.
 * @param nowS The clock, in seconds since the epoch, the same clock the agents use.
 * @param attention True when the session waits for the person.
 * @param resting What an idle agent does on its lounger, as `restingLine` says it (Sprint 29.7); null for none.
 */
export function cardContent(
  agent: AgentView,
  names: AgentNames | undefined,
  parentName: string | null,
  nowS: number,
  attention: boolean,
  resting: string | null = null,
): CardContent {
  const lines: CardLine[] = [];
  if (attention) lines.push({ text: 'needs you', attention: true });

  const project = projectOf(agent);
  lines.push({ text: project ? `${kindOf(agent)} · ${project}` : kindOf(agent), attention: false });

  const title = names?.full ?? agent.label;
  const description = agent.description?.replace(/\s+/g, ' ').trim();
  // When the description is the name, the title already said it.
  if (description && agent.kind !== 'session' && !title.startsWith(description)) {
    lines.push({ text: `in: ${description}`, attention: false });
  }
  if (parentName) lines.push({ text: `of: ${parentName}`, attention: false });

  // An agent that works but whose tool is not known yet (a backend that has
  // just started) says nothing here, rather than "idle" over "working".
  const activity = agent.activity?.trim();
  if (activity) lines.push({ text: `now: ${activity}`, attention: false });
  else if (agent.status === 'idle') lines.push({ text: 'now: idle', attention: false });
  // Only an agent that is not working rests on its lounger; a working one has no such line.
  if (resting !== null && agent.status !== 'working') lines.push({ text: `resting: ${resting}`, attention: false });

  const since = agent.started_at ?? agent.created_at;
  lines.push({ text: `${agent.status} for ${elapsedText(nowS - since)}`, attention: false });

  const prompt = agent.prompt ? plainText(agent.prompt) : '';
  if (prompt) lines.push({ text: `"${cutAtWord(prompt, PROMPT_LIMIT)}"`, attention: false });

  return { title, lines };
}
