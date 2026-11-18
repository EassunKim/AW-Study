// Which screen to show, from the URL's hash: #/ (decks), #/deck/<id>, #/review/<deckId>.
// The hash keeps everything on one page (the service worker serves it offline) while the back
// button and reloads still work. No router library.
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'decks' }
  | { name: 'deck'; deckId: string }
  | { name: 'review'; deckId: string }
  | { name: 'not-found' };

const ID = '([A-Za-z0-9-]{1,64})';
const PATTERNS: [RegExp, (m: RegExpMatchArray) => Route][] = [
  [/^#?\/?$/, () => ({ name: 'decks' })],
  [new RegExp(`^#/deck/${ID}$`), (m) => ({ name: 'deck', deckId: m[1]! })],
  [new RegExp(`^#/review/${ID}$`), (m) => ({ name: 'review', deckId: m[1]! })],
];

export function parseRoute(hash: string): Route {
  for (const [pattern, make] of PATTERNS) {
    const m = hash.match(pattern);
    if (m) return make(m);
  }
  return { name: 'not-found' };
}

export function href(route: Exclude<Route, { name: 'not-found' }>): string {
  switch (route.name) {
    case 'decks':
      return '#/';
    case 'deck':
      return `#/deck/${route.deckId}`;
    case 'review':
      return `#/review/${route.deckId}`;
  }
}

export function go(route: Exclude<Route, { name: 'not-found' }>): void {
  window.location.hash = href(route);
}

/** The current route, updated when the hash changes. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
