/**
 * What an agent is doing, read from the tool it uses, and whether its
 * session is waiting for the person.
 *
 * The backend says which tool an agent is running (`tool_name`) and the
 * session events say when a session asked the person something. This turns
 * both into a few words the pool can show: a swimmer that runs a command
 * sprints, a swimmer that asks for permission swims to the wall and raises
 * its hand. Pure: no Three.js, no clock of its own.
 */

import type { AgentView, SessionEventView } from '../../net/types';

export type WorkKind = 'run' | 'edit' | 'read' | 'web' | 'delegate' | 'plan' | 'other';

const RUN = new Set(['Bash', 'BashOutput', 'KillShell', 'KillBash', 'Monitor', 'TaskStop']);
const EDIT = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const READ = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch', 'LSP']);
const WEB = new Set(['WebSearch', 'WebFetch']);
const DELEGATE = new Set(['Agent', 'Task', 'Workflow', 'SendMessage']);
const PLAN = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion']);

/** The words in a tool name that make an MCP tool a web tool. */
const WEB_PATTERNS = ['browser', 'playwright', 'chrome', 'fetch', 'search'];

/**
 * How long the candidate kind has to be seen, without a break, before the
 * pool follows it. A swimmer that changed its stroke with every tool would
 * flicker.
 */
export const CANDIDATE_S = 2.5;
/** How long the shown kind has to be shown before it may change. */
export const MIN_SHOWN_S = 6;

/** How long a permission or a question may wait before it stops counting. */
const WAITING_WINDOW_S = 15 * 60;
/** How long an agent may work before its swimmer starts to tire, in seconds. */
const TIRED_AFTER_S = 30 * 60;
/** How much slower a swimmer that has worked for hours is, at most. */
const MAX_FATIGUE = 0.25;

/** The kind of work a tool does, from its name. */
export function toolKind(tool: string | null | undefined): WorkKind {
  if (!tool) return 'other';
  if (RUN.has(tool)) return 'run';
  if (EDIT.has(tool)) return 'edit';
  if (READ.has(tool)) return 'read';
  if (WEB.has(tool)) return 'web';
  if (DELEGATE.has(tool)) return 'delegate';
  if (PLAN.has(tool)) return 'plan';
  if (tool.startsWith('mcp__')) {
    const lower = tool.toLowerCase();
    if (WEB_PATTERNS.some((p) => lower.includes(p))) return 'web';
  }
  return 'other';
}

export interface WorkShown {
  kind: WorkKind;
  /** Seconds, when `kind` started being shown. */
  since: number;
  candidate: WorkKind;
  /** Seconds, when `candidate` was first seen without a break. */
  candidateSince: number;
}

export function initialWork(kind: WorkKind, now: number): WorkShown {
  return { kind, since: now, candidate: kind, candidateSince: now };
}

/**
 * Feed the latest kind; returns the kind to show.
 *
 * The candidate must have been seen without a break for CANDIDATE_S, and
 * the shown kind must have been shown for at least MIN_SHOWN_S.
 */
export function smoothWork(w: WorkShown, latest: WorkKind, now: number): WorkKind {
  if (latest !== w.candidate) {
    w.candidate = latest;
    w.candidateSince = now;
  }
  if (latest !== w.kind) {
    const candidateHeld = now - w.candidateSince >= CANDIDATE_S;
    const shownHeld = now - w.since >= MIN_SHOWN_S;
    if (candidateHeld && shownHeld) {
      w.kind = latest;
      w.since = now;
    }
  }
  return w.kind;
}

/**
 * True when the agent's session asked the person something that has not
 * been answered yet.
 *
 * A `permission` or `notification` session event for the agent's session
 * that is newer than the agent's last own event means the session is
 * waiting. Any later event of the agent means it was answered.
 */
export function needsYou(
  agent: Pick<AgentView, 'kind' | 'session_id' | 'last_event_at' | 'status'>,
  feed: readonly SessionEventView[],
  nowS: number,
): boolean {
  if (agent.kind !== 'session' || !agent.session_id) return false;
  if (agent.status === 'finished' || agent.status === 'leaving' || agent.status === 'removed') return false;
  // The newest question of this session; the feed is not sorted for us.
  let newest: SessionEventView | null = null;
  for (const event of feed) {
    if (event.session_id !== agent.session_id) continue;
    if (event.type !== 'permission' && event.type !== 'notification') continue;
    if (event.type === 'notification' && (event.detail ?? '').startsWith('agent_completed')) continue;
    if (newest === null || event.ts > newest.ts) newest = event;
  }
  if (newest === null) return false;
  return newest.ts > agent.last_event_at - 0.5 && nowS - newest.ts < WAITING_WINDOW_S;
}

/**
 * How much slower a swimmer is, after the agent has been working for
 * `workingS` seconds: none for the first half hour, then a little more
 * every four hours of work, up to a quarter.
 *
 * The number is a fraction of the speed the swimmer would otherwise have.
 */
export function fatigueAfter(workingS: number): number {
  const over = (workingS - TIRED_AFTER_S) / 60 / 240;
  return Math.min(MAX_FATIGUE, Math.max(0, over));
}
