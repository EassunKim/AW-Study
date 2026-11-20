// Plain helpers for the class and lecture screens: lecture times grouped the way people say them
// ("Mon, Wed, Fri 10:30 am, 50 min"), the latest lecture that has happened (the default answer to
// "What was covered?"), and labels for dates and slide ranges. No React, so they're unit-tested.
import type { Course, LectureWithSections, Meeting, SlideDeck, Weekday } from '../types/lecture';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
/** Monday first, as timetables are. */
export const WEEK: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const weekOrder = (day: Weekday) => WEEK.indexOf(day);

/** Lecture times that share a start and length: "Mon, Wed, Fri at 10:30 for 50 min". */
export interface MeetingGroup {
  days: Weekday[];
  start: string; // "HH:MM"
  minutes: number;
}

/** Groups meetings by start and length, days Monday first, groups by their first day then start. */
export function groupMeetings(meetings: readonly Meeting[]): MeetingGroup[] {
  const groups = new Map<string, MeetingGroup>();
  for (const m of meetings) {
    const key = `${m.start}|${m.minutes}`;
    const group = groups.get(key) ?? { days: [], start: m.start, minutes: m.minutes };
    if (!group.days.includes(m.day)) group.days.push(m.day);
    groups.set(key, group);
  }
  const list = [...groups.values()];
  for (const g of list) g.days.sort((a, b) => weekOrder(a) - weekOrder(b));
  return list.sort((a, b) => weekOrder(a.days[0]!) - weekOrder(b.days[0]!) || a.start.localeCompare(b.start));
}

/** Back from groups to meetings, one per day; a day and start given twice counts once. */
export function expandGroups(groups: readonly MeetingGroup[]): Meeting[] {
  const seen = new Set<string>();
  const meetings: Meeting[] = [];
  for (const g of groups) {
    for (const day of g.days) {
      const key = `${day}|${g.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      meetings.push({ day, start: g.start, minutes: g.minutes });
    }
  }
  return meetings.sort((a, b) => weekOrder(a.day) - weekOrder(b.day) || a.start.localeCompare(b.start));
}

/** "10:30 am", "2:05 pm", "12:00 pm" from "HH:MM". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Mon, Wed, Fri 10:30 am, 50 min · Tue 2:00 pm, 80 min", or a note when there are none. */
export function describeMeetings(meetings: readonly Meeting[]): string {
  if (meetings.length === 0) return 'No set lecture times';
  return groupMeetings(meetings)
    .map((g) => `${g.days.map((d) => DAY_NAMES[d]).join(', ')} ${formatTime(g.start)}, ${g.minutes} min`)
    .join(' · ');
}

/** The local date, weekday and "HH:MM" of `at` in `timeZone`. */
export function localNow(at: Date, timeZone: string): { date: string; day: Weekday; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return { date, day: weekday(date), time: `${get('hour')}:${get('minute')}` };
}

/** The weekday of a "YYYY-MM-DD" date. */
export function weekday(date: string): Weekday {
  return new Date(`${date}T12:00:00Z`).getUTCDay() as Weekday;
}

/** `date` moved by `days` (negative for earlier). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The most recent lecture that has started, within the last week: its date and length. Null when
 * the class has no set times. A lecture counts once it has started, so during a lecture it's that
 * one (you might fill it in at the end).
 */
export function latestLecture(meetings: readonly Meeting[], at: Date, timeZone: string): { date: string; minutes: number } | null {
  if (meetings.length === 0) return null;
  const now = localNow(at, timeZone);
  for (let back = 0; back <= 7; back++) {
    const date = addDays(now.date, -back);
    const day = weekday(date);
    const started = meetings
      .filter((m) => m.day === day && (back > 0 || m.start <= now.time))
      .sort((a, b) => b.start.localeCompare(a.start));
    if (started[0]) return { date, minutes: started[0].minutes };
  }
  return null; // unreachable: every weekday comes up within 7 days
}

/** How long the lecture on `date` was: the last one that day (as latestLecture picks), or null if none. */
export function lectureMinutesOn(meetings: readonly Meeting[], date: string): number | null {
  const day = weekday(date);
  const that = meetings.filter((m) => m.day === day).sort((a, b) => b.start.localeCompare(a.start))[0];
  return that ? that.minutes : null;
}

/** How far before a class was added its lectures still count as "to fill in": latestLecture's week. */
export const UNFILLED_LOOK_BACK_DAYS = 7;

/**
 * The lectures that have happened but aren't filled in yet, oldest first (the Classes page's date
 * buttons, docs/design "Classes"). Every lecture time from a week before the class was added (or the
 * term's start, if later) up to now, never past the term's end, less the dates in `filled`. Like
 * latestLecture, a lecture counts once it has started.
 */
export function unfilledLectures(
  course: Pick<Course, 'meetings' | 'termStart' | 'termEnd' | 'createdAt'>,
  filled: ReadonlySet<string>,
  at: Date,
  timeZone: string,
): { date: string; minutes: number }[] {
  if (course.meetings.length === 0) return [];
  const now = localNow(at, timeZone);
  let from = addDays(localNow(new Date(course.createdAt), timeZone).date, -UNFILLED_LOOK_BACK_DAYS);
  if (course.termStart && course.termStart > from) from = course.termStart;
  const to = course.termEnd && course.termEnd < now.date ? course.termEnd : now.date;
  const found: { date: string; minutes: number }[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (filled.has(date)) continue;
    const day = weekday(date);
    const started = course.meetings
      .filter((m) => m.day === day && (date < now.date || m.start <= now.time))
      .sort((a, b) => b.start.localeCompare(a.start));
    if (started[0]) found.push({ date, minutes: started[0].minutes });
  }
  return found;
}

/** "Nov 15": a lecture's date on its button. */
export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

/** "Wed, Nov 18" (and the year when it isn't `thisYear`). */
export function formatDate(date: string, thisYear?: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const withYear = thisYear !== undefined && date.slice(0, 4) !== thisYear;
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** "today", "tomorrow", "in 12 days", "3 days ago". */
export function relativeDay(today: string, date: string): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** "slide 4" or "slides 21–30". */
export function slidesLabel(first: number, last: number): string {
  return first === last ? `slide ${first}` : `slides ${first}–${last}`;
}

/** A deck's title from its file name: "Week 4.pdf" → "Week 4". */
export function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').trim() || 'Slides';
}

/**
 * Where the latest lecture (`lectures` is newest first) stopped: the furthest slide it reached in
 * the newest deck it used, if that deck has slides after it.
 */
export function carryOn(lectures: LectureWithSections[], decks: SlideDeck[]): { deck: SlideDeck; next: number } | null {
  const latest = lectures[0];
  if (!latest) return null;
  let best: { deck: SlideDeck; reached: number } | null = null;
  for (const s of latest.sections) {
    const deck = decks.find((d) => d.id === s.deckId);
    if (!deck) continue;
    const newer = !best || deck.createdAt > best.deck.createdAt;
    if (newer || (deck.id === best!.deck.id && s.lastPage > best!.reached)) best = { deck, reached: s.lastPage };
  }
  return best && best.reached < best.deck.pageCount ? { deck: best.deck, next: best.reached + 1 } : null;
}

/** A lecture's sections in reading order: older decks first, then by first slide. */
export function orderSections<S extends { deckId: string; firstPage: number }>(sections: readonly S[], decks: readonly SlideDeck[]): S[] {
  const added = new Map(decks.map((d) => [d.id, d.createdAt]));
  return [...sections].sort((a, b) => (added.get(a.deckId) ?? '').localeCompare(added.get(b.deckId) ?? '') || a.firstPage - b.firstPage);
}
