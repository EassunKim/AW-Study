// Notes and highlights on slides (#56): the store's rules, plain and encrypted.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnnotationInput } from '../types/annotation';
import { openHonedDb, RECORD_STORES } from './schema';
import { openStudyStore, type StudyStore } from './store';
import { containsText, fakePdf, newDataKey, testKeyring } from './test-helpers';

let counter = 0;
let name: string;
let store: StudyStore;
let now = Date.parse('2026-11-18T18:00:00.000Z');
const clock = () => new Date((now += 1000));

async function deck(pages = 5) {
  const course = await store.createCourse({ name: 'BIOL 110', meetings: [], termStart: null, termEnd: null });
  const d = await store.addSlideDeck({ courseId: course.id, title: 'Cells', fileName: 'cells.pdf', data: fakePdf(), pageTexts: Array(pages).fill('t') });
  return { course, deck: d };
}

const text = (deckId: string, extra: Partial<AnnotationInput> = {}): AnnotationInput => ({
  deckId,
  page: 2,
  kind: 'text',
  rects: [
    { x: 0.1, y: 0.2, w: 0.5, h: 0.04 },
    { x: 0.1, y: 0.25, w: 0.3, h: 0.04 },
  ],
  text: 'mitochondria make ATP',
  colour: 'yellow',
  note: '',
  ...extra,
});
const area = (deckId: string, extra: Partial<AnnotationInput> = {}): AnnotationInput => ({
  deckId,
  page: 2,
  kind: 'area',
  rects: [{ x: 0.5, y: 0.5, w: 0.4, h: 0.3 }],
  text: '',
  colour: 'blue',
  note: 'the diagram',
  ...extra,
});
const pin = (deckId: string, extra: Partial<AnnotationInput> = {}): AnnotationInput => ({
  deckId,
  page: 3,
  kind: 'note',
  rects: [{ x: 0.9, y: 0.1, w: 0, h: 0 }],
  text: '',
  colour: 'pink',
  note: 'ask about this in class',
  ...extra,
});

