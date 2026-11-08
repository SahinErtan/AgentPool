import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Lab } from './lab/Lab';
import './styles.css';

const isLab = new URLSearchParams(window.location.search).has('lab');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isLab ? <Lab /> : <App />}</StrictMode>,
);
