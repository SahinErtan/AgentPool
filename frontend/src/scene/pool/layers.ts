/**
 * The pool layers.
 *
 * Everything is drawn with Graphics primitives and one procedurally generated
 * texture (the caustics tile). There are no image assets in this project.
 */

import { Graphics, Texture } from 'pixi.js';
import { poolFloorY, poolLeftAtDepth, type PoolLayout } from './layout';
import { mixColour, type Palette } from './daylight';

export const COLORS = {
  skyTop: '#8fd3f4',
  skyBottom: '#d9f0fb',
  distant: '#7fb8d4',
  deck: '#e6d3b4',
  deckShade: '#cdb591',
  coping: '#f4f0e6',
  water: '#2f86c9',
  waterDeep: '#14508c',
  floor: '#bfe4f2',
  laneLine: '#8ec6de',
  lounger: '#ff8a3d',
  loungerFrame: '#d96f26',
  gate: '#f2e4c8',
  gateRoof: '#c96f4a',
  gateDoor: '#8a5a3b',
  parasol: '#ffd166',
  foam: '#ffffff',
};

export function drawSky(g: Graphics, layout: PoolLayout, palette: Palette): void {
  // The sky is a gradient. It is drawn in strips, because a strip of a
  // mixed colour is cheaper than a gradient object and looks the same.
  const strips = 24;
  for (let i = 0; i < strips; i += 1) {
    const t = i / (strips - 1);
    g.rect(
      layout.worldLeft,
      layout.worldTop + ((layout.deckY - layout.worldTop) * i) / strips,
      layout.worldWidth,
      (layout.deckY - layout.worldTop) / strips + 1,
    ).fill(mixColour(palette.skyTop, palette.skyBottom, t));
  }
  g.rect(
    layout.worldLeft,
    layout.deckY * 0.55,
    layout.worldWidth,
    layout.deckY * 0.45,
  ).fill({
    color: 0xffffff,
    alpha: 0.18 * palette.light,
  });

  // The stars come out with the dark. They are behind the clouds.
  if (palette.stars) {
    for (let i = 0; i < 60; i += 1) {
      // A fixed pattern: the same star every evening.
      const x = layout.worldLeft + ((i * 7919) % layout.worldWidth);
      const y = layout.worldTop + ((i * 104729) % Math.max(1, layout.deckY * 0.7));
      const size = 1 + ((i * 31) % 2);
      g.circle(x, y, size).fill({ color: 0xffffff, alpha: 0.35 + ((i * 17) % 40) / 100 });
    }
  }

  // The clouds. They are drawn in the sky, over the gradient.
  if (palette.clouds > 0.01) {
    for (let i = 0; i < 6; i += 1) {
      const x = layout.worldLeft + ((i * 613) % Math.max(1, layout.worldWidth - 160)) + 80;
      const y = layout.worldTop + 40 + ((i * 149) % Math.max(1, layout.deckY * 0.5));
      const w = 60 + ((i * 37) % 70);
      const h = 10 + ((i * 13) % 12);
      // A cloud is a few overlapping ellipses, so it has no hard edge.
      for (let k = 0; k < 4; k += 1) {
        const cx = x + (k - 1.5) * w * 0.28;
        const cy = y + ((k % 2) - 0.5) * h * 0.7;
        g.ellipse(cx, cy, w * (0.34 - k * 0.03), h * (0.8 + (k % 2) * 0.6)).fill({
          color: k % 2 === 0 ? 0xe8eef4 : 0xd3dce5,
          alpha: 0.17 * palette.clouds,
        });
      }
    }
  }

  // A distant treeline, so the sky has a horizon.
  const treeBase = layout.deckY;
  for (let x = layout.worldLeft - 20; x < layout.worldLeft + layout.worldWidth + 20; x += 46) {
    const height = 26 + ((x * 7919) % 23);
    g.circle(x, treeBase - height * 0.35, height * 0.75).fill({ color: palette.tree, alpha: 0.55 });
    g.rect(x - 2, treeBase - height * 0.3, 4, height * 0.3).fill({
      color: palette.trunk,
      alpha: 0.4,
    });
  }
}

