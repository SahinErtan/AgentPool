/**
 * The 3D character and the motion core that drives it.
 *
 * Three.js builds geometry and bones without a GPU, so the rig can be built
 * and posed here; only drawing it needs a browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';

import { specFor, ARCHETYPES, type Accessory, type Archetype } from '../src/scene/characters/spec';
import { POSE_KEYS, SWIM_STYLES, zeroPose } from '../src/scene/characters/poses';
import { PoseDriver } from '../src/scene/motion/driver';
import { ANKLE, BONES, HEAD_SCALE_3D, buildSkeleton3D, restPosition } from '../src/scene/characters3d/skeleton3d';
import { hairStyleFor, type HairStyle } from '../src/scene/characters3d/hair';
import { buildRig3D } from '../src/scene/characters3d/rig3d';
import { applyPose3D } from '../src/scene/characters3d/apply3d';
import { backRest, buildWorld, CHARACTER_HEIGHT } from '../src/scene/pool3d/world';
import { clampTarget, defaultView, MAX_POLAR, MIN_POLAR, viewPosition } from '../src/scene/pool3d/camera';
import { separateLabels } from '../src/scene/pool3d/overlay';

const IDS = Array.from({ length: 40 }, (_, i) => `agent-${i}-${(i * 7919) % 1000}`);

test('a new pose field starts at zero, so the rig never sees a stale value', () => {
  const pose = zeroPose();
  for (const key of POSE_KEYS) assert.equal(pose[key], 0, key);
  assert.equal(POSE_KEYS.length, Object.keys(pose).length);
});

test('every stroke sets the 3D fields on every frame, and keeps them finite', () => {
  const spec = specFor('stroke');
  for (const [name, style] of Object.entries(SWIM_STYLES)) {
    const pose = zeroPose();
    for (let i = 0; i <= 200; i += 1) {
      // Fill the pose with junk first: a field the stroke forgets to set
      // would keep the junk.
      for (const key of POSE_KEYS) pose[key] = 99;
      // The twist and the wrist are for the activities, not the strokes: a
      // stroke that does not use them leaves them at rest. The same goes for
      // the turn of the upper body, which only the stretch uses.
      pose.armTwistL = 0;
      pose.armTwistR = 0;
      pose.wristL = 0;
      pose.wristR = 0;
      pose.torso = 0;
      style.fn(pose, i / 200, spec);
      for (const key of POSE_KEYS) {
        assert.ok(Number.isFinite(pose[key]) && Math.abs(pose[key]) < 10, `${name} ${key} at ${i}`);
      }
    }
  }
});

test('the 3D parts of every stroke move without a jump', () => {
  const spec = specFor('stroke');
  const keys = ['spine', 'roll', 'armOutL', 'armOutR', 'legOutL', 'legOutR'] as const;
  for (const [name, style] of Object.entries(SWIM_STYLES)) {
    const a = zeroPose();
    const b = zeroPose();
    for (let i = 0; i < 400; i += 1) {
      style.fn(a, i / 400, spec);
      style.fn(b, (i + 1) / 400, spec);
      for (const key of keys) {
        assert.ok(Math.abs(a[key] - b[key]) < 0.2, `${name} ${key} jumps at ${i}`);
      }
    }
  }
});

test('the breaststroke and the butterfly are symmetric; the crawl recovers round the side', () => {
  const spec = specFor('stroke');
  const pose = zeroPose();
  for (let i = 0; i < 100; i += 1) {
    for (const name of ['breaststroke', 'butterfly'] as const) {
      SWIM_STYLES[name].fn(pose, i / 100, spec);
      assert.equal(pose.armOutL, pose.armOutR);
      assert.equal(pose.legOutL, pose.legOutR);
      assert.equal(pose.armL, pose.armR);
    }
  }
  // Somewhere in the cycle each arm of the crawl is well out to the side.
  let widest = 0;
  for (let i = 0; i < 100; i += 1) {
    SWIM_STYLES.crawl.fn(pose, i / 100, spec);
    widest = Math.max(widest, pose.armOutR);
  }
  assert.ok(widest > 0.4);
});

test('the crawl rolls the body shoulder to shoulder', () => {
  const spec = specFor('stroke');
  const pose = zeroPose();
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < 100; i += 1) {
    SWIM_STYLES.crawl.fn(pose, i / 100, spec);
    lo = Math.min(lo, pose.roll);
    hi = Math.max(hi, pose.roll);
  }
  assert.ok(lo < -0.4 && hi > 0.4);
});

test('the pose driver keeps its own clock: two characters breathe out of step', () => {
  const a = new PoseDriver(specFor('one'));
  const b = new PoseDriver(specFor('two'));
  let same = 0;
  for (let i = 0; i < 300; i += 1) {
    const pa = a.update(16).bodyPitch;
    const pb = b.update(16).bodyPitch;
    if (Math.abs(pa - pb) < 1e-4) same += 1;
  }
  assert.ok(same < 30);
});

test('the driver says which prop is in the hand, and only during the activity', () => {
  const spec = specFor('tea', 'subagent', { idleActivity: 'tea' });
  const driver = new PoseDriver(spec);
  assert.equal(driver.prop, null);
  driver.setState('lounging');
  driver.forceActivity(0.4);
  driver.update(16);
  assert.equal(driver.prop, 'cup');
  driver.setState('walking');
  driver.update(16);
  assert.equal(driver.prop, null);
});

// --- the skeleton ------------------------------------------------------

test('every archetype stands on the ground, about one unit tall', () => {
  for (const archetype of Object.keys(ARCHETYPES) as Archetype[]) {
    const sk = buildSkeleton3D(specFor('x', 'subagent', { archetype }));
    const foot = restPosition(sk, 'footL');
    assert.ok(Math.abs(foot.y - ANKLE) < 1e-9, `${archetype} floats`);
    const head = restPosition(sk, 'head');
    const top = head.y + sk.headR;
    assert.ok(top > 0.9 && top < 1.08, `${archetype} is ${top.toFixed(2)} tall`);
    // The order of the joints from the feet up.
    const knee = restPosition(sk, 'kneeL').y;
    const hip = restPosition(sk, 'hips').y;
    const shoulder = restPosition(sk, 'shoulderL').y;
    const neck = restPosition(sk, 'neck').y;
    assert.ok(foot.y < knee && knee < hip && hip < shoulder && shoulder < neck && neck < head.y);
    // The hand hangs about at the hip, not at the knee or the chest.
    const hand = restPosition(sk, 'handL').y;
    assert.ok(hand > knee && hand < shoulder);
  }
});

test('the left of the figure is +x, the way it faces is +z', () => {
  const sk = buildSkeleton3D(specFor('x'));
  assert.ok(restPosition(sk, 'shoulderL').x > 0);
  assert.ok(restPosition(sk, 'shoulderR').x < 0);
  assert.ok(restPosition(sk, 'eyes').z > 0);
});

// --- the rig -------------------------------------------------------------

test('a character is one geometry, bound to bones that exist', () => {
  for (const id of IDS.slice(0, 8)) {
    const rig = buildRig3D(specFor(id));
    const g = rig.mesh.geometry;
    const index = g.getAttribute('skinIndex');
    const weight = g.getAttribute('skinWeight');
    assert.ok(index.count > 500, 'too few vertices');
    assert.ok(index.count < 20000, 'too many vertices for 60 characters');
    for (let i = 0; i < index.count; i += 1) {
      assert.ok(index.getX(i) < BONES.length);
      assert.equal(weight.getX(i), 1);
    }
    // The outline is the same geometry, drawn again.
    assert.equal(rig.outline.geometry, g);
    rig.destroy();
  }
});

test('a character wears its own accessory and no other', () => {
  const sizes = new Map<Accessory, number>();
  for (const accessory of ['none', 'sunhat', 'cap', 'goggles', 'floatie', 'snorkel'] as Accessory[]) {
    const rig = buildRig3D(specFor('same-body', 'subagent', { accessory }));
    sizes.set(accessory, rig.mesh.geometry.getAttribute('position').count);
    rig.destroy();
  }
  const bare = sizes.get('none') ?? 0;
  for (const [accessory, count] of sizes) {
    if (accessory === 'none') continue;
    assert.ok(count > bare, `${accessory} added nothing`);
  }
});

test('a positive arm angle swings the hand forward, the way the figure faces', () => {
  const rig = buildRig3D(specFor('forward'));
  const pose = zeroPose();
  pose.armR = 1.2;
  applyPose3D(rig, pose, { eyes: 1, hair: 0, mouth: 0.12, ponytail: 0, prop: null });
  rig.root.updateMatrixWorld(true);
  const hand = rig.bones.handR.getWorldPosition(new Vector3());
  const shoulder = rig.bones.shoulderR.getWorldPosition(new Vector3());
  assert.ok(hand.z > shoulder.z + 0.1, 'the arm swung backwards');
  // A positive knee bend is forward; the knees bend backwards with a
  // negative one, and the foot goes behind.
  pose.armR = 0;
  pose.kneeL = -1.2;
  applyPose3D(rig, pose, { eyes: 1, hair: 0, mouth: 0.12, ponytail: 0, prop: null });
  rig.root.updateMatrixWorld(true);
  const foot = rig.bones.footL.getWorldPosition(new Vector3());
  const knee = rig.bones.kneeL.getWorldPosition(new Vector3());
  assert.ok(foot.z < knee.z - 0.05, 'the knee bent forwards');
  // Out to the side means away from the body, on both sides.
  pose.kneeL = 0;
  pose.armOutL = 1;
  pose.armOutR = 1;
  applyPose3D(rig, pose, { eyes: 1, hair: 0, mouth: 0.12, ponytail: 0, prop: null });
  rig.root.updateMatrixWorld(true);
  const left = rig.bones.handL.getWorldPosition(new Vector3());
  const right = rig.bones.handR.getWorldPosition(new Vector3());
  assert.ok(left.x > restPosition(rig.skeleton, 'shoulderL').x + 0.1);
  assert.ok(right.x < restPosition(rig.skeleton, 'shoulderR').x - 0.1);
  rig.destroy();
});

test('a swimmer lies along the way it faces', () => {
  const rig = buildRig3D(specFor('swimmer'));
  const pose = zeroPose();
  pose.rootRot = Math.PI / 2;
  applyPose3D(rig, pose, { eyes: 1, hair: 0, mouth: 0.12, ponytail: 0, prop: null });
  rig.root.updateMatrixWorld(true);
  const head = rig.bones.head.getWorldPosition(new Vector3());
  assert.ok(head.z > 0.7, 'the head is not ahead of the feet');
  assert.ok(Math.abs(head.y) < 0.15, 'the swimmer is not lying flat');
  rig.destroy();
});

/** How far the face of a swimmer looks up: the head's own +z, in the world. */
function faceUp(style: keyof typeof SWIM_STYLES, phase: number): number {
  const rig = buildRig3D(specFor(`face-${style}`));
  const pose = zeroPose();
  SWIM_STYLES[style].fn(pose, phase, specFor(`face-${style}`));
  applyPose3D(rig, pose, { eyes: 1, hair: 0, mouth: 0.12, ponytail: 0, prop: null });
  rig.root.updateMatrixWorld(true);
  const face = new Vector3(0, 0, 1).transformDirection(rig.bones.head.matrixWorld);
  rig.destroy();
  return face.y;
}

