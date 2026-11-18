import { useEffect, useState } from 'react';
import { APP_NAME } from './brand';
import type { StudyStore } from './db/store';
import { deviceTimeZone, studyDay } from './lib/studyDay';
import { DeckScreen } from './ui/DeckScreen';
import { DecksScreen } from './ui/DecksScreen';
import { ReviewScreen } from './ui/ReviewScreen';
import { href, useRoute } from './ui/route';
import { DAY_START_HOUR } from './ui/settings';
import { StoreContext } from './ui/store-context';

// The page frame: the name (back to the decks), the current screen, and a footer with today's
// study day and whether the app is ready to work offline.
export default function App({ store }: { store: StudyStore }) {
  const route = useRoute();
  return (
    <StoreContext value={store}>
      <header className="top">
        <h1>
          <a href={href({ name: 'decks' })}>{APP_NAME}</a>
        </h1>
      </header>
      <main className="app">
        {route.name === 'decks' && <DecksScreen />}
        {route.name === 'deck' && <DeckScreen key={route.deckId} deckId={route.deckId} />}
        {route.name === 'review' && <ReviewScreen key={route.deckId} deckId={route.deckId} />}
        {route.name === 'not-found' && (
          <section>
            <h2>Page not found</h2>
            <a href={href({ name: 'decks' })}>← Back to your decks</a>
          </section>
        )}
      </main>
      <Footer />
    </StoreContext>
  );
}

function Footer() {
  const [now, setNow] = useState(() => new Date());
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(() => setOfflineReady(true)).catch(() => {});
  }, []);

  return (
    <footer className="foot muted small">
      <span>
        Study day <span data-testid="study-day">{studyDay(now, deviceTimeZone(), DAY_START_HOUR)}</span>
      </span>
      <span data-testid="offline-status">{offlineReady ? 'Ready: works without a connection' : 'Getting ready…'}</span>
      <span>Your cards stay on this device.</span>
    </footer>
  );
}

/** Shown when the browser won't let the app store anything (e.g. some private windows). */
export function StorageProblem({ message }: { message: string }) {
  return (
    <main className="app">
      <h1>{APP_NAME}</h1>
      <p className="error">This browser won’t let {APP_NAME} store your cards on this device.</p>
      <p className="muted">
        Private or incognito windows sometimes block storage. Try a normal window. ({message})
      </p>
    </main>
  );
}