describe.each(['before setup (plain)', 'encrypted'] as const)('annotation store, %s', (mode) => {
  beforeEach(async () => {
    name = `annotations-${++counter}`;
    store = await openStudyStore({ name, deps: { clock } });
    if (mode === 'encrypted') {
      const key = await newDataKey();
      await store.setUp(await testKeyring(key), key);
    }
  });
  afterEach(() => store.close());

  it('adds text, area and note annotations and lists them by page, oldest first', async () => {
    const { course, deck: d } = await deck();
    const n = await store.addAnnotation(pin(d.id));
    const t = await store.addAnnotation(text(d.id, { text: '  mitochondria make ATP  ' }));
    const a = await store.addAnnotation(area(d.id));
    expect(t).toMatchObject({ courseId: course.id, deckId: d.id, page: 2, kind: 'text', text: 'mitochondria make ATP', colour: 'yellow' });
    expect(t.createdAt).toBe(t.updatedAt);
    expect((await store.listAnnotations(d.id)).map((x) => x.id)).toEqual([t.id, a.id, n.id]);
    expect((await store.listAnnotations(d.id, 2)).map((x) => x.id)).toEqual([t.id, a.id]);
    expect(await store.listAnnotations(d.id, 4)).toEqual([]);
    expect(await store.listAnnotations('another deck')).toEqual([]);
  });

  it('keeps only the position fields of each box', async () => {
    const { deck: d } = await deck();
    const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.2, extra: 'no' } as never;
    const a = await store.addAnnotation(area(d.id, { rects: [rect] }));
    expect((await store.listAnnotations(d.id))[0]!.rects).toEqual([{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }]);
    expect(a.rects[0]).not.toHaveProperty('extra');
  });

  it('refuses malformed annotations', async () => {
    const { deck: d } = await deck();
    const cases: [string, AnnotationInput][] = [
      ['page 0', text(d.id, { page: 0 })],
      ['page past the end', text(d.id, { page: 6 })],
      ['part page', text(d.id, { page: 1.5 })],
      ['unknown kind', text(d.id, { kind: 'scribble' as never })],
      ['unknown colour', text(d.id, { colour: 'red' as never })],
      ['text without words', text(d.id, { text: '   ' })],
      ['text without boxes', text(d.id, { rects: [] })],
      ['too many boxes', text(d.id, { rects: Array(501).fill({ x: 0, y: 0, w: 0.1, h: 0.1 }) })],
      ['too much text', text(d.id, { text: 'x'.repeat(5001) })],
      ['box off the page', text(d.id, { rects: [{ x: 0.8, y: 0, w: 0.3, h: 0.1 }] })],
      ['negative box', text(d.id, { rects: [{ x: -0.1, y: 0, w: 0.1, h: 0.1 }] })],
      ['box not a number', text(d.id, { rects: [{ x: Number.NaN, y: 0, w: 0.1, h: 0.1 }] })],
      ['area with two boxes', area(d.id, { rects: [area(d.id).rects[0]!, area(d.id).rects[0]!] })],
      ['area with no width', area(d.id, { rects: [{ x: 0.5, y: 0.5, w: 0, h: 0.2 }] })],
      ['area with no height', area(d.id, { rects: [{ x: 0.5, y: 0.5, w: 0.2, h: 0 }] })],
      ['area with words', area(d.id, { text: 'words' })],
      ['note with a size', pin(d.id, { rects: [{ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }] })],
      ['empty pinned note', pin(d.id, { note: '  ' })],
      ['pinned note with words', pin(d.id, { text: 'words' })],
      ['note too long', area(d.id, { note: 'x'.repeat(10_001) })],
      ['note not text', area(d.id, { note: 5 as never })],
    ];
    for (const [label, input] of cases) {
      await expect(store.addAnnotation(input), label).rejects.toMatchObject({ code: 'invalid' });
    }
    await expect(store.addAnnotation(text('no such deck'))).rejects.toMatchObject({ code: 'not-found' });
    expect(await store.listAnnotations(d.id)).toEqual([]);
  });

  it('changes the colour and the note, and nothing else', async () => {
    const { deck: d } = await deck();
    const t = await store.addAnnotation(text(d.id));
    const changed = await store.updateAnnotation(t.id, { colour: 'green', note: ' kept from Explain ', page: 4 } as never);
    expect(changed).toMatchObject({ colour: 'green', note: 'kept from Explain', page: 2, text: t.text, createdAt: t.createdAt });
    expect(changed.updatedAt > t.updatedAt).toBe(true);
    expect(await store.listAnnotations(d.id)).toEqual([changed]);
    expect(await store.updateAnnotation(t.id, {})).toMatchObject({ colour: 'green', note: 'kept from Explain' });
    await expect(store.updateAnnotation(t.id, { colour: 'red' as never })).rejects.toMatchObject({ code: 'invalid' });
    const n = await store.addAnnotation(pin(d.id));
    await expect(store.updateAnnotation(n.id, { note: '' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.updateAnnotation('gone', { note: 'x' })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('deletes one annotation', async () => {
    const { deck: d } = await deck();
    const t = await store.addAnnotation(text(d.id));
    const a = await store.addAnnotation(area(d.id));
    await store.deleteAnnotation(t.id);
    expect((await store.listAnnotations(d.id)).map((x) => x.id)).toEqual([a.id]);
    await expect(store.deleteAnnotation(t.id)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('deleting a deck or a class deletes their annotations, and only theirs', async () => {
    const one = await deck();
    const two = await deck();
    await store.addAnnotation(text(one.deck.id));
    await store.addAnnotation(pin(one.deck.id));
    const kept = await store.addAnnotation(area(two.deck.id));
    await store.deleteSlideDeck(one.deck.id);
    expect(await store.listAnnotations(one.deck.id)).toEqual([]);
    expect(await store.listAnnotations(two.deck.id)).toEqual([kept]);
    await store.deleteCourse(two.course.id);
    store.close();
    const db = await openHonedDb(name);
    expect(await db.count('annotations')).toBe(0);
    const log = (await db.getAll('changes')).filter((c) => c.entity === 'annotation');
    expect(log.map((c) => c.op)).toEqual(['put', 'put', 'put', 'delete', 'delete', 'delete']);
    db.close();
    store = await openStudyStore({ name });
  });

  it('is refused while locked', async () => {
    const { deck: d } = await deck();
    const t = await store.addAnnotation(text(d.id));
    if (mode === 'before setup (plain)') return;
    store.lock();
    await expect(store.listAnnotations(d.id)).rejects.toMatchObject({ code: 'locked' });
    await expect(store.listAnnotations('a deck with none')).rejects.toMatchObject({ code: 'locked' });
    await expect(store.addAnnotation(text(d.id))).rejects.toMatchObject({ code: 'locked' });
    await expect(store.updateAnnotation(t.id, { note: 'x' })).rejects.toMatchObject({ code: 'locked' });
    await expect(store.deleteAnnotation(t.id)).rejects.toMatchObject({ code: 'locked' });
  });
});

describe('annotations encrypted, on disk', () => {
  it('only id, courseId and deckId are readable, in the store and in the change log', async () => {
    name = `annotations-${++counter}`;
    store = await openStudyStore({ name });
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key);
    const { deck: d } = await deck();
    await store.addAnnotation(text(d.id, { text: 'golgi apparatus', note: 'secret note words' }));
    store.close();
    const db = await openHonedDb(name);
    expect(Object.keys((await db.getAll('annotations'))[0] as object).sort()).toEqual(['courseId', 'deckId', 'enc', 'id']);
    for (const st of RECORD_STORES) {
      const rows = await db.getAll(st);
      expect(containsText(rows, 'golgi'), st).toBe(false);
      expect(containsText(rows, 'secret note'), st).toBe(false);
      expect(containsText(rows, '"page"'), st).toBe(false);
    }
    db.close();
  });
});
