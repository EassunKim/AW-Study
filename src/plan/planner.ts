// The planner (#47, docs/DESIGN.md "Planning the day"): today's checklist, worked out each time from
// the history (lectures, study sessions done, quiz attempts) and the daily minutes. Nothing here is
// stored and nothing here touches the store: a pure function, so every rule has a test.
//
// Days are study days ("YYYY-MM-DD", src/lib/studyDay.ts: the day starts at 4 a.m.). A lecture's
// date is a calendar day, which for a daytime lecture is its study day too.
import { studyDay } from '../lib/studyDay';
import type { Lecture, Section } from '../types/lecture';
import type { StudySession } from '../types/plan';
import type { QuizAttempt } from '../types/quiz';
import { RULES } from './rules';

export type PlanItem =
  | { kind: 'study'; sectionId: string; step: 1 | 2 | 3; minutes: number; quizSize: number; due: string; overdueDays: number }
  | { kind: 'quiz'; sectionId: string; minutes: number; quizSize: number; due: string; overdueDays: number }
  | { kind: 'extra'; sectionId: string; minutes: number; due: string; overdueDays: number };

export interface Plan {
  today: PlanItem[]; // what fits today, in the order to do it (Play runs through these)
  later: PlanItem[]; // due, but over today's minutes: rolls into the coming days
  dailyMinutes: number;
  doneMinutes: number; // studied and quizzed already today (counts against the daily minutes)
  plannedMinutes: number; // today's items
  overBudget: boolean; // the first item alone is more than what's left of today
}

export interface PlanInput {
  today: string;
  dailyMinutes: number;
  lectures: Lecture[];
  sections: Section[];
  sessions: StudySession[];
  attempts: QuizAttempt[];
  timeZone: string;
  dayStartHour: number;
}

/** `date` moved by `days`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** Minutes a quiz of `n` questions takes, at RULES.secondsPerQuestion each, rounded up. */
export function quizMinutes(n: number): number {
  return Math.ceil((n * RULES.secondsPerQuestion) / 60);
}

/** A budget in thirds, whole minutes that add up (the earlier sessions get the odd minutes). */
export function thirds(budget: number): [number, number, number] {
  const base = Math.floor(budget / 3);
  const left = budget - 3 * base;
  return [base + (left > 0 ? 1 : 0), base + (left > 1 ? 1 : 0), base];
}

/** What comes after a quiz score (DESIGN's table): the next gap, the next quiz's size, extra study. */
export function afterScore(score: number, lastGap: number): { gap: number; size: number; extraMinutes: number } {
  for (const band of RULES.scoreBands) {
    if (score >= band.from) {
      const gap = band.gap === 'fixed' ? band.days : Math.max(band.atLeast, Math.round(band.times * lastGap));
      return { gap, size: band.size, extraMinutes: band.extraMinutes };
    }
  }
  throw new Error('unreachable: the last band starts at 0');
}

