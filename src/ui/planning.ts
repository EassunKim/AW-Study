// Loads what the planner needs (src/plan/planner.ts) and the names the screens show with it, for the
// Today panel and Play. Everything is read fresh each time: nothing the planner works out is stored.
import type { StudyStore } from '../db/store';
import { deviceTimeZone, studyDay } from '../lib/studyDay';
import { planDay, type Plan, type PlanItem } from '../plan/planner';
import type { Course, Section, SlideDeck } from '../types/lecture';
import { slidesLabel } from './classes';
import { DAY_START_HOUR } from './settings';

export interface ItemPlace {
  course: Course;
  section: Section;
  deck: SlideDeck;
}

export interface Planning {
  today: string;
  plan: Plan;
  place: (sectionId: string) => ItemPlace | undefined;
  /** Courses with at least one lecture: whether there's anything to plan at all. */
  hasLectures: boolean;
}

export async function loadPlanning(store: StudyStore, now = new Date()): Promise<Planning> {
  const timeZone = deviceTimeZone();
  const today = studyDay(now, timeZone, DAY_START_HOUR);
  const courses = await store.listCourses(today);
  const [perCourse, sections, attempts, sessions, settings] = await Promise.all([
    Promise.all(courses.map(async (c) => ({ lectures: await store.listLectures(c.id), decks: await store.listSlideDecks(c.id) }))),
    store.listSections(),
    store.listQuizAttempts(),
    store.listStudySessions(),
    store.getStudySettings(),
  ]);
  const lectures = perCourse.flatMap((p) => p.lectures.map((l) => l.lecture));
  const decks = new Map(perCourse.flatMap((p) => p.decks).map((d) => [d.id, d]));
  const courseById = new Map<string, Course>(courses.map((c) => [c.id, c]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const plan = planDay({ today, dailyMinutes: settings.dailyMinutes, lectures, sections, sessions, attempts, timeZone, dayStartHour: DAY_START_HOUR });
  return {
    today,
    plan,
    hasLectures: lectures.length > 0,
    place(sectionId) {
      const section = sectionById.get(sectionId);
      const course = section && courseById.get(section.courseId);
      const deck = section && decks.get(section.deckId);
      return section && course && deck ? { course, section, deck } : undefined;
    },
  };
}

/** "Study: PHIL 201 · Unit 4, slides 1–19" and its details line. */
export function describeItem(item: PlanItem, place: ItemPlace): { title: string; detail: string } {
  const where = `${place.course.name} · ${place.deck.title}, ${slidesLabel(place.section.firstPage, place.section.lastPage)}`;
  const late = item.overdueDays > 0 ? ` · ${item.overdueDays} day${item.overdueDays === 1 ? '' : 's'} late` : '';
  switch (item.kind) {
    case 'study':
      return { title: `Study ${where}`, detail: `${item.minutes} min, then a ${item.quizSize}-question quiz · session ${item.step} of 3${late}` };
    case 'quiz':
      return { title: `Quiz: ${where}`, detail: `${item.quizSize} questions, about ${item.minutes} min${late}` };
    case 'extra':
      return { title: `Extra study: ${where}`, detail: `${item.minutes} min, after a low quiz score${late}` };
  }
}
