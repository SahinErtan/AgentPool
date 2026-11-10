import { useEffect, useRef } from 'react';
import { connectAgentSocket } from './net/ws';
import { PoolCanvas } from './scene/pool/PoolCanvas';
import { store } from './state/store';
import { useStore } from './state/useStore';
import { AgentList } from './ui/AgentList';
import { Inspector } from './ui/Inspector';
import { Legend } from './ui/Legend';
import { Summary } from './ui/Summary';
import { Toast } from './ui/Toast';
import { TopBar } from './ui/TopBar';

export function App() {
  const { connected, selectedId } = useStore();
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

  return (
    <div className={`app ${selectedId ? 'app--inspecting' : ''}`}>
      <TopBar />
      <main className="stage">
        <PoolCanvas />
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
