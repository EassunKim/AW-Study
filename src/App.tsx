import { useEffect, useState } from 'react';
import { APP_NAME } from './brand';
import { deviceTimeZone, studyDay } from './lib/studyDay';

// The first screen. For now it proves the skeleton works: the app loads, knows today's study day,
// and says whether it's ready to open offline. Decks and reviews arrive in milestone 2.
export default function App() {
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

  const timeZone = deviceTimeZone();

  return (
    <main className="app">
      <h1>{APP_NAME}</h1>
      <p className="tagline">Lecture content, a little every day, at the right moment.</p>
      <dl className="facts">
        <dt>Study day</dt>
        <dd data-testid="study-day">{studyDay(now, timeZone)}</dd>
        <dt>Time zone</dt>
        <dd>{timeZone}</dd>
        <dt>Offline</dt>
        <dd data-testid="offline-status">{offlineReady ? 'Ready: works without a connection' : 'Getting ready…'}</dd>
      </dl>
      <p className="note">Your cards and slides will stay on this device. Nothing is stored on a server.</p>
    </main>
  );
}
