import type { AgentView } from '../net/types';
import { store, type Filter, type KindFilter, type StatusFilter } from '../state/store';
import { useStore } from '../state/useStore';
import { useTick } from './useTick';
import { workingSpan } from './timeline';

const KIND_MARK: Record<string, string> = {
  session: '◆',
  subagent: '●',
  mcp: '■',
  workflow: '▲',
};

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'working', label: 'Working' },
  { value: 'idle', label: 'Idle' },
  { value: 'done', label: 'Done' },
];

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'Every kind' },
  { value: 'session', label: 'Sessions' },
  { value: 'subagent', label: 'Subagents' },
  { value: 'mcp', label: 'MCP servers' },
  { value: 'workflow', label: 'Workflows' },
];

/** Whether an agent belongs in the list under the current filter. */
export function matches(agent: AgentView, filter: Filter): boolean {
  if (filter.status === 'working' && agent.status !== 'working') return false;
  if (filter.status === 'idle' && agent.status !== 'idle') return false;
  if (
    filter.status === 'done' &&
    agent.status !== 'finished' &&
    agent.status !== 'leaving'
  ) {
    return false;
  }
  if (filter.kind !== 'all' && agent.kind !== filter.kind) return false;
  return true;
}

function elapsed(from: number | null, now: number): string {
  if (!from) return '—';
  const seconds = Math.max(0, Math.round(now / 1000 - from));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function AgentList() {
  const { agents, selectedId, hoveredId, filter } = useStore();
  const now = useTick(1000);
  const list = [...agents.values()]
    .filter((agent) => matches(agent, filter))
    .sort((a, b) => a.id.localeCompare(b.id));

  return (
    <aside className="agent-list">
      <h2>Agents</h2>

      <div className="filters">
        <div className="filters__chips">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`chip ${filter.status === item.value ? 'is-on' : ''}`}
              aria-pressed={filter.status === item.value}
              onClick={() => store.setFilter({ status: item.value })}
            >
              {item.label}
            </button>
          ))}
        </div>
        <select
          className="filters__kind"
          value={filter.kind}
          aria-label="Filter by kind"
          onChange={(event) =>
            store.setFilter({ kind: event.target.value as KindFilter })
          }
        >
          {KIND_FILTERS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {list.length === 0 ? (
        <p className="empty">
          {agents.size === 0 ? 'No agents yet.' : 'Nothing matches the filter.'}
        </p>
      ) : null}

      <ul>
        {list.map((agent) => {
          const span = workingSpan(agent.started_at, agent.finished_at, now);
          return (
            <li
              key={agent.id}
              className={[
                'agent',
                `agent--${agent.status}`,
                agent.id === selectedId ? 'is-selected' : '',
                agent.id === hoveredId ? 'is-hovered' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => store.select(agent.id === selectedId ? null : agent.id)}
            >
              <div className="agent__main">
                <span className="agent__mark">{KIND_MARK[agent.kind] ?? '·'}</span>
                <span className="agent__label">{agent.label}</span>
                <span className="agent__time">
                  {elapsed(agent.started_at ?? agent.created_at, now)}
                </span>
              </div>
              <div className="agent__meta">
                <span className="agent__status">{agent.status}</span>
                <span className="agent__slot">{agent.presentation.slot ?? '—'}</span>
              </div>
              {span ? (
                <div
                  className="agent__timeline"
                  title="The last fifteen minutes"
                  aria-hidden="true"
                >
                  <div
                    className="agent__timeline-fill"
                    style={{ left: `${span.left}%`, width: `${span.width}%` }}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