test('a backstroke swimmer faces the sky, and a crawl swimmer looks at the water', () => {
  for (const phase of [0, 0.2, 0.4, 0.6, 0.8]) {
    assert.ok(faceUp('backstroke', phase) > 0.5, `backstroke at ${phase} looks at ${faceUp('backstroke', phase)}`);
    assert.ok(faceUp('crawl', phase) < 0.3, `crawl at ${phase} looks up at ${faceUp('crawl', phase)}`);
  }
});

test('a driver asked for a backstroke swims on its back', () => {
  const spec = specFor('driver-backstroke');
  const driver = new PoseDriver(spec);
  driver.setState('swimming');
  driver.setSwimStyle('backstroke');
  for (let t = 0; t < 1000; t += 16) driver.update(16);
  const rig = buildRig3D(spec);
  for (let i = 0; i < 5; i += 1) {
    for (let t = 0; t < 200; t += 16) driver.update(16);
    applyPose3D(rig, driver.currentPose, { eyes: 1, hair: 0, mouth: 0.12, ponytail: 0, prop: null });
    rig.root.updateMatrixWorld(true);
    const face = new Vector3(0, 0, 1).transformDirection(rig.bones.head.matrixWorld);
    assert.ok(face.y > 0.5, `looks at ${face.y.toFixed(2)} at step ${i}`);
  }
  rig.destroy();
});

