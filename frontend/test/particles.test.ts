/**
 * The particle pool: the foam, the bubbles and the confetti.
 *
 * Three.js builds the points without a GPU, so the pool can be watched
 * here, in node, with no renderer at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PARTICLE_BUBBLE,
  PARTICLE_CONFETTI,
  PARTICLE_FOAM,
  PARTICLE_ROCKET,
  PARTICLE_SPARK,
  Particles,
} from '../src/scene/pool3d/effects3d';

const WATER_Y = -0.18;

test('the pool of particles takes more than it can hold, and does not fall over', () => {
  const particles = new Particles();
  for (let i = 0; i < 2000; i += 1) {
    particles.foam(i * 0.01, 0, WATER_Y + 0.01, 0.1);
    particles.bubbles(i * 0.01, -0.6, 0, 2);
    particles.confetti(i * 0.01, 1, 0, 3);
  }
  // The ring buffer wrapped: the first particles are the ones that were
  // put in last.
  let alive = 0;
  for (let i = 0; i < particles.life.length; i += 1) if (particles.life[i] > 0) alive += 1;
  assert.ok(alive > 0, 'nothing is alive');
  assert.ok(alive <= particles.life.length);
  particles.update(1 / 60, WATER_Y);
  particles.dispose();
});

test('the foam stays on the surface it was put on', () => {
  const particles = new Particles();
  particles.foam(1, 2, WATER_Y + 0.012, 0.14);
  let found = -1;
  for (let i = 0; i < particles.life.length; i += 1) {
    if (particles.kind[i] === PARTICLE_FOAM) found = i;
  }
  assert.ok(found >= 0, 'no foam was made');
  const y = particles.position[found * 3 + 1];
  for (let step = 0; step < 120; step += 1) particles.update(1 / 60, WATER_Y);
  assert.ok(Math.abs(particles.position[found * 3 + 1] - y) < 1e-9, 'the foam moved');
  particles.dispose();
});

test('a bubble never comes up above the surface', () => {
  const particles = new Particles();
  particles.bubbles(0, -0.8, 0, 4);
  let bubbles = 0;
  for (let i = 0; i < particles.life.length; i += 1) {
    if (particles.kind[i] === PARTICLE_BUBBLE) bubbles += 1;
  }
  assert.equal(bubbles, 4);
  for (let step = 0; step < 600; step += 1) {
    particles.update(1 / 60, WATER_Y);
    for (let i = 0; i < particles.life.length; i += 1) {
      if (particles.kind[i] !== PARTICLE_BUBBLE) continue;
      assert.ok(
        particles.position[i * 3 + 1] <= WATER_Y + 1e-9,
        'a bubble came up out of the water',
      );
    }
  }
  particles.dispose();
});

test('a firework makes at most 150 particles in all, and they are all dead five seconds later', () => {
  const particles = new Particles();
  particles.firework(2, -10);
  let made = 0;
  let rockets = 0;
  let sparks = 0;
  // Every slot that was used for the firework: the buffer is fresh, so
  // none is reused in this test.
  for (let i = 0; i < particles.life.length; i += 1) {
    if (particles.maxLife[i] > 0) made += 1;
  }
  assert.equal(made, 1, 'the rocket is the only particle at the start');
  for (let step = 0; step < 300; step += 1) {
    particles.update(1 / 60, WATER_Y);
    for (let i = 0; i < particles.life.length; i += 1) {
      if (particles.maxLife[i] > 0 && particles.kind[i] === PARTICLE_ROCKET && particles.life[i] > 0) rockets += 1;
      if (particles.maxLife[i] > 0 && particles.kind[i] === PARTICLE_SPARK) sparks += 1;
    }
  }
  made = 0;
  for (let i = 0; i < particles.life.length; i += 1) {
    if (particles.maxLife[i] > 0) made += 1;
  }
  assert.ok(made <= 150, `a firework made ${made} particles`);
  assert.ok(sparks >= 90, `only ${sparks} sparks were seen`);
  assert.ok(rockets > 0, 'the rocket was never seen in the air');
  for (let step = 0; step < 300; step += 1) particles.update(1 / 60, WATER_Y);
  let alive = 0;
  for (let i = 0; i < particles.life.length; i += 1) if (particles.life[i] > 0) alive += 1;
  assert.equal(alive, 0, 'something of the firework is still alive after five seconds');
  particles.dispose();
});

test('a rocket climbs, and its burst comes out of the top of its climb', () => {
  const particles = new Particles();
  particles.firework(0, 0);
  let top = 0;
  for (let step = 0; step < 66; step += 1) {
    particles.update(1 / 60, WATER_Y);
    for (let i = 0; i < particles.life.length; i += 1) {
      if (particles.kind[i] === PARTICLE_ROCKET && particles.life[i] > 0) top = Math.max(top, particles.position[i * 3 + 1]);
    }
  }
  // Six metres a second for 0.85 s, and the rocket starts at 0.2 m: about
  // five metres up, low enough for the default view to show the burst.
  assert.ok(top > 4.5 && top < 5.8, `the rocket reached ${top} m`);
  // The sparks of the burst start at the top, not at the ground.
  let lowest = Number.POSITIVE_INFINITY;
  for (let step = 0; step < 30; step += 1) {
    particles.update(1 / 60, WATER_Y);
    for (let i = 0; i < particles.life.length; i += 1) {
      if (particles.kind[i] === PARTICLE_SPARK && particles.life[i] > 1.2) lowest = Math.min(lowest, particles.position[i * 3 + 1]);
    }
  }
  // Half a second after the burst a spark has fallen and flown out at most
  // about two and a half metres from the five-metre top.
  assert.ok(lowest > 2, `a burst spark was at ${lowest} m`);
  particles.dispose();
});

test('the confetti has eight bright colours to choose from', () => {
  const particles = new Particles();
  particles.confetti(0, 1, 0, 200);
  const seen = new Set<string>();
  for (let i = 0; i < particles.life.length; i += 1) {
    if (particles.kind[i] !== PARTICLE_CONFETTI) continue;
    seen.add(`${particles.colour[i * 3]},${particles.colour[i * 3 + 1]},${particles.colour[i * 3 + 2]}`);
  }
  assert.equal(seen.size, 8);
  particles.dispose();
});
