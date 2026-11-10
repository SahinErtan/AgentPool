/**
 * A tiny external store.
 *
 * The Pixi scene reads from it in its ticker, so React only re-renders for
 * the panels — the 60 fps path never touches React state.
 */

import type { AgentView, SessionEventView } from '../net/types';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'warn';
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
  toast: Toast | null;
  lastFrameAt: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();

let toastId = 0;

let state: StoreState = {
  connected: false,
  scene: 'pool',
  scenePayload: null,
  agents: new Map(),
  feed: [],
  selectedId: null,
  hoveredId: null,
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
    state = { ...state, agents: map, lastFrameAt: Date.now() };
    emit();
  },

  upsertAgents(agents: AgentView[]) {
    if (agents.length === 0) return;
    const map = new Map(state.agents);
    for (const agent of agents) map.set(agent.id, agent);
    state = { ...state, agents: map, lastFrameAt: Date.now() };
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
};