test('a sub-agent keeps its own suit and takes its parent\'s suit as the trim', () => {
  const parent = specFor('session:family', 'session');
  const own = specFor('sub:family-1', 'subagent');
  const trimmed = specFor('sub:family-1', 'subagent', { accent: parent.suit });
  assert.equal(trimmed.suit, own.suit);
  assert.equal(trimmed.accent, parent.suit);
  assert.equal(trimmed.skin, own.skin);
  assert.equal(trimmed.swimStyle, own.swimStyle);
  assert.notEqual(trimmed.suit, parent.suit);
});

// --- the camera ------------------------------------------------------------

test('the camera never goes below the horizon or over the top', () => {
  const world = buildWorld(null);
  const view = defaultView(world, 16 / 9, 38);
  for (const polar of [-1, 0, 0.5, 1.2, 1.6, 3]) {
    const p = viewPosition({ ...view, polar });
    const rise = p.y - view.target.y;
    const flat = Math.hypot(p.x - view.target.x, p.z - view.target.z);
    const angle = Math.atan2(flat, rise);
    assert.ok(angle >= MIN_POLAR - 1e-9 && angle <= MAX_POLAR + 1e-9);
  }
  assert.ok(MAX_POLAR < Math.PI / 2 - 0.2, 'the camera may go down to the water line');
});

