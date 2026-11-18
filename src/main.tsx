import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App, { StorageProblem } from './App';
import { openStudyStore } from './db/store';
import { messageOf } from './ui/useLoad';
import './app.css';

const element = document.getElementById('root');
if (!element) throw new Error('index.html has no #root element');
const root = createRoot(element);

// Open the on-device database first; every screen needs it.
openStudyStore().then(
  (store) =>
    root.render(
      <StrictMode>
        <App store={store} />
      </StrictMode>,
    ),
  (err: unknown) => root.render(<StorageProblem message={messageOf(err)} />),
);

// The service worker caches the app so it opens offline. In `npm run dev` this does nothing.
registerSW({ immediate: true });