export function drawDeck(g: Graphics, layout: PoolLayout, palette: Palette): void {
  // The walkway the characters cross. It carries on past the edges of the
  // canvas, so the camera can move without showing the end of the world.
  g.rect(layout.worldLeft, layout.deck.y, layout.worldWidth, layout.deck.h).fill(palette.deck);
  g.rect(
    layout.worldLeft,
    layout.deck.y + layout.deck.h - 6,
    layout.worldWidth,
    6,
  ).fill(palette.deckShade);
  // Tiles.
  for (let x = layout.worldLeft; x < layout.worldLeft + layout.worldWidth; x += 42) {
    g.rect(x, layout.deck.y, 2, layout.deck.h).fill({ color: 0x000000, alpha: 0.05 });
  }

  // The pool coping: a wide white edge with a shadow under it, so the
  // boundary between the terrace and the water reads clearly.
  const coping = Math.round(layout.characterHeight * 0.16);
  const copingY = layout.surfaceY - coping * 0.5;
  g.rect(layout.water.x - coping, copingY, layout.water.w + coping * 2, coping).fill(palette.coping);
  g.rect(layout.water.x - coping, copingY + coping, layout.water.w + coping * 2, 5).fill({
    color: palette.waterDeep,
    alpha: 0.45,
  });

  // The loungers.
  for (const slot of layout.loungers) {
    g.roundRect(slot.x, slot.y, slot.w, slot.h, 6).fill(COLORS.lounger);
    g.roundRect(slot.x + 4, slot.y + slot.h * 0.35, slot.w - 8, slot.h * 0.5, 4).fill({
      color: 0xffffff,
      alpha: 0.22,
    });
    g.rect(slot.x + 6, slot.y + slot.h, 4, 8).fill(COLORS.loungerFrame);
    g.rect(slot.x + slot.w - 10, slot.y + slot.h, 4, 8).fill(COLORS.loungerFrame);
  }

  // The gate: a changing hut with a door.
  const gate = layout.gate;
  g.rect(gate.x, gate.y, gate.w, gate.h).fill(COLORS.gate);
  g.rect(gate.x - 6, gate.y, gate.w + 12, 14).fill(COLORS.gateRoof);
  g.roundRect(gate.x + gate.w * 0.28, gate.y + gate.h * 0.38, gate.w * 0.44, gate.h * 0.62, 6).fill(
    COLORS.gateDoor,
  );
  g.circle(gate.x + gate.w * 0.64, gate.y + gate.h * 0.7, 3).fill(0xf7e6a0);

  // A parasol on the deck.
  const parasolX = layout.loungers[Math.floor(layout.loungers.length / 2)]?.x ?? layout.width / 2;
  g.rect(parasolX + 20, layout.deckY - layout.characterHeight * 0.9, 4, layout.characterHeight * 0.9).fill(
    0x9c7a52,
  );
  g.ellipse(parasolX + 22, layout.deckY - layout.characterHeight * 0.9, 34, 12).fill(COLORS.parasol);

  // The lamps around the pool, and the light they put on the deck.
  if (palette.lamps) {
    for (const slot of layout.loungers) {
      const lampX = slot.x + slot.w / 2;
      const lampY = layout.deck.y - 12;
      g.rect(lampX - 1, lampY, 2, 12).fill(0x6b5a44);
      g.circle(lampX, lampY, 3).fill(0xffe6a8);
      // Three rings, so the light fades out instead of ending in a circle.
      g.circle(lampX, lampY, 9).fill({ color: 0xffd98a, alpha: 0.12 });
      g.circle(lampX, lampY, 20).fill({ color: 0xffd98a, alpha: 0.06 });
      // The pool of light on the deck under the lamp.
      g.ellipse(lampX, layout.deck.y + 20, 30, 12).fill({ color: 0xffd98a, alpha: 0.08 });
    }
  }
}

export function drawFloor(g: Graphics, layout: PoolLayout, palette: Palette): void {
  const water = layout.water;
  const shallow = poolFloorY(layout, water.x);
  const deep = poolFloorY(layout, water.x + water.w);

  // The floor of the pool is a slope: the water is deeper at the ladder
  // end than at the gate end, so the pool is not a flat rectangle.
  g.poly(
    [
      water.x,
      water.y,
      water.x + water.w,
      water.y,
      water.x + water.w,
      deep,
      water.x,
      shallow,
    ],
    true,
  ).fill(palette.floor);

  // The walls at the two ends of the pool, seen through the water.
  const wall = Math.max(4, Math.round(layout.characterHeight * 0.12));
  g.rect(water.x, water.y, wall, shallow - water.y).fill({
    color: palette.poolWall,
    alpha: 0.5,
  });
  g.rect(water.x + water.w - wall, water.y, wall, deep - water.y).fill({
    color: palette.poolWall,
    alpha: 0.5,
  });

  // The lane lines are painted on the floor of the pool, so they follow
  // the slope of it.
  g.moveTo(water.x, shallow - 3)
    .lineTo(water.x + water.w, deep - 3)
    .stroke({ width: 3, color: 0x4a9ec4, alpha: 0.9 });

  // The depth markers, along the floor.
  for (let x = water.x + 40; x < water.x + water.w - 40; x += 120) {
    g.rect(x, poolFloorY(layout, x) - 9, 22, 5).fill({ color: 0x1c5a7d, alpha: 0.85 });
  }
}

