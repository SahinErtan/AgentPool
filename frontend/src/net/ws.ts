/**
 * The WebSocket client.
 *
 * The dashboard may sit open for hours, so the socket is allowed to die: the
 * backend restarts, a proxy eats the connection, the laptop sleeps. When
 * that happens the client reconnects with a backoff, tears down a socket
 * that has gone quiet, and - while there is no socket - polls the same state
 * over HTTP so the panel still moves.
 */

import { store } from '../state/store';
import { demoCount } from '../scene/demo/demoFeed';
import type { ConnectionState, ServerFrame } from './types';
import { Backoff, POLL_INTERVAL_MS, STALL_TIMEOUT_MS, StallDetector, shouldPoll } from './backoff';

/**
 * How often we ask the backend "are you still there?".
 *
 * The backend answers a ping with a pong, so this keeps the silence timer
 * fed while the pool is idle.
 */
const PING_INTERVAL_MS = 10_000;

/**
 * After this many failed attempts the dashboard says it is offline rather
 * than that it is reconnecting: the backend is not coming back right now.
 */
const OFFLINE_AFTER_ATTEMPTS = 3;

export interface AgentSocket {
  close(): void;
}

/**
 * The token, when the backend asks for one.
 *
 * The backend can be told to want a token (`AGENTPOOL_TOKEN`). The
 * dashboard is then opened with the token in the address, and it is passed
 * on in the query — a WebSocket cannot carry a header of its own.
 */
export function tokenFromSearch(search: string): string {
  const value = new URLSearchParams(search).get('token');
  return value && value.trim() ? value.trim() : '';
}

/** The address of the socket, with the token when there is one. */
export function socketUrl(host: string, path: string, token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${protocol}//${host}${path}${query}`;
}

/** The address of the state endpoint, with the token when there is one. */
export function stateUrl(token: string): string {
  return token ? `/api/state?token=${encodeURIComponent(token)}` : '/api/state';
}

export function connectAgentSocket(): AgentSocket {
  const token = tokenFromSearch(window.location.search);
  let socket: WebSocket | null = null;
  let closed = false;
  let connection: ConnectionState = 'connecting';
  let pingTimer: number | undefined;
  let stallTimer: number | undefined;
  let reconnectTimer: number | undefined;
  let pollTimer: number | undefined;
  let pollAbort: AbortController | null = null;
  let polling = false;

  const backoff = new Backoff();
  const stall = new StallDetector(STALL_TIMEOUT_MS);

  const setConnection = (next: ConnectionState) => {
    connection = next;
    // The store also keeps `connected` in step with the state.
    store.setConnection(next);
  };

  /** Whether the socket is carrying the state on its own. */
  const isLive = () => !shouldPoll(connection);

  const clearTimers = () => {
    if (pingTimer !== undefined) window.clearInterval(pingTimer);
    if (stallTimer !== undefined) window.clearTimeout(stallTimer);
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    pingTimer = undefined;
    stallTimer = undefined;
    reconnectTimer = undefined;
  };

  const armStallTimer = () => {
    if (stallTimer !== undefined) window.clearTimeout(stallTimer);
    stallTimer = window.setTimeout(() => {
      if (closed) return;
      if (!stall.isStalled()) {
        // Something arrived just in time; wait again.
        armStallTimer();
        return;
      }
      // The socket is alive but silent: drop it so the reconnect can happen.
      socket?.close();
    }, STALL_TIMEOUT_MS);
  };

  const stopPolling = () => {
    if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    pollTimer = undefined;
    pollAbort?.abort();
    pollAbort = null;
  };

  /** One slow poll of the same state the socket would have sent. */
  const poll = async () => {
    if (closed || isLive()) {
      pollTimer = undefined;
      polling = false;
      return;
    }
    polling = true;
    const controller = new AbortController();
    pollAbort = controller;
    try {
      const response = await fetch(stateUrl(token), {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (response.ok) {
        // The endpoint answers with the same snapshot frame the socket sends.
        handle(JSON.parse((await response.text()) || '{}') as ServerFrame);
      }
    } catch {
      // The backend is still down: the next poll will try again.
    } finally {
      pollAbort = null;
    }
    if (closed || isLive()) {
      pollTimer = undefined;
      polling = false;
      return;
    }
    pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS);
  };

  const startPolling = () => {
    if (polling || pollTimer !== undefined) return;
    poll();
  };

  const scheduleReconnect = () => {
    if (closed) return;
    setConnection(backoff.attempts >= OFFLINE_AFTER_ATTEMPTS ? 'offline' : 'reconnecting');
    const delay = backoff.next();
    reconnectTimer = window.setTimeout(open, delay);
  };

  const handle = (frame: ServerFrame) => {
    stall.markActivity();
    armStallTimer();
    switch (frame.type) {
      case 'snapshot':
        store.setScene(frame.scene);
        store.setScenePayload((frame.scene_payload as Record<string, unknown>) ?? null);
        store.replaceAgents(frame.agents ?? []);
        break;
      case 'agent_upsert':
        // The scene description comes with the agents: the pool may have
        // grown or shrunk.
        if (frame.scene_payload !== undefined) {
          store.setScenePayload((frame.scene_payload as Record<string, unknown>) ?? null);
        }
        store.upsertAgents(frame.agents ?? []);
        break;
      case 'agent_remove':
        // The backend removes one agent at a time, or a whole list of
        // them when the sweeper has expired some.
        if (frame.agent_id) store.removeAgent(frame.agent_id);
        for (const agentId of frame.agent_ids ?? []) store.removeAgent(agentId);
        // The pool may have shrunk with them: the number of loungers
        // travels with the removal.
        if (frame.scene_payload !== undefined) {
          store.setScenePayload((frame.scene_payload as Record<string, unknown>) ?? null);
        }
        break;
      case 'session_event':
        store.pushFeed(frame.event);
        break;
      case 'scene':
        store.setScene(frame.scene);
        break;
      default:
        break;
    }
  };

  const open = () => {
    if (closed) return;
    socket = new WebSocket(socketUrl(window.location.host, '/ws', token));

    socket.onopen = () => {
      backoff.reset();
      setConnection('live');
      stall.markActivity();
      armStallTimer();
      stopPolling();
      pingTimer = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    };

    socket.onmessage = (message) => {
      try {
        handle(JSON.parse(message.data as string) as ServerFrame);
      } catch {
        // A malformed frame must not kill the connection.
      }
    };

    socket.onclose = () => {
      clearTimers();
      if (closed) return;
      scheduleReconnect();
      // The socket is gone, so the panel falls back to the slow poll.
      startPolling();
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  setConnection('connecting');
  open();

  return {
    close() {
      closed = true;
      clearTimers();
      stopPolling();
      socket?.close();
      socket = null;
    },
  };
}

/** Tell the backend that a character has walked out through the gate. */
export function acknowledgeExit(agentId: string): void {
  // The demo crowd is not in the backend, so there is nobody to tell.
  if (demoCount(window.location.search) > 0) return;
  const token = tokenFromSearch(window.location.search);
  const socket = new WebSocket(socketUrl(window.location.host, '/ws', token));
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'agent_exited', agent_id: agentId }));
    socket.close();
  };
}
