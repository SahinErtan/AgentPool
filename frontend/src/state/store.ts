/**
 * A tiny external store.
 *
 * The Pixi scene reads from it in its ticker, so React only re-renders for
 * the panels — the 60 fps path never touches React state.
 */

import type {
  AgentKind,
  AgentStatus,
  AgentView,
  ConnectionState,
  SessionEventView,
} from '../net/types';
import { fullName } from '../scene/names';

export type { ConnectionState };

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'warn';
}

/** Which agents the list shows. */
export type StatusFilter = 'all' | 'working' | 'idle' | 'done';
/** The kinds the list can show. An MCP server is not an agent any more (Sprint 28). */
export type KindFilter = 'all' | 'session' | 'subagent' | 'workflow';

export interface Filter {
  status: StatusFilter;
  kind: KindFilter;
}

/** What the panel remembers about an agent that is no longer there. */
export interface AgentMemory {
  status: AgentStatus;
  finishedAt: number | null;
  lastEventAt: number;
  /** The full name of the agent, so that it can still be named when it is gone. */
  name: string;
  kind: AgentKind;
}

/**
 * How the dashboard is talking to the backend.
 *
 * `connecting` is the first attempt, `reconnecting` is a live socket that
 * was lost and is being dialled again, `offline` is when the dashboard has
 * given up and is polling instead.
 */

export interface StoreState {
  connected: boolean;
  /** The finer state of the connection: the panel can say more than on/off. */
  connection: ConnectionState;
  scene: string;
  /** The scene's own description: how many lanes, how many loungers. */
  scenePayload: Record<string, unknown> | null;
  agents: Map<string, AgentView>;
  feed: SessionEventView[];
  selectedId: string | null;
  /**
   * The row of the list that the keyboard is on.
   *
   * It is the row that owns the Tab stop, and the row the focus goes back
   * to when the inspector closes. It survives the selection being cleared.
   */
  focusedId: string | null;
  /**
   * The agent a link points at, until it shows up in the pool.
   *
   * A deep link can arrive before the agent does, so the link waits here
   * instead of being thrown away.
   */
  pendingAgentId: string | null;
  /** Where the keyboard focus is asked to go: the list or the inspector. */
  focusTarget: 'list' | 'inspector' | null;
  /** Counts the focus requests, so the same target can be asked twice. */
  focusNonce: number;
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
  connection: 'connecting',
  scene: 'pool',
  scenePayload: null,
  agents: new Map(),
  feed: [],
  selectedId: null,
  focusedId: null,
  pendingAgentId: pendingAgentFromUrl(),
  focusTarget: null,
  focusNonce: 0,
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
    this.setConnection(connected ? 'live' : 'offline');
  },

  /** Say how the connection is doing, so the panel can tell the truth. */
  setConnection(connection: ConnectionState) {
    if (state.connection === connection) return;
    state = { ...state, connection, connected: connection === 'live' };
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
    // The agent has left the pool, so it is done — whatever the last
    // state we heard of it was. The memory is what the "done" filter
    // looks at, and it must not keep saying that the agent is working.
    const memory = new Map(state.memory);
    const entry = memory.get(agentId);
    if (entry && entry.status !== 'finished' && entry.status !== 'leaving') {
      memory.set(agentId, { ...entry, status: 'finished' });
    }
    state = { ...state, agents: map, memory, lastFrameAt: Date.now() };
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
    // The cursor follows the selection, but it stays where it is when the
    // selection is cleared: the row is still there to go back to.
    const focusedId = agentId ?? state.focusedId;
    if (
      state.selectedId === agentId &&
      state.focusedId === focusedId &&
      state.pendingAgentId === null
    ) {
      return;
    }
    state = {
      ...state,
      selectedId: agentId,
      focusedId,
      // A selection replaces the link that was waiting for an agent.
      pendingAgentId: null,
    };
    emit();
  },

  /** Move the keyboard cursor to another row. */
  setFocused(agentId: string | null) {
    if (state.focusedId === agentId) return;
    state = { ...state, focusedId: agentId };
    emit();
  },

  /** Remember the agent a link points at, until it shows up in the pool. */
  setPendingAgent(agentId: string | null) {
    if (state.pendingAgentId === agentId) return;
    state = { ...state, pendingAgentId: agentId };
    emit();
  },

  /** Ask for the keyboard focus to move somewhere. */
  requestFocus(target: 'list' | 'inspector') {
    state = { ...state, focusTarget: target, focusNonce: state.focusNonce + 1 };
    emit();
  },

  /** The focus request has been carried out. */
  clearFocusTarget() {
    if (state.focusTarget === null) return;
    state = { ...state, focusTarget: null };
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
      name: fullName(agent),
      kind: agent.kind,
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

/**
 * The deep link of an agent.
 *
 * The selection used to live only in the browser's memory, so an agent
 * could not be linked to, bookmarked or sent to somebody else. The agent
 * lives in the address bar instead, as `?agent=<id>`.
 */

/** The agent id in a query string, if there is one. */
export function agentFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('agent');
  return value ? value : null;
}

/**
 * The agent a link points at, read when the panel starts.
 *
 * The link is read before the very first render, so that the address bar
 * is not cleared before the agent it points at has had its chance to show
 * up in the pool.
 */
function pendingAgentFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return agentFromSearch(window.location.search);
}

/**
 * The query string with the agent in it — or without it.
 *
 * The id is escaped on the way out, so an id with a colon in it survives
 * the round trip through the address bar.
 */
export function searchWithAgent(search: string, agentId: string | null): string {
  const params = new URLSearchParams(search);
  if (agentId) params.set('agent', agentId);
  else params.delete('agent');
  const text = params.toString();
  return text ? `?${text}` : '';
}
