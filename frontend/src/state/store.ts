/**
 * A tiny external store.
 *
 * The Pixi scene reads from it in its ticker, so React only re-renders for
 * the panels — the 60 fps path never touches React state.
 */

import type { AgentStatus, AgentView, SessionEventView } from '../net/types';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'warn';
}

/** Which agents the list shows. */
export type StatusFilter = 'all' | 'working' | 'idle' | 'done';
export type KindFilter = 'all' | 'session' | 'subagent' | 'mcp' | 'workflow';

export interface Filter {
  status: StatusFilter;
  kind: KindFilter;
}

/** What the panel remembers about an agent that is no longer there. */
export interface AgentMemory {
  status: AgentStatus;
  finishedAt: number | null;
  lastEventAt: number;
}

export interface StoreState {
  connected: boolean;
  scene: string;
  /** The scene's own description: how many lanes, how many loungers. */
  scenePayload: Record<string, unknown> | null;
  agents: Map<string, AgentView>;
  feed: SessionEventView[];
  selectedId: string | null;
  /** The agent the pointer is over in the scene. */
  hoveredId: string | null;
  /** What the list shows. */
  filter: Filter;
  /**
   * A short memory of the agents that have been here.
   *
   * A finished agent walks out of the scene and is gone, but the panel
   * still wants to say how many finished in the last five minutes. The
   * memory outlives the agent, and it is thrown away after a while.
   */
  memory: Map<string, AgentMemory>;
  toast: Toast | null;
  lastFrameAt: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();

let toastId = 0;

/** How long the memory of an agent is kept. */
const MEMORY_TTL_MS = 10 * 60 * 1000;

let state: StoreState = {
  connected: false,
  scene: 'pool',
  scenePayload: null,
  agents: new Map(),
  feed: [],
  selectedId: null,
  hoveredId: null,
  filter: { status: 'all', kind: 'all' },
  memory: new Map(),
  toast: null,
  lastFrameAt: 0,
};

function emit() {
  for (const listener of listeners) listener();
}

export const store = {
  get(): StoreState {
    return state;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  setConnected(connected: boolean) {
    if (state.connected === connected) return;
    state = { ...state, connected };
    emit();
  },

  setScene(scene: string) {
    if (state.scene === scene) return;
    state = { ...state, scene };
    emit();
  },

  setScenePayload(payload: Record<string, unknown> | null) {
    state = { ...state, scenePayload: payload };
    emit();
  },

  replaceAgents(agents: AgentView[]) {
    const map = new Map<string, AgentView>();
    for (const agent of agents) map.set(agent.id, agent);
    state = { ...state, agents: map, memory: remember(state.memory, agents), lastFrameAt: Date.now() };
    emit();
  },

  upsertAgents(agents: AgentView[]) {
    if (agents.length === 0) return;
    const map = new Map(state.agents);
    for (const agent of agents) map.set(agent.id, agent);
    state = { ...state, agents: map, memory: remember(state.memory, agents), lastFrameAt: Date.now() };
    emit();
  },

  removeAgent(agentId: string) {
    if (!state.agents.has(agentId)) return;
    const map = new Map(state.agents);
    map.delete(agentId);
    state = { ...state, agents: map, lastFrameAt: Date.now() };
    emit();
  },

  pushFeed(event: SessionEventView) {
    const feed = [event, ...state.feed].slice(0, 100);
    state = { ...state, feed, lastFrameAt: Date.now() };
    emit();
  },

  pushToast(message: string, kind: Toast['kind'] = 'info') {
    toastId += 1;
    state = { ...state, toast: { id: toastId, message, kind } };
    emit();
  },

  clearToast(id: number) {
    if (!state.toast || state.toast.id !== id) return;
    state = { ...state, toast: null };
    emit();
  },

  select(agentId: string | null) {
    if (state.selectedId === agentId) return;
    state = { ...state, selectedId: agentId };
    emit();
  },

  /** Remember which agent the pointer is over, so the list can follow it. */
  setHovered(agentId: string | null) {
    if (state.hoveredId === agentId) return;
    state = { ...state, hoveredId: agentId };
    emit();
  },

  /** Narrow the list down. */
  setFilter(filter: Partial<Filter>) {
    const next = { ...state.filter, ...filter };
    if (next.status === state.filter.status && next.kind === state.filter.kind) return;
    state = { ...state, filter: next };
    emit();
  },
};

/**
 * Remember what happened to the agents, and forget the old ones.
 *
 * The memory outlives the agent: a character that finished walks out of
 * the scene, but the panel still counts it for a few minutes.
 */
function remember(
  memory: Map<string, AgentMemory>,
  agents: AgentView[],
): Map<string, AgentMemory> {
  const next = new Map(memory);
  for (const agent of agents) {
    next.set(agent.id, {
      status: agent.status,
      finishedAt: agent.finished_at,
      lastEventAt: agent.last_event_at,
    });
  }

  const cutoff = Date.now() - MEMORY_TTL_MS;
  for (const [id, entry] of next) {
    if (Math.max(entry.lastEventAt * 1000, (entry.finishedAt ?? 0) * 1000) < cutoff) {
      next.delete(id);
    }
  }
  return next;
}
