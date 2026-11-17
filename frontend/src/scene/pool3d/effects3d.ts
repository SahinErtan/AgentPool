/**
 * Droplets, steam, foam and bubbles: one pool of particles for the whole
 * scene.
 *
 * A hand going into the water throws up a few drops; a cup of tea gives off
 * a thread of steam; a swimmer leaves foam behind it; a dive leaves
 * bubbles. All of them are points in one buffer that is made once, so the
 * frame never allocates, and all of them are drawn in one draw call.
 */

import {
  LineBasicMaterial,
  LineSegments,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
} from 'three';

/**
 * How many particles the pool holds. Fireworks take over a hundred each, so
 * the pool was raised from 1600 (Sprint 27): the foam of a busy pool would
 * otherwise be overwritten by the sparks of a single rocket.
 */
const COUNT = 2400;

/** What a particle is. */
export const PARTICLE_DROP = 0;
export const PARTICLE_STEAM = 1;
export const PARTICLE_FOAM = 2;
export const PARTICLE_BUBBLE = 3;
export const PARTICLE_CONFETTI = 4;
/** A petal from a garden tree: it drifts down, and floats on the water once it lands. */
export const PARTICLE_PETAL = 5;
/** A spark of a firework: it falls under a little gravity and fades. */
export const PARTICLE_SPARK = 6;
/** A rocket going up; it bursts into sparks when its life runs out. */
export const PARTICLE_ROCKET = 7;

/**
 * The rocket's climb, in metres a second, and how long it climbs for, in
 * seconds. It bursts about three and a half metres up: the default view
 * looks down at the pool, and a burst much higher is above the top of the
 * picture, where nobody sees it.
 */
const ROCKET_SPEED = 4.2;
const ROCKET_LIFE = 0.85;
/** One spark of the dim trail every this many seconds. */
const TRAIL_EVERY = 0.05;
const TRAIL_LIFE = 0.6;
/** The sparks of a burst: how many, how fast they fly out, and how fast they fall. */
const BURST_COUNT = 110;
const BURST_SPEED = 3.2;
const BURST_LIFE_MIN = 1.5;
const BURST_LIFE_SPAN = 0.5;
const SPARK_GRAVITY = 3;
/**
 * The sizes of the rocket, its trail and its sparks. A point is drawn
 * `size × 320 / distance` pixels wide, and the default view is some 20 m
 * from the far edge of the pool: a size under 0.2 is a pixel or two there,
 * which is too little to see.
 */
