import { lazy, Suspense, useCallback, useState } from 'react';

/**
 * Shows the pool: the 3D one, which is loaded only when it is shown.
 *
 * The pool needs WebGL2. When the browser does not offer it, or when the
 * pool cannot start or loses its graphics context for good, a short message takes the
 * pool's place: there is no other pool to fall back to.
 */

const Pool3D = lazy(() => import('./pool3d/Pool3DCanvas').then((m) => ({ default: m.Pool3DCanvas })));

function webgl2Available(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export function SceneHost() {
  const [supported] = useState(webgl2Available);
  const [lost, setLost] = useState<'failed' | 'lost' | null>(null);
  const onLost = useCallback((why: 'failed' | 'lost') => setLost(why), []);

  if (!supported) {
    return (
      <div className="pool-canvas pool-unavailable">
        The pool needs WebGL2, which this browser does not offer.
      </div>
    );
  }
  if (lost === 'failed') {
    return (
      <div className="pool-canvas pool-unavailable">
        The pool could not start its graphics. The browser console says why.
      </div>
    );
  }
  if (lost === 'lost') {
    return (
      <div className="pool-canvas pool-unavailable">
        The pool lost its graphics context. Reload the page to bring it back.
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="pool-canvas" />}>
      <Pool3D onLost={onLost} />
    </Suspense>
  );
}
