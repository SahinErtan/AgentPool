/**
 * The scripted crowd (`?demo`).
 *
 * Every later sprint adds a behaviour that only shows when an agent is in a
 * particular state: running Bash, waiting for permission, finishing, being
 * a sub-agent. Waiting for real agents to do these things makes a change
 * impossible to check, so the demo feeds the store with fake agents that
 * behave as if a backend had sent them.
 *
 * The crowd is a pure function of its ids and of the clock, so the same
 * crowd turns up in every browser and in the tests. The only state is the
 * allocator's memory: which lane a swimmer took and which lounger an
 * idler is on, so that nobody is given a place that somebody else has.
 */

import { rngFor } from '../characters/spec';
import { store } from '../../state/store';
import type {
  AgentKind,
  AgentStatus,
  AgentView,
  AgentPresentation,
  SessionEventView,
} from '../../net/types';

export interface DemoHandle {
  close(): void;
}

/**
 * The number of lanes the demo pool has. The pool grows with the crowd: a
 * lane takes about six swimmers before they are on top of one another, so a
 * big crowd gets more lanes than a small one.
 */
export function demoLanes(n: number): number {
  if (n <= 20) return 4;
  if (n <= 40) return 6;
  return 8;
}

/**
 * The length of the demo pool. The pool grows with the crowd: a lane that is
 * too short for its swimmers has them on top of one another.
 */
export function demoLength(n: number): number {
  if (n <= 24) return 16;
  return 16 + (n - 24) * 0.7;
}

/** The number of lanes a pool of four holds, for the tests that want one. */
export const DEMO_LANES = 4;
/** The number of waiting spots at the edge of the pool. */
export const DEMO_WAITING = 4;
/** The most agents the demo will make. */
export const DEMO_MAX = 60;
/** How many agents there are when `?demo` is asked for without a number. */
export const DEMO_DEFAULT = 12;

/** The tools a working agent uses. */
const TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Edit',
  'Write',
  'Bash',
  'Bash',
  'WebSearch',
  'WebFetch',
  'Agent',
  'TodoWrite',
  'mcp__plugin_playwright_playwright__browser_click',
];

/** The kinds of sub-agent the demo has. */
const SUBAGENT_TYPES = ['Explore', 'Plan', 'general-purpose', 'code-improver'];

/**
 * The sessions of the demo, as a person would have them open: a name on the
 * disk, the project, and the last prompt. Two of them are called `pool-sprint`,
 * in two projects, so that the naming rule has a clash to tell apart.
 */
const SESSIONS: { name: string; project: string; prompt: string }[] = [
  { name: 'pool-sprint', project: 'AgentPool', prompt: 'check how far Sprint 21 got and what is still open' },
  { name: 'docs-pass', project: 'AgentPool', prompt: 'read the plans and tell me which step has no check' },
  { name: 'billing-api', project: 'shop-backend', prompt: 'why does the refund webhook retry twice' },
  { name: 'pool-sprint', project: 'forecast', prompt: 'the forecast page still shows yesterday, fix it' },
  { name: 'ci-fixes', project: 'shop-backend', prompt: 'make the pipeline green on main' },
  { name: 'mobile-app', project: 'shop-mobile', prompt: 'the login screen flickers on the second tap' },
  { name: 'release-notes', project: 'AgentPool', prompt: 'write the notes for the last three tags' },
  { name: 'auth-review', project: 'shop-backend', prompt: 'review the token refresh for races' },
  { name: 'deck-polish', project: 'slides', prompt: 'tighten the speaker notes on slides 4 to 9' },
  { name: 'data-import', project: 'etl-tools', prompt: 'the CSV import drops the last row' },
];

/** What the sub-agents were asked to do. */
const DESCRIPTIONS = [
  'Implement Sprint 21',
  'Check the lane tests',
  'Find the flaky test',
  'Review the naming table',
  'Trace the permission events',
  'Measure the frame budget',
  'Read the docs for the card',
  'Summarise the last release',
  'Fix the broken import',
  'Check the reduced motion path',
  'Port the lounge poses',
  'Write the migration notes',
];

