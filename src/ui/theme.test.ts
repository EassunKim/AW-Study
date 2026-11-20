import { describe, expect, it } from 'vitest';
import { savedTheme, shownLook } from './theme';

const storage = (value: string | null) => ({ getItem: () => value });

describe('savedTheme', () => {
  it('gives the saved choice', () => {
    expect(savedTheme(storage('light'))).toBe('light');
    expect(savedTheme(storage('dark'))).toBe('dark');
  });
  it('follows the phone when nothing, something unknown, or no storage', () => {
    expect(savedTheme(storage(null))).toBe('phone');
    expect(savedTheme(storage('purple'))).toBe('phone');
    expect(savedTheme(null)).toBe('phone');
    expect(
      savedTheme({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('phone');
  });
});

describe('shownLook', () => {
  it('uses the phone’s setting only for "phone"', () => {
    expect(shownLook('phone', true)).toBe('dark');
    expect(shownLook('phone', false)).toBe('light');
    expect(shownLook('light', true)).toBe('light');
    expect(shownLook('dark', false)).toBe('dark');
  });
});
