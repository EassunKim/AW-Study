// Runs sync while Honed is unlocked and on screen (#105): at once, every 30 seconds, and when the page comes back
// into view or online. Does nothing (and sends nothing) on a device where sync is off. When another device's
// changes arrive, `onChanged` lets the app redraw the pages that list things.
import { useEffect, useRef } from 'react';
import { useStore } from '../ui/store-context';
import { syncOnce } from './engine';

export const SYNC_EVERY_MS = 30_000;

export function SyncRunner({ onChanged }: { onChanged: () => void }) {
  const store = useStore();
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    let stopped = false;
    let running = false;
    const round = async () => {
      if (stopped || running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const result = await syncOnce(store);
        if (result && result.changed > 0 && !stopped) changed.current();
      } catch {
        // Recorded in the sync state (Settings shows it); the next round tries again
      } finally {
        running = false;
      }
    };
    void round();
    const timer = setInterval(() => void round(), SYNC_EVERY_MS);
    const again = () => void round();
    document.addEventListener('visibilitychange', again);
    window.addEventListener('online', again);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('online', again);
    };
  }, [store]);

  return null;
}
