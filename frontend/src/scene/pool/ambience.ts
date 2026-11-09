/**
 * The ambience: the small things that make the pool a place rather than a
 * diagram. A bird crosses the sky, petals drift over the water, the parasol
 * sways and the sun glints on the surface.
 *
 * All of it is a handful of particles drawn into a single Graphics per
 * layer, so it costs almost nothing.
 */

import { Container, Graphics } from 'pixi.js';
import type { PoolLayout } from './layout';

interface Petal {
  alive: boolean;
  x: number;
  y: number;
  speed: number;
  sway: number;
  phase: number;
  size: number;
  spin: number;
}

interface Ripple {
  alive: boolean;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  size: number;
}

interface Bird {
  alive: boolean;
  x: number;
  y: number;
  speed: number;
  phase: number;
}

export class Ambience {
  readonly container = new Container();
  private sky = new Graphics();
  private petals = new Graphics();
  private water = new Graphics();

  private petalPool: Petal[] = [];
  private ripplePool: Ripple[] = [];
  private bird: Bird = { alive: false, x: 0, y: 0, speed: 0, phase: 0 };

  private layout!: PoolLayout;
  private time = 0;
  private nextBird = 6;
  private nextRipple = 2;

  constructor(layout: PoolLayout) {
    this.container.addChild(this.sky, this.petals, this.water);
    for (let index = 0; index < 14; index += 1) {
      this.petalPool.push({
        alive: false,
        x: 0,
        y: 0,
        speed: 0,
        sway: 0,
        phase: 0,
        size: 3,
        spin: 0,
      });
    }
    for (let index = 0; index < 8; index += 1) {
      this.ripplePool.push({
        alive: false,
        x: 0,
        y: 0,
        life: 0,
        maxLife: 1,
        size: 1,
      });
    }
    this.resize(layout);
  }

  resize(layout: PoolLayout): void {
    this.layout = layout;
  }

  update(dt: number): void {
    this.time += dt;
    const layout = this.layout;

    // --- the bird -------------------------------------------------
    this.nextBird -= dt;
    if (!this.bird.alive && this.nextBird <= 0) {
      this.bird = {
        alive: true,
        x: -30,
        y: layout.deckY * (0.18 + Math.random() * 0.3),
        speed: 40 + Math.random() * 25,
        phase: 0,
      };
      this.nextBird = 22 + Math.random() * 20;
    }
    if (this.bird.alive) {
      this.bird.x += this.bird.speed * dt;
      this.bird.phase += dt * 7;
      if (this.bird.x > layout.width + 30) this.bird.alive = false;
    }

    // --- the petals ------------------------------------------------
    for (const petal of this.petalPool) {
      if (!petal.alive) {
        if (Math.random() < dt * 0.35) {
          petal.alive = true;
          petal.x = layout.water.x + Math.random() * layout.water.w;
          petal.y = layout.surfaceY - 10 - Math.random() * layout.deckY * 0.4;
          petal.speed = 8 + Math.random() * 10;
          petal.sway = 6 + Math.random() * 10;
          petal.phase = Math.random() * 6.28;
          petal.size = 2 + Math.random() * 2.5;
          petal.spin = (Math.random() - 0.5) * 3;
        }
        continue;
      }
      petal.phase += dt * petal.spin;
      petal.x += petal.speed * dt;
      petal.y += Math.sin(petal.phase) * petal.sway * dt;
      if (petal.x > layout.water.x + layout.water.w || petal.y > layout.surfaceY + 20) {
        petal.alive = false;
      }
    }

    // --- the ambient ripples ---------------------------------------
    this.nextRipple -= dt;
    if (this.nextRipple <= 0) {
      const ripple = this.ripplePool.find((item) => !item.alive);
      if (ripple) {
        ripple.alive = true;
        ripple.x = layout.water.x + 20 + Math.random() * (layout.water.w - 40);
        ripple.y = layout.surfaceY + 4 + Math.random() * 40;
        ripple.life = 0;
        ripple.maxLife = 2.6;
        ripple.size = 4;
      }
      this.nextRipple = 1.5 + Math.random() * 3;
    }
    for (const ripple of this.ripplePool) {
      if (!ripple.alive) continue;
      ripple.life += dt;
      if (ripple.life >= ripple.maxLife) {
        ripple.alive = false;
        continue;
      }
    }

    this.draw();
  }

  private draw(): void {
    const layout = this.layout;

    // The bird: two little wings that flap.
    this.sky.clear();
    if (this.bird.alive) {
      const flap = Math.sin(this.bird.phase) * 5;
      this.sky
        .moveTo(this.bird.x - 7, this.bird.y - flap)
        .quadraticCurveTo(this.bird.x - 2, this.bird.y + 2, this.bird.x, this.bird.y)
        .quadraticCurveTo(this.bird.x + 2, this.bird.y + 2, this.bird.x + 7, this.bird.y - flap)
        .stroke({ width: 2, color: 0x2c3e50, alpha: 0.75, cap: 'round' });
    }

    // The petals.
    this.petals.clear();
    for (const petal of this.petalPool) {
      if (!petal.alive) continue;
      this.petals
        .ellipse(petal.x, petal.y, petal.size, petal.size * 0.6)
        .fill({ color: 0xffd9e0, alpha: 0.75 });
    }

    // The sun glint and the ambient ripples.
    this.water.clear();
    const glint = 0.12 + Math.sin(this.time * 0.7) * 0.05;
    this.water
      .ellipse(layout.water.x + layout.water.w * 0.72, layout.surfaceY + 14, 46, 7)
      .fill({ color: 0xffffff, alpha: glint });
    for (const ripple of this.ripplePool) {
      if (!ripple.alive) continue;
      const progress = ripple.life / ripple.maxLife;
      this.water
        .ellipse(ripple.x, ripple.y, ripple.size + progress * 22, (ripple.size + progress * 22) * 0.3)
        .stroke({ width: 1.5, color: 0xffffff, alpha: (1 - progress) * 0.45 });
    }
  }
}
