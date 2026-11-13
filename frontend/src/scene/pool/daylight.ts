/**
 * The light of the day.
 *
 * The pool is a place that has a morning and an evening. The colours of
 * the sky, the water and the deck follow the clock, and the lamps around
 * the pool come on when the sun goes down.
 *
 * The palette is a set of keyframes over the day, and the colours between
 * them are mixed. Everything here is a pure function of the hour, so it can
 * be checked without a browser.
 */

import type { Weather } from './weather';

/** The colours of the pool at one moment. */
export interface Palette {
  skyTop: number;
  skyBottom: number;
  /** The trees on the horizon. */
  tree: number;
  trunk: number;
  deck: number;
  deckShade: number;
  coping: number;
  water: number;
  waterDeep: number;
  floor: number;
  /**
   * The concrete the pool is dug into: the ground around it and the
   * walls that are seen through the water.
   */
  poolWall: number;
  /** How bright the day is: 0 in the middle of the night, 1 at noon. */
  light: number;
  /** Whether the lamps around the pool are on. */
  lamps: boolean;
  /** Whether the stars are out. */
  stars: boolean;
  /** How much cloud there is: 0 is a clear sky, 1 is overcast. */
  clouds: number;
}

const NIGHT: Palette = {
  skyTop: 0x0a1730,
  skyBottom: 0x16305a,
  tree: 0x14283c,
  trunk: 0x241c18,
  deck: 0x4a4f63,
  deckShade: 0x353a4a,
  coping: 0x6e7386,
  water: 0x123a63,
  waterDeep: 0x0a2444,
  floor: 0x2b5c7a,
  poolWall: 0x232b38,
  light: 0.2,
  lamps: true,
  stars: true,
  clouds: 0,
};

const DAWN: Palette = {
  skyTop: 0x8fa8d8,
  skyBottom: 0xf6c9a4,
  tree: 0x4a6b5c,
  trunk: 0x5a4432,
  deck: 0xc9b193,
  deckShade: 0xa88f74,
  coping: 0xf0e6d8,
  water: 0x3f7fb0,
  waterDeep: 0x1f4f7d,
  floor: 0xbcd8e4,
  poolWall: 0xa8a294,
  light: 0.62,
  lamps: true,
  stars: false,
  clouds: 0,
};

const MORNING: Palette = {
  skyTop: 0x8fd3f4,
  skyBottom: 0xd9f0fb,
  tree: 0x6fae86,
  trunk: 0x7a6248,
  deck: 0xe6d3b4,
  deckShade: 0xcdb591,
  coping: 0xf4f0e6,
  water: 0x2f86c9,
  waterDeep: 0x14508c,
  floor: 0xbfe4f2,
  poolWall: 0xdcd4c2,
  light: 1,
  lamps: false,
  stars: false,
  clouds: 0,
};

const NOON: Palette = {
  skyTop: 0x9adcf7,
  skyBottom: 0xe8f6fc,
  tree: 0x7cba92,
  trunk: 0x876d51,
  deck: 0xf0e0c4,
  deckShade: 0xd8c39f,
  coping: 0xfbf8f0,
  water: 0x2f92d6,
  waterDeep: 0x125a9c,
  floor: 0xcbeaf6,
  poolWall: 0xe8e0cd,
  light: 1,
  lamps: false,
  stars: false,
  clouds: 0,
};

const AFTERNOON: Palette = {
  skyTop: 0x8fd0ef,
  skyBottom: 0xffe0c4,
  tree: 0x74a877,
  trunk: 0x84664a,
  deck: 0xe8d0ab,
  deckShade: 0xc9ab84,
  coping: 0xf7efdf,
  water: 0x2d7fbe,
  waterDeep: 0x144a83,
  floor: 0xc2e0ec,
  poolWall: 0xe0d5bd,
  light: 0.92,
  lamps: false,
  stars: false,
  clouds: 0,
};

