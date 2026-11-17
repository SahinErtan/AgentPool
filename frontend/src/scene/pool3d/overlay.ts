/**
 * The names over the heads, as plain HTML on top of the canvas.
 *
 * A label drawn into the 3D scene would shrink with the distance and blur;
 * a DOM element stays sharp at every zoom, takes the page's font and costs
 * nothing to draw. The scene tells each label where the head is on the
 * screen every frame, and the labels that would cover a more important one
 * are hidden.
 *
 * The card under the pointer (Sprint 28) is in this layer too: one element,
 * reused for whichever agent the pointer is over.
 */

import { tidyName } from '../names';
import type { CardContent } from '../card';

export interface LabelBox {
  id: string;
  /** The point the label stands on, in CSS pixels: the middle of its bottom edge. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Lower comes first: 0 the selected agent, 1 the hovered one, 2 the rest. */
  rank: number;
  /** Nearer the camera comes first among equals. */
  depth: number;
}

/**
 * Which labels to show.
 *
 * The labels are placed in order of importance (the selected one, the one
 * under the pointer, then the nearest), and one that would cover a label
 * already placed is left out. The list beside the pool names every agent.
 */
export function separateLabels(boxes: LabelBox[]): Set<string> {
  const order = [...boxes].sort((a, b) => a.rank - b.rank || a.depth - b.depth);
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const shown = new Set<string>();
  for (const b of order) {
    const box = {
      left: b.x - b.width / 2 - 2,
      right: b.x + b.width / 2 + 2,
      top: b.y - b.height - 1,
      bottom: b.y + 1,
    };
    const overlaps = placed.some(
      (o) => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top,
    );
    if (overlaps) continue;
    placed.push(box);
    shown.add(b.id);
  }
  return shown;
}

interface Label {
  element: HTMLDivElement;
  /** The little dot in the colour of the family. */
  dot: HTMLSpanElement;
  name: HTMLSpanElement;
  colour: string;
  text: string;
  width: number;
  height: number;
  x: number;
  y: number;
  visible: boolean;
  wanted: boolean;
  rank: number;
  depth: number;
  bubble: HTMLDivElement | null;
}

/** The DOM layer over the canvas. */
export class LabelOverlay {
  readonly element: HTMLDivElement;
  private readonly labels = new Map<string, Label>();
  /** The one card, reused for every agent the pointer is over. */
  private readonly card: HTMLDivElement;
  private cardOf: CardContent | null = null;
  private cardWidth = 0;
  private cardHeight = 0;

  constructor(host: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'pool3d-labels';
    this.element.setAttribute('aria-hidden', 'true');
    host.appendChild(this.element);

    this.card = document.createElement('div');
    this.card.className = 'pool3d-card';
    this.card.setAttribute('aria-hidden', 'true');
    this.card.style.display = 'none';
    this.element.appendChild(this.card);
  }

  /**
   * Make sure an agent has a label with this name. The name is tidied to the
   * screen's limit here too, so a label is never longer than the rule allows.
   */
  ensure(id: string, text: string): void {
    const short = tidyName(text);
    let label = this.labels.get(id);
    if (!label) {
      const element = document.createElement('div');
      element.className = 'pool3d-label';
      // Hidden until the first layout says where it goes; shown at once,
      // it stood in the top left corner until then.
      element.style.display = 'none';
      const dot = document.createElement('span');
      dot.className = 'pool3d-label__dot';
      const name = document.createElement('span');
      element.append(dot, name);
      this.element.appendChild(element);
      label = {
        element,
        dot,
        name,
        colour: '',
        text: '',
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        visible: false,
        wanted: false,
        rank: 2,
        depth: 0,
        bubble: null,
      };
      this.labels.set(id, label);
    }
    if (label.text !== short) {
      label.text = short;
      label.name.textContent = short;
      label.width = 0;
      label.visible = false;
      label.element.style.display = 'none';
    }
  }

  /** The colour of the dot before an agent's name: the colour of its family. */
  setColour(id: string, colour: string): void {
    const label = this.labels.get(id);
    if (!label || label.colour === colour) return;
    label.colour = colour;
    label.dot.style.background = colour;
  }

  remove(id: string): void {
    const label = this.labels.get(id);
    if (!label) return;
    label.element.remove();
    label.bubble?.remove();
    this.labels.delete(id);
  }

