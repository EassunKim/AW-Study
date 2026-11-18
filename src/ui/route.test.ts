import { describe, expect, it } from 'vitest';
import { href, parseRoute, type Route } from './route';

describe('parseRoute', () => {
  it('reads every screen', () => {
    expect(parseRoute('')).toEqual({ name: 'classes' });
    expect(parseRoute('#/')).toEqual({ name: 'classes' });
    expect(parseRoute('#/class/abc-123')).toEqual({ name: 'class', courseId: 'abc-123' });
    expect(parseRoute('#/class/c1/slides/abc-123')).toEqual({ name: 'slides', courseId: 'c1', deckId: 'abc-123' });
    expect(parseRoute('#/class/c1/slides/abc-123/21-30')).toEqual({ name: 'slides', courseId: 'c1', deckId: 'abc-123', first: 21, last: 30 });
    expect(parseRoute('#/class/c1/slides/abc-123/4-4')).toEqual({ name: 'slides', courseId: 'c1', deckId: 'abc-123', first: 4, last: 4 });
    expect(parseRoute('#/cards')).toEqual({ name: 'decks' });
    expect(parseRoute('#/cards/deck/abc-123')).toEqual({ name: 'deck', deckId: 'abc-123' });
    expect(parseRoute('#/cards/review/abc-123')).toEqual({ name: 'review', deckId: 'abc-123' });
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
  });

  it('treats anything else as not found', () => {
    for (const hash of [
      '#/class/',
      '#/class/a/b',
      '#/class/c1/slides/a/0-3',
      '#/class/c1/slides/a/5-3',
      '#/class/c1/slides/a/3',
      '#/class/c1/slides/a/1-99999',
      '#/slides/abc',
      '#/deck/abc',
      '#/review/abc',
      '#/cards/deck/',
      '#/settings/x',
      '#/class/<script>',
      `#/class/${'x'.repeat(65)}`,
    ]) {
      expect(parseRoute(hash), hash).toEqual({ name: 'not-found' });
    }
  });

  it('round-trips with href', () => {
    const routes: Exclude<Route, { name: 'not-found' }>[] = [
      { name: 'classes' },
      { name: 'class', courseId: 'c1' },
      { name: 'slides', courseId: 'c1', deckId: 'd1' },
      { name: 'slides', courseId: 'c1', deckId: 'd1', first: 2, last: 4 },
      { name: 'decks' },
      { name: 'deck', deckId: 'd1' },
      { name: 'review', deckId: 'd1' },
      { name: 'settings' },
    ];
    for (const route of routes) expect(parseRoute(href(route))).toEqual(route);
  });
});
