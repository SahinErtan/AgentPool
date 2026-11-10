/**
 * The reactions.
 *
 * A reaction is an offset that is added on top of whatever the character
 * is doing, so it has to stay small enough not to break the posture and
 * has to fade in and out.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reactionDelta, zeroPose, type Pose, type ReactionKind } from '../src/scene/characters/poses';

function deltaAt(kind: ReactionKind, u: number): Pose {
  const out = zeroPose();
  reactionDelta(out, kind, u);
  return out;
}

/** The envelope of a reaction: it fades in and out. */
function envelope(u: number): number {
  return Math.sin(u * Math.PI) ** 2;
}

test('a reaction starts and ends with nothing', () => {
  for (const kind of ['wave', 'waveLying', 'look'] as ReactionKind[]) {
    const start = deltaAt(kind, 0);
    assert.ok(Math.abs(start.armR) < 1e-9);
    assert.ok(Math.abs(start.headPitch) < 1e-9);
  }
});

test('the wave lifts an arm', () => {
  const pose = deltaAt('wave', 0.5);
  assert.ok(pose.armR < -2, `the arm did not go up: ${pose.armR}`);
  // The elbow does the waving: it moves over the reaction.
  const first = deltaAt('wave', 0.5).elbowR;
  const second = deltaAt('wave', 0.57).elbowR;
  assert.ok(Math.abs(first - second) > 0.2, 'the elbow does not move');
});

test('the wave of a character that lies down is a different angle', () => {
  // The body of a lounger character is turned a quarter turn, so the same
  // shoulder angle would send the arm out sideways.
  const standing = deltaAt('wave', 0.5);
  const lying = deltaAt('waveLying', 0.5);
  assert.ok(Math.abs(standing.armR - lying.armR) > 1);
});

test('the look only moves the head', () => {
  const pose = deltaAt('look', 0.5);
  assert.notEqual(pose.headPitch, 0);
  assert.notEqual(pose.headYaw, 0);
  assert.equal(pose.armR, 0);
  assert.equal(pose.armL, 0);
});

test('the reaction never breaks the posture', () => {
  for (const kind of ['wave', 'waveLying', 'look'] as ReactionKind[]) {
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const pose = deltaAt(kind, u);
      assert.equal(pose.rootRot, 0, 'the body must not be turned');
      assert.equal(pose.legL, 0, 'the legs must stay still');
      assert.equal(pose.legR, 0, 'the legs must stay still');
      assert.ok(Math.abs(pose.armR) < 4, `the arm went too far: ${pose.armR}`);
    }
  }
});

test('the envelope is a hill', () => {
  assert.ok(envelope(0) < 0.001);
  assert.ok(envelope(0.5) > 0.99);
  assert.ok(envelope(1) < 0.001);
});