/** Everything the planner knows about one section: its due items, and its last score. */
export function sectionItems(input: PlanInput, section: Section, lecture: Lecture): { items: PlanItem[]; lastScore: number | null } {
  const day = (iso: string) => studyDay(new Date(iso), input.timeZone, input.dayStartHour);
  const sessions = input.sessions.filter((s) => s.sectionId === section.id);
  const attempts = input.attempts.filter((a) => a.sectionId === section.id).sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  const last = attempts.at(-1) ?? null;
  const items: PlanItem[] = [];
  const due = (date: string) => ({ due: date, overdueDays: Math.max(0, daysBetween(date, input.today)) });

  // The first week: three sessions, on days 1, 3 and 7, but never closer than their spacing to the one before
  const doneOn = [1, 2, 3].map((step) =>
    sessions
      .filter((s) => s.kind === 'first-week' && s.step === step)
      .map((s) => day(s.finishedAt))
      .sort()[0],
  );
  const minutes = thirds(section.schedule.budgetMinutes);
  const offsets = RULES.firstWeekDays;
  let firstWeekDone: string | null = null;
  for (let i = 0; i < 3; i++) {
    if (doneOn[i]) {
      firstWeekDone = i === 2 ? doneOn[i]! : null;
      continue;
    }
    const earliest = addDays(lecture.date, offsets[i]!);
    const afterPrevious = i > 0 ? addDays(doneOn[i - 1]!, offsets[i]! - offsets[i - 1]!) : earliest;
    const date = earliest > afterPrevious ? earliest : afterPrevious;
    if (date <= input.today) {
      items.push({ kind: 'study', sectionId: section.id, step: (i + 1) as 1 | 2 | 3, minutes: minutes[i]!, quizSize: RULES.firstWeekQuizSize, ...due(date) });
    }
    break; // one step at a time
  }

  // After the first week: quizzes, each score setting the next date and size
  if (firstWeekDone) {
    let gap = RULES.firstGapDays;
    let next = addDays(firstWeekDone, gap);
    let size = RULES.firstWeekQuizSize;
    for (const a of attempts) {
      const on = day(a.finishedAt);
      if (on <= firstWeekDone) continue; // the first week's own quizzes
      const after = afterScore(a.score, gap);
      gap = after.gap;
      size = after.size;
      next = addDays(on, gap);
    }
    if (next <= input.today) items.push({ kind: 'quiz', sectionId: section.id, minutes: quizMinutes(size), quizSize: size, ...due(next) });
  }

  // Extra study after a low score, the day after it, until done (a newer low score asks again)
  if (last) {
    const { extraMinutes } = afterScore(last.score, RULES.firstGapDays);
    const doneSince = sessions.some((s) => s.kind === 'extra' && s.finishedAt > last.finishedAt);
    const date = addDays(day(last.finishedAt), 1);
    if (extraMinutes > 0 && !doneSince && date <= input.today) {
      items.push({ kind: 'extra', sectionId: section.id, minutes: extraMinutes, ...due(date) });
    }
  }
  return { items, lastScore: last ? last.score : null };
}

/** Today's checklist. */
export function planDay(input: PlanInput): Plan {
  const day = (iso: string) => studyDay(new Date(iso), input.timeZone, input.dayStartHour);
  const lectures = new Map(input.lectures.map((l) => [l.id, l]));
  const candidates: { item: PlanItem; lastScore: number | null; lectureDate: string }[] = [];
  for (const section of input.sections) {
    const lecture = lectures.get(section.lectureId);
    if (!lecture) continue;
    const { items, lastScore } = sectionItems(input, section, lecture);
    for (const item of items) candidates.push({ item, lastScore, lectureDate: lecture.date });
  }

  // Priority (DESIGN): the lowest recent scores, then new lectures, then the most overdue
  const kindOrder = { extra: 0, study: 1, quiz: 2 } as const;
  const weak = (s: number | null) => s !== null && s < RULES.weakScore;
  candidates.sort((a, b) => {
    const aw = weak(a.lastScore);
    const bw = weak(b.lastScore);
    if (aw !== bw) return aw ? -1 : 1;
    if (aw && bw && a.lastScore !== b.lastScore) return a.lastScore! - b.lastScore!;
    const aNew = a.item.kind === 'study';
    const bNew = b.item.kind === 'study';
    if (!aw && aNew !== bNew) return aNew ? -1 : 1;
    if (a.item.sectionId === b.item.sectionId) return kindOrder[a.item.kind] - kindOrder[b.item.kind];
    return (
      b.item.overdueDays - a.item.overdueDays ||
      a.lectureDate.localeCompare(b.lectureDate) ||
      kindOrder[a.item.kind] - kindOrder[b.item.kind] ||
      a.item.sectionId.localeCompare(b.item.sectionId)
    );
  });

  // What today already holds counts against its minutes
  const doneMinutes =
    input.sessions.filter((s) => day(s.finishedAt) === input.today).reduce((sum, s) => sum + s.minutes, 0) +
    input.attempts.filter((a) => day(a.finishedAt) === input.today && !input.sessions.some((s) => s.sectionId === a.sectionId && day(s.finishedAt) === input.today)).reduce((sum, a) => sum + quizMinutes(a.asked), 0);
  let left = Math.max(0, input.dailyMinutes - doneMinutes);
  const today: PlanItem[] = [];
  const later: PlanItem[] = [];
  let overBudget = false;
  for (const { item } of candidates) {
    if (item.minutes <= left) {
      today.push(item);
      left -= item.minutes;
    } else if (today.length === 0 && doneMinutes === 0) {
      today.push(item); // one big item still gets done, and the screen says it's over
      overBudget = true;
      left = 0;
    } else later.push(item);
  }
  return {
    today,
    later,
    dailyMinutes: input.dailyMinutes,
    doneMinutes,
    plannedMinutes: today.reduce((sum, i) => sum + i.minutes, 0),
    overBudget,
  };
}
