/**
 * The weather's life (Sprints 26.6 and 26.7): the hurrying walkers, the towel
 * over the head in the rain, the lean, the calm after two minutes with nobody
 * working, the cat's choices in the calm, and the wind's pull on the flags and
 * the duck. All of it is pure, so it is checked here in node.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loungePose, zeroPose, type Motion } from '../src/scene/characters/poses';
import { specFor } from '../src/scene/characters/spec';
import { ACTIONS } from '../src/scene/motion/actions';
import { PoseDriver } from '../src/scene/motion/driver';
import { paletteFor } from '../src/scene/pool3d/daylight';
import { fbm } from '../src/scene/characters/noise';
import { flagTilt, fountainsOn } from '../src/scene/pool3d/equipment';
import {
  CreatureDirector,
  gustScale,
  windAt,
  type CreaturePerson,
  type CreatureWorld,
} from '../src/scene/pool3d/creatures';
import { abortsErrand, createBody, walkSpeedOf, WALK_SPEED, type Body } from '../src/scene/pool3d/flow';
import type { ErrandKind } from '../src/scene/pool3d/errands';
import {
  CALM_AFTER_S,
  CALM_EASE_S,
  CALM_WAVES,
  COVER_PROP,
  calmAmount,
  isCalm,
  isRaining,
  rainLean,
  RAIN_LEAN,
  stepCalm,
  waveScale,
  wantsCover,
  workedAt,
  type CoverInputs,
} from '../src/scene/pool3d/weatherLife';
import { buildWorld, queueSpot, type World } from '../src/scene/pool3d/world';

const ALL_ERRANDS: ErrandKind[] = ['shower', 'kiosk', 'hotTub', 'pingPong', 'ballGame', 'chat', 'stroll', 'towel', 'sunscreen'];
const OUTDOOR: ErrandKind[] = ['ballGame', 'pingPong', 'stroll', 'chat'];
const INDOOR: ErrandKind[] = ALL_ERRANDS.filter((k) => !OUTDOOR.includes(k));

/** A body with an errand of `kind`, on its lounger and wanting nothing else. */
function errandBody(kind: ErrandKind | null, hurry: boolean): Body {
  const world = buildWorld(null);
  const body = createBody('walker', 1.6, 0.5, 1, queueSpot(world, 0));
  body.desired = 'lounge';
  body.needsYou = false;
  body.hurry = hurry;
  body.errand =
    kind === null
      ? null
      : {
          kind,
          phase: 'going',
          spot: { x: 0, z: 0, yaw: 0 },
          slot: '',
          startedAt: 0,
        } as unknown as Body['errand'];
  return body;
}

// --- 26.6: the hurry ---------------------------------------------------------

test('a hurrying walker is 1.2 times as quick, and a stroll is slower still', () => {
  const plain = errandBody(null, false);
  const hurried = errandBody(null, true);
  assert.equal(walkSpeedOf(plain), WALK_SPEED * (0.9 + 0.2 * plain.speedScale));
  assert.ok(Math.abs(walkSpeedOf(hurried) / walkSpeedOf(plain) - 1.2) < 1e-9, 'the hurry is 1.2 times the walk');
  // A stroll (walkScale 0.75) keeps its slower pace when it hurries.
  const stroll = { ...plain, walkScale: 0.75 };
  assert.ok(Math.abs(walkSpeedOf({ ...stroll, hurry: true }) / walkSpeedOf(stroll) - 1.2) < 1e-9);
});

test('in the rain the outdoor errands end, and the indoor ones carry on', () => {
  for (const kind of OUTDOOR) {
    assert.equal(abortsErrand(errandBody(kind, true)), true, `${kind} ends when it rains`);
    assert.equal(abortsErrand(errandBody(kind, false)), false, `${kind} goes on when it does not`);
  }
  for (const kind of INDOOR) {
    assert.equal(abortsErrand(errandBody(kind, true)), false, `${kind} is indoors and goes on in the rain`);
  }
});

test('an errand ends at once when the agent wants something else or needs the person, rain or not', () => {
  const indoor = errandBody('hotTub', false);
  assert.equal(abortsErrand({ ...indoor, desired: 'swim' }), true, 'it wants the water');
  assert.equal(abortsErrand({ ...indoor, needsYou: true }), true, 'it needs the person');
  assert.equal(abortsErrand(errandBody(null, true)), false, 'no errand, nothing to end');
});

