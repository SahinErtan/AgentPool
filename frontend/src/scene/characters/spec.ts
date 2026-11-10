/**
 * Deterministic character identity.
 *
 * A character is a pure function of the agent id: the same id always produces
 * the same character, in every browser tab, after every reload. No assets, no
 * runtime randomness, no server round-trip.
 *
 * Every attribute draws from its own *named* random stream so that adding a new
 * attribute later cannot reshuffle the characters that already exist.
 */

export type SwimStyle = 'crawl' | 'breaststroke' | 'butterfly' | 'doggy';
export type Accessory = 'none' | 'sunhat' | 'cap' | 'goggles' | 'floatie' | 'snorkel';
export type IdleActivity =
  | 'none'
  | 'tea'
  | 'book'
  | 'phone'
  | 'sunbathe'
  | 'nap'
  | 'stretch'
  | 'snack'
  | 'chat'
  | 'newspaper'
  | 'cards'
  | 'call';
export type Archetype = 'bean' | 'pear' | 'tall' | 'squat' | 'round';
export type Role = 'session' | 'subagent' | 'mcp' | 'workflow';

/** Body proportions, as fractions of the total height. */
export interface ArchetypeSpec {
  /** Hip-to-ankle length. */
  leg: number;
  /** Hip-to-shoulder length. */
  torso: number;
  /** Shoulder-to-hand length. */
  arm: number;
  /** Head radius. */
  headR: number;
  /** Hip width multiplier. */
  hipWidth: number;
  /** Shoulder width multiplier. */
  shoulderWidth: number;
  /** Torso thickness multiplier. */
  girth: number;
}

export const ARCHETYPES: Record<Archetype, ArchetypeSpec> = {
  bean: { leg: 0.22, torso: 0.42, arm: 0.26, headR: 0.17, hipWidth: 1.0, shoulderWidth: 1.0, girth: 1.15 },
  pear: { leg: 0.3, torso: 0.38, arm: 0.28, headR: 0.15, hipWidth: 1.25, shoulderWidth: 0.95, girth: 1.0 },
  tall: { leg: 0.38, torso: 0.34, arm: 0.32, headR: 0.14, hipWidth: 0.95, shoulderWidth: 0.95, girth: 0.85 },
  squat: { leg: 0.18, torso: 0.4, arm: 0.24, headR: 0.19, hipWidth: 1.1, shoulderWidth: 1.2, girth: 1.1 },
  round: { leg: 0.22, torso: 0.36, arm: 0.25, headR: 0.2, hipWidth: 1.05, shoulderWidth: 1.05, girth: 1.2 },
};

/** Curated skin tones — a hand-picked ramp, never a random hue. */
export const SKIN_TONES = [
  '#f6d7c0', '#edc3a3', '#d9a57c', '#c08a5f', '#9c6640', '#7a4a2b', '#573320', '#3a2317',
];

/** Curated hair colours. */
export const HAIR_TONES = [
  '#1b1410', '#3b2418', '#6b3f22', '#a8641f', '#d9a441', '#8a8f96', '#d8d3cb', '#a03a2f',
];

/**
 * Role fixes the hue family so the pool is readable at a glance; the hash picks
 * the exact hue inside the family, so two subagents never look identical.
 */
const ROLE_HUE: Record<Role, { hue: number; spread: number }> = {
  session: { hue: 72, spread: 18 }, // warm gold
  subagent: { hue: 248, spread: 70 }, // cool blue -> green -> violet
  mcp: { hue: 190, spread: 16 }, // teal / cyan
  workflow: { hue: 32, spread: 18 }, // orange / red
};

export interface CharacterSpec {
  seed: number;
  archetype: Archetype;
  /** Overall scale factor. */
  height: number;
  skin: string;
  suit: string;
  accent: string;
  hair: string;
  accessory: Accessory;
  swimStyle: SwimStyle;
  idleActivity: IdleActivity;
  /** Seconds of lounging before the idle activity starts. */
  idleStartDelay: number;
  /** How long the idle activity lasts. */
  idleDuration: number;
  /** Seconds of lounging before the next activity. */
  idleCooldown: number;
  /** Phase offset so no two characters animate in lockstep. */
  phaseOffset: number;
  /** Stroke speed multiplier. */
  speedScale: number;
  /** True when the character faces left. */
  flip: boolean;
  /** Seconds between blinks. */
  blinkInterval: number;
}

