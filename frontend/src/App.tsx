import { useEffect, useRef } from 'react';
import { connectAgentSocket } from './net/ws';
import { PoolCanvas } from './scene/pool/PoolCanvas';
import { searchWithAgent, store } from './state/store';
import { useStore } from './state/useStore';
import { AgentList } from './ui/AgentList';
import { Inspector } from './ui/Inspector';
import { Legend } from './ui/Legend';
import { Summary } from './ui/Summary';
import { Toast } from './ui/Toast';
import { TopBar } from './ui/TopBar';

export function App() {
  const { connected, selectedId, agents, pendingAgentId } = useStore();
  const wasConnected = useRef<boolean | null>(null);

  useEffect(() => {
    const socket = connectAgentSocket();
    return () => socket.close();
  }, []);

  // Say it when the dashboard loses the backend, and when it gets it back.
  useEffect(() => {
    if (wasConnected.current === null) {
      wasConnected.current = connected;
      return;
    }
    if (wasConnected.current === connected) return;
    wasConnected.current = connected;
    if (connected) {
      store.pushToast('The pool is back online.');
    } else {
      store.pushToast('Lost the backend — the agents keep swimming.', 'warn');
    }
  }, [connected]);

  // A link to an agent: ?agent=<id>. The agent may not be in the pool yet,
  // so the link waits until it shows up. An id that never shows up simply
  // leaves the dashboard with nothing selected.
  useEffect(() => {
    if (!pendingAgentId) return;
    if (!agents.has(pendingAgentId)) return;
    store.select(pendingAgentId);
  }, [agents, pendingAgentId]);

  // The address bar follows the selection, so that an agent can be
  // bookmarked or sent to somebody else. A link that is still waiting for
  // its agent is left alone until it is resolved.
  useEffect(() => {
    if (pendingAgentId) return;
    const search = searchWithAgent(window.location.search, selectedId);
    const now = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const next = `${window.location.pathname}${search}${window.location.hash}`;
    if (now === next) return;
    window.history.replaceState(null, '', next);
  }, [selectedId, pendingAgentId]);

  return (
    <div className={`app ${selectedId ? 'app--inspecting' : ''}`}>
      <TopBar />
      <main className="stage">
        {/* The picture is the list in another shape, so the list is its
            alternative: this says so, and hides the canvas from the
            screen readers. */}
        <div
          className="pool-canvas-wrap"
          role="img"
          aria-label="The pool: a drawing of the agents at work. The agent list has the same information in text."
        >
          <PoolCanvas />
        </div>
        <div className="stage__overlay">
          <Summary />
          <Legend />
          <AgentList />
          <Inspector />
        </div>
      </main>
      <Toast />
    </div>
  );
}
