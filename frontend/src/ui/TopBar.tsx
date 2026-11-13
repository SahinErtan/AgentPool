import { useStore } from '../state/useStore';

/**
 * The name of the pool, the connection and the scene.
 *
 * The counts of the agents are not here: the panel says them, and saying
 * them twice in two places is how two different numbers come to be shown.
 */
export function TopBar() {
  const { connected, connection, scene } = useStore();

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
    </header>
  );
}
