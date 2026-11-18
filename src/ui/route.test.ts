import { describe, expect, it } from 'vitest';
import { href, parseRoute } from './route';

describe('parseRoute', () => {
  it('reads the three screens', () => {
    expect(parseRoute('')).toEqual({ name: 'decks' });
    expect(parseRoute('#/')).toEqual({ name: 'decks' });
    expect(parseRoute('#/deck/abc-123')).toEqual({ name: 'deck', deckId: 'abc-123' });
    expect(parseRoute('#/review/abc-123')).toEqual({ name: 'review', deckId: 'abc-123' });
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
  });

  it('treats anything else as not found', () => {
    for (const hash of ['#/deck/', '#/deck/a/b', '#/review', '#/decks', '#/settings/x', '#/deck/<script>', `#/deck/${'x'.repeat(65)}`]) {
      expect(parseRoute(hash)).toEqual({ name: 'not-found' });
    }
  });

  it('round-trips with href', () => {
    for (const route of [
      { name: 'decks' },
      { name: 'deck', deckId: 'd1' },
      { name: 'review', deckId: 'd1' },
      { name: 'settings' },
    ] as const) {
      expect(parseRoute(href(route))).toEqual(route);
    }
  });
});