/** What a working agent is doing, for each tool, in the words of the card (Sprint 28, step 28.4). */
const ACTIVITY: Record<string, string[]> = {
  Read: ['Read: names.ts', 'Read: overlay.ts'],
  Grep: ['Grep: displayNames', 'Grep: fullName'],
  Glob: ['Glob: src/**/*.tsx'],
  Edit: ['Edit: overlay.ts', 'Edit: AgentList.tsx'],
  Write: ['Write: card.ts'],
  Bash: ['Bash: npm test', 'Bash: npx tsc -b', 'Bash: git status'],
  WebSearch: ['WebSearch: naming rule'],
  WebFetch: ['WebFetch: developer.mozilla.org'],
  Agent: ['Agent: Implement Sprint 21'],
  TodoWrite: ['TodoWrite'],
  mcp__plugin_playwright_playwright__browser_click: ['playwright: browser_click'],
};

/** The sub-agents of this session that have no description: the demo's clash of plain names. */
const QUIET_SESSION = 1;
const QUIET_COUNT = 3;

/** How long a finished agent is on its way out, in seconds. */
const FINISHED_SECONDS = 8;
/** How long an agent walks out through the gate, in seconds. */
const LEAVING_SECONDS = 20;
/**
 * How many work-and-rest periods a session has before it ends.
 *
 * A session that never ends is a session that never walks out through the
 * gate, and the gate celebration - confetti by day, fireworks at night -
 * can never be seen in the demo. So the session works, rests, works again
 * and then ends; the next session walks in through the same gate.
 */
const SESSION_CYCLES = 2;

/**
 * The number of fake agents asked for by `?demo` or `?demo=N`, or 0.
 *
 * `?demo` gives the default crowd, `?demo=N` gives N of them, and a
 * missing parameter means no demo at all.
 */
export function demoCount(search: string): number {
  const params = new URLSearchParams(search);
  if (!params.has('demo')) return 0;
  const raw = params.get('demo');
  if (raw === null || raw.trim() === '') return DEMO_DEFAULT;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEMO_DEFAULT;
  return Math.max(1, Math.min(DEMO_MAX, n));
}

/** One place in the crowd. */
interface Slot {
  /** The id of the slot; a sub-agent adds its generation to it. */
  baseId: string;
  kind: AgentKind;
  /** The session this one belongs to, for a sub-agent. */
  parentId: string | null;
  /** The session this one belongs to, as the wire model wants it. */
  sessionId: string | null;
  subagentType: string | null;
  label: string;
  /** True when the slot is replaced by a new generation when its life ends. */
  churns: boolean;
  /** The name the backend gives the agent, as the wire model carries it. */
  name: string | null;
  project: string | null;
  description: string | null;
  prompt: string | null;
}

/** The timeline of one slot. */
interface Timeline {
  /** How long a working phase lasts. */
  workLen: number;
  /** How long an idle phase lasts. */
  idleLen: number;
  /** How long the second working phase of a sub-agent lasts. */
  workLen2: number;
  /** How long the same tool stays the same. */
  toolEvery: number;
  /** The length of one work-and-idle period. */
  period: number;
  /** The length of one whole life, for a slot that is replaced. */
  life: number;
  /** How far into its first period the slot starts. */
  offset: number;
  /** When the session first asks the person for something. */
  permFirst: number;
  /** How often the session asks, in seconds. */
  permEvery: number;
  /** How long the person has to answer. */
  permWait: number;
}

/** What a slot is doing at a moment. */
interface SlotState {
  status: AgentStatus;
  /** The time the current phase began, in seconds since the demo began. */
  phaseStart: number;
  /** How many times the tool has changed in this phase. */
  toolIndex: number;
  /** The time of the last tool change, in seconds since the demo began. */
  toolAt: number;
  /** True while the person is being asked for something. */
  waiting: boolean;
  /** The generation of a sub-agent. */
  gen: number;
}

