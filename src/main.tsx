import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { startDb } from './db/client';
import './app.css';

// SPIKE (issue #6): the database worker, reachable from DevTools and the browser tests.
(globalThis as { __honedDb?: unknown }).__honedDb = startDb();

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The service worker caches the app so it opens offline. In `npm run dev` this does nothing.
registerSW({ immediate: true });
