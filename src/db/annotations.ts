// The annotation side of StudyStore (#56, milestone 7): highlights, area boxes and pinned notes on a
// slide deck's pages. Built on the store's own helpers like lectures.ts and quiz.ts: sealed per
// docs/SECURITY.md (only id, courseId and deckId stay readable; the page is inside), refused while
// locked, every write inside `exclusive()` and in the change log.
import {
  ANNOTATION_COLOURS,
  type Annotation,
  type AnnotationInput,
  type AnnotationStore,
  type PageRect,
} from '../types/annotation';
import type { SlideDeck } from '../types/lecture';
import { writeRows, type StoreContext } from './lectures';
import { StoreError } from './store';

export const ANNOTATION_TEXT_MAX = 5_000;
export const ANNOTATION_NOTE_MAX = 10_000;
export const ANNOTATION_RECTS_MAX = 500;
export const ANNOTATIONS_PER_PAGE_MAX = 1_000;

const invalid = (message: string) => new StoreError('invalid', message);
const notFound = () => new StoreError('not-found', 'That note or highlight no longer exists.');
const isFraction = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

/** A box inside the page (fractions 0-1), copied so nothing else rides along into the record. */
function checkRect(r: unknown): PageRect {
  const { x, y, w, h } = (r ?? {}) as Partial<PageRect>;
  if (!isFraction(x) || !isFraction(y) || !isFraction(w) || !isFraction(h) || x + w > 1.000001 || y + h > 1.000001) {
    throw invalid('That position isn’t on the slide.');
  }
  return { x, y, w, h };
}

function checkColour(colour: unknown) {
  if (!(ANNOTATION_COLOURS as readonly unknown[]).includes(colour)) throw invalid('Pick one of the highlight colours.');
  return colour as Annotation['colour'];
}

function checkNote(note: unknown, required: boolean): string {
  if (typeof note !== 'string') throw invalid('A note is text.');
  const clean = note.trim();
  if (clean.length > ANNOTATION_NOTE_MAX) throw invalid(`A note can be at most ${ANNOTATION_NOTE_MAX.toLocaleString('en')} characters.`);
  if (required && !clean) throw invalid('A pinned note can’t be empty.');
  return clean;
}

function checkShape(input: AnnotationInput): Pick<Annotation, 'kind' | 'rects' | 'text'> {
  if (!Array.isArray(input.rects)) throw invalid('That position isn’t on the slide.');
  const rects = input.rects.map(checkRect);
  const text = typeof input.text === 'string' ? input.text.trim() : null;
  if (text === null) throw invalid('Highlighted words are text.');
  switch (input.kind) {
    case 'text':
      if (rects.length < 1 || rects.length > ANNOTATION_RECTS_MAX) throw invalid('Select some words to highlight.');
      if (!text) throw invalid('Select some words to highlight.');
      if (text.length > ANNOTATION_TEXT_MAX) throw invalid(`Highlight at most ${ANNOTATION_TEXT_MAX.toLocaleString('en')} characters at once.`);
      return { kind: 'text', rects, text };
    case 'area':
      if (rects.length !== 1 || rects[0]!.w === 0 || rects[0]!.h === 0) throw invalid('Drag a box over part of the slide.');
      if (text) throw invalid('An area highlight has no words.');
      return { kind: 'area', rects, text: '' };
    case 'note':
      if (rects.length !== 1 || rects[0]!.w !== 0 || rects[0]!.h !== 0) throw invalid('A note is pinned to one point.');
      if (text) throw invalid('A pinned note has no highlighted words.');
      return { kind: 'note', rects, text: '' };
    default:
      throw invalid('Unknown kind of note or highlight.');
  }
}

const byPlace = (a: Annotation, b: Annotation) => a.page - b.page || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export function annotationMethods(ctx: StoreContext): AnnotationStore {
  const { db, open, openAll, seal, change, exclusive, requireOpen } = ctx;
  const iso = () => ctx.clock().toISOString();

  const save = async (annotation: Annotation) => {
    const [sealed, log] = await Promise.all([seal('annotations', { ...annotation }), change('annotation', 'put', annotation.id, annotation)]);
    await writeRows(db, [{ store: 'annotations', row: sealed }], [], [log]);
  };
  const getOrThrow = async (id: string) => {
    const row = await db.get('annotations', id);
    if (!row) throw notFound();
    return open<Annotation>('annotations', row);
  };
  const listDeck = async (deckId: string) => openAll<Annotation>('annotations', await db.getAllFromIndex('annotations', 'byDeck', deckId));

  return {
    async listAnnotations(deckId, page) {
      requireOpen();
      const all = await listDeck(deckId);
      return (page === undefined ? all : all.filter((a) => a.page === page)).sort(byPlace);
    },

    addAnnotation: (input) =>
      exclusive(async () => {
        requireOpen();
        const row = await db.get('slideDecks', input?.deckId);
        if (!row) throw new StoreError('not-found', 'That slide deck no longer exists.');
        const deck = await open<SlideDeck>('slideDecks', row);
        if (!Number.isInteger(input.page) || input.page < 1 || input.page > deck.pageCount) {
          throw invalid(`That slide isn’t in this deck (it has ${deck.pageCount}).`);
        }
        const shape = checkShape(input);
        const colour = checkColour(input.colour);
        const note = checkNote(input.note, shape.kind === 'note');
        const onPage = (await listDeck(deck.id)).filter((a) => a.page === input.page).length;
        if (onPage >= ANNOTATIONS_PER_PAGE_MAX) throw invalid(`A slide can have at most ${ANNOTATIONS_PER_PAGE_MAX} notes and highlights.`);
        const now = iso();
        const annotation: Annotation = {
          id: ctx.newId(),
          courseId: deck.courseId,
          deckId: deck.id,
          page: input.page,
          ...shape,
          colour,
          note,
          createdAt: now,
          updatedAt: now,
        };
        await save(annotation);
        return annotation;
      }),

    updateAnnotation: (id, changes) =>
      exclusive(async () => {
        requireOpen();
        const old = await getOrThrow(id);
        const next: Annotation = {
          ...old,
          colour: changes?.colour === undefined ? old.colour : checkColour(changes.colour),
          note: changes?.note === undefined ? old.note : checkNote(changes.note, old.kind === 'note'),
          updatedAt: iso(),
        };
        await save(next);
        return next;
      }),

    deleteAnnotation: (id) =>
      exclusive(async () => {
        requireOpen();
        if (!(await db.get('annotations', id))) throw notFound();
        await writeRows(db, [], [{ store: 'annotations', id }], [await change('annotation', 'delete', id, null)]);
      }),
  };
}