test('the default view is above the deck and looks at the pool, on a phone too', () => {
  const world = buildWorld(null);
  for (const aspect of [390 / 844, 1, 16 / 9, 21 / 9]) {
    const view = defaultView(world, aspect, 38);
    const p = viewPosition(view);
    assert.ok(p.y > 3, 'the camera is too low');
    assert.ok(view.target.x > world.pool.minX && view.target.x < world.pool.maxX);
    assert.ok(Number.isFinite(view.distance));
  }
});

test('the camera keeps looking at the deck', () => {
  const world = buildWorld(null);
  const target = { x: 400, y: -30, z: -400 };
  clampTarget(world, target);
  assert.ok(target.x <= world.deck.maxX && target.z >= world.deck.minZ && target.y >= -1.2);
});

// --- the labels and the scene choice ----------------------------------------

test('a label that would cover a more important one is left out', () => {
  const shown = separateLabels([
    { id: 'near', x: 100, y: 100, width: 60, height: 16, rank: 2, depth: 5 },
    { id: 'far', x: 110, y: 104, width: 60, height: 16, rank: 2, depth: 20 },
    { id: 'picked', x: 120, y: 98, width: 60, height: 16, rank: 0, depth: 30 },
    { id: 'alone', x: 400, y: 300, width: 60, height: 16, rank: 2, depth: 9 },
  ]);
  assert.deepEqual([...shown].sort(), ['alone', 'picked']);
});

// --- the head, the hair and the mouth --------------------------------------

test('the head of the 3D figure is smaller than it was', () => {
  for (const archetype of Object.keys(ARCHETYPES) as Archetype[]) {
    const sk = buildSkeleton3D(specFor('head', 'subagent', { archetype }));
    const raw = ARCHETYPES[archetype].headR;
    const total = ARCHETYPES[archetype].leg + ARCHETYPES[archetype].torso + 2 * raw;
    assert.ok(Math.abs(sk.headR - (raw / total) * HEAD_SCALE_3D) < 1e-12, archetype);
    assert.ok(sk.headR < raw / total, `${archetype} did not get a smaller head`);
  }
});