/** FNV-1a, 32 bit. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for visual variety. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A named random stream. `rngFor(id, 'skin')` never disturbs `rngFor(id, 'hair')`,
 * so adding an attribute later cannot change the existing characters.
 */
export function rngFor(id: string, channel: string): () => number {
  return mulberry32(fnv1a(`${id}#${channel}`));
}

function pick<T>(rng: () => number, options: readonly T[]): T {
  return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
}

function weightedPick<T extends string>(
  rng: () => number,
  table: Record<T, number>,
): T {
  const entries = Object.entries(table) as [T, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

/** OKLCH -> sRGB hex. Done in code so we never depend on the browser parsing it. */
export function oklchToHex(lightness: number, chroma: number, hueDeg: number): string {
  const h = (hueDeg * Math.PI) / 180;
  const a = chroma * Math.cos(h);
  const b = chroma * Math.sin(h);

  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const encode = (v: number) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, c)) * 255);
  };

  return `#${[encode(lr), encode(lg), encode(lb)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

const ACCESSORY_TABLE: Record<Accessory, number> = {
  none: 26,
  sunhat: 18,
  cap: 16,
  goggles: 14,
  floatie: 14,
  snorkel: 12,
};

const SWIM_TABLE: Record<SwimStyle, number> = {
  crawl: 34,
  breaststroke: 26,
  butterfly: 22,
  doggy: 18,
};

const ACTIVITY_TABLE: Record<IdleActivity, number> = {
  none: 14,
  tea: 15,
  book: 12,
  phone: 12,
  sunbathe: 12,
  nap: 10,
  stretch: 9,
  snack: 9,
  chat: 7,
  newspaper: 11,
  cards: 8,
  call: 10,
};

/** Build the full specification of a character from its agent id. */
export function specFor(
  agentId: string,
  role: Role = 'subagent',
  overrides: Partial<CharacterSpec> = {},
): CharacterSpec {
  const seed = fnv1a(agentId);

  const shapeRng = rngFor(agentId, 'shape');
  const archetype = pick(shapeRng, Object.keys(ARCHETYPES) as Archetype[]);
  const height = 0.88 + shapeRng() * 0.24;

  const colorRng = rngFor(agentId, 'color');
  const family = ROLE_HUE[role];
  const hue = (family.hue + (colorRng() * 2 - 1) * family.spread + 360) % 360;
  const suitHue = (hue + (colorRng() * 2 - 1) * 12 + 360) % 360;
  const accentHue = (suitHue + 150 + (colorRng() * 2 - 1) * 30 + 360) % 360;

  const skin = pick(colorRng, SKIN_TONES);
  const hair = pick(colorRng, HAIR_TONES);
  const suit = oklchToHex(0.62 + colorRng() * 0.12, 0.13 + colorRng() * 0.05, suitHue);
  const accent = oklchToHex(0.75 + colorRng() * 0.1, 0.14 + colorRng() * 0.05, accentHue);

  const accessory = weightedPick(rngFor(agentId, 'accessory'), ACCESSORY_TABLE);
  const swimStyle = weightedPick(rngFor(agentId, 'swim'), SWIM_TABLE);
  const idleActivity = weightedPick(rngFor(agentId, 'activity'), ACTIVITY_TABLE);

  const motionRng = rngFor(agentId, 'motion');
  return {
    seed,
    archetype,
    height,
    skin,
    suit,
    accent,
    hair,
    accessory,
    swimStyle,
    idleActivity,
    idleStartDelay: 6 + motionRng() * 24,
    idleDuration: 5 + motionRng() * 9,
    idleCooldown: 20 + motionRng() * 40,
    phaseOffset: motionRng(),
    speedScale: 0.85 + motionRng() * 0.35,
    flip: motionRng() < 0.5,
    blinkInterval: 2 + motionRng() * 4,
    ...overrides,
  };
}
