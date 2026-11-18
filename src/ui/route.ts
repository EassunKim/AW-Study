// Which screen to show, from the URL's hash: #/ (classes), #/class/<id>, #/class/<id>/slides/<deckId>
// (a deck in the viewer, optionally .../<first>-<last> for a section), #/class/<id>/quiz/<sectionId>,
// #/play (today's checklist, one item after another), #/settings.
// The hash keeps everything on one page (the service worker serves it offline) while the back
// button and reloads still work. No router library.
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'classes' }
  | { name: 'class'; courseId: string }
  | { name: 'slides'; courseId: string; deckId: string; first?: number; last?: number }
  | { name: 'quiz'; courseId: string; sectionId: string }
  | { name: 'play' }
  | { name: 'settings' }
  | { name: 'not-found' };

const ID = '([A-Za-z0-9-]{1,64})';
const PAGE = '([1-9][0-9]{0,3})';
const PATTERNS: [RegExp, (m: RegExpMatchArray) => Route | null][] = [
  [/^#?\/?$/, () => ({ name: 'classes' })],
  [new RegExp(`^#/class/${ID}$`), (m) => ({ name: 'class', courseId: m[1]! })],
  [new RegExp(`^#/class/${ID}/slides/${ID}$`), (m) => ({ name: 'slides', courseId: m[1]!, deckId: m[2]! })],
  [
    new RegExp(`^#/class/${ID}/slides/${ID}/${PAGE}-${PAGE}$`),
    (m) =>
      Number(m[3]) <= Number(m[4]) ? { name: 'slides', courseId: m[1]!, deckId: m[2]!, first: Number(m[3]), last: Number(m[4]) } : null,
  ],
  [new RegExp(`^#/class/${ID}/quiz/${ID}$`), (m) => ({ name: 'quiz', courseId: m[1]!, sectionId: m[2]! })],
  [/^#\/play$/, () => ({ name: 'play' })],
  [/^#\/settings$/, () => ({ name: 'settings' })],
];

export function parseRoute(hash: string): Route {
  for (const [pattern, make] of PATTERNS) {
    const m = hash.match(pattern);
    const route = m && make(m);
    if (route) return route;
  }
  return { name: 'not-found' };
}

export function href(route: Exclude<Route, { name: 'not-found' }>): string {
  switch (route.name) {
    case 'classes':
      return '#/';
    case 'class':
      return `#/class/${route.courseId}`;
    case 'slides': {
      const deck = `#/class/${route.courseId}/slides/${route.deckId}`;
      return route.first && route.last ? `${deck}/${route.first}-${route.last}` : deck;
    }
    case 'quiz':
      return `#/class/${route.courseId}/quiz/${route.sectionId}`;
    case 'play':
      return '#/play';
    case 'settings':
      return '#/settings';
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
