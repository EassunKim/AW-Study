// The lecture side of the store (#24): classes, exams, slide decks, lectures, sections. Every test
// runs twice, before setup (plain records) and encrypted, like store.test.ts.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CourseInput, Meeting } from '../types/lecture';
import { MAX_PDF_BYTES, shareBudget } from './lectures';
import { openHonedDb, RECORD_STORES } from './schema';
import { openStudyStore, type StudyStore } from './store';
import { containsText, fakePdf, newDataKey, testKeyring } from './test-helpers';

const MARKER = 'LECTURE-MARKER-31';
const monWed: Meeting[] = [
  { day: 1, start: '10:30', minutes: 50 },
  { day: 3, start: '10:30', minutes: 50 },
];
const chem: CourseInput = { name: 'CHEM 101', meetings: monWed, termStart: '2026-09-02', termEnd: '2026-12-15' };

let counter = 0;
let name: string;
let store: StudyStore;

async function deckIn(courseId: string, pages = 30, title = 'Week 4') {
  const pageTexts = Array.from({ length: pages }, (_, i) => `slide ${i + 1}`);
  return store.addSlideDeck({ courseId, title, fileName: `${title}.pdf`, data: fakePdf(title), pageTexts });
}

describe('shareBudget', () => {
  it('shares minutes by page count in whole minutes that add up exactly', () => {
    expect(shareBudget(50, [10])).toEqual([50]);
    expect(shareBudget(50, [10, 10])).toEqual([25, 25]);
    expect(shareBudget(50, [1, 1, 1])).toEqual([17, 17, 16]);
    expect(shareBudget(50, [30, 10]).reduce((a, b) => a + b)).toBe(50);
    expect(shareBudget(50, [30, 10])).toEqual([38, 12]); // 37.5 and 12.5: the earlier one gets the odd minute
  });
});

