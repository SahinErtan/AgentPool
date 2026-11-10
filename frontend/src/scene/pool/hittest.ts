/**
 * Finding the character under the pointer.
 *
 * The characters are drawn, not laid out: there is no DOM element per
 * agent, so a click on the canvas has to be matched against the geometry
 * the scene already knows. The hit area is generous on purpose — a person
 * aims at a head in the water, not at a pixel.
 */

export interface HitBox {
  id: string;
  /** Where the character stands, in scene pixels. */
  x: number;
  /** The ground — or the waterline — under the character. */
  y: number;
  /** The half width of the hit area. */
  halfWidth: number;
  /** The top of the hit area. */
  top: number;
  /** The bottom of the hit area. */
  bottom: number;
}

/** How the character is standing, which decides the shape of its hit area. */
export type Pose = 'swim' | 'stand' | 'lie';

/**
 * The hit area of a character.
 *
 * A swimmer is mostly under the water, so its area reaches up to the head
 * and is wide enough for the arms. A character that lies down is a long
 * horizontal shape, so its area is short and wide. One that stands is a
 * column.
 */
export function characterBox(
  id: string,
  x: number,
  y: number,
  height: number,
  pose: Pose,
): HitBox {
  if (pose === 'lie') {
    return {
      id,
      x,
      y,
      halfWidth: height * 0.7,
      top: y - height * 0.55,
      bottom: y + height * 0.1,
    };
  }
  if (pose === 'swim') {
    return {
      id,
      x,
      y,
      halfWidth: height * 0.8,
      top: y - height * 0.95,
      bottom: y + height * 0.1,
    };
  }
  return {
    id,
    x,
    y,
    halfWidth: height * 0.42,
    top: y - height,
    bottom: y + height * 0.1,
  };
}

/**
 * The character under the pointer, or null when the pointer is on the water.
 *
 * When two characters overlap, the one whose middle is closest to the
 * pointer wins: the character that is drawn on top is also the one that is
 * picked.
 */
export function hitTest(boxes: HitBox[], px: number, py: number): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    if (px < box.x - box.halfWidth || px > box.x + box.halfWidth) continue;
    if (py < box.top || py > box.bottom) continue;

    // The middle of the hit area is what the pointer is judged against.
    const middle = (box.top + box.bottom) / 2;
    const dx = px - box.x;
    const dy = py - middle;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = box.id;
    }
  }

  return best;
}
