/** The wire model shared with the backend. */

export type AgentKind = 'session' | 'subagent' | 'mcp' | 'workflow';

/**
 * How the dashboard is talking to the backend.
 *
 * The store keeps the same union next to its own state; it is repeated here
 * so the net layer does not have to import the state layer to name a state.
 */
export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

export type AgentStatus = 'idle' | 'working' | 'finished' | 'leaving' | 'removed';

export type SceneMode =
  | 'swim'
  | 'lounge'
  | 'exiting'
  | 'leaving'
  | 'waiting'
  | 'offscreen'
  | 'entering'
  | 'walking';

export interface AgentPresentation {
  mode: SceneMode;
  slot: string | null;
  props: Record<string, unknown>;
}

/** One thing that happened to an agent, as the backend remembers it. */
export interface AgentEventView {
  ts: number;
  type: string;
  tool: string | null;
  detail: string | null;
}

export interface AgentView {
  id: string;
  kind: AgentKind;
  status: AgentStatus;
  label: string;
  session_id: string | null;
  parent_id: string | null;
  tool_use_id: string | null;
  subagent_type: string | null;
  tool_name: string | null;
  detail: string | null;
  cwd: string | null;
  created_at: number;
  last_event_at: number;
  started_at: number | null;
  finished_at: number | null;
  event_count: number;
  leaving_deadline: number | null;
  scene: string;
  presentation: AgentPresentation;
  /** The last few things that happened to this agent. */
  events?: AgentEventView[];
  /*
   * Sprint 28. Every field below is optional: a backend from before the
   * sprint does not send them, and the frontend then works from `label`
   * and `cwd`. The naming rule is in `scene/names.ts`.
   */
  /** The name the backend chose for the agent, without the duplicate handling. */
  name?: string | null;
  /** The last folder of the agent's working directory. */
  project?: string | null;
  /** The task a subagent or a workflow was given, in full. */
  description?: string | null;
  /** The last prompt of the session, in markdown. */
  prompt?: string | null;
  /** What the agent is doing right now, in a few words: "Bash: npm test". */
  activity?: string | null;
  /**
   * The name of the session the agent belongs to. The backend remembers it
   * after the session's own character has left, so a background subagent
   * still says whose it is.
   */
  session_name?: string | null;
  /** The model the agent runs on, as the backend names it. */
  model?: string | null;
  /** The reasoning effort the agent works at: "medium", "high". */
  effort?: string | null;
  /** The tokens of the last turn: the context that was sent. */
  tokens_in?: number | null;
  /** The tokens of the last turn: what came out. */
  tokens_out?: number | null;
  /** The tokens the agent has used in all. */
  tokens_total?: number | null;
}

export interface SessionEventView {
  event_id: string;
  ts: number;
  type: string;
  session_id: string;
  detail: string | null;
  source: string;
}

export type ServerFrame =
  | {
      type: 'snapshot';
      scene: string;
      ts: number;
      agents: AgentView[];
      scene_payload?: unknown;
    }
  | {
      type: 'agent_upsert';
      ts?: number;
      agents: AgentView[];
      /** The scene description, which changes when the pool grows. */
      scene_payload?: unknown;
    }
  | {
      type: 'agent_remove';
      ts?: number;
      agent_id?: string;
      agent_ids?: string[];
      /** The scene description, when the pool shrank with the agents. */
      scene_payload?: Record<string, unknown>;
    }
  | { type: 'session_event'; ts?: number; event: SessionEventView }
  | { type: 'scene'; ts?: number; scene: string; payload: unknown }
  | { type: 'pong'; ts: number };
