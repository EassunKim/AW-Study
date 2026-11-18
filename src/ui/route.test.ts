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
    expect(parseRoute('#/class/c1/quiz/s-1')).toEqual({ name: 'quiz', courseId: 'c1', sectionId: 's-1' });
    expect(parseRoute('#/play')).toEqual({ name: 'play' });
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
  });

  it('treats anything else as not found, including the old flashcard addresses', () => {
    for (const hash of [
      '#/class/',
      '#/class/a/b',
      '#/class/c1/slides/a/0-3',
      '#/class/c1/slides/a/5-3',
      '#/class/c1/slides/a/3',
      '#/class/c1/slides/a/1-99999',
      '#/slides/abc',
      '#/class/c1/quiz/',
      '#/class/c1/quiz/s1/2',
      '#/cards',
      '#/cards/deck/abc',
      '#/deck/abc',
      '#/review/abc',
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
      { name: 'quiz', courseId: 'c1', sectionId: 's1' },
      { name: 'play' },
      { name: 'settings' },
    ];
    for (const route of routes) expect(parseRoute(href(route))).toEqual(route);
  });
});