export interface DemoState {
  /** How many agents the crowd has. */
  n: number;
  /** The time the demo began, in seconds since the epoch. */
  startS: number;
  /** The places in the crowd. */
  roster: Slot[];
  /** The timeline of every place, worked out once. */
  timelines: Map<string, Timeline>;
  /** The swimmers of every lane, in the order they took the lane. */
  lanes: Map<number, string[]>;
  /** The lounger of every agent that has one. */
  loungers: Map<string, number>;
  /** The waiting spot of every agent that has one. */
  waiting: Map<string, number>;
  /** The permission events that have been pushed already. */
  pushed: Set<string>;
  /** The scene description the last call produced. */
  payload: Record<string, unknown> | null;
}

/** The places in a crowd of `n` agents. */
function buildRoster(n: number): Slot[] {
  const sessions = Math.max(1, Math.ceil(n / 6));
  const roster: Slot[] = [];
  for (let k = 0; k < sessions; k += 1) {
    const session = SESSIONS[k % SESSIONS.length];
    roster.push({
      baseId: `session:demo-s${k}`,
      kind: 'session',
      parentId: null,
      sessionId: `demo-s${k}`,
      subagentType: null,
      label: session.name,
      churns: true,
      name: session.name,
      project: session.project,
      description: null,
      prompt: session.prompt,
    });
  }
  let rest = n - sessions;
  if (n >= 8) {
    roster.push({
      baseId: 'wf:demo',
      kind: 'workflow',
      parentId: null,
      sessionId: null,
      subagentType: null,
      label: 'task',
      churns: false,
      name: 'Sweep the lint warnings',
      project: 'AgentPool',
      description: 'Sweep the lint warnings',
      prompt: null,
    });
    rest -= 1;
  }
  for (let i = 0; i < rest; i += 1) {
    const session = i % sessions;
    const owner = SESSIONS[session % SESSIONS.length];
    // The first few sub-agents of one session have no description, and
    // they are all Explore: the naming rule has to number them.
    const quiet = session === QUIET_SESSION && Math.floor(i / sessions) < QUIET_COUNT;
    const type = quiet ? 'Explore' : SUBAGENT_TYPES[i % SUBAGENT_TYPES.length];
    const description = quiet ? null : DESCRIPTIONS[i % DESCRIPTIONS.length];
    roster.push({
      baseId: `sub:demo-${i}`,
      kind: 'subagent',
      parentId: `session:demo-s${session}`,
      sessionId: `demo-s${session}`,
      subagentType: type,
      label: type,
      churns: true,
      name: description ?? type,
      project: owner.project,
      description,
      prompt: null,
    });
  }
  return roster;
}

/** The timeline of a place, drawn from its own stream. */
function buildTimeline(slot: Slot): Timeline {
  const rng = rngFor(slot.baseId, 'demo');
  const workLen = 40 + rng() * 80;
  const idleLen = 30 + rng() * 60;
  const workLen2 = 40 + rng() * 80;
  const toolEvery = 4 + rng() * 11;
  const jitter = rng();
  const period = workLen + idleLen;
  const life = workLen + idleLen + workLen2 + FINISHED_SECONDS + LEAVING_SECONDS;
  return {
    workLen,
    idleLen,
    workLen2,
    toolEvery,
    period,
    life,
    offset: jitter * period,
    permFirst: 20 + rng() * 40,
    permEvery: 150 + rng() * 110,
    permWait: 15 + rng() * 15,
  };
}

/** The tool of an agent, at the given change of tool. */
function toolFor(baseId: string, index: number): string {
  const rng = rngFor(baseId, 'demo-tool');
  let value = 0;
  for (let i = 0; i <= index; i += 1) value = rng();
  return TOOLS[Math.min(TOOLS.length - 1, Math.floor(value * TOOLS.length))];
}