// --- 26.6: the lean ----------------------------------------------------------

test('a walker in the rain leans forward only while it hurries and walks', () => {
  assert.equal(rainLean(true, true), RAIN_LEAN);
  assert.equal(RAIN_LEAN, 0.15);
  assert.equal(rainLean(true, false), 0, 'standing still it does not lean');
  assert.equal(rainLean(false, true), 0, 'not hurrying it does not lean');
  assert.equal(isRaining(0.31), true);
  assert.equal(isRaining(0.3), false, 'the rain starts above 0.3');
});

// --- 26.6: the cover ---------------------------------------------------------

const COVERED: CoverInputs = {
  raining: true,
  lounging: true,
  onErrand: false,
  needsYou: false,
  inWater: false,
  inEntry: false,
  doingActivity: false,
  hasVariant: false,
};

test('a figure on its lounger covers its head in the rain', () => {
  assert.equal(wantsCover(COVERED), true);
  assert.equal(wantsCover({ ...COVERED, raining: false }), false, 'not in the rain');
  assert.equal(wantsCover({ ...COVERED, lounging: false }), false, 'not lounging');
});

test('the cover is not started during an errand, an idle activity, a request for the person or a lounge variant', () => {
  const blocks: (keyof CoverInputs)[] = ['onErrand', 'needsYou', 'inWater', 'inEntry', 'doingActivity', 'hasVariant'];
  for (const key of blocks) {
    assert.equal(wantsCover({ ...COVERED, [key]: true }), false, `${key} stops the cover`);
  }
});

test('the cover is the lounge with the arms up, the elbows bent and the head bowed, and it replaces the pose', () => {
  assert.equal(ACTIONS.cover.mode, 'replace');
  const motion: Motion = { t: 3, seed: 11 };
  const pose = zeroPose();
  ACTIONS.cover.pose(pose, 0.5, motion);
  const lounge = loungePose(zeroPose(), motion);
  assert.equal(pose.bodyPitch, lounge.bodyPitch, 'built on the lounge pose');
  assert.ok(pose.armL < -2 && pose.armR < -2, 'both arms up (negative is up, as in the cheer)');
  assert.ok(pose.elbowL > 1.5 && pose.elbowR > 1.5, 'the elbows are bent');
  assert.ok(pose.headPitch < lounge.headPitch, 'the head bows further than the lounge look');
  assert.ok(pose.headPitch < 0, 'a negative head pitch is forwards and down, so a bow and not a tilt back');
});

test('the cover holds the towel, and the driver shows the arms up once it is held', () => {
  assert.equal(COVER_PROP, 'towel');
  const driver = new PoseDriver(specFor('held'));
  driver.setCarry(COVER_PROP);
  driver.hold('cover');
  for (let t = 0; t < 1500; t += 16) driver.update(16);
  assert.equal(driver.action, 'cover', 'the cover goes on while held');
  assert.ok(driver.currentPose.armL < -1 && driver.currentPose.armR < -1, 'the arms are up');
  assert.ok(driver.currentPose.headPitch < 0, 'the head is bowed');
  driver.release();
  for (let t = 0; t < 3000; t += 16) driver.update(16);
  assert.equal(driver.action, null, 'released, the cover ends');
});

// --- 26.7: the calm ----------------------------------------------------------

test('the pool is calm after two minutes with nobody working, and not before', () => {
  assert.equal(CALM_AFTER_S, 120);
  assert.equal(isCalm(CALM_AFTER_S - 0.01), false);
  assert.equal(isCalm(CALM_AFTER_S), true);
});

test('the time of the last work moves on only while somebody works', () => {
  assert.equal(workedAt(10, 50, true), 50, 'working now: the time is now');
  assert.equal(workedAt(10, 50, false), 10, 'nobody working: the time stays');
});

/** Run the calm over `frames` frames at `dt`, from `progress`, with the calm fixed. */
function easeFor(progress: number, calm: boolean, seconds: number, dt = 1 / 60): number {
  let p = progress;
  for (let t = 0; t < seconds - 1e-9; t += dt) p = stepCalm(p, calm, dt);
  return p;
}

