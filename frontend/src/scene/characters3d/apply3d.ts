/**
 * A pose, written onto the bones of a 3D character.
 *
 * The pose model is the one the 2D rig uses: joint angles measured from
 * straight down, positive forward. A rotation about x in Three.js turns a
 * limb that hangs down *backwards* for a positive angle, exactly as a
 * positive rotation in Pixi turns it backwards in the side view, so each
 * joint gets the same number the 2D rig gives it. The 3D-only fields (the
 * spine, the roll, the arms and legs out to the side) go on the other axes.
 */

import type { Pose } from '../characters/poses';
import type { PropKind } from '../motion/driver';
import type { Rig3D } from './rig3d';

export interface Extras {
  eyes: number;
  hair: number;
  /** How open the mouth is, 0 to 1. */
  mouth: number;
  /** The swing of a ponytail. */
  ponytail: number;
  prop: PropKind | null;
}

export function applyPose3D(rig: Rig3D, pose: Pose, extras: Extras): void {
  const b = rig.bones;
  b.pitch.rotation.x = pose.rootRot;
  b.bob.position.y = pose.bob;
  b.bob.rotation.x = pose.bodyRoll;
  // Squash and stretch: the body goes up and thin, or down and thick, and
  // the volume stays about the same.
  const stretch = Math.max(-0.3, Math.min(0.3, pose.stretch));
  const thin = 1 / Math.sqrt(1 + stretch);
  b.bob.scale.set(thin, 1 + stretch, thin);
  b.hips.position.y = rig.skeleton.hipY + pose.bodyY;
  // The roll first, about the long axis of the body, then the pitch.
  b.hips.rotation.set(pose.bodyPitch, pose.roll, 0);
  // The spine bends forward (spine) and turns about its own axis (torso). The
  // turn is the upper body only: the hips keep their roll and their place.
  b.spine.rotation.set(pose.spine, pose.torso, 0);
  b.head.rotation.set(-pose.headPitch, pose.headYaw, 0);
  b.hair.rotation.x = extras.hair * 0.5;
  b.eyes.scale.y = Math.max(0.08, extras.eyes);
  // The mouth opens, and the ponytail hangs back and swings with the head.
  b.mouth.scale.set(1, 0.6 + 2.2 * extras.mouth, 1);
  b.ponytail.rotation.x = 0.25 + extras.ponytail;

  // The arms: swung forward or back, and lifted out to the side. The left
  // side of the figure is +x, and a positive turn about z lifts a hanging
  // limb towards +x, so the right side takes the opposite sign.
  //
  // The shoulder's y turn is the twist of the upper arm about its own axis.
  // Its order is set to XZY when the rig is built, so the twist is applied
  // first, in the frame of the hanging arm, and the swing and the lift turn
  // the axis after it. The twist therefore stays about the arm itself. A
  // turn of +y carries the forearm's forward direction towards +x, so it
  // brings the right forearm in and takes the left one out: the left side
  // takes the opposite sign.
  b.shoulderL.rotation.set(-pose.armL, -pose.armTwistL, pose.armOutL + 0.06);
  b.shoulderR.rotation.set(-pose.armR, pose.armTwistR, -pose.armOutR - 0.06);
  b.elbowL.rotation.x = -pose.elbowL;
  b.elbowR.rotation.x = -pose.elbowR;
  // The wrist bends the same way as the elbow. The hand bones are the
  // wrists: they sit where the forearm ends, and carry the prop.
  b.handL.rotation.x = -pose.wristL;
  b.handR.rotation.x = -pose.wristR;
  b.legL.rotation.set(-pose.legL, 0, pose.legOutL);
  b.legR.rotation.set(-pose.legR, 0, -pose.legOutR);
  b.kneeL.rotation.x = -pose.kneeL;
  b.kneeR.rotation.x = -pose.kneeR;

  // The prop in the hand stays upright: the layer is turned back by the
  // angles of the arm and the body. The wrist is left out, so a bent wrist
  // tilts the prop it holds, as a cup is tilted for a sip.
  for (const [kind, prop] of Object.entries(rig.props)) prop.visible = kind === extras.prop;
  rig.propLayer.rotation.x = pose.armR + pose.elbowR - pose.bodyPitch - pose.bodyRoll - pose.spine - pose.rootRot;
}