  /**
   * Show the card beside an agent's label, or hide it.
   *
   * The card goes above the label when there is room, below the head when
   * there is not, and it stays inside the window. Its content is only
   * rebuilt when the caller passes a new object, so a card that does not
   * change costs nothing but a move.
   *
   * @param anchor The agent the card belongs to, or null.
   * @param width The width of the scene, in CSS pixels.
   * @param height The height of the scene, in CSS pixels.
   */
  showCard(anchor: string | null, content: CardContent | null, width: number, height: number): void {
    const label = anchor !== null ? this.labels.get(anchor) : undefined;
    if (!label || !content || !label.wanted) {
      this.hideCard();
      return;
    }
    if (content !== this.cardOf) {
      this.cardOf = content;
      this.card.replaceChildren();
      const title = document.createElement('div');
      title.className = 'pool3d-card__title';
      title.textContent = content.title;
      this.card.appendChild(title);
      for (const line of content.lines) {
        const row = document.createElement('div');
        row.className = line.attention ? 'pool3d-card__line pool3d-card__line--attention' : 'pool3d-card__line';
        row.textContent = line.text;
        this.card.appendChild(row);
      }
      this.card.style.display = '';
      // Measured once per content: the card is moved every frame, and a
      // read of its size each frame would make the browser lay the page out.
      this.cardWidth = this.card.offsetWidth;
      this.cardHeight = this.card.offsetHeight;
    }
    const cw = this.cardWidth;
    const ch = this.cardHeight;
    let left = label.x - cw / 2;
    left = Math.min(Math.max(4, left), width - cw - 4);
    let top = label.y - label.height - ch - 8;
    if (top < 4) top = label.y + 8;
    top = Math.min(top, height - ch - 4);
    this.card.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(4, top))}px)`;
  }

  private hideCard(): void {
    if (this.cardOf === null) return;
    this.cardOf = null;
    this.card.style.display = 'none';
    this.card.replaceChildren();
  }

  /**
   * Where the label should stand this frame, or that it should not show.
   *
   * An `attention` label is one whose session waits for the person: it is
   * drawn in amber and pulses, and the scene ranks it high.
   */
  place(
    id: string,
    x: number,
    y: number,
    wanted: boolean,
    rank: number,
    depth: number,
    selected: boolean,
    attention = false,
  ): void {
    const label = this.labels.get(id);
    if (!label) return;
    label.x = x;
    label.y = y;
    label.wanted = wanted;
    label.rank = rank;
    label.depth = depth;
    label.element.classList.toggle('pool3d-label--selected', selected);
    label.element.classList.toggle('pool3d-label--attention', attention);
  }

  /** Show a short line of speech over a head for a moment. */
  say(id: string, text: string, seconds = 2.6): void {
    const label = this.labels.get(id);
    if (!label) return;
    if (!label.bubble) {
      label.bubble = document.createElement('div');
      label.bubble.className = 'pool3d-bubble';
      this.element.appendChild(label.bubble);
    }
    const bubble = label.bubble;
    bubble.textContent = text;
    bubble.dataset.until = String(performance.now() + seconds * 1000);
  }

  /** Lay the labels out after every `place` of the frame. */
  flush(): void {
    const boxes: LabelBox[] = [];
    for (const [id, label] of this.labels) {
      // A label with no name (the cat's, which has only a speech bubble) is not
      // laid out: it has no box to keep clear of the others.
      if (!label.wanted || label.text === '') continue;
      if (label.width === 0) {
        // Measured once per text; reading the layout every frame would
        // force the browser to lay the page out every frame. A hidden
        // element has no size, so it is shown unseen for the measurement.
        const style = label.element.style;
        const display = style.display;
        style.visibility = 'hidden';
        style.display = '';
        label.width = label.element.offsetWidth || label.text.length * 7 + 8;
        label.height = label.element.offsetHeight || 16;
        style.display = display;
        style.visibility = '';
      }
      boxes.push({ id, x: label.x, y: label.y, width: label.width, height: label.height, rank: label.rank, depth: label.depth });
    }
    const shown = separateLabels(boxes);
    const now = performance.now();
    for (const [id, label] of this.labels) {
      const visible = shown.has(id) && label.text !== '';
      if (visible !== label.visible) {
        label.visible = visible;
        label.element.style.display = visible ? '' : 'none';
      }
      if (visible) {
        label.element.style.transform = `translate(${Math.round(label.x - label.width / 2)}px, ${Math.round(label.y - label.height)}px)`;
      }
      const bubble = label.bubble;
      if (bubble) {
        const until = Number(bubble.dataset.until ?? 0);
        const on = label.wanted && now < until;
        bubble.style.display = on ? '' : 'none';
        if (on) {
          bubble.style.transform = `translate(${Math.round(label.x - bubble.offsetWidth / 2)}px, ${Math.round(label.y - label.height - bubble.offsetHeight - 4)}px)`;
        }
      }
    }
  }

  destroy(): void {
    this.element.remove();
    this.labels.clear();
    this.cardOf = null;
  }
}