test('every haircut turns up, and the same seed always gives the same one', () => {
  const seen = new Set<HairStyle>();
  for (let seed = 0; seed < 500; seed += 1) {
    const style = hairStyleFor(seed);
    assert.ok(
      ['crop', 'bob', 'bun', 'ponytail', 'buzz'].includes(style),
      `seed ${seed} gave ${style}`,
    );
    seen.add(style);
    assert.equal(hairStyleFor(seed), style, `seed ${seed} changed its mind`);
  }
  assert.equal(seen.size, 5, 'some haircut never turned up');
});

test('the mouth and the ponytail are bones of their own', () => {
  assert.equal(BONES[BONES.length - 2], 'mouth');
  assert.equal(BONES[BONES.length - 1], 'ponytail');
  const sk = buildSkeleton3D(specFor('bones'));
  // The mouth is on the face, the ponytail behind the head.
  assert.ok(restPosition(sk, 'mouth').z > restPosition(sk, 'head').z);
  assert.ok(restPosition(sk, 'ponytail').z < restPosition(sk, 'head').z);
});

test('the mouth opens when the driver says so', () => {
  const rig = buildRig3D(specFor('mouth'));
  const pose = zeroPose();
  applyPose3D(rig, pose, { eyes: 1, hair: 0, mouth: 0, ponytail: 0, prop: null });
  const shut = rig.bones.mouth.scale.y;
  applyPose3D(rig, pose, { eyes: 1, hair: 0, mouth: 1, ponytail: 0, prop: null });
  assert.ok(rig.bones.mouth.scale.y > shut, 'the mouth did not open');
  rig.destroy();
});

