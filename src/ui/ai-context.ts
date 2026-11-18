// Hands the AiBackend to the screens. The real one calls our AI helper at /ai/ (src/ai/http.ts); the
// browser tests answer /ai/ themselves, so nothing is spent or sent.
import { createContext, useContext } from 'react';
import type { AiBackend } from '../ai/backend';
import { HttpAiBackend } from '../ai/http';

export const AiContext = createContext<AiBackend>(new HttpAiBackend());

export function useAi(): AiBackend {
  return useContext(AiContext);
}