/**
 * The working time of a phase, with the waiting for the person taken out.
 *
 * While the person is being asked, the session does not move on: its
 * `last_event_at` stays where it was, which is how a real session looks
 * once the person has been asked.
 */
function effectiveTime(local: number, windows: { at: number; wait: number }[]): number {
  let t = local;
  for (const w of windows) {
    if (t < w.at) break;
    t -= w.wait;
  }
  return t;
}

/** The permission windows of a working phase. */
function permissionWindows(
  tl: Timeline,
  phaseStart: number,
  phaseLength: number,
): { at: number; wait: number }[] {
  const windows: { at: number; wait: number }[] = [];
  const first = Math.floor((phaseStart - tl.permFirst) / tl.permEvery);
  for (let j = first; j <= first + 4; j += 1) {
    const p = tl.permFirst + j * tl.permEvery;
    if (p < phaseStart) continue;
    if (p >= phaseStart + phaseLength) break;
    windows.push({ at: p - phaseStart, wait: tl.permWait });
  }
  return windows;
}

/**
 * What a session is doing at the given time, in seconds since the demo began.
 *
 * A session works and rests in periods, and after a couple of periods it
 * ends: it is finished, it walks out through the gate, and the next
 * session takes its place. The generation is in its id, so the scene sees
 * a new agent walk in through the same gate.
 */
function sessionState(elapsed: number, tl: Timeline): SlotState {
  const life = SESSION_CYCLES * tl.period + FINISHED_SECONDS + LEAVING_SECONDS;
  const t0 = elapsed + tl.offset;
  const gen = Math.floor(t0 / life);
  const tau = t0 - gen * life;
  const genStart = gen * life - tl.offset;
  const cycle = Math.floor(tau / tl.period);
  const phaseStart = genStart + cycle * tl.period;
  const local = tau - cycle * tl.period;
  const windows = permissionWindows(tl, phaseStart, tl.workLen);
  for (const w of windows) {
    if (local >= w.at && local < w.at + w.wait) {
      // The person is being asked: the session waits, and its last event
      // is the question.
      return {
        status: 'working',
        phaseStart,
        toolIndex: Math.max(0, Math.floor(w.at / tl.toolEvery)),
        toolAt: phaseStart + w.at,
        waiting: true,
        gen,
      };
    }
  }
  const after = tau - SESSION_CYCLES * tl.period;
  if (after >= 0) {
    // The end of the session: it is done, and then it leaves.
    const done = {
      status: 'finished' as const,
      phaseStart: genStart + SESSION_CYCLES * tl.period,
      toolIndex: Math.max(0, Math.floor(tl.workLen / tl.toolEvery)),
      toolAt: genStart + SESSION_CYCLES * tl.period,
      waiting: false,
      gen,
    };
    if (after < FINISHED_SECONDS) return done;
    return { ...done, status: 'leaving', phaseStart: done.phaseStart + FINISHED_SECONDS };
  }
  if (local < tl.workLen) {
    const t = effectiveTime(local, windows);
    return {
      status: 'working',
      phaseStart,
      toolIndex: Math.max(0, Math.floor(t / tl.toolEvery)),
      toolAt: phaseStart + t,
      waiting: false,
      gen,
    };
  }
  // Idle: the last thing the session did was in the working phase before.
  const t = effectiveTime(tl.workLen, windows);
  return {
    status: 'idle',
    phaseStart: phaseStart + tl.workLen,
    toolIndex: Math.max(0, Math.floor(t / tl.toolEvery)),
    toolAt: phaseStart + t,
    waiting: false,
    gen,
  };
}

