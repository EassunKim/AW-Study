import { useEffect, useState } from 'react';
import { APP_NAME } from './brand';
import type { StudyStore } from './db/store';
import { deviceTimeZone, studyDay } from './lib/studyDay';
import { DeckScreen } from './ui/DeckScreen';
import { DecksScreen } from './ui/DecksScreen';
import { VaultContext } from './ui/lock-parts';
import { ReviewScreen } from './ui/ReviewScreen';
import { go, href, useRoute } from './ui/route';
import { DAY_START_HOUR } from './ui/settings';
import { SettingsScreen } from './ui/SettingsScreen';
import { SetupScreen } from './ui/SetupScreen';
import { StoreContext } from './ui/store-context';
import { UnlockScreen } from './ui/UnlockScreen';
import type { Vault, VaultStatus } from './ui/vault';

// The page frame: the name (back to the decks), the current screen, and a footer with today's
// study day and whether the app is ready to work offline. Until the cards are unlocked, the only
// screen is setup (first run) or unlock.
export default function App({ store, vault }: { store: StudyStore; vault: Vault }) {
  const route = useRoute();
  const [status, setStatus] = useState<VaultStatus>(() => vault.status());
  const refresh = () => setStatus(vault.status());
  const lock = () => {
    vault.lock();
    refresh();
    go({ name: 'decks' });
  };

  return (
    <VaultContext value={vault}>
      <StoreContext value={store}>
        <header className="top">
          <h1>
            <a href={href({ name: 'decks' })}>{APP_NAME}</a>
          </h1>
          {status === 'unlocked' && (
            <nav className="row" aria-label="App">
              <a className="button" href={href({ name: 'settings' })}>
                Settings
              </a>
              <button type="button" onClick={lock}>
                Lock
              </button>
            </nav>
          )}
        </header>
        <main className="app">
          {status === 'new' && <SetupScreen onDone={refresh} />}
          {status === 'locked' && <UnlockScreen onUnlocked={refresh} />}
          {status === 'unlocked' && <Screen route={route} onLock={lock} />}
        </main>
        <Footer />
      </StoreContext>
    </VaultContext>
  );
}

function Screen({ route, onLock }: { route: ReturnType<typeof useRoute>; onLock: () => void }) {
  return (
    <>
      {route.name === 'decks' && <DecksScreen />}
      {route.name === 'deck' && <DeckScreen key={route.deckId} deckId={route.deckId} />}
      {route.name === 'review' && <ReviewScreen key={route.deckId} deckId={route.deckId} />}
      {route.name === 'settings' && <SettingsScreen onLock={onLock} />}
      {route.name === 'not-found' && (
        <section>
          <h2>Page not found</h2>
          <a href={href({ name: 'decks' })}>← Back to your decks</a>
        </section>
      )}
    </>
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
