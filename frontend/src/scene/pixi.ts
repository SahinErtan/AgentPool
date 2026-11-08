/**
 * PixiJS helpers.
 *
 * Note on `resizeTo`: PixiJS v8's `ResizePlugin` keeps its state in *static*
 * fields, so destroying one `Application` wipes the plugin for every other
 * live application. Under React's StrictMode (which mounts, unmounts and mounts
 * again) that breaks the surviving instance with
 * `this._cancelResize is not a function`.
 *
 * We therefore do not use `resizeTo` at all and drive the canvas size from our
 * own `ResizeObserver`. That keeps each scene instance independent.
 */

import type { Application } from 'pixi.js';

/** Keep the renderer the same size as the host element. */
export function observeHostSize(app: Application, host: HTMLElement): ResizeObserver {
  const apply = () => {
    const width = Math.max(1, Math.floor(host.clientWidth));
    const height = Math.max(1, Math.floor(host.clientHeight));
    if (app.renderer.width !== width || app.renderer.height !== height) {
      app.renderer.resize(width, height);
    }
  };
  const observer = new ResizeObserver(apply);
  observer.observe(host);
  apply();
  return observer;
}
