import { describe, expect, it } from 'vitest';
import { autoBackupDue, canUseFolder, reminderDue, writeToFolder, type Folder } from './folder';
import { backupFileName } from './format';
import { shouldSuggestHomeScreen } from './persist';

/** A folder in memory. */
function fakeFolder(names: string[] = []) {
  const files = new Map<string, string>(names.map((n) => [n, 'old']));
  const folder: Folder = {
    name: 'Backups',
    async getFileHandle(name) {
      return {
        async createWritable() {
          let text = '';
          return {
            async write(data: string) {
              text += data;
            },
            async close() {
              files.set(name, text);
            },
          };
        },
      };
    },
    async removeEntry(name) {
      files.delete(name);
    },
    async *keys() {
      yield* [...files.keys()];
    },
  };
  return { folder, files };
}

const at = (iso: string) => new Date(iso);

describe('writing to a folder', () => {
  it('writes the file and keeps only the newest five of ours', async () => {
    const old = [1, 2, 3, 4, 5].map((d) => backupFileName('Honed', at(`2026-11-0${d}T09:30:00`)));
    const { folder, files } = fakeFolder([...old, 'notes.txt', 'Other-backup-2026-01-01-0000.honed']);
    const name = backupFileName('Honed', at('2026-11-18T10:00:00'));
    await writeToFolder(folder, name, 'NEW', 'Honed');
    expect(files.get(name)).toBe('NEW');
    expect([...files.keys()].filter((n) => n.startsWith('Honed-')).sort()).toEqual([...old.slice(1), name]);
    expect(files.has('notes.txt')).toBe(true); // never touches other files
    expect(files.has('Other-backup-2026-01-01-0000.honed')).toBe(true);
  });

  it('names sort by time', () => {
    expect(backupFileName('Honed', at('2026-11-18T09:05:00'))).toBe('Honed-backup-2026-11-18-0905.honed');
    expect(backupFileName('Honed', at('2026-02-01T00:00:00')) < backupFileName('Honed', at('2026-11-01T00:00:00'))).toBe(true);
  });
});

describe('when to back up', () => {
  const now = at('2026-11-18T12:00:00Z');
  it('automatic: only when something changed, and at most once an hour', () => {
    expect(autoBackupDue({ now, lastAt: null, lastUpTo: 0, latest: 0 })).toBe(false);
    expect(autoBackupDue({ now, lastAt: null, lastUpTo: 0, latest: 3 })).toBe(true);
    expect(autoBackupDue({ now, lastAt: '2026-11-18T11:30:00Z', lastUpTo: 1, latest: 3 })).toBe(false);
    expect(autoBackupDue({ now, lastAt: '2026-11-18T11:00:00Z', lastUpTo: 1, latest: 3 })).toBe(true);
    expect(autoBackupDue({ now, lastAt: '2026-11-01T11:00:00Z', lastUpTo: 3, latest: 3 })).toBe(false);
  });

  it('reminder: something not backed up, and the last backup over a week ago', () => {
    const since = '2026-11-01T00:00:00Z';
    expect(reminderDue({ now, lastAt: '2026-11-12T12:00:00Z', since, lastUpTo: 1, latest: 5 })).toBe(false);
    expect(reminderDue({ now, lastAt: '2026-11-10T12:00:00Z', since, lastUpTo: 1, latest: 5 })).toBe(true);
    expect(reminderDue({ now, lastAt: '2026-11-01T12:00:00Z', since, lastUpTo: 5, latest: 5 })).toBe(false);
    // Never backed up: counted from when the device started keeping track
    expect(reminderDue({ now, lastAt: null, since: '2026-11-15T00:00:00Z', lastUpTo: 0, latest: 5 })).toBe(false);
    expect(reminderDue({ now, lastAt: null, since, lastUpTo: 0, latest: 5 })).toBe(true);
  });
});

describe('what the browser offers', () => {
  it('folders only on a computer with the picker', () => {
    const win = { showDirectoryPicker: () => {} };
    expect(canUseFolder(win, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140')).toBe(true);
    expect(canUseFolder({}, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/140')).toBe(false);
    expect(canUseFolder(win, 'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile')).toBe(false);
  });

  it('suggests the Home Screen on iPhone and iPad Safari, not once installed', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Mobile/15E148 Safari/604.1';
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.1 Mobile/15E148 Safari/604.1';
    expect(shouldSuggestHomeScreen(iphone, false)).toBe(true);
    expect(shouldSuggestHomeScreen(ipad, false)).toBe(true);
    expect(shouldSuggestHomeScreen(iphone, true)).toBe(false);
    expect(shouldSuggestHomeScreen('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', false)).toBe(false);
  });
});
