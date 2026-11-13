import { useStore } from '../state/useStore';

export function TopBar() {
  const { connected, connection, scene, agents } = useStore();
  const working = [...agents.values()].filter((a) => a.status === 'working').length;

  // The connection has more than one way to be wrong, and the panel says
  // which one it is.
  const status =
    connection === 'live'
      ? 'connected'
      : connection === 'connecting'
        ? 'connecting…'
        : connection === 'reconnecting'
          ? 'reconnecting…'
          : 'offline';

  return (
    <header className="topbar">
      <span className="topbar__brand">AgentPool</span>
      <span className={`topbar__dot ${connected ? 'is-on' : 'is-off'}`} />
      <span className="topbar__status">{status}</span>
      <span className="topbar__scene">scene: {scene}</span>
      <span className="topbar__counts">
        {working} working / {agents.size} total
      </span>
    </header>
  );
}
