import { useStore } from '../state/useStore';

export function TopBar() {
  const { connected, scene, agents } = useStore();
  const working = [...agents.values()].filter((a) => a.status === 'working').length;

  return (
    <header className="topbar">
      <span className="topbar__brand">AgentPool</span>
      <span className={`topbar__dot ${connected ? 'is-on' : 'is-off'}`} />
      <span className="topbar__status">{connected ? 'connected' : 'reconnecting…'}</span>
      <span className="topbar__scene">scene: {scene}</span>
      <span className="topbar__counts">
        {working} working / {agents.size} total
      </span>
    </header>
  );
}
