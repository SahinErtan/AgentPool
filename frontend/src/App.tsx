import { useEffect } from 'react';
import { connectAgentSocket } from './net/ws';
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
      <AgentList />
    </div>
  );
}