test('the character looks the same as it did before the haircut and the mouth', () => {
  // These are the values specFor gave before this sprint. A new channel
  // must not move a single one of them.
  const pinned = [
    { id: 'agent-0', archetype: 'tall', height: 0.8911633880622685, skin: '#edc3a3', suit: '#4497fc', accent: '#fa973b', hair: '#6b3f22', accessory: 'sunhat', swimStyle: 'butterfly', idleActivity: 'tea', phaseOffset: 0.2944287685677409, speedScale: 0.9590250886860303, flip: true },
    { id: 'agent-1', archetype: 'round', height: 0.9968305082060397, skin: '#d9a57c', suit: '#84a4ff', accent: '#fab800', hair: '#a8641f', accessory: 'floatie', swimStyle: 'butterfly', idleActivity: 'newspaper', phaseOffset: 0.40384572674520314, speedScale: 0.961477121792268, flip: false },
    { id: 'session:abc', archetype: 'bean', height: 0.9426119100488722, skin: '#573320', suit: '#b182fb', accent: '#ffb013', hair: '#1b1410', accessory: 'cap', swimStyle: 'butterfly', idleActivity: 'stretch', phaseOffset: 0.615832001902163, speedScale: 1.1207285840879195, flip: false },
    { id: 'sub:demo-1', archetype: 'round', height: 0.9224182544089854, skin: '#573320', suit: '#40b2ff', accent: '#ffa23a', hair: '#8a8f96', accessory: 'goggles', swimStyle: 'crawl', idleActivity: 'chat', phaseOffset: 0.08793074823915958, speedScale: 1.0654365824651904, flip: false },
    { id: 'user:claude', archetype: 'bean', height: 0.9989576279185712, skin: '#9c6640', suit: '#0099e3', accent: '#ffa966', hair: '#d9a441', accessory: 'none', swimStyle: 'doggy', idleActivity: 'none', phaseOffset: 0.9052549123298377, speedScale: 0.9709042942849919, flip: false },
    { id: 'project-alpha', archetype: 'tall', height: 0.9353189834579826, skin: '#f6d7c0', suit: '#00a7ce', accent: '#ff9dcb', hair: '#a03a2f', accessory: 'cap', swimStyle: 'doggy', idleActivity: 'stretch', phaseOffset: 0.9032797422260046, speedScale: 1.0624914163840002, flip: true },
    { id: 'demo', archetype: 'bean', height: 1.0417341716401278, skin: '#3a2317', suit: '#00c0ee', accent: '#ff8c71', hair: '#d9a441', accessory: 'sunhat', swimStyle: 'breaststroke', idleActivity: 'chat', phaseOffset: 0.25550470710732043, speedScale: 1.0627436786657198, flip: true },
    { id: 'x', archetype: 'tall', height: 0.9881890670582653, skin: '#3a2317', suit: '#16b4ff', accent: '#ff95a6', hair: '#1b1410', accessory: 'sunhat', swimStyle: 'breaststroke', idleActivity: 'none', phaseOffset: 0.342110532335937, speedScale: 1.1832544332137331, flip: true },
    { id: 'test-1', archetype: 'squat', height: 0.9482721555605531, skin: '#573320', suit: '#309ae5', accent: '#ff9cb7', hair: '#a8641f', accessory: 'sunhat', swimStyle: 'breaststroke', idleActivity: 'sunbathe', phaseOffset: 0.38449817802757025, speedScale: 0.8844062594231218, flip: true },
    { id: 'a1b2c3', archetype: 'tall', height: 1.06600577108562, skin: '#f6d7c0', suit: '#00a8c2', accent: '#ffa2e6', hair: '#a8641f', accessory: 'cap', swimStyle: 'crawl', idleActivity: 'phone', phaseOffset: 0.015952593181282282, speedScale: 0.9569920833338983, flip: false },
    { id: 'zzz', archetype: 'squat', height: 1.071597054824233, skin: '#f6d7c0', suit: '#4cacff', accent: '#fca01a', hair: '#a8641f', accessory: 'none', swimStyle: 'crawl', idleActivity: 'stretch', phaseOffset: 0.9383112939540297, speedScale: 1.0577863705693744, flip: false },
    { id: 'pool', archetype: 'pear', height: 1.0795770034380257, skin: '#d9a57c', suit: '#00c7c8', accent: '#f099ff', hair: '#3b2418', accessory: 'none', swimStyle: 'crawl', idleActivity: 'sunbathe', phaseOffset: 0.08669020608067513, speedScale: 1.1642048947978765, flip: true },
    { id: 'work', archetype: 'round', height: 1.0013218908943236, skin: '#3a2317', suit: '#00c0bb', accent: '#ff7896', hair: '#3b2418', accessory: 'cap', swimStyle: 'breaststroke', idleActivity: 'phone', phaseOffset: 0.6870783451013267, speedScale: 1.158643110585399, flip: false },
    { id: 'runner', archetype: 'tall', height: 1.1106307098083197, skin: '#edc3a3', suit: '#608dfb', accent: '#f89900', hair: '#a03a2f', accessory: 'none', swimStyle: 'breaststroke', idleActivity: 'cards', phaseOffset: 0.5284639957826585, speedScale: 1.1038368810433894, flip: true },
    { id: 'coder', archetype: 'squat', height: 0.8906473134458065, skin: '#d9a57c', suit: '#b176d4', accent: '#d7d357', hair: '#d8d3cb', accessory: 'sunhat', swimStyle: 'doggy', idleActivity: 'newspaper', phaseOffset: 0.2703971420414746, speedScale: 0.9123321098973974, flip: false },
    { id: 'planner', archetype: 'pear', height: 0.9987654197029769, skin: '#7a4a2b', suit: '#6d95fa', accent: '#ff9976', hair: '#3b2418', accessory: 'none', swimStyle: 'crawl', idleActivity: 'call', phaseOffset: 0.3460007691755891, speedScale: 1.1244352717883883, flip: false },
    { id: 'reviewer', archetype: 'tall', height: 0.8924810262583196, skin: '#9c6640', suit: '#999cff', accent: '#eebb1e', hair: '#3b2418', accessory: 'goggles', swimStyle: 'doggy', idleActivity: 'sunbathe', phaseOffset: 0.4412691981997341, speedScale: 1.0266540330601857, flip: true },
    { id: 'sprint-21', archetype: 'pear', height: 0.9981438180431723, skin: '#9c6640', suit: '#00c2c0', accent: '#de86f9', hair: '#3b2418', accessory: 'none', swimStyle: 'doggy', idleActivity: 'tea', phaseOffset: 0.1371001871302724, speedScale: 0.8800689246156252, flip: false },
    { id: 'main', archetype: 'squat', height: 0.8881790516152978, skin: '#edc3a3', suit: '#a16cc6', accent: '#ecbc00', hair: '#d8d3cb', accessory: 'sunhat', swimStyle: 'breaststroke', idleActivity: 'newspaper', phaseOffset: 0.9808885147795081, speedScale: 0.977871501527261, flip: false },
    { id: 'worker-7', archetype: 'tall', height: 0.9867442478425801, skin: '#f6d7c0', suit: '#00bae4', accent: '#ff80b3', hair: '#a8641f', accessory: 'none', swimStyle: 'breaststroke', idleActivity: 'snack', phaseOffset: 0.6072330856695771, speedScale: 1.1844440693734213, flip: false },
  ];
  for (const want of pinned) {
    const spec = specFor(want.id);
    assert.equal(spec.archetype, want.archetype, want.id);
    assert.equal(spec.height, want.height, want.id);
    assert.equal(spec.skin, want.skin, want.id);
    assert.equal(spec.suit, want.suit, want.id);
    assert.equal(spec.accent, want.accent, want.id);
    assert.equal(spec.hair, want.hair, want.id);
    assert.equal(spec.accessory, want.accessory, want.id);
    assert.equal(spec.swimStyle, want.swimStyle, want.id);
    assert.equal(spec.idleActivity, want.idleActivity, want.id);
    assert.equal(spec.phaseOffset, want.phaseOffset, want.id);
    assert.equal(spec.speedScale, want.speedScale, want.id);
    assert.equal(spec.flip, want.flip, want.id);
  }
});

