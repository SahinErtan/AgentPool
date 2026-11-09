/**
 * The WebSocket client.
 *
 * It reconnects with backoff, so a browser tab left open survives a backend
 * restart, and it asks for a fresh snapshot on every connect.
 */

import { store } from '../state/store';
import type { ServerFrame } from './types';

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;
const PING_INTERVAL_MS = 20_000;
const STALL_TIMEOUT_MS = 30_000;

export interface AgentSocket {
  close(): void;
}

export function connectAgentSocket(): AgentSocket {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let pingTimer: number | undefined;
  let stallTimer: number | undefined;
  let reconnectTimer: number | undefined;

  const clearTimers = () => {
    if (pingTimer !== undefined) window.clearInterval(pingTimer);
    if (stallTimer !== undefined) window.clearTimeout(stallTimer);
    pingTimer = undefined;
    stallTimer = undefined;
  };

  const armStallTimer = () => {
    if (stallTimer !== undefined) window.clearTimeout(stallTimer);
    stallTimer = window.setTimeout(() => {
      // The socket is alive but silent: drop it and reconnect.
      socket?.close();
    }, STALL_TIMEOUT_MS);
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
    attempt += 1;
    reconnectTimer = window.setTimeout(open, delay);
  };

  const handle = (frame: ServerFrame) => {
    armStallTimer();
    switch (frame.type) {
      case 'snapshot':
        store.setScene(frame.scene);
        store.setScenePayload((frame.scene_payload as Record<string, unknown>) ?? null);
        store.replaceAgents(frame.agents ?? []);
        break;
      case 'agent_upsert':
        store.upsertAgents(frame.agents ?? []);
        break;
      case 'agent_remove':
        store.removeAgent(frame.agent_id);
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
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socket.onopen = () => {
      attempt = 0;
      store.setConnected(true);
      armStallTimer();
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
      store.setConnected(false);
      clearTimers();
      scheduleReconnect();
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  open();

  return {
    close() {
      closed = true;
      clearTimers();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}

/** Tell the backend that a character has walked out through the gate. */
export function acknowledgeExit(agentId: string): void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'agent_exited', agent_id: agentId }));
    socket.close();
  };
}