/** What a sub-agent is doing at the given time. */
function subagentState(elapsed: number, tl: Timeline): SlotState {
  const t0 = elapsed + tl.offset;
  const gen = Math.floor(t0 / tl.life);
  const tau = t0 - gen * tl.life;
  const genStart = gen * tl.life - tl.offset;
  const workEnd = tl.workLen;
  const idleEnd = workEnd + tl.idleLen;
  const work2End = idleEnd + tl.workLen2;
  const finishedEnd = work2End + FINISHED_SECONDS;
  if (tau < workEnd) {
    return {
      status: 'working',
      phaseStart: genStart,
      toolIndex: Math.floor(tau / tl.toolEvery),
      toolAt: genStart + tau,
      waiting: false,
      gen,
    };
  }
  if (tau < idleEnd) {
    return {
      status: 'idle',
      phaseStart: genStart + workEnd,
      toolIndex: Math.floor(tl.workLen / tl.toolEvery),
      toolAt: genStart + tl.workLen,
      waiting: false,
      gen,
    };
  }
  if (tau < work2End) {
    const local = tau - idleEnd;
    return {
      status: 'working',
      phaseStart: genStart + idleEnd,
      toolIndex: Math.floor(local / tl.toolEvery),
      toolAt: genStart + idleEnd + local,
      waiting: false,
      gen,
    };
  }
  if (tau < finishedEnd) {
    return {
      status: 'finished',
      phaseStart: genStart + work2End,
      toolIndex: Math.floor(tl.workLen2 / tl.toolEvery),
      toolAt: genStart + idleEnd + tl.workLen2,
      waiting: false,
      gen,
    };
  }
  return {
    status: 'leaving',
    phaseStart: genStart + finishedEnd,
    toolIndex: Math.floor(tl.workLen2 / tl.toolEvery),
    toolAt: genStart + idleEnd + tl.workLen2,
    waiting: false,
    gen,
  };
}

/** The memory of a demo crowd. */
export function createDemoState(n: number, startS: number): DemoState {
  const roster = buildRoster(n);
  const timelines = new Map<string, Timeline>();
  for (const slot of roster) timelines.set(slot.baseId, buildTimeline(slot));
  return {
    n,
    startS,
    roster,
    timelines,
    lanes: new Map(),
    loungers: new Map(),
    waiting: new Map(),
    pushed: new Set(),
    payload: null,
  };
}

/** The id an agent has right now: a sub-agent carries its generation. */
function idOf(slot: Slot, st: SlotState): string {
  if (!slot.churns) return slot.baseId;
  return `${slot.baseId}-${st.gen}`;
}

/** The lane a swimmer is in, or null when it is not swimming. */
function laneOf(state: DemoState, id: string): number | null {
  for (const [lane, members] of state.lanes) {
    if (members.includes(id)) return lane;
  }
  return null;
}

/**
 * The fake agents at `nowS` (seconds) for a crowd of `n`.
 *
 * The allocator lives in the state: a swimmer keeps its lane for the whole
 * of its working phase, and an idler keeps its lounger until somebody
 * else needs it.
 */