const DUSK: Palette = {
  skyTop: 0x4a3f6e,
  skyBottom: 0xe08a5a,
  tree: 0x2f3a44,
  trunk: 0x2e231d,
  deck: 0xa88a72,
  deckShade: 0x836954,
  coping: 0xd8c8b4,
  water: 0x27557f,
  waterDeep: 0x123c6e,
  floor: 0x7f9fb4,
  poolWall: 0x6f6255,
  light: 0.45,
  lamps: true,
  stars: false,
  clouds: 0,
};

/** The keyframes over the day, in order. */
const KEYS: { hour: number; palette: Palette }[] = [
  { hour: 0, palette: NIGHT },
  { hour: 5, palette: NIGHT },
  { hour: 6.5, palette: DAWN },
  { hour: 9, palette: MORNING },
  { hour: 13, palette: NOON },
  { hour: 17, palette: AFTERNOON },
  { hour: 20, palette: DUSK },
  { hour: 22, palette: NIGHT },
  { hour: 24, palette: NIGHT },
];

/** Mix two colours. */
export function mixColour(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function mixPalette(a: Palette, b: Palette, t: number): Palette {
  return {
    skyTop: mixColour(a.skyTop, b.skyTop, t),
    skyBottom: mixColour(a.skyBottom, b.skyBottom, t),
    tree: mixColour(a.tree, b.tree, t),
    trunk: mixColour(a.trunk, b.trunk, t),
    deck: mixColour(a.deck, b.deck, t),
    deckShade: mixColour(a.deckShade, b.deckShade, t),
    coping: mixColour(a.coping, b.coping, t),
    water: mixColour(a.water, b.water, t),
    waterDeep: mixColour(a.waterDeep, b.waterDeep, t),
    floor: mixColour(a.floor, b.floor, t),
    poolWall: mixColour(a.poolWall, b.poolWall, t),
    light: a.light + (b.light - a.light) * t,
    // The lamps are a switch, not a gradient: they come on when it gets
    // dark and go off when it gets light.
    lamps: t < 0.5 ? a.lamps : b.lamps,
    stars: t < 0.5 ? a.stars : b.stars,
    clouds: a.clouds + (b.clouds - a.clouds) * t,
  };
}

/**
 * The colours of the pool at a given hour of the day.
 *
 * The hour may be any number: it is wrapped into the day, so 25 is one
 * o'clock in the morning.
 */
export function paletteFor(hour: number): Palette {
  const h = ((hour % 24) + 24) % 24;

  let index = 0;
  for (let i = 0; i < KEYS.length - 1; i += 1) {
    if (h >= KEYS[i].hour && h <= KEYS[i + 1].hour) {
      index = i;
      break;
    }
    index = i;
  }

  const from = KEYS[index];
  const to = KEYS[Math.min(index + 1, KEYS.length - 1)];
  const span = to.hour - from.hour;
  const t = span <= 0 ? 0 : (h - from.hour) / span;
  return mixPalette(from.palette, to.palette, Math.max(0, Math.min(1, t)));
}

/** The hour of the day, with the minutes as a fraction. */
export function hourOfDay(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/**
 * The palette with the weather on top of it.
 *
 * The clouds take the colour out of the sky and the light out of the
 * pool. The rain is darker than the clouds.
 */
export function applyWeather(palette: Palette, weather: Weather): Palette {
  if (weather === 'clear') return { ...palette, clouds: 0 };

  const overcast = weather === 'cloudy' ? 0.55 : 1;
  const grey = weather === 'cloudy' ? 0xa9b5c0 : 0x76818e;

  return {
    ...palette,
    skyTop: mixColour(palette.skyTop, grey, overcast * 0.6),
    skyBottom: mixColour(palette.skyBottom, grey, overcast * 0.45),
    water: mixColour(palette.water, grey, overcast * 0.3),
    // The deck is wet when it rains.
    deck: mixColour(palette.deck, grey, overcast * 0.18),
    deckShade: mixColour(palette.deckShade, grey, overcast * 0.18),
    light: palette.light * (1 - overcast * 0.3),
    clouds: overcast,
  };
}
