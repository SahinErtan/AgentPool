/**
 * The moments of the pool: the things that happen to the agents, found by
 * comparing one snapshot of the agents with the one before.
 *
 * A moment is a small event in the pool: an agent finishes, reaches a round
 * number of events, or its session ends; the pool goes quiet, or wakes up,
 * or is busy. The scene decides what each one looks like. Here only the
 * detection lives, and it is pure, so the rules are checked in node.
 *
 * The first snapshot only fills the memory. A page that is reloaded with
 * agents already finished or already busy must not throw confetti for all
 * of them at once.
 */

import type { AgentStatus, AgentView } from '../../net/types';

export type Moment =
  | { kind: 'finished'; id: string }
  | { kind: 'milestone'; id: string; count: number }
  | { kind: 'sessionEnded'; id: string }
  /** No agent has been working for two minutes. */
  | { kind: 'quiet' }
  /** Six or more agents are working at once. */
  | { kind: 'busy' }
  /** The first agent to work again after a quiet spell. */
  | { kind: 'awake' };

/** What the detector remembers between two snapshots. */
export interface MomentMemory {
  /** The last status of each agent, by id. */
  status: Map<string, AgentStatus>;
  /** The last event count of each agent, by id. */
  events: Map<string, number>;
  /** The time since which nobody has been working, or null while somebody is. */
  quietSince: number | null;
  /** True once the quiet moment has been reported, until somebody works again. */
  quiet: boolean;
  /** The time of the last busy moment; minus infinity before the first. */
  lastBusyAt: number;
  /** False until the first snapshot has filled the memory. */
  primed: boolean;
}

export function createMomentMemory(): MomentMemory {
  return {
    status: new Map(),
    events: new Map(),
    quietSince: null,
    quiet: false,
    lastBusyAt: Number.NEGATIVE_INFINITY,
    primed: false,
  };
}

/** The statuses of a session that is on its way out of the pool. */
function isEnding(status: AgentStatus | undefined): boolean {
  return status === 'leaving' || status === 'removed';
}

/** The round numbers of events an agent is congratulated on. */
export const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000];
/** How long nobody may be working before the pool is quiet, in seconds. */
export const QUIET_AFTER_S = 120;
/** How many agents must work at once for the pool to be busy. */
export const BUSY_COUNT = 6;
/** The least time between two busy moments, in seconds. */
export const BUSY_GAP_S = 600;

/**
 * The moments between the last snapshot and this one. Updates the memory.
 *
 * @param now The scene's clock, in seconds. The quiet and busy rules are
 *   timed from it.
 */
export function detectMoments(agents: readonly AgentView[], now: number, memory: MomentMemory): Moment[] {
  const out: Moment[] = [];
  const present = new Set<string>();
  let working = 0;
  for (const agent of agents) {
    const id = agent.id;
    present.add(id);
    const before = memory.status.get(id);
    const count = memory.events.get(id);
    memory.status.set(id, agent.status);
    memory.events.set(id, agent.event_count);
    if (agent.status === 'working') working += 1;
    // An agent seen for the first time sets its values, and no moment.
    if (!memory.primed || before === undefined || count === undefined) continue;

    if (before !== agent.status) {
      if (agent.status === 'finished') {
        out.push({ kind: 'finished', id });
      } else if (agent.kind === 'session' && isEnding(agent.status) && !isEnding(before)) {
        // A session that is already leaving does not end twice when it is removed.
        out.push({ kind: 'sessionEnded', id });
      }
    }

    if (agent.event_count > count) {
      // Only the highest milestone crossed is reported: a jump from 90 to
      // 600 events is the 500, not the 100 and the 250 as well.
      let top = 0;
      for (const m of MILESTONES) {
        if (count < m && m <= agent.event_count) top = m;
      }
      if (top > 0) out.push({ kind: 'milestone', id, count: top });
    }
  }

  // An agent that has left the list is forgotten, so the memory does not grow.
  for (const id of [...memory.status.keys()]) {
    if (present.has(id)) continue;
    memory.status.delete(id);
    memory.events.delete(id);
  }

  if (working > 0) {
    memory.quietSince = null;
    if (memory.quiet) {
      memory.quiet = false;
      if (memory.primed) out.push({ kind: 'awake' });
    }
  } else {
    if (memory.quietSince === null) memory.quietSince = now;
    if (!memory.quiet && now - memory.quietSince >= QUIET_AFTER_S) {
      memory.quiet = true;
      out.push({ kind: 'quiet' });
    }
  }

  if (memory.primed && working >= BUSY_COUNT && now - memory.lastBusyAt >= BUSY_GAP_S) {
    memory.lastBusyAt = now;
    out.push({ kind: 'busy' });
  }

  memory.primed = true;
  return out;
}
