import { useEffect } from 'react';
import { connectAgentSocket } from './net/ws';
import { PoolCanvas } from './scene/pool/PoolCanvas';
import { AgentList } from './ui/AgentList';
import { TopBar } from './ui/TopBar';

export function App() {
  useEffect(() => {
    const socket = connectAgentSocket();
    return () => socket.close();
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="stage">
        <PoolCanvas />
        <AgentList />
      </main>
    </div>
  );
}
