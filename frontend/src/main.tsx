import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// The lab is a tool, loaded only when it is asked for: `?lab` opens it.
// (`?lab&3d` still works; it is the same lab.)
const Lab3D = lazy(() => import('./lab/Lab3D').then((m) => ({ default: m.Lab3D })));

const isLab = new URLSearchParams(window.location.search).has('lab');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isLab ? <Suspense fallback={null}><Lab3D /></Suspense> : <App />}
  </StrictMode>,
);
