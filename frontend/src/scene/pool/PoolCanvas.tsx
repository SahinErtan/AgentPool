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

        scene = new PoolScene(app);
        scene.syncAgents([...store.get().agents.values()]);

        // A handle for the browser console, so the scene can be inspected
        // while it runs.
        (window as unknown as { __agentpool?: unknown }).__agentpool = scene;
        (window as unknown as { __agentpoolApp?: unknown }).__agentpoolApp = app;

        const unsubscribe = store.subscribe(() => {
          scene?.syncAgents([...store.get().agents.values()]);
        });

        // The scene follows the renderer: the pool has to be drawn in the
        // size the canvas actually has, or a click lands on the wrong
        // character.
        observer = observeHostSize(app, host, () => {
          scene?.resize(app.renderer.width, app.renderer.height);
        });

        (app as unknown as { __unsubscribe?: () => void }).__unsubscribe = () => {
          unsubscribe();
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
