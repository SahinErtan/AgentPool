import { useEffect, useMemo, useRef } from 'react';
import type { AgentView } from '../net/types';
import { store } from '../state/store';
import { useStore } from '../state/useStore';
import { cutAtWord, plainText } from '../scene/text';
import { agentNames, projectOf } from '../scene/names';
import { prettyModel, prettyTokens, prettyTurn } from '../scene/model';

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

export { cutAtWord, plainText } from '../scene/text';

/** How long the Detail of an agent may get before it is cut. */
const DETAIL_LIMIT = 160;

/**
 * Where the agent is: the presentation says so, but an agent that is on
 * its way out has no slot any more while its route still knows.
 */
function slotOf(agent: AgentView, props: Record<string, unknown>): string {
  const slot = agent.presentation?.slot;
  if (slot) return String(slot);
  const lounger = props.lounger;
  if (lounger !== null && lounger !== undefined) return `lounger:${lounger}`;
  const lane = props.lane;
  if (lane !== null && lane !== undefined) return `lane:${lane}`;
  const waiting = props.waiting;
  if (waiting !== null && waiting !== undefined) return `waiting:${waiting}`;
  return '—';
}

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="inspector__row" title={title}>
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
  const { agents, selectedId, focusTarget, focusNonce } = useStore();
  const agent = selectedId ? agents.get(selectedId) : null;
  const names = useMemo(() => agentNames([...agents.values()]), [agents]);
  const shown = agent ? names.get(agent.id) : undefined;
  const section = useRef<HTMLElement>(null);

  // The inspector takes the focus when it opens, so that the keyboard can
  // walk through the details of the agent.
  useEffect(() => {
    if (focusTarget !== 'inspector') return;
    const node = section.current;
    if (!node) return;
    node.focus();
    store.clearFocusTarget();
  }, [focusTarget, focusNonce, agent?.id]);

  // Escape closes the inspector and hands the focus back to the row it
  // came from.
  const close = () => {
    store.select(null);
    store.requestFocus('list');
  };

  if (!agent) {
    return (
      <section className="inspector inspector--empty">
        <p>Pick an agent to see its details.</p>
      </section>
    );
  }

  const props = agent.presentation.props;
  // The Detail of a session is the whole prompt, in markdown. It is cut
  // to a few lines here; the full text stays in the title of the row.
  const detailText = agent.detail ? plainText(agent.detail) : '';
  const name = shown?.short ?? agent.label;
  const project = projectOf(agent);
  const promptText = agent.prompt ? plainText(agent.prompt) : '';
  const description = agent.description ? agent.description.replace(/\s+/g, ' ').trim() : '';
  // The tokens of the last turn. A row that has no number in it is not
  // shown at all: an empty row says less than no row.
  const turn = prettyTurn(agent.tokens_in, agent.tokens_out);

  return (
    <section
      className="inspector"
      ref={section}
      tabIndex={-1}
      role="region"
      aria-label={`Details of ${name}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <header className="inspector__header">
        <div className="inspector__title">
          <h2 title={shown?.full ?? agent.label}>{name}</h2>
          <p className="inspector__sub">
            {agent.kind}
            {project ? ` · ${project}` : ''}
          </p>
        </div>
        <button
          type="button"
          className="inspector__close"
          onClick={close}
          aria-label="Close the inspector"
        >
          ×
        </button>
      </header>

      <div className="inspector__body">
        <Row label="Kind" value={agent.kind} />
        {agent.model ? (
          <Row label="Model" value={prettyModel(agent.model)} title={agent.model} />
        ) : null}
        {agent.effort ? <Row label="Effort" value={agent.effort} /> : null}
        {turn ? (
          <Row
            label="Tokens (last turn)"
            value={turn}
            title={
              agent.tokens_in !== null && agent.tokens_in !== undefined
                ? `${agent.tokens_in} in · ${agent.tokens_out ?? 0} out`
                : undefined
            }
          />
        ) : null}
        {agent.tokens_total ? (
          <Row
            label="Tokens used"
            value={prettyTokens(agent.tokens_total)}
            title={String(agent.tokens_total)}
          />
        ) : null}
        <Row label="Status" value={agent.status} />
        <Row label="Scene" value={agent.scene} />
        <Row label="Slot" value={slotOf(agent, props)} />
        <Row label="Project" value={project ?? '—'} />
        <Row label="Session" value={agent.session_id ?? '—'} />
        <Row label="Parent" value={agent.parent_id ?? '—'} />
        <Row label="Type" value={agent.subagent_type ?? agent.tool_name ?? '—'} />
        <Row label="Description" value={description ? cutAtWord(description, DETAIL_LIMIT) : '—'} title={description || undefined} />
        <Row label="Activity" value={agent.activity?.trim() || '—'} />
        <Row
          label="Last prompt"
          value={promptText ? cutAtWord(promptText, DETAIL_LIMIT) : '—'}
          title={promptText || undefined}
        />
        <Row
          label="Detail"
          value={detailText ? cutAtWord(detailText, DETAIL_LIMIT) : '—'}
          title={detailText || undefined}
        />
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

      <EventRing agent={agent} />
    </section>
  );
}

/**
 * What happened to this agent, most recent first.
 *
 * The backend remembers the last few events of every agent, with the tool
 * that was used. When there are none — an agent that was recovered from
 * the disk — the session's own feed is shown instead.
 */
function EventRing({ agent }: { agent: AgentView }) {
  const { feed } = useStore();

  const own = agent.events ?? [];
  const rows =
    own.length > 0
      ? own
          .slice()
          .reverse()
          .slice(0, 12)
          .map((event, index) => ({
            key: `${event.ts}-${index}`,
            type: event.type,
            tool: event.tool,
            detail: event.detail,
            ts: event.ts,
          }))
      : feed
          .filter((event) => (agent.session_id ? event.session_id === agent.session_id : false))
          .slice(0, 12)
          .map((event) => ({
            key: event.event_id,
            type: event.type,
            tool: null,
            detail: event.detail,
            ts: event.ts,
          }));

  if (rows.length === 0) {
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
        {rows.map((row) => (
          <li key={row.key}>
            <span className="inspector__event-type">{row.type}</span>
            {row.tool ? <span className="inspector__event-tool">{row.tool}</span> : null}
            <span className="inspector__event-detail">{row.detail ?? ''}</span>
            <span className="inspector__event-time">
              {new Date(row.ts * 1000).toLocaleTimeString()}
            </span>
          </li>
        ))}
      </ul>
      <p className="inspector__footnote">
        The id of this agent is <code>{agent.id}</code>.
      </p>
    </div>
  );
}
