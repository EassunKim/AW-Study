// Loads something from the store for a screen: { data, error, reload }. A newer load always wins,
// so a slow old answer never overwrites a newer one.
import { useCallback, useEffect, useRef, useState } from 'react';

export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const run = useCallback(load, deps);

  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const value = await run();
      if (ticket === latest.current) {
        setData(value);
        setError(null);
      }
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [run]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, reload };
}

/** The message to show for a failed action. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
