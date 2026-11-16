/**
 * The camera tour: the orbit, the looks at what happens, and the limits the
 * camera keeps. Pure, so it is checked here in node with a simulated clock.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_DISTANCE, MAX_POLAR, MIN_DISTANCE, MIN_POLAR } from '../src/scene/pool3d/camera';
import {
  FOCUS_S,
  createTourState,
  createTourView,
  tourStep,
  type Interest,
  type TourState,
  type TourView,
} from '../src/scene/pool3d/director';
import { buildWorld, type World } from '../src/scene/pool3d/world';

const DT = 1 / 30;

interface Tour {
  world: World;
  state: TourState;
  view: TourView;
  /** The scene time, in seconds, after the last frame. */
  t: number;
}

function setup(): Tour {
  const world = buildWorld(null);
  const state = createTourState(0.9, 20, 0, { x: 0, y: 0.3, z: 0 });
  return { world, state, view: createTourView(), t: 0 };
}

/** One frame of the tour, with the interests that arrive in it. */
function frame(tour: Tour, interests: Interest[] = []): TourView {
  tour.t += DT;
  return tourStep(tour.state, DT, tour.t, interests, tour.world, tour.view);
}

/** An interest that happens at the time of the next frame. */
function next(tour: Tour, weight: number, x = 0, z = 0): Interest {
  return { x, y: 0.5, z, weight, at: tour.t + DT };
}

test('with no interests the azimuth only grows', () => {
  const tour = setup();
  let last = tour.state.azimuth;
  for (let i = 0; i < 600; i += 1) {
    frame(tour);
    assert.ok(tour.state.azimuth > last, 'the azimuth did not grow');
    last = tour.state.azimuth;
  }
  // Twenty seconds at 0.035 rad a second.
  assert.ok(Math.abs(tour.state.azimuth - 0.035 * 20) < 0.01, `the azimuth is ${tour.state.azimuth}`);
});

test('the orbit keeps the polar angle and the distance of the default view', () => {
  const tour = setup();
  const v = frame(tour);
  assert.equal(v.polar, 0.9);
  assert.equal(v.distance, 20);
});

test('at half speed the orbit turns at half the rate', () => {
  const tour = setup();
  tour.state.speed = 0.5;
  for (let i = 0; i < 300; i += 1) frame(tour);
  assert.ok(Math.abs(tour.state.azimuth - 0.035 * 0.5 * 10) < 0.01, `the azimuth is ${tour.state.azimuth}`);
});

test('an interest of weight 2 takes the focus at once and keeps it for seven seconds', () => {
  const tour = setup();
  frame(tour, [next(tour, 2, 6, 3)]);
  assert.ok(tour.state.focus !== null, 'no focus was taken');
  assert.equal(tour.state.focus!.x, 6);
  assert.ok(Math.abs(tour.state.focusUntil - (tour.t + FOCUS_S)) < 1e-9, 'the focus does not last seven seconds');
  for (let i = 0; i < 6 * 30; i += 1) frame(tour);
  assert.ok(tour.state.focus !== null, 'the focus was given up before seven seconds');
  for (let i = 0; i < 2 * 30; i += 1) frame(tour);
  assert.equal(tour.state.focus, null, 'the focus is still held after seven seconds');
});

test('a second interest of weight 1.5 during the focus does not take it', () => {
  const tour = setup();
  frame(tour, [next(tour, 2, 6, 3)]);
  frame(tour, [next(tour, 1.5, -5, 4)]);
  assert.equal(tour.state.focus!.x, 6);
  assert.equal(tour.state.focusWeight, 2);
});

test('an interest of weight 3 takes the focus during a focus of weight 2', () => {
  const tour = setup();
  frame(tour, [next(tour, 2, 6, 3)]);
  frame(tour, [next(tour, 3, -5, 4)]);
  assert.equal(tour.state.focus!.x, -5);
  assert.equal(tour.state.focusWeight, 3);
});

test('an interest below weight 1 is not looked at, and an old one is not looked at again', () => {
  const tour = setup();
  frame(tour, [next(tour, 0.5, 6, 3)]);
  assert.equal(tour.state.focus, null);
  const interest = next(tour, 2, 6, 3);
  frame(tour, [interest]);
  assert.ok(tour.state.focus !== null);
  const until = tour.state.focusUntil;
  // The same interest, given again, does not start the focus over.
  frame(tour, [interest]);
  assert.equal(tour.state.focusUntil, until);
});

test('the camera glides to the focus; it does not jump there', () => {
  const tour = setup();
  frame(tour, [next(tour, 2, 10, 0)]);
  const v = frame(tour);
  assert.ok(v.target.x > 0 && v.target.x < 10, `the look is at ${v.target.x}`);
});

test('every target is over the deck, and every polar angle and distance is within its limits', () => {
  const tour = setup();
  const deck = tour.world.deck;
  for (let i = 0; i < 1800; i += 1) {
    const batch: Interest[] = [];
    if (i % 100 === 0) batch.push(next(tour, 2, 999, 999));
    if (i % 300 === 150) batch.push(next(tour, 3, -999, -999));
    if (i % 450 === 300) batch.push(next(tour, 1, deck.minX, deck.maxZ));
    const v = frame(tour, batch);
    assert.ok(v.target.x >= deck.minX && v.target.x <= deck.maxX, `x ${v.target.x} is off the deck`);
    assert.ok(v.target.z >= deck.minZ && v.target.z <= deck.maxZ, `z ${v.target.z} is off the deck`);
    assert.ok(v.polar >= MIN_POLAR && v.polar <= MAX_POLAR, `polar ${v.polar}`);
    assert.ok(v.distance >= MIN_DISTANCE && v.distance <= MAX_DISTANCE, `distance ${v.distance}`);
  }
});

test('a view that is too low or too far is brought within the limits', () => {
  const world = buildWorld(null);
  const state = createTourState(0.01, 500, 0, { x: 0, y: 0, z: 0 });
  const v = tourStep(state, DT, 0, [], world, createTourView());
  assert.equal(v.polar, MIN_POLAR);
  assert.equal(v.distance, MAX_DISTANCE);
});