export function demoAgents(n: number, nowS: number, state: DemoState): AgentView[] {
  const elapsed = nowS - state.startS;

  // --- what every place is doing now.
  const places = state.roster.slice(0, Math.max(0, Math.floor(n))).map((slot) => {
    const tl = state.timelines.get(slot.baseId);
    if (!tl) throw new Error(`no timeline for ${slot.baseId}`);
    const st = slot.churns ? subagentState(elapsed, tl) : sessionState(elapsed, tl);
    return { slot, tl, st, id: idOf(slot, st) };
  });

  // --- the lanes.
  const swimmers = places.filter((p) => p.st.status === 'working');
  const swimming = new Set(swimmers.map((p) => p.id));
  for (const [lane, members] of state.lanes) {
    const kept = members.filter((id) => swimming.has(id));
    if (kept.length !== members.length) state.lanes.set(lane, kept);
  }
  for (const p of swimmers) {
    if (laneOf(state, p.id) !== null) continue;
    // The lane with the fewest swimmers, the lowest one first.
    let best = 0;
    let bestCount = Number.POSITIVE_INFINITY;
    for (let lane = 0; lane < demoLanes(state.n); lane += 1) {
      const count = state.lanes.get(lane)?.length ?? 0;
      if (count < bestCount) {
        bestCount = count;
        best = lane;
      }
    }
    const members = state.lanes.get(best) ?? [];
    members.push(p.id);
    state.lanes.set(best, members);
  }

  // --- the loungers, the waiting spots and the queue.
  const idlers = places.filter((p) => p.st.status === 'idle');
  const idling = new Set(idlers.map((p) => p.id));
  const loungerCount = Math.max(6, Math.min(12, idlers.length + 2));
  for (const [id, index] of [...state.loungers]) {
    if (!idling.has(id) || index >= loungerCount) state.loungers.delete(id);
  }
  for (const [id] of [...state.waiting]) {
    if (!idling.has(id)) state.waiting.delete(id);
  }
  const takenLoungers = new Set(state.loungers.values());
  for (const p of idlers) {
    if (state.loungers.has(p.id)) continue;
    for (let i = 0; i < loungerCount; i += 1) {
      if (takenLoungers.has(i)) continue;
      state.loungers.set(p.id, i);
      takenLoungers.add(i);
      break;
    }
  }
  const takenWaiting = new Set(state.waiting.values());
  for (const p of idlers) {
    if (state.loungers.has(p.id) || state.waiting.has(p.id)) continue;
    for (let i = 0; i < DEMO_WAITING; i += 1) {
      if (takenWaiting.has(i)) continue;
      state.waiting.set(p.id, i);
      takenWaiting.add(i);
      break;
    }
  }
  const queue = idlers
    .filter((p) => !state.loungers.has(p.id) && !state.waiting.has(p.id))
    .map((p) => p.id);

  // --- the scene description: it changes with the crowd.
  state.payload = {
    scene: 'pool',
    lanes: demoLanes(state.n),
    length: demoLength(state.n),
    loungers: loungerCount,
    waiting: DEMO_WAITING,
    gate: 'gate',
    ladder: 'ladder',
  };

  // --- the agents themselves.
  // A session that ends is replaced by the next one, so a sub-agent belongs
  // to the session that is running now, not to the slot it was born in.
  const sessions = new Map<string, string>();
  for (const p of places) {
    if (p.slot.kind !== 'session') continue;
    sessions.set(p.slot.baseId, p.id);
  }
  const agents: AgentView[] = places.map((p) => {
    const { slot, st } = p;
    const tool = st.toolIndex >= 0 ? toolFor(slot.baseId, st.toolIndex) : null;
    const presentation = presentationOf(state, p, queue);
    // Only a working agent is doing something; an idle one has finished its last tool.
    const activity = st.status === 'working' && tool ? activityOf(tool, st.toolIndex) : null;
    return {
      id: p.id,
      kind: slot.kind,
      status: st.status,
      label: slot.label,
      session_id: slot.sessionId,
      parent_id: slot.parentId ? (sessions.get(slot.parentId) ?? slot.parentId) : null,
      tool_use_id: null,
      subagent_type: slot.subagentType,
      tool_name: tool,
      detail: tool,
      cwd: slot.project ? `/work/${slot.project}` : null,
      created_at: state.startS,
      last_event_at: state.startS + st.toolAt,
      started_at: state.startS,
      finished_at: null,
      event_count: st.toolIndex + 1,
      leaving_deadline: null,
      scene: 'pool',
      presentation,
      events: [],
      name: slot.name,
      project: slot.project,
      description: slot.description,
      prompt: slot.prompt,
      activity,
    };
  });
  return agents;
}

/** What a working agent is doing, in a few words, for the tool it is on. */
function activityOf(tool: string, index: number): string {
  const samples = ACTIVITY[tool];
  if (!samples) return tool;
  return samples[index % samples.length];
}

