import { store } from '../state/store';
import { useStore } from '../state/useStore';

function formatTime(seconds: number | null): string {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toLocaleTimeString();
}

function formatDuration(from: number | null, to: number | null): string {
  if (!from) return '—';
  const end = to ?? Date.now() / 1000;
  const seconds = Math.max(0, Math.round(end - from));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspector__row">
      <span className="inspector__key">{label}</span>
      <span className="inspector__value">{value}</span>
    </div>
  );
}

/**
 * The details of the selected agent.
 *
 * The scene is deliberately vague about what a character is doing, so this is
 * where the raw facts live: what the backend knows about the agent.
 */
export function Inspector() {
  const { agents, selectedId } = useStore();
  const agent = selectedId ? agents.get(selectedId) : null;

  if (!agent) {
    return (
      <section className="inspector inspector--empty">
        <p>Pick an agent to see its details.</p>
      </section>
    );
  }

  const props = agent.presentation.props;

  return (
    <section className="inspector">
      <header className="inspector__header">
        <h2>{agent.label}</h2>
        <button
          type="button"
          className="inspector__close"
          onClick={() => store.select(null)}
          aria-label="Close the inspector"
        >
          ×
        </button>
      </header>

      <div className="inspector__body">
        <Row label="Kind" value={agent.kind} />
        <Row label="Status" value={agent.status} />
        <Row label="Scene" value={agent.scene} />
        <Row label="Slot" value={agent.presentation.slot ?? '—'} />
        <Row label="Session" value={agent.session_id ?? '—'} />
        <Row label="Parent" value={agent.parent_id ?? '—'} />
        <Row label="Type" value={agent.subagent_type ?? agent.tool_name ?? '—'} />
        <Row label="Detail" value={agent.detail ?? '—'} />
        <Row label="Folder" value={agent.cwd ?? '—'} />
        <Row label="Route" value={String(props.route ?? '—')} />
        <Row label="From → to" value={`${props.from ?? '—'} → ${props.to ?? '—'}`} />
        <Row label="Started" value={formatTime(agent.started_at)} />
        <Row label="Finished" value={formatTime(agent.finished_at)} />
        <Row label="Duration" value={formatDuration(agent.started_at, agent.finished_at)} />
        <Row label="Tool use" value={agent.tool_use_id ?? '—'} />
        <Row label="Created" value={formatTime(agent.created_at)} />
        <Row label="Last event" value={formatTime(agent.last_event_at)} />
        <Row label="Leaves at" value={formatTime(agent.leaving_deadline)} />
        <Row label="Events" value={String(agent.event_count)} />
        <Row label="Id" value={agent.id} />
      </div>

      <EventRing agentId={agent.id} sessionId={agent.session_id} />
    </section>
  );
}

/**
 * What happened to this agent, most recent first.
 *
 * The backend keeps a feed of the session events; the ones that belong to
 * this agent are the ones that share its session.
 */
function EventRing({ agentId, sessionId }: { agentId: string; sessionId: string | null }) {
  const { feed } = useStore();
  const events = feed
    .filter((event) => (sessionId ? event.session_id === sessionId : false))
    .slice(0, 12);

  if (events.length === 0) {
    return (
      <div className="inspector__ring">
        <h3>Events</h3>
        <p className="inspector__empty">Nothing yet.</p>
      </div>
    );
  }

  return (
    <div className="inspector__ring">
      <h3>Events</h3>
      <ul>
        {events.map((event) => (
          <li key={event.event_id}>
            <span className="inspector__event-type">{event.type}</span>
            <span className="inspector__event-detail">{event.detail ?? ''}</span>
            <span className="inspector__event-time">
              {new Date(event.ts * 1000).toLocaleTimeString()}
            </span>
          </li>
        ))}
      </ul>
      <p className="inspector__footnote">
        The id of this agent is <code>{agentId}</code>.
      </p>
    </div>
  );
}
