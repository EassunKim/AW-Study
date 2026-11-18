// The shared contract for milestone 4 (docs/DESIGN.md, "Classes, lectures and sections"). The
// storage (#24), the viewer (#25) and the screens (#26) code against these types and the
// `LectureStore` interface below. Change them only in their own small PR, announced in those issues.
//
// Plain JSON everywhere except the PDF bytes themselves (Uint8Array), which only addSlideDeck and
// getSlideDeckFile carry. Times are ISO 8601 strings in UTC; calendar dates are "YYYY-MM-DD" in the
// user's study day (src/lib/studyDay.ts); clock times are "HH:MM" in the user's local time.
// Ids are crypto.randomUUID() strings.
//
// "Course" is the code's word for what the screens call a class (`class` is a keyword).

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, as Date.getDay()

/** One weekly lecture slot, e.g. Mondays at 10:30 for 50 minutes. */
export interface Meeting {
  day: Weekday;
  start: string; // "HH:MM", local time
  minutes: number; // 1-600
}

export interface Course {
  id: string;
  name: string; // 1-100 characters
  meetings: Meeting[]; // may be empty (no fixed schedule)
  termStart: string | null; // "YYYY-MM-DD"
  termEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CourseInput = Pick<Course, 'name' | 'meetings' | 'termStart' | 'termEnd'>;

export type ExamKind = 'midterm' | 'final' | 'test';

export interface Exam {
  id: string;
  courseId: string;
  title: string; // e.g. "Midterm 1"
  kind: ExamKind;
  date: string; // "YYYY-MM-DD"
  /** The lectures it covers; null = every lecture of the course up to its date. */
  lectureIds: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export type ExamInput = Pick<Exam, 'courseId' | 'title' | 'kind' | 'date' | 'lectureIds'>;

/** A PDF of slides. Its bytes and page text are stored separately, so lists never decrypt them. */
export interface SlideDeck {
  id: string;
  courseId: string;
  title: string; // shown to the user; starts as the file name without ".pdf"
  fileName: string;
  pageCount: number;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface SlideDeckInput {
  courseId: string;
  title: string;
  fileName: string;
  /** The PDF file. */
  data: Uint8Array;
  /** The text of each page, from extractPageText (#25), in page order; its length is the page count. */
  pageTexts: string[];
}

export interface Lecture {
  id: string;
  courseId: string;
  date: string; // "YYYY-MM-DD"
  minutes: number; // how long it ran: the first-week study budget of its sections
  createdAt: string;
  updatedAt: string;
}

/**
 * What the planner keeps per section. Milestone 5 (the planner) owns these rules and may extend
 * this type in its own contract PR; milestone 4 only sets the starting budget.
 */
export interface SectionSchedule {
  budgetMinutes: number; // first-week study budget: the lecture's minutes, shared by page count
  studiedMinutes: number; // spent so far
  nextDue: string | null; // "YYYY-MM-DD"; null until the planner sets it
  extraMinutes: number; // extra study owed after low scores
}

/** A range of slides covered in one lecture: what gets scheduled and quizzed. */
export interface Section {
  id: string;
  courseId: string;
  lectureId: string;
  deckId: string;
  firstPage: number; // 1-based, inclusive
  lastPage: number; // 1-based, inclusive, at most the deck's page count
  schedule: SectionSchedule;
  createdAt: string;
  updatedAt: string;
}

export interface SectionInput {
  deckId: string;
  firstPage: number;
  lastPage: number;
}

export interface LectureInput {
  courseId: string;
  date: string;
  minutes: number;
  sections: SectionInput[]; // at least one
}

export interface CourseSummary extends Course {
  lectureCount: number;
  deckCount: number;
  nextExam: Exam | null; // the soonest exam on or after today
}

export interface LectureWithSections {
  lecture: Lecture;
  sections: Section[]; // in the order given
}

/**
 * The store methods the screens (#26) call for milestone 4. Part of StudyStore (src/db/store.ts);
 * like the rest of it, every method refuses with StoreError 'locked' while the store is locked,
 * and 'invalid' (with a user-ready message) or 'not-found' as appropriate.
 */
export interface LectureStore {
  // Classes
  listCourses(today: string): Promise<CourseSummary[]>; // sorted by name
  getCourse(id: string): Promise<Course | null>;
  createCourse(input: CourseInput): Promise<Course>;
  updateCourse(id: string, input: CourseInput): Promise<Course>;
  /** Deletes the course and everything in it: exams, decks (with their PDFs), lectures, sections. */
  deleteCourse(id: string): Promise<void>;

  // Exams
  listExams(courseId: string): Promise<Exam[]>; // by date
  addExam(input: ExamInput): Promise<Exam>;
  updateExam(id: string, input: ExamInput): Promise<Exam>;
  deleteExam(id: string): Promise<void>;

  // Slide decks
  listSlideDecks(courseId: string): Promise<SlideDeck[]>; // by title
  /** Stores the PDF and its page text. 'invalid' if it isn't a PDF, is empty, or is over 100 MB. */
  addSlideDeck(input: SlideDeckInput): Promise<SlideDeck>;
  renameSlideDeck(id: string, title: string): Promise<SlideDeck>;
  /** 'invalid' while any section uses the deck (delete those lectures first). */
  deleteSlideDeck(id: string): Promise<void>;
  getSlideDeckFile(id: string): Promise<Uint8Array>;
  getSlideDeckPages(id: string): Promise<string[]>;

  // Lectures and sections
  listLectures(courseId: string): Promise<LectureWithSections[]>; // newest first
  getLecture(id: string): Promise<LectureWithSections | null>;
  /**
   * Records a lecture and its sections. Each section's budget is the lecture's minutes shared by
   * page count. 'invalid' for a page range outside its deck, a deck from another course, or no
   * sections.
   */
  recordLecture(input: LectureInput): Promise<LectureWithSections>;
  /** Changes the date or minutes (budgets are re-shared); sections stay as they are. */
  updateLecture(id: string, edit: { date: string; minutes: number }): Promise<LectureWithSections>;
  /** Deletes the lecture and its sections. */
  deleteLecture(id: string): Promise<void>;
  /** Every section, or one course's: what the planner (milestone 5) reads. */
  listSections(courseId?: string): Promise<Section[]>;
}
