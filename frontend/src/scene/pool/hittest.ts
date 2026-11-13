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
  return updateCharacterBox(
    { id, x, y, halfWidth: 0, top: 0, bottom: 0 },
    x,
    y,
    height,
    pose,
  );
}

/**
 * The same hit area, written into a box that is already there.
 *
 * The characters move every frame, so their hit areas change every frame
 * as well. Writing into the box that is already there keeps the pointer
 * from building a new list of boxes every time it moves.
 */
export function updateCharacterBox(
  box: HitBox,
  x: number,
  y: number,
  height: number,
  pose: Pose,
): HitBox {
  if (pose === 'lie') {
    box.halfWidth = height * 0.7;
    box.top = y - height * 0.55;
    box.bottom = y + height * 0.1;
  } else if (pose === 'swim') {
    box.halfWidth = height * 0.8;
    box.top = y - height * 0.95;
    box.bottom = y + height * 0.1;
  } else {
    box.halfWidth = height * 0.42;
    box.top = y - height;
    box.bottom = y + height * 0.1;
  }
  box.x = x;
  box.y = y;
  return box;
}

/**
 * The hit areas of the characters, kept up to date.
 *
 * The pointer moves far more often than the scene changes, and the areas
 * change with every frame, so they are held here and written into. The
 * order is the order the characters were added, which is the order the
 * old code built its list in.
 */
export class HitBoxCache {
  private readonly boxes = new Map<string, HitBox>();
  private readonly order: HitBox[] = [];

  /** Add a character to the cache. */
  add(id: string, x: number, y: number, height: number, pose: Pose): HitBox {
    const box = characterBox(id, x, y, height, pose);
    this.boxes.set(id, box);
    this.order.push(box);
    return box;
  }

  /** Take a character out of the cache. */
  remove(id: string): void {
    const box = this.boxes.get(id);
    if (!box) return;
    this.boxes.delete(id);
    const index = this.order.indexOf(box);
    if (index >= 0) this.order.splice(index, 1);
  }

  /** Put the hit area of a character where the character is now. */
  update(id: string, x: number, y: number, height: number, pose: Pose): void {
    const box = this.boxes.get(id);
    if (!box) {
      this.add(id, x, y, height, pose);
      return;
    }
    updateCharacterBox(box, x, y, height, pose);
  }

  /** The hit areas, in the order the characters were added. */
  get list(): HitBox[] {
    return this.order;
  }
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
