import { store } from '../state/store';
import { useStore } from '../state/useStore';

const KIND_MARK: Record<string, string> = {
  session: '◆',
  subagent: '●',
  mcp: '■',
  workflow: '▲',
};

function elapsed(from: number | null): string {
  if (!from) return '—';
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - from));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function AgentList() {
  const { agents, selectedId } = useStore();
  const list = [...agents.values()].sort((a, b) => a.id.localeCompare(b.id));

  return (
    <aside className="agent-list">
      <h2>Agents</h2>
      {list.length === 0 ? <p className="empty">No agents yet.</p> : null}
      <ul>
        {list.map((agent) => (
          <li
            key={agent.id}
            className={`agent agent--${agent.status} ${agent.id === selectedId ? 'is-selected' : ''}`}
            onClick={() => store.select(agent.id === selectedId ? null : agent.id)}
          >
            <span className="agent__mark">{KIND_MARK[agent.kind] ?? '·'}</span>
            <span className="agent__label">{agent.label}</span>
            <span className="agent__status">{agent.status}</span>
            <span className="agent__slot">{agent.presentation.slot ?? '—'}</span>
            <span className="agent__time">{elapsed(agent.started_at ?? agent.created_at)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
