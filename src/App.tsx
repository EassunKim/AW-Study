import { lazy, Suspense, useEffect, useState } from 'react';
import { BackupWatcher } from './backup/BackupWatcher';
import { APP_NAME } from './brand';
import type { StudyStore } from './db/store';
import { deviceTimeZone, studyDay } from './lib/studyDay';
import { ClassesScreen } from './ui/ClassesScreen';
import { ClassScreen } from './ui/ClassScreen';
import { VaultContext } from './ui/lock-parts';
import { go, href, useRoute } from './ui/route';
import { DAY_START_HOUR } from './ui/settings';
import { SettingsScreen } from './ui/SettingsScreen';
import { SetupScreen } from './ui/SetupScreen';
import { StoreContext } from './ui/store-context';
import { UnlockScreen } from './ui/UnlockScreen';
import type { Vault, VaultStatus } from './ui/vault';

// With PDF.js, so loaded only when slides are opened
const SlidesScreen = lazy(() => import('./ui/SlidesScreen'));
const QuizScreen = lazy(() => import('./ui/QuizScreen'));

// The page frame: the name (back to the classes), the current screen, and a footer with today's
// study day and whether the app is ready to work offline. Until the app is unlocked, the only
// screen is setup (first run) or unlock.
export default function App({ store, vault }: { store: StudyStore; vault: Vault }) {
  const route = useRoute();
  const [status, setStatus] = useState<VaultStatus>(() => vault.status());
  const refresh = () => setStatus(vault.status());
  const lock = () => {
    vault.lock();
    refresh();
    go({ name: 'classes' });
  };

  return (
    <VaultContext value={vault}>
      <StoreContext value={store}>
        <header className="top">
          <h1>
            <a href={href({ name: 'classes' })}>{APP_NAME}</a>
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
          {status === 'unlocked' && <BackupWatcher store={store} />}
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
      {route.name === 'classes' && <ClassesScreen />}
      {route.name === 'class' && <ClassScreen key={route.courseId} courseId={route.courseId} />}
      {route.name === 'slides' && (
        <Suspense fallback={<p className="muted">Opening the slides…</p>}>
          <SlidesScreen key={href(route)} courseId={route.courseId} deckId={route.deckId} first={route.first} last={route.last} />
        </Suspense>
      )}
      {route.name === 'quiz' && (
        <Suspense fallback={<p className="muted">Opening the quiz…</p>}>
          <QuizScreen key={href(route)} courseId={route.courseId} sectionId={route.sectionId} />
        </Suspense>
      )}
      {route.name === 'settings' && <SettingsScreen onLock={onLock} />}
      {route.name === 'not-found' && (
        <section>
          <h2>Page not found</h2>
          <a href={href({ name: 'classes' })}>← Back to your classes</a>
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
      <span>Your classes and slides stay on this device.</span>
    </footer>
  );
}

/** Shown when the browser won't let the app store anything (e.g. some private windows). */
export function StorageProblem({ message }: { message: string }) {
  return (
    <main className="app">
      <h1>{APP_NAME}</h1>
      <p className="error">This browser won’t let {APP_NAME} store your classes and slides on this device.</p>
      <p className="muted">
        Private or incognito windows sometimes block storage. Try a normal window. ({message})
      </p>
    </main>
  );
}
