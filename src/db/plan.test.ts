// The planning side of the store (#47): study sessions and settings, plain and encrypted.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudySessionInput } from '../types/plan';
import { openHonedDb, RECORD_STORES } from './schema';
import { openStudyStore, type StudyStore } from './store';
import { containsText, fakePdf, newDataKey, testKeyring } from './test-helpers';

const T1 = '2026-11-18T18:00:00.000Z';
const T2 = '2026-11-18T18:20:00.000Z';
let counter = 0;
let name: string;
let store: StudyStore;

async function section() {
  const course = await store.createCourse({ name: 'PHIL 201', meetings: [], termStart: null, termEnd: null });
  const deck = await store.addSlideDeck({ courseId: course.id, title: 'U4', fileName: 'u4.pdf', data: fakePdf(), pageTexts: Array(19).fill('t') });
  const { sections } = await store.recordLecture({ courseId: course.id, date: '2026-11-17', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 19 }] });
  return { course, section: sections[0]! };
}
const session = (sectionId: string, extra: Partial<StudySessionInput> = {}): StudySessionInput => ({
  sectionId,
  kind: 'first-week',
  step: 1,
  startedAt: T1,
  finishedAt: T2,
  minutes: 17,
  ...extra,
});

describe.each(['before setup (plain)', 'encrypted'] as const)('plan store, %s', (mode) => {
  beforeEach(async () => {
    name = `plan-${++counter}`;
    store = await openStudyStore({ name });
    if (mode === 'encrypted') {
      const key = await newDataKey();
      await store.setUp(await testKeyring(key), key);
    }
  });
  afterEach(() => store.close());

  it('records study sessions and lists them newest first', async () => {
    const { section: s, course } = await section();
    const first = await store.recordStudySession(session(s.id));
    const extra = await store.recordStudySession(session(s.id, { kind: 'extra', step: null, startedAt: T2, finishedAt: '2026-11-19T10:00:00.000Z', minutes: 10 }));
    expect(first).toMatchObject({ courseId: course.id, sectionId: s.id, kind: 'first-week', step: 1, minutes: 17 });
    expect((await store.listStudySessions()).map((x) => x.id)).toEqual([extra.id, first.id]);
    expect((await store.listStudySessions(s.id)).length).toBe(2);
    expect(await store.listStudySessions('another')).toEqual([]);
  });

  it('refuses a malformed session', async () => {
    const { section: s } = await section();
    for (const [label, input] of [
      ['first week without a step', session(s.id, { step: null })],
      ['step 4', session(s.id, { step: 4 as never })],
      ['extra with a step', session(s.id, { kind: 'extra', step: 2 })],
      ['unknown kind', session(s.id, { kind: 'cram' as never })],
      ['ends before it starts', session(s.id, { startedAt: T2, finishedAt: T1 })],
      ['part minutes', session(s.id, { minutes: 1.5 })],
      ['too long', session(s.id, { minutes: 601 })],
    ] as const) {
      await expect(store.recordStudySession(input), label).rejects.toMatchObject({ code: 'invalid' });
    }
    await expect(store.recordStudySession(session('nope'))).rejects.toMatchObject({ code: 'not-found' });
    expect(await store.listStudySessions()).toEqual([]);
  });

  it('settings start at 60 minutes, are saved, and are checked', async () => {
    expect(await store.getStudySettings()).toEqual({ dailyMinutes: 60 });
    expect(await store.saveStudySettings({ dailyMinutes: 45 })).toEqual({ dailyMinutes: 45 });
    expect(await store.getStudySettings()).toEqual({ dailyMinutes: 45 });
    for (const bad of [9, 601, 30.5, Number.NaN]) {
      await expect(store.saveStudySettings({ dailyMinutes: bad })).rejects.toMatchObject({ code: 'invalid' });
    }
    expect(await store.getStudySettings()).toEqual({ dailyMinutes: 45 });
  });

  it('deleting the lecture or the class takes its study sessions', async () => {
    const { section: s, course } = await section();
    await store.recordStudySession(session(s.id));
    await store.deleteLecture(s.lectureId);
    expect(await store.listStudySessions()).toEqual([]);
    const again = await section();
    await store.recordStudySession(session(again.section.id));
    await store.deleteCourse(again.course.id);
    const db = await openHonedDb(name);
    expect(await db.count('studySessions')).toBe(0);
    db.close();
    void course;
  });
});

describe('encrypted, on disk', () => {
  it('only the ids of sessions and settings are readable', async () => {
    name = `plan-${++counter}`;
    store = await openStudyStore({ name });
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key);
    const { section: s } = await section();
    await store.recordStudySession(session(s.id, { minutes: 423 }));
    await store.saveStudySettings({ dailyMinutes: 377 });
    store.close();
    const db = await openHonedDb(name);
    expect(Object.keys((await db.getAll('studySessions'))[0] as object).sort()).toEqual(['courseId', 'enc', 'id', 'sectionId']);
    expect(Object.keys((await db.getAll('settings'))[0] as object).sort()).toEqual(['enc', 'id']);
    for (const st of RECORD_STORES) expect(containsText(await db.getAll(st), '"dailyMinutes":377'), st).toBe(false);
    db.close();
  });
});
