// The shared contract for the viewer's notes and highlights (#56, milestone 7; docs/DESIGN.md "The
// slide viewer"). The storage (src/db/annotations.ts) and the viewer (src/viewer/) code against these.
// Change them only in their own small PR, announced in the task issues.
//
// Plain JSON. Times are ISO 8601 strings in UTC. Ids are crypto.randomUUID() strings.
//
// An annotation belongs to a slide deck's page, not to a section: it shows wherever that slide is open
// (the slides, a study session, a quiz's slide). The PDF itself is never changed. Unlike quiz attempts
// and study sessions, annotations are the user's own notes: they can be edited and deleted.

/**
 * - `text`: words selected on the slide, highlighted line by line.
 * - `area`: a box dragged over any part of the slide (diagrams, images).
 * - `note`: a note pinned to a point on the slide.
 */
export type AnnotationKind = 'text' | 'area' | 'note';

export const ANNOTATION_COLOURS = ['yellow', 'green', 'blue', 'pink'] as const;
export type AnnotationColour = (typeof ANNOTATION_COLOURS)[number];

/**
 * A box on the page, as fractions of the page's width and height (0 to 1, from the top left), so it
 * lines up at any zoom and screen size. A point (a pinned note) is a box with w and h 0.
 */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Annotation {
  id: string;
  courseId: string; // the deck's class
  deckId: string;
  page: number; // from 1, within the deck
  kind: AnnotationKind;
  /** text: one box per line, 1-500; area: exactly one box with some size; note: exactly one point. */
  rects: PageRect[];
  /** The words highlighted (text), 1-5,000 characters; '' for an area or a note. */
  text: string;
  colour: AnnotationColour;
  /** The user's note, or an AI answer kept as a note: 0-10,000 characters (a pinned note needs 1). */
  note: string;
  createdAt: string;
  updatedAt: string;
}

export type AnnotationInput = Pick<Annotation, 'deckId' | 'page' | 'kind' | 'rects' | 'text' | 'colour' | 'note'>;

/** What can change after an annotation is made: its colour and its note. */
export type AnnotationChange = Partial<Pick<Annotation, 'colour' | 'note'>>;

/**
 * The store methods for annotations. Part of StudyStore (src/db/store.ts), with its rules: 'locked'
 * while locked, 'invalid' (with a user-ready message) or 'not-found' as appropriate. Deleting a class
 * or a slide deck deletes its annotations too.
 */
export interface AnnotationStore {
  /** A deck's annotations, by page then oldest first; or only one page's. */
  listAnnotations(deckId: string, page?: number): Promise<Annotation[]>;
  /** 'invalid' if malformed (see Annotation), or the page isn't in the deck; at most 1,000 per page. */
  addAnnotation(input: AnnotationInput): Promise<Annotation>;
  /** Changes the colour or the note. 'invalid' for a pinned note left empty. */
  updateAnnotation(id: string, change: AnnotationChange): Promise<Annotation>;
  deleteAnnotation(id: string): Promise<void>;
}