describe.each(['before setup (plain)', 'encrypted'] as const)('lecture store, %s', (mode) => {
  beforeEach(async () => {
    name = `lectures-${++counter}`;
    store = await openStudyStore({ name });
    if (mode === 'encrypted') {
      const key = await newDataKey();
      await store.setUp(await testKeyring(key), key);
    }
  });
  afterEach(() => store.close());

  describe('classes', () => {
    it('are created, listed by name, updated and validated', async () => {
      const c = await store.createCourse({ ...chem, name: '  CHEM 101 ' });
      await store.createCourse({ name: 'BIOL 200', meetings: [], termStart: null, termEnd: null });
      expect(c.name).toBe('CHEM 101');
      expect(c.meetings).toEqual(monWed);
      expect((await store.listCourses('2026-11-18')).map((x) => x.name)).toEqual(['BIOL 200', 'CHEM 101']);
      const updated = await store.updateCourse(c.id, { ...chem, name: 'CHEM 102' });
      expect((await store.getCourse(c.id))!.name).toBe('CHEM 102');
      expect(updated.createdAt).toBe(c.createdAt);
    });

    it('refuse bad input with a message, writing nothing', async () => {
      const bad: [string, CourseInput][] = [
        ['empty name', { ...chem, name: ' ' }],
        ['long name', { ...chem, name: 'x'.repeat(101) }],
        ['bad day', { ...chem, meetings: [{ day: 7 as 0, start: '10:30', minutes: 50 }] }],
        ['bad time', { ...chem, meetings: [{ day: 1, start: '25:00', minutes: 50 }] }],
        ['bad minutes', { ...chem, meetings: [{ day: 1, start: '10:30', minutes: 0 }] }],
        ['bad date', { ...chem, termStart: '2026-02-30' }],
        ['ends before it starts', { ...chem, termStart: '2026-12-01', termEnd: '2026-09-01' }],
      ];
      for (const [label, input] of bad) {
        await expect(store.createCourse(input), label).rejects.toMatchObject({ code: 'invalid' });
      }
      expect(await store.listCourses('2026-11-18')).toEqual([]);
    });

    it('summaries count lectures and decks, and show the next exam on or after today', async () => {
      const c = await store.createCourse(chem);
      const deck = await deckIn(c.id);
      await store.recordLecture({ courseId: c.id, date: '2026-11-16', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 5 }] });
      await store.addExam({ courseId: c.id, title: 'Midterm', kind: 'midterm', date: '2026-10-20', lectureIds: null });
      await store.addExam({ courseId: c.id, title: 'Final', kind: 'final', date: '2026-12-10', lectureIds: null });
      const [summary] = await store.listCourses('2026-11-18');
      expect(summary).toMatchObject({ lectureCount: 1, deckCount: 1 });
      expect(summary!.nextExam!.title).toBe('Final');
      expect((await store.listCourses('2026-12-11'))[0]!.nextExam).toBeNull();
    });

    it('deleting a class deletes everything in it, and nothing of another class', async () => {
      const c = await store.createCourse(chem);
      const other = await store.createCourse({ ...chem, name: 'Other' });
      const deck = await deckIn(c.id);
      const keep = await deckIn(other.id, 5, 'Keep');
      await store.recordLecture({ courseId: c.id, date: '2026-11-16', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 5 }] });
      await store.addExam({ courseId: c.id, title: 'Midterm', kind: 'midterm', date: '2026-10-20', lectureIds: null });
      await store.deleteCourse(c.id);
      expect(await store.getCourse(c.id)).toBeNull();
      const db = await openHonedDb(name);
      for (const s of ['exams', 'lectures', 'sections'] as const) expect(await db.count(s), s).toBe(0);
      expect(await db.getAllKeys('slideDecks')).toEqual([keep.id]);
      expect(await db.getAllKeys('deckFiles')).toEqual([keep.id]);
      expect(await db.getAllKeys('deckPages')).toEqual([keep.id]);
      db.close();
      await expect(store.deleteCourse(c.id)).rejects.toMatchObject({ code: 'not-found' });
    });
  });

  describe('exams', () => {
    it('are listed by date and can cover chosen lectures of their own class only', async () => {
      const c = await store.createCourse(chem);
      const other = await store.createCourse({ ...chem, name: 'Other' });
      const deck = await deckIn(c.id);
      const otherDeck = await deckIn(other.id);
      const l1 = await store.recordLecture({ courseId: c.id, date: '2026-10-01', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 3 }] });
      const foreign = await store.recordLecture({ courseId: other.id, date: '2026-10-01', minutes: 50, sections: [{ deckId: otherDeck.id, firstPage: 1, lastPage: 3 }] });
      await store.addExam({ courseId: c.id, title: 'Final', kind: 'final', date: '2026-12-10', lectureIds: null });
      const mid = await store.addExam({ courseId: c.id, title: 'Midterm', kind: 'midterm', date: '2026-10-20', lectureIds: [l1.lecture.id] });
      expect((await store.listExams(c.id)).map((e) => e.title)).toEqual(['Midterm', 'Final']);
      await expect(
        store.addExam({ courseId: c.id, title: 'X', kind: 'test', date: '2026-10-20', lectureIds: [foreign.lecture.id] }),
      ).rejects.toMatchObject({ code: 'invalid' });
      await expect(store.addExam({ courseId: c.id, title: 'X', kind: 'quiz' as 'test', date: '2026-10-20', lectureIds: null })).rejects.toMatchObject({ code: 'invalid' });
      await expect(store.addExam({ courseId: 'nope', title: 'X', kind: 'test', date: '2026-10-20', lectureIds: null })).rejects.toMatchObject({ code: 'not-found' });
      const moved = await store.updateExam(mid.id, { courseId: c.id, title: 'Midterm 1', kind: 'midterm', date: '2026-10-22', lectureIds: null });
      expect(moved.lectureIds).toBeNull();
      await store.deleteExam(mid.id);
      expect((await store.listExams(c.id)).map((e) => e.title)).toEqual(['Final']);
    });
  });

  describe('slide decks', () => {
    it('keep the PDF byte for byte and its page text, separately from the deck', async () => {
      const c = await store.createCourse(chem);
      const data = fakePdf('lecture four', 300_000);
      const pageTexts = ['Title', 'Covalent bonds', 'Ionic bonds'];
      const deck = await store.addSlideDeck({ courseId: c.id, title: '', fileName: 'Week 4.pdf', data, pageTexts });
      expect(deck).toMatchObject({ title: 'Week 4', fileName: 'Week 4.pdf', pageCount: 3, byteSize: 300_000 });
      expect(await store.getSlideDeckFile(deck.id)).toEqual(data);
      expect(await store.getSlideDeckPages(deck.id)).toEqual(pageTexts);
      expect((await store.listSlideDecks(c.id)).map((d) => d.title)).toEqual(['Week 4']);
      expect((await store.renameSlideDeck(deck.id, 'Bonds')).title).toBe('Bonds');
    });

    it('refuse files that aren’t PDFs, are empty, too big, or have no pages', async () => {
      const c = await store.createCourse(chem);
      const add = (data: Uint8Array, pageTexts = ['a']) => store.addSlideDeck({ courseId: c.id, title: 't', fileName: 'f.pdf', data, pageTexts });
      await expect(add(new TextEncoder().encode('<html>not a pdf'))).rejects.toMatchObject({ code: 'invalid' });
      await expect(add(new Uint8Array(0))).rejects.toMatchObject({ code: 'invalid' });
      await expect(add(fakePdf(), [])).rejects.toMatchObject({ code: 'invalid' });
      const tooBig = new Uint8Array(MAX_PDF_BYTES + 1);
      tooBig.set(new TextEncoder().encode('%PDF-'));
      await expect(add(tooBig)).rejects.toMatchObject({ code: 'invalid' });
      expect(await store.listSlideDecks(c.id)).toEqual([]);
    });

    it('can’t be deleted while a lecture uses them; afterwards the PDF and text go too', async () => {
      const c = await store.createCourse(chem);
      const deck = await deckIn(c.id);
      const { lecture } = await store.recordLecture({ courseId: c.id, date: '2026-11-16', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 5 }] });
      await expect(store.deleteSlideDeck(deck.id)).rejects.toMatchObject({ code: 'invalid' });
      await store.deleteLecture(lecture.id);
      await store.deleteSlideDeck(deck.id);
      await expect(store.getSlideDeckFile(deck.id)).rejects.toMatchObject({ code: 'not-found' });
      await expect(store.getSlideDeckPages(deck.id)).rejects.toMatchObject({ code: 'not-found' });
    });

    it('a 20 MB PDF round-trips intact', async () => {
      const c = await store.createCourse(chem);
      const data = fakePdf('big', 20 * 1024 * 1024);
      const deck = await store.addSlideDeck({ courseId: c.id, title: 'Big', fileName: 'big.pdf', data, pageTexts: ['x'] });
      const back = await store.getSlideDeckFile(deck.id);
      expect(back.length).toBe(data.length);
      expect(back).toEqual(data);
    }, 60_000);
  });

  describe('lectures and sections', () => {
    it('record a lecture with its sections, sharing its minutes by page count', async () => {
      const c = await store.createCourse(chem);
      const a = await deckIn(c.id, 40, 'Week 4');
      const b = await deckIn(c.id, 10, 'Week 5');
      const { lecture, sections } = await store.recordLecture({
        courseId: c.id,
        date: '2026-11-18',
        minutes: 50,
        sections: [
          { deckId: a.id, firstPage: 21, lastPage: 30 }, // 10 pages
          { deckId: b.id, firstPage: 1, lastPage: 10 }, // 10 pages
        ],
      });
      expect(lecture).toMatchObject({ courseId: c.id, date: '2026-11-18', minutes: 50 });
      expect(sections.map((s) => s.schedule.budgetMinutes).sort()).toEqual([25, 25]);
      expect(sections.every((s) => s.lectureId === lecture.id && s.schedule.nextDue === null && s.schedule.studiedMinutes === 0)).toBe(true);
      expect(await store.getLecture(lecture.id)).toEqual({ lecture, sections });
    });

    it('refuse a range outside the deck, backwards, a deck from another class, or no slides', async () => {
      const c = await store.createCourse(chem);
      const other = await store.createCourse({ ...chem, name: 'Other' });
      const deck = await deckIn(c.id, 30);
      const foreign = await deckIn(other.id, 30);
      const record = (sections: { deckId: string; firstPage: number; lastPage: number }[], minutes = 50, date = '2026-11-18') =>
        store.recordLecture({ courseId: c.id, date, minutes, sections });
      for (const [label, sections] of [
        ['past the end', [{ deckId: deck.id, firstPage: 25, lastPage: 31 }]],
        ['page 0', [{ deckId: deck.id, firstPage: 0, lastPage: 3 }]],
        ['backwards', [{ deckId: deck.id, firstPage: 10, lastPage: 5 }]],
        ['another class', [{ deckId: foreign.id, firstPage: 1, lastPage: 3 }]],
        ['nothing', []],
      ] as const) {
        await expect(record([...sections]), label).rejects.toMatchObject({ code: 'invalid' });
      }
      await expect(record([{ deckId: deck.id, firstPage: 1, lastPage: 2 }], 0)).rejects.toMatchObject({ code: 'invalid' });
      await expect(record([{ deckId: deck.id, firstPage: 1, lastPage: 2 }], 50, '2026-13-01')).rejects.toMatchObject({ code: 'invalid' });
      expect(await store.listLectures(c.id)).toEqual([]);
    });

    it('list newest first; changing the minutes re-shares the budgets; deleting removes the sections', async () => {
      const c = await store.createCourse(chem);
      const deck = await deckIn(c.id, 40);
      const older = await store.recordLecture({ courseId: c.id, date: '2026-11-16', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 10 }] });
      const newer = await store.recordLecture({
        courseId: c.id,
        date: '2026-11-18',
        minutes: 50,
        sections: [
          { deckId: deck.id, firstPage: 11, lastPage: 30 },
          { deckId: deck.id, firstPage: 31, lastPage: 40 },
        ],
      });
      expect((await store.listLectures(c.id)).map((l) => l.lecture.date)).toEqual(['2026-11-18', '2026-11-16']);
      const edited = await store.updateLecture(newer.lecture.id, { date: '2026-11-18', minutes: 75 });
      expect(edited.sections.map((s) => [s.firstPage, s.schedule.budgetMinutes])).toEqual([
        [11, 50],
        [31, 25],
      ]);
      expect((await store.listSections()).length).toBe(3);
      await store.deleteLecture(older.lecture.id);
      expect((await store.listSections(c.id)).map((s) => s.firstPage)).toEqual([11, 31]);
      await expect(store.getLecture(older.lecture.id)).resolves.toBeNull();
    });
  });

  it('every write is in the change log, never with the PDF bytes', async () => {
    const c = await store.createCourse(chem);
    const deck = await deckIn(c.id);
    await store.recordLecture({ courseId: c.id, date: '2026-11-18', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 3 }] });
    const log = await store.changesSince(0);
    expect(log.map((e) => `${e.entity}:${e.op}`)).toEqual(['course:put', 'slideDeck:put', 'lecture:put', 'section:put']);
    expect(JSON.stringify(log)).not.toContain('%PDF');
  });
});

