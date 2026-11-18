// Hands the StudyStore to every screen. App wraps everything in <StoreContext value={store}>.
import { createContext, useContext } from 'react';
import type { StudyStore } from '../db/store';

export const StoreContext = createContext<StudyStore | null>(null);

export function useStore(): StudyStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore() outside <StoreContext>');
  return store;
}
