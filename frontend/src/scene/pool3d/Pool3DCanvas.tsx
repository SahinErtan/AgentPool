import { useEffect, useRef, useState } from 'react';
import { store } from '../../state/store';
import { prefersReducedMotion } from '../motion';
import { PoolScene3D } from './PoolScene3D';

/**
 * Hosts the 3D pool and keeps it in step with the store.
 *
 * Like the 2D canvas, React never re-renders for the animation: the scene
 * runs its own frame loop and reads the store there. React only shows the
 * tour's button, and the chip that says the tour is running.
 *
 * @param onLost Called when the browser takes the WebGL context away for
 *   good; the page then falls back to the 2D pool.
 */
export function Pool3DCanvas({ onLost }: { onLost: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PoolScene3D | null>(null);
  const [touring, setTouring] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: PoolScene3D;
    try {
      scene = new PoolScene3D(host);
    } catch (error) {
      console.error('AgentPool: the 3D pool failed to start', error);
      onLost();
      return;
    }
    scene.syncAgents([...store.get().agents.values()]);
    (window as unknown as { __agentpool?: unknown }).__agentpool = scene;
    sceneRef.current = scene;
    scene.setTourListener(setTouring);

    const unsubscribe = store.subscribe(() => {
      scene.syncAgents([...store.get().agents.values()]);
    });
    const observer = new ResizeObserver(() => {
      scene.resize(host.clientWidth, host.clientHeight);
    });
    observer.observe(host);

    const canvas = scene.renderer.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      // Give the browser a moment to give the context back; if it does
      // not, the 2D pool takes over.
      const timer = window.setTimeout(onLost, 2500);
      canvas.addEventListener('webglcontextrestored', () => window.clearTimeout(timer), { once: true });
    };
    canvas.addEventListener('webglcontextlost', lost);

    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      unsubscribe();
      observer.disconnect();
      sceneRef.current = null;
      scene.destroy();
    };
  }, [onLost]);

  // With reduced motion nothing may move the camera but the person, and a
  // tour moves it on its own: so the button is there, but it is off.
  const allowed = !prefersReducedMotion();
  return (
    <div className="pool-canvas pool3d" ref={hostRef}>
      <div className="pool3d-tour">
        {touring && <span className="pool3d-tour__chip">Touring — move to stop</span>}
        <button
          type="button"
          className="pool3d-tour__button"
          title={allowed ? 'Tour the pool' : 'The tour is off with reduced motion'}
          aria-label="Tour the pool"
          aria-pressed={touring}
          disabled={!allowed}
          onClick={() => sceneRef.current?.toggleTour()}
        >
          {touring ? '■' : '▶'}
        </button>
      </div>
    </div>
  );
}
