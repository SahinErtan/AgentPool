/** The wire model shared with the backend. */

export type AgentKind = 'session' | 'subagent' | 'mcp' | 'workflow';

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
  | { type: 'agent_remove'; ts?: number; agent_id: string }
  | { type: 'session_event'; ts?: number; event: SessionEventView }
  | { type: 'scene'; ts?: number; scene: string; payload: unknown }
  | { type: 'pong'; ts: number };