describe('encrypted', () => {
  it('nothing from a class, deck, PDF, page text or lecture appears on disk', async () => {
    name = `lectures-${++counter}`;
    store = await openStudyStore({ name });
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key);
    const c = await store.createCourse({ ...chem, name: `CHEM ${MARKER}` });
    const deck = await store.addSlideDeck({
      courseId: c.id,
      title: `Deck ${MARKER}`,
      fileName: `${MARKER}.pdf`,
      data: fakePdf(MARKER, 10_000),
      pageTexts: [`page ${MARKER}`],
    });
    await store.recordLecture({ courseId: c.id, date: '2026-11-18', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 1 }] });
    await store.addExam({ courseId: c.id, title: `Exam ${MARKER}`, kind: 'final', date: '2026-12-10', lectureIds: null });
    store.close();
    const db = await openHonedDb(name);
    for (const s of [...RECORD_STORES, 'meta'] as const) {
      expect(containsText(await db.getAll(s), MARKER), s).toBe(false);
    }
    // Readable fields are exactly SECURITY.md's table
    const keys = async (s: 'courses' | 'exams' | 'slideDecks' | 'deckFiles' | 'deckPages' | 'lectures' | 'sections') =>
      Object.keys((await db.getAll(s))[0] as object).sort();
    expect(await keys('courses')).toEqual(['enc', 'id']);
    expect(await keys('exams')).toEqual(['courseId', 'date', 'enc', 'id']);
    expect(await keys('slideDecks')).toEqual(['courseId', 'enc', 'id']);
    expect(await keys('deckFiles')).toEqual(['enc', 'id']);
    expect(await keys('deckPages')).toEqual(['enc', 'id']);
    expect(await keys('lectures')).toEqual(['courseId', 'date', 'enc', 'id']);
    expect(await keys('sections')).toEqual(['courseId', 'deckId', 'enc', 'id', 'lectureId', 'nextDue']);
    // The PDF is stored as raw ciphertext: its size plus the 16-byte tag, not JSON
    const file = (await db.getAll('deckFiles'))[0] as { enc: { ct: Uint8Array } };
    expect(file.enc.ct.length).toBe(10_000 + 16);
    db.close();
  });

  it('setUp seals lectures, decks and PDFs made before it, and they read back the same', async () => {
    name = `lectures-${++counter}`;
    store = await openStudyStore({ name });
    const c = await store.createCourse(chem);
    const data = fakePdf(MARKER, 5_000);
    const deck = await store.addSlideDeck({ courseId: c.id, title: 'Plain', fileName: 'p.pdf', data, pageTexts: [`p ${MARKER}`] });
    const lecture = await store.recordLecture({ courseId: c.id, date: '2026-11-18', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 1 }] });
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key);
    expect(await store.getSlideDeckFile(deck.id)).toEqual(data);
    expect(await store.getLecture(lecture.lecture.id)).toEqual(lecture);
    const db = await openHonedDb(name);
    for (const s of RECORD_STORES) {
      expect((await db.getAll(s)).every((r) => 'enc' in (r as object)), s).toBe(true);
      expect(containsText(await db.getAll(s), MARKER), s).toBe(false);
    }
    db.close();
    store.close();
  });
});
