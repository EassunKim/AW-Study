import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { openStudyStore } from './db/store';
import './app.css';

// The on-device database. The screens (issue #7) will get it through React; until then, and for
// the browser tests and DevTools, a promise of it is at globalThis.__honedStore.
const store = openStudyStore();
(globalThis as { __honedStore?: unknown }).__honedStore = store;
store.catch((err: unknown) => console.error('Could not open the on-device database:', err));

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The service worker caches the app so it opens offline. In `npm run dev` this does nothing.
registerSW({ immediate: true });