/** The presentation of one agent: where it is and what it is doing. */
function presentationOf(
  state: DemoState,
  place: { slot: Slot; st: SlotState; id: string },
  queue: string[],
): AgentPresentation {
  const props: Record<string, unknown> = {
    lane: null,
    lane_offset: 0,
    direction: 1,
    speed_scale: 1,
    lounger: null,
    waiting: null,
    queue: 0,
    route: null,
    from: null,
    to: null,
  };
  const { st, id } = place;

  if (st.status === 'working') {
    const lane = laneOf(state, id) ?? 0;
    const members = state.lanes.get(lane) ?? [];
    const rank = Math.max(0, members.indexOf(id));
    props.lane = lane;
    props.lane_offset = (lane % 2 ? 0.18 : -0.18) + rank * 0.3;
    props.direction = (lane + rank) % 2 === 0 ? 1 : -1;
    return { mode: 'swim', slot: `lane:${lane}`, props };
  }

  if (st.status === 'idle') {
    const lounger = state.loungers.get(id);
    if (lounger !== undefined) {
      props.lounger = lounger;
      return { mode: 'lounge', slot: `lounger:${lounger}`, props };
    }
    const waiting = state.waiting.get(id);
    if (waiting !== undefined) {
      props.waiting = waiting;
      return { mode: 'waiting', slot: `waiting:${waiting}`, props };
    }
    props.queue = Math.max(0, queue.indexOf(id));
    return { mode: 'waiting', slot: null, props };
  }

  if (st.status === 'finished') {
    props.to = 'gate';
    return { mode: 'exiting', slot: null, props };
  }

  if (st.status === 'leaving') {
    return { mode: 'leaving', slot: null, props };
  }

  return { mode: 'offscreen', slot: null, props };
}

/**
 * The permission events that are due.
 *
 * A session asks the person for something every so often, and waits for the
 * answer. The events are the ones the backend would have pushed.
 */
export function demoEvents(n: number, nowS: number, state: DemoState): SessionEventView[] {
  const elapsed = nowS - state.startS;
  const events: SessionEventView[] = [];
  for (const slot of state.roster.slice(0, Math.max(0, Math.floor(n)))) {
    if (slot.kind !== 'session' || !slot.sessionId) continue;
    const tl = state.timelines.get(slot.baseId);
    if (!tl) continue;
    let p = tl.permFirst;
    let k = 0;
    while (p <= elapsed && k < 64) {
      const eventId = `demo-perm-${slot.baseId}-${k}`;
      if (!state.pushed.has(eventId)) {
        state.pushed.add(eventId);
        events.push({
          event_id: eventId,
          ts: state.startS + p,
          type: 'permission',
          session_id: slot.sessionId,
          detail: 'Bash',
          source: 'demo',
        });
      }
      p += tl.permEvery;
      k += 1;
    }
  }
  return events;
}

/**
 * Start feeding the store with the fake crowd.
 *
 * It replaces the websocket: the demo does not talk to the backend at all.
 */
export function startDemo(n: number): DemoHandle {
  const startS = Date.now() / 1000;
  const state = createDemoState(n, startS);
  // The dashboard is "live" while the demo runs, so the panels do not say
  // that the backend is gone.
  setConnection('live');
  let payloadKey = '';

  const tick = () => {
    const nowS = Date.now() / 1000;
    const agents = demoAgents(n, nowS, state);
    replaceAgents(agents);
    const payload = state.payload;
    if (payload) {
      const key = `${payload.lanes}/${payload.loungers}/${payload.waiting}`;
      if (key !== payloadKey) {
        payloadKey = key;
        setScenePayload(payload);
      }
    }
    for (const event of demoEvents(n, nowS, state)) pushFeed(event);
  };

  tick();
  const timer = window.setInterval(tick, 500);
  return {
    close() {
      window.clearInterval(timer);
    },
  };
}

/* The store is only touched by the part of this file that runs in the
   browser; everything above it is pure and is tested without one. */
function setConnection(state: 'connecting' | 'live' | 'reconnecting' | 'offline'): void {
  store.setConnection(state);
}

function replaceAgents(agents: AgentView[]): void {
  store.replaceAgents(agents);
}

function setScenePayload(payload: Record<string, unknown>): void {
  store.setScenePayload(payload);
}

function pushFeed(event: SessionEventView): void {
  store.pushFeed(event);
}