const ROCKET_SIZE = 0.45;
const TRAIL_SIZE = 0.26;
const SPARK_SIZE = 0.5;
/** The effects the pending work keeps: a burst or a trail spark, queued while the buffer is read. */
const PENDING = 32;

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColour;
varying float vAlpha;
varying vec3 vColour;
void main() {
  vAlpha = aAlpha;
  vColour = aColour;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (320.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColour;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  gl_FragColor = vec4(vColour, vAlpha * (1.0 - d * 4.0));
  #include <colorspace_fragment>
}
`;

export class Particles {
  readonly points: Points;
  /** The particles are read by the tests, so the buffers are not private. */
  readonly position = new Float32Array(COUNT * 3);
  readonly velocity = new Float32Array(COUNT * 3);
  readonly life = new Float32Array(COUNT);
  readonly maxLife = new Float32Array(COUNT);
  readonly size = new Float32Array(COUNT);
  readonly alpha = new Float32Array(COUNT);
  readonly colour = new Float32Array(COUNT * 3);
  /**
   * 0 a drop, 1 steam, 2 foam, 3 a bubble, 4 confetti, 5 a petal, 6 a spark,
   * 7 a rocket.
   */
  readonly kind = new Uint8Array(COUNT);
  /**
   * The surface a bubble rises to, when it is not the pool's; NaN for the
   * pool's. For a rocket it is the colour pair its burst takes.
   */
  readonly surface = new Float32Array(COUNT);
  /** The time to the next trail spark of each rocket. */
  private readonly trailIn = new Float32Array(COUNT);
  /** Bursts and trail sparks queued while the buffer is being read: where, and what. */
  private readonly pendingAt = new Float32Array(PENDING * 4);
  private readonly pendingKind = new Uint8Array(PENDING);
  private pendingCount = 0;
  private next = 0;
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private seed = 1;
  /** The clock of the pool of particles, in seconds. */
  private time = 0;

  constructor() {
    this.geometry.setAttribute('position', new BufferAttribute(this.position, 3));
    this.geometry.setAttribute('aSize', new BufferAttribute(this.size, 1));
    this.geometry.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.geometry.setAttribute('aColour', new BufferAttribute(this.colour, 3));
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  private random(): number {
    // A small deterministic generator: the particles do not need the
    // quality of Math.random, and this one makes no garbage.
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    colour: Color,
    kind: number,
    surface = Number.NaN,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % COUNT;
    this.position.set([x, y, z], i * 3);
    this.velocity.set([vx, vy, vz], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.colour.set([colour.r, colour.g, colour.b], i * 3);
    this.kind[i] = kind;
    this.surface[i] = surface;
    this.trailIn[i] = TRAIL_EVERY;
  }

  private static readonly WATER = new Color('#e9fbff');
  private static readonly STEAM = new Color('#ffffff');
  private static readonly FOAM = new Color('#ffffff');
  private static readonly BUBBLE = new Color('#dff6ff');
  private static readonly PETAL = new Color('#f4a3c0');
  /** Eight bright colours for the confetti. */
  private static readonly CONFETTI: Color[] = [
    new Color('#ff4d4d'),
    new Color('#ffd23f'),
    new Color('#2f8fb8'),
    new Color('#5ad17a'),
    new Color('#c96fd8'),
    new Color('#ff8fc7'),
    new Color('#4fd8ff'),
    new Color('#ff9f1c'),
  ];
  private static readonly ROCKET = new Color('#fff4d6');
  private static readonly TRAIL = new Color('#cfd8e3');
  /** The four colour pairs a burst can take. */
  private static readonly BURSTS: [Color, Color][] = [
    [new Color('#ff5d5d'), new Color('#ffd23f')],
    [new Color('#7fd3ff'), new Color('#ffffff')],
    [new Color('#c96fd8'), new Color('#8cc56a')],
    [new Color('#ffa84f'), new Color('#f2f2f2')],
  ];

  /** Drops thrown up where a hand goes into the water. */
  splash(x: number, y: number, z: number, strength: number): void {
    const n = Math.round(6 + strength * 10);
    for (let k = 0; k < n; k += 1) {
      const a = this.random() * Math.PI * 2;
      const s = (0.4 + this.random() * 0.9) * strength;
      this.spawn(
        x + Math.cos(a) * 0.05,
        y,
        z + Math.sin(a) * 0.05,
        Math.cos(a) * s,
        1.2 + this.random() * 1.6 * strength,
        Math.sin(a) * s,
        0.5 + this.random() * 0.4,
        0.05 + this.random() * 0.05,
        Particles.WATER,
        PARTICLE_DROP,
      );
    }
  }

  /** A wisp of steam from a cup. */
  steam(x: number, y: number, z: number): void {
    this.spawn(
      x + (this.random() - 0.5) * 0.03,
      y,
      z + (this.random() - 0.5) * 0.03,
      (this.random() - 0.5) * 0.05,
      0.22 + this.random() * 0.1,
      (this.random() - 0.5) * 0.05,
      1.4 + this.random() * 0.6,
      0.06,
      Particles.STEAM,
      PARTICLE_STEAM,
    );
  }

  /**
   * A patch of foam on the surface.
   *
   * It does not move: it stays where it was put and spreads out, and it
   * fades as it spreads.
   */
  foam(x: number, z: number, y: number, size = 0.14): void {
    this.spawn(
      x + (this.random() - 0.5) * 0.06,
      y,
      z + (this.random() - 0.5) * 0.06,
      0,
      0,
      0,
      1.4,
      size,
      Particles.FOAM,
      PARTICLE_FOAM,
    );
  }

  /**
   * Bubbles coming up from under the water.
   *
   * @param surface The height the bubbles go up to, for a body of water that
   *   is not the pool's (the hot tub's); the pool's surface by default.
   */
  bubbles(x: number, y: number, z: number, n = 4, surface = Number.NaN): void {
    for (let k = 0; k < n; k += 1) {
      this.spawn(
        x + (this.random() - 0.5) * 0.12,
        y,
        z + (this.random() - 0.5) * 0.12,
        0,
        0.5,
        0,
        1.5 + this.random() * 1.5,
        0.03 + this.random() * 0.03,
        Particles.BUBBLE,
        PARTICLE_BUBBLE,
        surface,
      );
    }
  }

  /**
   * One drop thrown with the given velocity, as from a fountain.
   *
   * The drop falls under gravity like the splash does, and fades away.
   */
  arc(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    this.spawn(x, y, z, vx, vy, vz, 1.1, 0.05, Particles.WATER, PARTICLE_DROP);
  }

  /**
   * A firework: a rocket goes up from the ground at (x, z). At the top of its
   * climb it bursts into sparks, and it leaves a dim trail on the way.
   *
   * It makes about 108 particles in all: the rocket, some 17 trail sparks
   * and the 90 sparks of the burst.
   */
  firework(x: number, z: number): void {
    const pair = Math.floor(this.random() * Particles.BURSTS.length);
    this.spawn(x, 0.2, z, 0, ROCKET_SPEED, 0, ROCKET_LIFE, ROCKET_SIZE, Particles.ROCKET, PARTICLE_ROCKET, pair);
  }

  /** The sparks of a burst, thrown out in every direction from one point. */
  private burst(x: number, y: number, z: number, pair: number): void {
    const colours = Particles.BURSTS[pair];
    for (let k = 0; k < BURST_COUNT; k += 1) {
      // A point on the sphere, by its height and its turn about the axis.
      const up = this.random() * 2 - 1;
      const turn = this.random() * Math.PI * 2;
      const ring = Math.sqrt(1 - up * up);
      const speed = BURST_SPEED * (0.6 + 0.4 * this.random());
      this.spawn(
        x,
        y,
        z,
        Math.cos(turn) * ring * speed,
        up * speed,
        Math.sin(turn) * ring * speed,
        BURST_LIFE_MIN + this.random() * BURST_LIFE_SPAN,
        SPARK_SIZE,
        colours[k % 2],
        PARTICLE_SPARK,
      );
    }
  }

  /** A petal let go in the garden: it drifts and falls, and floats once it reaches the water. */
  petal(x: number, y: number, z: number): void {
    this.spawn(x, y, z, 0.1, -0.3, 0, 30, 0.09, Particles.PETAL, PARTICLE_PETAL);
  }

  /** How many petals are in the air or on the water. */
  petalCount(): number {
    let n = 0;
    for (let i = 0; i < COUNT; i += 1) if (this.kind[i] === PARTICLE_PETAL && this.life[i] > 0) n += 1;
    return n;
  }

  /** A burst of confetti, thrown out in every direction. */
  confetti(x: number, y: number, z: number, n = 60): void {
    for (let k = 0; k < n; k += 1) {
      const a = this.random() * Math.PI * 2;
      const s = 1.2 + this.random() * 2.4;
      const colour = Particles.CONFETTI[Math.floor(this.random() * Particles.CONFETTI.length)];
      this.spawn(
        x,
        y,
        z,
        Math.cos(a) * s,
        2.4 + this.random() * 1.6,
        Math.sin(a) * s,
        2.4 + this.random() * 0.6,
        0.06 + this.random() * 0.05,
        colour,
        PARTICLE_CONFETTI,
      );
    }
  }

  /**
   * Move every particle on.
   *
   * @param waterY The height of the surface: a bubble dies when it gets
   *   there, and a bubble never goes above it.
   */
  update(dt: number, waterY: number): void {
    this.time += dt;
    for (let i = 0; i < COUNT; i += 1) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const j = i * 3;
      const kind = this.kind[i];
      if (kind === PARTICLE_DROP) {
        this.velocity[j + 1] -= 9.8 * dt;
      } else if (kind === PARTICLE_STEAM) {
        // Steam slows, spreads and swells as it rises.
        this.velocity[j] *= 0.98;
        this.velocity[j + 2] *= 0.98;
        this.size[i] += dt * 0.08;
      } else if (kind === PARTICLE_FOAM) {
        // Foam stays on the surface and spreads out.
        this.velocity[j + 1] = 0;
        this.size[i] += dt * 0.25;
      } else if (kind === PARTICLE_BUBBLE) {
        // A bubble rises and wobbles about as it goes.
        this.velocity[j + 1] = 0.5;
        this.velocity[j] = 0.35 * Math.sin(this.time * 4);
        this.velocity[j + 2] = 0.35 * Math.cos(this.time * 3.1);
      } else if (kind === PARTICLE_SPARK) {
        // A spark falls a little faster than the air holds it up, and slows as it goes.
        this.velocity[j + 1] -= SPARK_GRAVITY * dt;
        this.velocity[j] *= 1 - 0.5 * dt;
        this.velocity[j + 1] *= 1 - 0.5 * dt;
        this.velocity[j + 2] *= 1 - 0.5 * dt;
      } else if (kind === PARTICLE_ROCKET) {
        // A rocket climbs at a steady speed; it is the only thing that does not fall.
        this.velocity[j + 1] = ROCKET_SPEED;
      } else if (kind === PARTICLE_PETAL) {
        // A petal drifts on the air as it falls, and on the water it floats.
        if (this.position[j + 1] > waterY) {
          this.velocity[j + 1] = -0.3;
          this.velocity[j] = 0.15 * Math.sin(this.life[i] * 1.7 + i);
          this.velocity[j + 2] = 0.15 * Math.cos(this.life[i] * 1.3 + i);
        } else {
          this.position[j + 1] = waterY + 0.01;
          this.velocity[j] = 0.04 * Math.sin(this.life[i] * 0.6 + i);
          this.velocity[j + 1] = 0;
          this.velocity[j + 2] = 0.04 * Math.cos(this.life[i] * 0.5 + i);
        }
      } else {
        // Confetti falls slowly and drifts.
        this.velocity[j + 1] = -0.6;
        this.velocity[j] += (this.random() - 0.5) * 0.6 * dt;
        this.velocity[j + 2] += (this.random() - 0.5) * 0.6 * dt;
      }
      this.position[j] += this.velocity[j] * dt;
      this.position[j + 1] += this.velocity[j + 1] * dt;
      this.position[j + 2] += this.velocity[j + 2] * dt;
      // A bubble that reaches the surface is gone.
      if (kind === PARTICLE_BUBBLE) {
        const top = Number.isNaN(this.surface[i]) ? waterY : this.surface[i];
        if (this.position[j + 1] >= top) {
          this.position[j + 1] = top;
          this.life[i] = 0;
        }
      }
      if (kind === PARTICLE_ROCKET) this.rocketStep(i, dt);
      const u = Math.max(0, this.life[i] / this.maxLife[i]);
      if (kind === PARTICLE_DROP) this.alpha[i] = 0.85 * u;
      else if (kind === PARTICLE_SPARK) this.alpha[i] = 0.95 * u;
      else if (kind === PARTICLE_ROCKET) this.alpha[i] = this.life[i] > 0 ? 1 : 0;
      else if (kind === PARTICLE_STEAM) this.alpha[i] = 0.35 * Math.sin(u * Math.PI);
      else if (kind === PARTICLE_FOAM) this.alpha[i] = 0.7 * u;
      else if (kind === PARTICLE_BUBBLE) this.alpha[i] = 0.7 * u;
      else if (kind === PARTICLE_PETAL) this.alpha[i] = 0.9 * Math.min(1, this.life[i] / 3);
      // The confetti turns over, so it flickers.
      else this.alpha[i] = 0.8 + 0.2 * Math.sin(this.life[i] * 20);
    }
    // The bursts and the trail sparks are made now, when the buffer is not
    // being read: a spawn in the middle of the loop could overwrite a rocket.
    for (let p = 0; p < this.pendingCount; p += 1) {
      const q = p * 4;
      if (this.pendingKind[p] === PARTICLE_ROCKET) {
        this.burst(this.pendingAt[q], this.pendingAt[q + 1], this.pendingAt[q + 2], this.pendingAt[q + 3]);
      } else {
        this.spawn(
          this.pendingAt[q],
          this.pendingAt[q + 1],
          this.pendingAt[q + 2],
          0,
          0.05,
          0,
          TRAIL_LIFE,
          TRAIL_SIZE,
          Particles.TRAIL,
          PARTICLE_SPARK,
        );
      }
    }
    this.pendingCount = 0;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aColour.needsUpdate = true;
  }

  /**
   * A rocket's trail and its burst, for the rocket in slot `i`. Called once
   * a frame, while the rocket is in the air; the work is queued, not done.
   */
  private rocketStep(i: number, dt: number): void {
    if (this.life[i] <= 0) {
      // Its life is out: it bursts where it is, and is not a rocket any more.
      this.queue(PARTICLE_ROCKET, this.position[i * 3], this.position[i * 3 + 1], this.position[i * 3 + 2], this.surface[i]);
      this.kind[i] = PARTICLE_DROP;
      this.alpha[i] = 0;
      return;
    }
    this.trailIn[i] -= dt;
    while (this.trailIn[i] <= 0) {
      this.trailIn[i] += TRAIL_EVERY;
      this.queue(PARTICLE_SPARK, this.position[i * 3], this.position[i * 3 + 1], this.position[i * 3 + 2], 0);
    }
  }

  /** Queue a burst or a trail spark, for after the loop. A full queue drops the spark. */
  private queue(kind: number, x: number, y: number, z: number, pair: number): void {
    if (this.pendingCount >= PENDING) return;
    const q = this.pendingCount * 4;
    this.pendingAt[q] = x;
    this.pendingAt[q + 1] = y;
    this.pendingAt[q + 2] = z;
    this.pendingAt[q + 3] = pair;
    this.pendingKind[this.pendingCount] = kind;
    this.pendingCount += 1;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Rain: short streaks falling over the deck.
 *
 * The rain follows the weather clock (`weather.ts`). The streaks are one set
 * of line segments, moved on the
 * CPU; when the rain stops they are simply not drawn.
 */
export class Rain {
  readonly lines: LineSegments;
  private readonly positions: Float32Array;
  private readonly speeds: Float32Array;
  private readonly count: number;
  private readonly area: { minX: number; maxX: number; minZ: number; maxZ: number };
  private readonly material: LineBasicMaterial;
  private seed = 7;

  constructor(area: { minX: number; maxX: number; minZ: number; maxZ: number }, count = 900) {
    this.area = area;
    this.count = count;
    this.positions = new Float32Array(count * 6);
    this.speeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) this.reset(i, true);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.material = new LineBasicMaterial({ color: '#dbe9f5', transparent: true, opacity: 0, depthWrite: false });
    this.lines = new LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
  }

  private random(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  private reset(i: number, anywhere: boolean): void {
    const x = this.area.minX + this.random() * (this.area.maxX - this.area.minX);
    const z = this.area.minZ + this.random() * (this.area.maxZ - this.area.minZ);
    const y = anywhere ? this.random() * 12 : 10 + this.random() * 3;
    const j = i * 6;
    this.positions[j] = x;
    this.positions[j + 1] = y;
    this.positions[j + 2] = z;
    this.positions[j + 3] = x - 0.04;
    this.positions[j + 4] = y + 0.35;
    this.positions[j + 5] = z;
    this.speeds[i] = 9 + this.random() * 3;
  }

  /**
   * @param amount 0 to 1, how hard it rains.
   * @param onDrop Called for a drop that lands in the water, now and then.
   */
  update(dt: number, amount: number, waterY: number, onDrop: (x: number, z: number) => void): void {
    this.material.opacity = 0.5 * amount;
    this.lines.visible = amount > 0.01;
    if (!this.lines.visible) return;
    const active = Math.floor(this.count * amount);
    for (let i = 0; i < this.count; i += 1) {
      const j = i * 6;
      if (i >= active) {
        this.positions[j + 1] = -50;
        this.positions[j + 4] = -50;
        continue;
      }
      const fall = this.speeds[i] * dt;
      this.positions[j + 1] -= fall;
      this.positions[j + 4] -= fall;
      this.positions[j] -= fall * 0.1;
      this.positions[j + 3] -= fall * 0.1;
      if (this.positions[j + 1] < waterY) {
        if (i % 40 === 0) onDrop(this.positions[j], this.positions[j + 2]);
        this.reset(i, false);
      }
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}