test('the waves fall to 0.4 of their size, eased over ten seconds, and come back over ten', () => {
  assert.equal(CALM_EASE_S, 10);
  assert.equal(CALM_WAVES, 0.4);
  assert.equal(waveScale(0), 1, 'lively: the waves are their full size');
  assert.ok(Math.abs(waveScale(1) - 0.4) < 1e-12, 'calm: 0.4 of their size');
  const halfway = easeFor(0, true, 5);
  assert.ok(Math.abs(halfway - 0.5) < 0.01, `halfway after five seconds, was ${halfway}`);
  assert.equal(easeFor(0, true, 10), 1, 'fully calm after ten seconds');
  assert.equal(easeFor(0, true, 30), 1, 'and stays there');
  assert.equal(easeFor(1, false, 10), 0, 'back to lively after ten seconds of work');
});

test('the eased calm is smooth at both ends, and monotone between them', () => {
  assert.equal(calmAmount(0), 0);
  assert.equal(calmAmount(1), 1);
  assert.equal(calmAmount(0.5), 0.5);
  assert.ok(calmAmount(0.1) < 0.1, 'it starts slowly');
  let last = -1;
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const a = calmAmount(p);
    assert.ok(a >= last - 1e-12 && a >= 0 && a <= 1);
    last = a;
  }
});

test('a simulated scene: work, then 120 seconds of quiet, then calm; work again starts to lift it at once', () => {
  // Frames of a tenth of a second. Somebody works in frames 0..499 (to 50 s) and in frame 3000 (300 s).
  const dt = 1 / 10;
  let lastWorkingAt = 0;
  let progress = 0;
  let calmFrame = -1;
  const progressAt: number[] = [];
  for (let frame = 0; frame <= 4000; frame += 1) {
    const time = frame * dt;
    const working = frame < 500 || frame === 3000;
    lastWorkingAt = workedAt(lastWorkingAt, time, working);
    const calm = isCalm(time - lastWorkingAt);
    if (calm && calmFrame < 0) calmFrame = frame;
    progress = stepCalm(progress, calm, dt);
    progressAt[frame] = progress;
  }
  // The last work was at 49.9 s, so the calm starts at 169.9 s, when the quiet reaches 120 s.
  assert.equal(calmFrame, 1699, 'calm from 170 s');
  assert.equal(progressAt[1698], 0, 'the calm has not begun before its first frame');
  assert.ok(progressAt[1699] > 0 && progressAt[1699] < 0.05, 'it eases from the first frame of calm');
  assert.ok(progressAt[2900] === 1, 'fully calm long before the work returns');
  assert.ok(progressAt[3000] < 1, 'work at 300 s lifts the calm at once');
  assert.ok(progressAt[3010] < progressAt[3000], 'and keeps lifting it');
});

test('the fountains stop while the pool is calm, even when they were started', () => {
  assert.equal(fountainsOn(10, false, -1), true, 'the first forty seconds of a period run');
  assert.equal(fountainsOn(50, false, -1), false, 'then they rest');
  assert.equal(fountainsOn(130, false, -1), true, 'and run again at the next period');
  assert.equal(fountainsOn(50, false, 60), true, 'a busy start keeps them on for forty seconds');
  assert.equal(fountainsOn(50, true, 60), false, 'calm stops them even then');
  assert.equal(fountainsOn(10, true, -1), false, 'and in a period');
});

// --- 26.7: the cat in the calm -----------------------------------------------

const HOUR_S = 900;
const DT = 0.1;

/** The cat's states over `hours` of a sunny morning, with the calm as given. */
function catStatesIn(calm: boolean, hours: number): Set<string> {
  const world = buildWorld(null);
  const director = new CreatureDirector(26);
  const people: CreaturePerson[] = [];
  const seen = new Set<string>();
  const start = 9 * HOUR_S;
  for (let t = start; t < start + hours * HOUR_S; t += DT) {
    const hour = 9 + (t - start) / HOUR_S;
    const env: CreatureWorld = {
      world,
      hour,
      light: paletteFor(hour).light,
      raining: false,
      reducedMotion: false,
      calm,
      sprinkler: false,
      people,
      splashes: [],
      avoid: [],
      naps: [],
    };
    director.step(DT, t, env);
    seen.add(director.creatures.find((c) => c.kind === 'cat')?.state ?? 'none');
  }
  return seen;
}

