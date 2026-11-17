/**
 * Whether the person in front of the screen asked for less motion.
 *
 * The characters keep moving — that is the information the pool carries — but
 * everything that is only decoration stops: the drifting petals, the bird,
 * the caustics on the floor of the pool.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

let cached: boolean | null = null;

function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  return window.matchMedia(QUERY);
}

function read(): boolean {
  const list = query();
  return list ? list.matches : false;
}

/** Whether the reduced motion preference is set right now. */
export function prefersReducedMotion(): boolean {
  if (cached === null) {
    cached = read();
    const list = query();
    if (list && typeof list.addEventListener === 'function') {
      list.addEventListener('change', () => {
        cached = read();
      });
    }
  }
  return cached;
}
