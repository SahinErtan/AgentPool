import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// The labs are tools, loaded only when they are asked for: the 2D lab
// brings PixiJS and the 3D lab brings Three.js.
const Lab = lazy(() => import('./lab/Lab').then((m) => ({ default: m.Lab })));
const Lab3D = lazy(() => import('./lab/Lab3D').then((m) => ({ default: m.Lab3D })));

const params = new URLSearchParams(window.location.search);
const isLab = params.has('lab');
const is3D = params.has('3d');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isLab ? <Suspense fallback={null}>{is3D ? <Lab3D /> : <Lab />}</Suspense> : <App />}
  </StrictMode>,
);