test('in the calm the cat prefers to watch the still water or to sleep, and does not groom', () => {
  const calmStates = catStatesIn(true, 6);
  assert.equal(calmStates.has('groom'), false, 'no grooming while the pool is calm');
  assert.ok(calmStates.has('sleep') || calmStates.has('watch'), `the cat sleeps or watches: ${[...calmStates]}`);
  // The control: with the water lively the cat does groom, so the test is not vacuous.
  assert.ok(catStatesIn(false, 6).has('groom'), 'the lively pool has grooming');
});

// --- 26.6: the wind on the flags and the duck --------------------------------

/** The calmest and the windiest moments of the first hour, by the wind. */
function calmestAndWindiest(): { calm: number; windy: number } {
  let calm = 0;
  let windy = 0;
  for (let t = 0; t < 3600; t += 1) {
    if (windAt(t) < windAt(calm)) calm = t;
    if (windAt(t) > windAt(windy)) windy = t;
  }
  return { calm, windy };
}

test('the wind scales the flags and the duck: today\'s motion in a calm, more in a strong wind', () => {
  const { calm, windy } = calmestAndWindiest();
  assert.ok(windAt(windy) - windAt(calm) > 0.3, 'the hour has a calm and a strong wind');
  assert.ok(Math.abs(gustScale(calm) - 1) < 0.2, 'nearly today\'s motion in the calm');
  assert.ok(gustScale(windy) > gustScale(calm) + 0.3, 'more in the strong wind');
  for (let t = 0; t < 3600; t += 97) {
    assert.ok(Math.abs(gustScale(t) - (1 + windAt(t))) < 1e-12);
  }
  for (let i = 0; i < 14; i += 1) {
    assert.equal(flagTilt(windy, i), 0.15 * fbm(windy * 0.6, 1200 + i) * gustScale(windy), `flag ${i} at the wind`);
    assert.equal(flagTilt(calm, i), 0.15 * fbm(calm * 0.6, 1200 + i) * gustScale(calm), `flag ${i} in the calm`);
  }
});

/** The distance a paddling duck covers in `seconds`, starting at `t0`, in the sun. */
function paddleDistance(t0: number, seconds: number): number {
  const world = buildWorld(null);
  const director = new CreatureDirector(26);
  const people: CreaturePerson[] = [];
  const env = (t: number): CreatureWorld => ({
    world,
    hour: 13,
    light: paletteFor(13).light,
    raining: false,
    reducedMotion: false,
    calm: false,
    sprinkler: false,
    people,
    splashes: [],
    avoid: [],
    naps: [],
  });
  // Bring the duck in, then wait until it is paddling.
  director.step(DT, t0, env(t0));
  director.callDuck();
  let t = t0;
  const limit = t0 + 60;
  let duck = director.creatures.find((c) => c.kind === 'duck');
  while (t < limit) {
    t += DT;
    director.step(DT, t, env(t));
    duck = director.creatures.find((c) => c.kind === 'duck');
    if (duck && duck.state === 'paddle') break;
  }
  assert.ok(duck && duck.state === 'paddle', 'the duck is paddling');
  let total = 0;
  const end = t + seconds;
  let last = { x: duck.x, z: duck.z };
  while (t < end) {
    t += DT;
    director.step(DT, t, env(t));
    const d = director.creatures.find((c) => c.kind === 'duck');
    if (!d || d.state !== 'paddle') break;
    total += Math.hypot(d.x - last.x, d.z - last.z);
    last = { x: d.x, z: d.z };
  }
  return total;
}

test('the duck drifts faster in a strong wind than in a calm, and the same as today in a calm', () => {
  const { calm, windy } = calmestAndWindiest();
  // Start the duck's paddle at the calm and at the windy moment of the hour.
  const calmDistance = paddleDistance(calm, 3);
  const windyDistance = paddleDistance(windy, 3);
  assert.ok(calmDistance > 0 && windyDistance > 0, 'the duck moves in both');
  assert.ok(windyDistance > calmDistance * 1.2, `windy ${windyDistance.toFixed(3)} m, calm ${calmDistance.toFixed(3)} m`);
});