// --- the lounger ------------------------------------------------------------

test('the back of a lounging figure rests on the back rest', () => {
  const world = buildWorld(null);
  for (const archetype of Object.keys(ARCHETYPES) as Archetype[]) {
    const spec = specFor('lean-test', 'subagent', { archetype, idleActivity: 'none' });
    const rig = buildRig3D(spec);
    const scale = CHARACTER_HEIGHT * spec.height;
    rig.root.scale.setScalar(scale);
    const driver = new PoseDriver(spec);
    driver.setState('lounging');
    for (let i = 0; i < 120; i += 1) driver.update(16);
    applyPose3D(rig, driver.currentPose, {
      eyes: 1,
      hair: 0,
      mouth: 0.12,
      ponytail: 0,
      prop: null,
    });

    const lounger = world.loungers[0];
    // Where the scene puts a body that has sat down.
    const hipHeight = restPosition(rig.skeleton, 'hips').y * scale;
    rig.root.position.set(
      lounger.x,
      lounger.seatHeight - hipHeight,
      lounger.z - lounger.facing.z * lounger.length * 0.2,
    );
    rig.root.rotation.y = Math.atan2(lounger.facing.x, lounger.facing.z);
    rig.root.updateMatrixWorld(true);

    const neck = rig.bones.neck.getWorldPosition(new Vector3());
    const rest = backRest(lounger);
    // The distance from the neck to the plane of the back rest, along its
    // normal. It has to be in front of it, and close to it.
    const distance = (neck.y - rest.y) * rest.normalY + (neck.z - rest.z) * rest.normalZ;
    assert.ok(distance > 0.02, `${archetype} is ${distance.toFixed(3)} m in front of the rest`);
    assert.ok(distance < 0.14, `${archetype} is ${distance.toFixed(3)} m from the rest`);
    rig.destroy();
  }
});
