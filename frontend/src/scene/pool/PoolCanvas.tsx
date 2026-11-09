import { Application } from 'pixi.js';
import { useEffect, useRef } from 'react';
import { store } from '../../state/store';
import { observeHostSize } from '../pixi';
import { PoolScene } from './PoolScene';

/**
 * Hosts the PixiJS canvas and keeps the scene in sync with the store.
 *
 * React never re-renders for the animation: the scene reads the store in its
 * own ticker, so the 60 fps path stays out of React entirely.
 */
export function PoolCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let initialized = false;
    const app = new Application();
    let scene: PoolScene | null = null;
    let observer: ResizeObserver | null = null;

    app
      .init({
        antialias: true,
        background: '#8fd3f4',
        resolution: Math.min(window.devicePixelRatio, 2),
        autoDensity: true,
        width: Math.max(1, host.clientWidth),
        height: Math.max(1, host.clientHeight),
      })
      .then(() => {
        if (disposed) {
          app.destroy(true);
          return;
        }
        initialized = true;
        host.appendChild(app.canvas);
        observer = observeHostSize(app, host);

        scene = new PoolScene(app);
        scene.syncAgents([...store.get().agents.values()]);

        const unsubscribe = store.subscribe(() => {
          scene?.syncAgents([...store.get().agents.values()]);
        });

        const onResize = () => {
          scene?.resize(app.renderer.width, app.renderer.height);
        };
        observer = observeHostSize(app, host);
        window.addEventListener('resize', onResize);
        onResize();

        (app as unknown as { __unsubscribe?: () => void }).__unsubscribe = () => {
          unsubscribe();
          window.removeEventListener('resize', onResize);
        };
      })
      .catch((error: unknown) => {
        console.error('AgentPool: the scene failed to start', error);
      });

    return () => {
      disposed = true;
      const cleanup = (app as unknown as { __unsubscribe?: () => void }).__unsubscribe;
      cleanup?.();
      observer?.disconnect();
      scene?.destroy();
      if (initialized) app.destroy(true, { children: true });
    };
  }, []);

  return <div className="pool-canvas" ref={hostRef} />;
}
