import { useEffect, useRef, type KeyboardEvent } from 'react';
import { matches } from '../state/filter';
import type { AgentView } from '../net/types';
import { store, type KindFilter, type StatusFilter } from '../state/store';
import { useStore } from '../state/useStore';
import { keyAction, nextSelection } from './keyboard';
import { useTick } from './useTick';
import { spanDescription, workingSpan } from './timeline';
import { cutAtWord, plainText } from './Inspector';

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
// The rule itself lives with the state, because the scene dims the
// characters that the list hides.
export { matches };

/** How long the second line of a row may be: the panel is narrow. */
const ROW_TEXT_LIMIT = 40;

/**
 * A detail that is only a path is a folder, not a description.
 *
 * The path belongs to the "Folder" row of the inspector; as the second
 * line of a row it would tell nothing about the agent.
 */
function looksLikePath(text: string): boolean {
  return text.startsWith('/') || text.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(text);
}

/**
 * Which agent this is, in a few words.
 *
 * The label of a subagent is its kind, not its description: seven
 * subagents can all be called "general-purpose". The description is what
 * tells two of them apart, so it comes first. The tool says what the
 * agent did last and the slot says where it is; neither of them says
 * which agent it is, so they come after the description.
 */
export function rowDescription(agent: AgentView): string {
  const detail = agent.detail ? plainText(agent.detail) : '';
  if (detail && !looksLikePath(detail)) {
    return cutAtWord(detail, ROW_TEXT_LIMIT);
  }
  const withTool = (agent.events ?? []).filter((event) => event.tool);
  const lastTool = withTool.length > 0 ? withTool[withTool.length - 1].tool : agent.tool_name;
  if (lastTool) return lastTool;
  const slot = agent.presentation?.slot;
  if (slot) return String(slot);
  return '—';
}

/**
 * What a screen reader says for the row.
 *
 * It has to say which agent this is: the label alone is the kind of the
 * agent, and seven rows can share it.
 */
export function rowAccessibleName(agent: AgentView, now: number): string {
  return [
    agent.label,
    agent.status,
    rowDescription(agent),
    elapsed(agent.started_at ?? agent.created_at, now),
  ]
    .filter(Boolean)
    .join(', ');
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
  const {
    agents,
    memory,
    selectedId,
    hoveredId,
    filter,
    focusedId,
    focusTarget,
    focusNonce,
  } = useStore();
  const now = useTick(1000);
  const list = [...agents.values()]
    .filter((agent) => matches(agent, filter))
    .sort((a, b) => a.id.localeCompare(b.id));

  // The agents that are gone. A finished agent walks out of the scene and
  // the backend forgets it, but the panel remembers it for a while — and
  // the "done" filter is about those, not about an empty list.
  const gone =
    filter.status === 'done'
      ? [...memory.entries()]
          .filter(([, entry]) => entry.status === 'finished' || entry.status === 'leaving')
          .filter(([, entry]) => filter.kind === 'all' || entry.kind === filter.kind)
          .sort((a, b) => (b[1].finishedAt ?? 0) - (a[1].finishedAt ?? 0))
      : [];

  const ids = list.map((agent) => agent.id);
  // The row that owns the Tab stop: the one the keyboard was on last, or
  // the first row when that one is gone.
  const cursorId = focusedId !== null && ids.includes(focusedId) ? focusedId : ids[0] ?? null;

  const rows = useRef(new Map<string, HTMLLIElement>());

  // The inspector gives the focus back when it closes.
  useEffect(() => {
    if (focusTarget !== 'list' || cursorId === null) return;
    const row = rows.current.get(cursorId);
    if (!row) return;
    row.focus();
    store.clearFocusTarget();
  }, [focusTarget, focusNonce, cursorId]);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const action = keyAction(event.key);
    if (action === 'none') return;
    // The list is ours: the page must not scroll or move the focus away.
    event.preventDefault();
    event.stopPropagation();

    const next = nextSelection(ids, cursorId, event.key);

    if (action === 'move') {
      if (next === null) return;
      store.select(next);
      // The focus stays in the list, so that the arrow keys keep working.
      rows.current.get(next)?.focus();
      return;
    }

    if (action === 'open') {
      if (next === null) return;
      store.select(next);
      // Enter is the one key that puts the focus into the inspector: the
      // arrow keys have to keep it in the list, or the list cannot be
      // walked.
      store.requestFocus('inspector');
      return;
    }

    // Escape closes the inspector and hands the focus back to the row.
    store.select(null);
    store.requestFocus('list');
  };

  return (
    <aside className="agent-list">
      <h2 id="agent-list-heading">Agents</h2>

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

      {list.length === 0 && gone.length === 0 ? (
        <p className="empty">
          {agents.size === 0 ? 'No agents yet.' : 'Nothing matches the filter.'}
        </p>
      ) : null}

      <ul
        role="listbox"
        aria-labelledby="agent-list-heading"
        onKeyDown={onKeyDown}
      >
        {list.map((agent) => {
          const span = workingSpan(agent.started_at, agent.finished_at, now);
          const description = rowDescription(agent);
          return (
            <li
              key={agent.id}
              role="option"
              aria-selected={agent.id === selectedId}
              aria-label={rowAccessibleName(agent, now)}
              // The full detail stays reachable on hover: the second line
              // of the row is cut to fit the panel.
              title={agent.detail ? plainText(agent.detail) : undefined}
              // Only the row the keyboard is on is in the Tab order: that is
              // how a list is walked with the arrow keys.
              tabIndex={agent.id === cursorId ? 0 : -1}
              ref={(node) => {
                if (node) rows.current.set(agent.id, node);
                else rows.current.delete(agent.id);
              }}
              className={[
                'agent',
                `agent--${agent.status}`,
                agent.id === selectedId ? 'is-selected' : '',
                agent.id === hoveredId ? 'is-hovered' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                store.select(agent.id === selectedId ? null : agent.id);
                // The row that was clicked is the row the keyboard is on.
                store.setFocused(agent.id);
                rows.current.get(agent.id)?.focus();
              }}
            >
              <div className="agent__main">
                <span className="agent__mark" aria-hidden="true">
                  {KIND_MARK[agent.kind] ?? '·'}
                </span>
                <span className="agent__label">{agent.label}</span>
                <span className="agent__time">
                  {elapsed(agent.started_at ?? agent.created_at, now)}
                </span>
              </div>
              <div className="agent__meta">
                <span className="agent__status">{agent.status}</span>
                {/* The second line says which agent this is, not only
                    where it is. The class name is the old one; the
                    styles of it are not mine to change. */}
                <span className="agent__what">{description}</span>
              </div>
              {span ? (
                <div
                  className="agent__timeline"
                  title={spanDescription(agent.started_at, agent.finished_at, now)}
                  role="img"
                  aria-label={spanDescription(agent.started_at, agent.finished_at, now)}
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

        {/* The agents that have left the pool. They are not there to be
            picked, but they are what the "done" filter is about. */}
        {gone.map(([id, entry]) => (
          <li key={id} className="agent agent--gone" aria-disabled="true">
            <div className="agent__main">
              <span className="agent__mark" aria-hidden="true">
                {KIND_MARK[entry.kind] ?? '·'}
              </span>
              <span className="agent__label">{entry.label}</span>
              <span className="agent__time">
                {entry.finishedAt ? elapsed(entry.finishedAt, now) : ''}
              </span>
            </div>
            <div className="agent__meta">
              <span className="agent__status">{entry.status}</span>
              <span className="agent__what">left the pool</span>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
