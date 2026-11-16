import { lazy, Suspense, useCallback, useState } from 'react';

/**
 * Picks the pool to show: the 3D one, or the 2D one.
 *
 * The 3D pool is the default. The 2D pool opens with `?2d`, when the
 * browser has no WebGL2, and when the 3D pool loses its GPU context for
 * good. Each one is loaded only when it is shown, so the 2D page does not
 * download Three.js and the 3D page does not download PixiJS.
 */

const Pool2D = lazy(() => import('./pool/PoolCanvas').then((m) => ({ default: m.PoolCanvas })));
const Pool3D = lazy(() => import('./pool3d/Pool3DCanvas').then((m) => ({ default: m.Pool3DCanvas })));

function webgl2Available(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export function sceneMode(search: string, hasWebgl2: boolean): '2d' | '3d' {
  const params = new URLSearchParams(search);
  if (params.has('2d')) return '2d';
  return hasWebgl2 ? '3d' : '2d';
}

export function SceneHost() {
  const [mode, setMode] = useState<'2d' | '3d'>(() => sceneMode(window.location.search, webgl2Available()));
  const fallBack = useCallback(() => setMode('2d'), []);
  return (
    <Suspense fallback={<div className="pool-canvas" />}>
      {mode === '3d' ? <Pool3D onLost={fallBack} /> : <Pool2D />}
    </Suspense>
  );
}
