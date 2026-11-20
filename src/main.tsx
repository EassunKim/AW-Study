import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App, { StorageProblem } from './App';
import { openStudyStore } from './db/store';
import { applyTheme } from './ui/theme';
import { updateReady } from './ui/update';
import { messageOf } from './ui/useLoad';
import '@fontsource-variable/lexend'; // bundled with the app (font-src 'self'), never fetched from another site
import './app.css';

// The colours the person chose for this device (src/ui/theme.ts), before anything is drawn
applyTheme();

const element = document.getElementById('root');
if (!element) throw new Error('index.html has no #root element');
const root = createRoot(element);

// Open the on-device database first; every screen needs it.
openStudyStore().then(
  (store) =>
    root.render(
      <StrictMode>
        <App store={store} vault={store} />
      </StrictMode>,
    ),
  (err: unknown) => root.render(<StorageProblem message={messageOf(err)} />),
);

// The service worker caches the app so it opens offline. In `npm run dev` this does nothing. A new
// version is applied when it's safe (src/ui/update.ts), never in the middle of an unlock or a quiz.
registerSW({ immediate: true, onNeedReload: updateReady });
// The browser tests stand in for the service worker with this event (tests/browsers/app.spec.ts)
window.addEventListener('honed:update-ready', updateReady);
