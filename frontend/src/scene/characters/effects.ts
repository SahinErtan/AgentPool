/**
 * The small effects that make the loungers look inhabited: the steam above
 * a cup, the "Z" glyphs above a sleeping character and the speech bubble of
 * a conversation.
 *
 * Every effect is a tiny pool of particles that is recycled, never allocated
 * during the ticker.
 */

import { Container, Graphics, Text } from 'pixi.js';

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

function makePool(count: number): Particle[] {
  return Array.from({ length: count }, () => ({
    alive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 1,
  }));
}

/**
 * The splash of a hand going into the water.
 *
 * A swimmer whose hand goes under the water pushes some of it up. It is
 * the difference between a figure in the water and a figure *in* the water,
 * and it is the event the scene listens for.
 */
export class Splash {
  readonly container = new Container();
  private graphics = new Graphics();
  private pool = makePool(60);
  private next = 0;

  constructor() {
    this.container.addChild(this.graphics);
  }

  /** Push some water up at the given place. */
  emit(x: number, y: number, strength = 1): void {
    const count = Math.min(6, Math.max(2, Math.round(strength * 4)));
    for (let index = 0; index < count; index += 1) {
      const particle = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      particle.alive = true;
      particle.x = x + (Math.random() - 0.5) * 8;
      particle.y = y;
      // The drops go up and to the side, and they fall back.
      particle.vx = (Math.random() - 0.5) * 46 * strength;
      particle.vy = -(26 + Math.random() * 30) * strength;
      particle.life = 0;
      particle.maxLife = 0.5 + Math.random() * 0.4;
      particle.size = 1.4 + Math.random() * 1.8;
    }
  }

  update(dt: number): void {
    this.graphics.clear();
    for (const particle of this.pool) {
      if (!particle.alive) continue;
      particle.life += dt;
      if (particle.life >= particle.maxLife) {
        particle.alive = false;
        continue;
      }
      particle.vy += 320 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      const fade = 1 - particle.life / particle.maxLife;
      this.graphics
        .circle(particle.x, particle.y, particle.size * (0.5 + fade * 0.5))
        .fill({ color: 0xffffff, alpha: 0.75 * fade });
    }
  }
}

/** Steam wisps rising from a cup. */
export class Steam {
  readonly container = new Container();
  private graphics = new Graphics();
  private pool = makePool(12);
  private next = 0;

  constructor() {
    this.container.addChild(this.graphics);
  }

  /** Spawn a wisp at the given position. */
  emit(x: number, y: number): void {
    const particle = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    particle.alive = true;
    particle.x = x + (Math.random() - 0.5) * 3;
    particle.y = y;
    particle.vx = (Math.random() - 0.5) * 4;
    particle.vy = -12 - Math.random() * 8;
    particle.life = 0;
    particle.maxLife = 1.4 + Math.random() * 0.8;
    particle.size = 1.6 + Math.random() * 1.6;
  }

  update(dt: number): void {
    this.graphics.clear();
    for (const particle of this.pool) {
      if (!particle.alive) continue;
      particle.life += dt;
      if (particle.life >= particle.maxLife) {
        particle.alive = false;
        continue;
      }
      const progress = particle.life / particle.maxLife;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx += Math.sin(particle.life * 6) * 3 * dt;
      const radius = particle.size * (1 + progress * 2.2);
      this.graphics
        .circle(particle.x, particle.y, radius)
        .fill({ color: 0xffffff, alpha: (1 - progress) * 0.35 });
    }
  }
}

/** The "Z" glyphs above a sleeping character. */
export class SleepZ {
  readonly container = new Container();
  private glyphs: { text: Text; alive: boolean; life: number; x: number; y: number }[] = [];

  constructor() {
    for (let index = 0; index < 4; index += 1) {
      const text = new Text({
        text: 'Z',
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 12, fill: 0xffffff },
      });
      text.visible = false;
      this.container.addChild(text);
      this.glyphs.push({ text, alive: false, life: 0, x: 0, y: 0 });
    }
  }

  emit(x: number, y: number): void {
    const glyph = this.glyphs.find((item) => !item.alive);
    if (!glyph) return;
    glyph.alive = true;
    glyph.life = 0;
    glyph.x = x;
    glyph.y = y;
    glyph.text.position.set(x, y);
    glyph.text.alpha = 1;
    glyph.text.visible = true;
  }

  update(dt: number): void {
    for (const glyph of this.glyphs) {
      if (!glyph.alive) continue;
      glyph.life += dt;
      if (glyph.life > 2.2) {
        glyph.alive = false;
        glyph.text.visible = false;
        continue;
      }
      const progress = glyph.life / 2.2;
      glyph.text.position.set(glyph.x + progress * 12, glyph.y - progress * 26);
      glyph.text.alpha = 1 - progress;
      glyph.text.scale.set(0.7 + progress * 0.5);
    }
  }
}

/** A speech bubble for a conversation. */
export class SpeechBubble {
  readonly container = new Container();
  private graphics = new Graphics();
  private text = new Text({
    text: '',
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: 0x1d2b36 },
  });

  constructor() {
    this.text.anchor.set(0.5, 0.5);
    this.container.addChild(this.graphics, this.text);
    this.container.visible = false;
  }

  show(x: number, y: number, message: string, duration = 2.4): void {
    this.text.text = message;
    const width = Math.max(26, this.text.width + 14);
    const height = Math.max(18, this.text.height + 10);
    this.graphics.clear();
    this.graphics
      .roundRect(x - width / 2, y - height / 2, width, height, 6)
      .fill({ color: 0xffffff, alpha: 0.92 });
    this.graphics
      .moveTo(x - 5, y + height / 2 - 1)
      .lineTo(x - 1, y + height / 2 + 6)
      .lineTo(x + 4, y + height / 2 - 1)
      .fill({ color: 0xffffff, alpha: 0.92 });
    this.text.position.set(x, y);
    this.container.visible = true;
    this.container.alpha = 1;
    this.hideAt = duration;
  }

  private hideAt = 0;
  private elapsed = 0;

  update(dt: number): void {
    if (!this.container.visible) return;
    this.elapsed += dt;
    if (this.elapsed >= this.hideAt) {
      this.container.visible = false;
      this.elapsed = 0;
    }
  }
}
