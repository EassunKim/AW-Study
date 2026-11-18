import { beforeEach, describe, expect, it } from 'vitest';
import { decideUpdate, isUpdateReady, onUpdateChange, resetUpdate, setActivity, updateReady } from './update';

let reloads = 0;
beforeEach(() => {
  reloads = 0;
  resetUpdate({ reload: () => reloads++ });
});

describe('a new version arriving', () => {
  it('reloads at once only while locked with no unlock started', () => {
    expect(decideUpdate('locked')).toBe('reload');
    expect(decideUpdate('unlocking')).toBe('wait');
    expect(decideUpdate('unlocked')).toBe('wait');
    updateReady();
    expect(reloads).toBe(1);
  });

  it('while unlocking or unlocked it waits, tells the banner, and reloads on the next lock', () => {
    const heard: boolean[] = [];
    onUpdateChange((ready) => heard.push(ready));
    setActivity('unlocking'); // the passkey prompt is open
    updateReady();
    expect(reloads).toBe(0);
    expect(isUpdateReady()).toBe(true);
    expect(heard).toEqual([true]);
    setActivity('unlocked'); // unlocking finished: still no reload, a quiz may start
    expect(reloads).toBe(0);
    setActivity('locked'); // locked: now it's safe
    expect(reloads).toBe(1);
  });

  it('a failed unlock (back to locked) applies a waiting update', () => {
    setActivity('unlocking');
    updateReady();
    setActivity('locked');
    expect(reloads).toBe(1);
  });
});