/**
 * The concrete the pool is dug into.
 *
 * It is drawn over the caustics, so the light of the water does not fall
 * on the ground around the pool.
 */
export function drawShell(g: Graphics, layout: PoolLayout, palette: Palette): void {
  const water = layout.water;
  const shallow = poolFloorY(layout, water.x);
  const deep = poolFloorY(layout, water.x + water.w);
  const bottom = layout.height;
  const worldRight = layout.worldLeft + layout.worldWidth;

  // The ground on both sides of the pool. It is the same earth as the
  // terrace above, only in the shade: a ground that is much darker than
  // the deck reads as a hole in the picture.
  g.rect(
    layout.worldLeft,
    layout.surfaceY,
    water.x - layout.worldLeft,
    bottom - layout.surfaceY,
  ).fill(palette.deckShade);
  g.rect(water.x + water.w, layout.surfaceY, worldRight - (water.x + water.w), bottom - layout.surfaceY).fill(
    palette.deckShade,
  );

  // The ground under the floor of the pool.
  g.poly([water.x, shallow, water.x + water.w, deep, water.x + water.w, bottom, water.x, bottom], true).fill(
    palette.deckShade,
  );
}

/**
 * A caustic tile, generated once.
 *
 * The height field is a sum of sine waves; the bright bands are where that
 * field focuses light, which is the Laplacian of the height. Baking it into
 * a texture gives convincing caustics for two draw calls.
 */
export function makeCausticTexture(size = 128): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const texture = Texture.from(canvas);

  if (!context) return texture;

  const waves = [
    { ax: 3, ay: 2, phase: 0.4, amp: 1.0 },
    { ax: 5, ay: 4, phase: 1.7, amp: 0.62 },
    { ax: 8, ay: 7, phase: 2.9, amp: 0.34 },
    { ax: 13, ay: 11, phase: 0.8, amp: 0.18 },
  ];

  const height = (x: number, y: number): number => {
    let total = 0;
    for (const wave of waves) {
      total +=
        wave.amp *
        Math.sin((2 * Math.PI * (wave.ax * x + wave.ay * y)) / size + wave.phase);
    }
    return total;
  };

  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const laplacian =
        height(x - 1, y) + height(x + 1, y) + height(x, y - 1) + height(x, y + 1) -
        4 * height(x, y);
      const value = Math.max(0, Math.min(255, 128 + laplacian * 190));
      const index = (y * size + x) * 4;
      image.data[index] = 255;
      image.data[index + 1] = 255;
      image.data[index + 2] = 255;
      image.data[index + 3] = value;
    }
  }
  context.putImageData(image, 0, 0);
  texture.source.addressMode = 'repeat';
  return texture;
}

/** How many bands the depth of the water is made of. */
const DEPTH_BANDS = 16;

export function drawWater(g: Graphics, layout: PoolLayout, palette: Palette): void {
  const water = layout.water;
  // The depth of the water is a gradient, not two rectangles: the water
  // gets darker the deeper it is. Every band is a strip of the pool
  // between two depths, and the slope of the floor cuts the strips short.
  for (let band = 0; band < DEPTH_BANDS; band += 1) {
    const top = water.y + (water.h * band) / DEPTH_BANDS;
    const bottom = water.y + (water.h * (band + 1)) / DEPTH_BANDS;
    const leftTop = poolLeftAtDepth(layout, top);
    const leftBottom = poolLeftAtDepth(layout, bottom);
    if (leftBottom >= water.x + water.w) continue;
    const t = (band + 0.5) / DEPTH_BANDS;
    g.poly(
      [
        leftTop,
        top,
        water.x + water.w,
        top,
        water.x + water.w,
        bottom,
        leftBottom,
        bottom,
      ],
      true,
    ).fill({
      color: mixColour(palette.water, palette.waterDeep, t),
      // The water is thin enough to see the floor of the pool through it,
      // but the deeper it is the less of the floor comes through.
      alpha: 0.5 + 0.25 * t,
    });
  }
}

/** The foam line along the surface. */
export function drawFoam(g: Graphics, layout: PoolLayout, time: number): void {
  const water = layout.water;
  g.moveTo(water.x, water.y);
  const step = 16;
  for (let x = water.x; x <= water.x + water.w; x += step) {
    const wave = Math.sin((x / step) * 0.7 + time * 1.6) * 2.2;
    g.lineTo(x, water.y + wave);
  }
  g.stroke({ width: 3, color: 0xffffff, alpha: 0.5, cap: 'round' });
}
