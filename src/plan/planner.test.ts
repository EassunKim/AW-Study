// The planner's rules, one by one (DESIGN "Planning the day"). Times are in UTC with the day starting
// at 4 a.m., so a study day is simply the date of a time between 04:00 and the next 04:00.
import { describe, expect, it } from 'vitest';
import type { Lecture, Section } from '../types/lecture';
import type { StudySession } from '../types/plan';
import type { QuizAttempt } from '../types/quiz';
import { addDays, afterScore, firstWeekQuizSize, planDay, quizMinutes, thirds, type PlanInput } from './planner';

let n = 0;
const at = (day: string, hour = 12) => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;

function lecture(date: string, minutes = 50): Lecture {
  return { id: `l${++n}`, courseId: 'c', date, minutes, createdAt: at(date), updatedAt: at(date) };
}
function section(l: Lecture, budget = l.minutes): Section {
  return {
    id: `s${++n}`,
    courseId: 'c',
    lectureId: l.id,
    deckId: 'd',
    firstPage: 1,
    lastPage: 10,
    schedule: { budgetMinutes: budget, studiedMinutes: 0, nextDue: null, extraMinutes: 0 },
    createdAt: at(l.date),
    updatedAt: at(l.date),
  };
}
function studied(s: Section, day: string, step: 1 | 2 | 3 | null, minutes = 15, hour = 12): StudySession {
  return {
    id: `x${++n}`,
    courseId: 'c',
    sectionId: s.id,
    kind: step ? 'first-week' : 'extra',
    step,
    startedAt: at(day, hour),
    finishedAt: at(day, hour),
    minutes,
    createdAt: at(day, hour),
  };
}
function quizzed(s: Section, day: string, score: number, asked = 10, hour = 13): QuizAttempt {
  const right = Math.round(score * asked);
  return {
    id: `a${++n}`,
    courseId: 'c',
    sectionId: s.id,
    startedAt: at(day, hour),
    finishedAt: at(day, hour),
    answers: [],
    right,
    asked,
    score: right / asked,
    createdAt: at(day, hour),
  };
}

function plan(today: string, parts: { lectures: Lecture[]; sections: Section[]; sessions?: StudySession[]; attempts?: QuizAttempt[] }, dailyMinutes = 60) {
  const input: PlanInput = {
    today,
    dailyMinutes,
    lectures: parts.lectures,
    sections: parts.sections,
    sessions: parts.sessions ?? [],
    attempts: parts.attempts ?? [],
    timeZone: 'UTC',
    dayStartHour: 4,
  };
  return planDay(input);
}
const summary = (items: ReturnType<typeof planDay>['today']) =>
  items.map((i) => `${i.kind}${i.kind === 'study' ? i.step : ''}:${i.sectionId}:${i.minutes}${'quizSize' in i ? `/${i.quizSize}q` : ''}`);

describe('pieces', () => {
  it('thirds add up, earlier sessions getting the odd minutes', () => {
    expect(thirds(50)).toEqual([17, 17, 16]);
    expect(thirds(51)).toEqual([17, 17, 17]);
    expect(thirds(1)).toEqual([1, 0, 0]);
  });

  it('the score table', () => {
    expect(afterScore(0.95, 7)).toEqual({ gap: 18, size: 3, extraMinutes: 0 }); // 2.5 x 7 = 17.5
    expect(afterScore(0.9, 1)).toEqual({ gap: 3, size: 3, extraMinutes: 0 }); // at least 3 days
    expect(afterScore(0.8, 7)).toEqual({ gap: 11, size: 5, extraMinutes: 0 }); // 1.5 x 7 = 10.5
    expect(afterScore(0.6, 18)).toEqual({ gap: 2, size: 8, extraMinutes: 10 });
    expect(afterScore(0.2, 18)).toEqual({ gap: 1, size: 10, extraMinutes: 20 });
    expect(quizMinutes(5)).toBe(4); // 200 seconds
  });

  it('a first-week quiz is sized by the section: 10 for 20 slides, half a question a slide, 5 to 15', () => {
    const pages = (firstPage: number, lastPage: number) => firstWeekQuizSize({ firstPage, lastPage });
    expect(pages(21, 40)).toBe(10); // the default
    expect(pages(1, 24)).toBe(12);
    expect(pages(1, 15)).toBe(8); // 7.5 rounds up
    expect(pages(1, 6)).toBe(5); // never under 5
    expect(pages(1, 60)).toBe(15); // never over 15
  });
});

describe('a new section’s first week', () => {
  const l = lecture('2026-11-16');
  const s = section(l);

  it('three sessions on days 1, 3 and 7, a third of the budget each, one at a time', () => {
    expect(plan('2026-11-16', { lectures: [l], sections: [s] }).today).toEqual([]); // the lecture day itself
    expect(summary(plan('2026-11-17', { lectures: [l], sections: [s] }).today)).toEqual([`study1:${s.id}:17/5q`]);
    const one = [studied(s, '2026-11-17', 1)];
    expect(plan('2026-11-18', { lectures: [l], sections: [s], sessions: one }).today).toEqual([]);
    expect(summary(plan('2026-11-19', { lectures: [l], sections: [s], sessions: one }).today)).toEqual([`study2:${s.id}:17/5q`]);
    const two = [...one, studied(s, '2026-11-19', 2)];
    expect(plan('2026-11-22', { lectures: [l], sections: [s], sessions: two }).today).toEqual([]);
    expect(summary(plan('2026-11-23', { lectures: [l], sections: [s], sessions: two }).today)).toEqual([`study3:${s.id}:16/5q`]);
  });

  it('a late session pushes the next one by its spacing', () => {
    const late = [studied(s, '2026-11-17', 1), studied(s, '2026-11-21', 2)]; // day 3's on day 5
    expect(plan('2026-11-23', { lectures: [l], sections: [s], sessions: late }).today).toEqual([]); // not day 7...
    const p = plan('2026-11-25', { lectures: [l], sections: [s], sessions: late }); // ...but 4 days after day 5
    expect(summary(p.today)).toEqual([`study3:${s.id}:16/5q`]);
    expect(p.today[0]!.due).toBe('2026-11-25');
  });

  it('a lecture entered late is still studied from step 1, shown as overdue', () => {
    const old = lecture('2026-11-01');
    const os = section(old);
    const p = plan('2026-11-18', { lectures: [old], sections: [os] });
    expect(summary(p.today)).toEqual([`study1:${os.id}:17/5q`]);
    expect(p.today[0]!.overdueDays).toBe(16);
  });

  it('a study session after midnight counts for the day before (the day starts at 4 a.m.)', () => {
    const night = [studied(s, '2026-11-18', 1, 15, 2)]; // 2 a.m. on the 18th = still the 17th
    expect(summary(plan('2026-11-19', { lectures: [l], sections: [s], sessions: night }).today)).toEqual([`study2:${s.id}:17/5q`]);
  });
});

describe('after the first week: quizzes by score', () => {
  const l = lecture('2026-11-01');
  const s = section(l);
  const week = [studied(s, '2026-11-02', 1), studied(s, '2026-11-04', 2), studied(s, '2026-11-08', 3)];
  const weekQuizzes = [quizzed(s, '2026-11-08', 0.9)]; // the last session's own quiz doesn't move the schedule
  const parts = (attempts: QuizAttempt[] = [], sessions: StudySession[] = []) => ({
    lectures: [l],
    sections: [s],
    sessions: [...week, ...sessions],
    attempts: [...weekQuizzes, ...attempts],
  });

  it('the first quiz is 7 days after the first week, 5 questions', () => {
    expect(plan('2026-11-14', parts()).today).toEqual([]);
    expect(summary(plan('2026-11-15', parts()).today)).toEqual([`quiz:${s.id}:4/5q`]);
    expect(plan('2026-11-20', parts()).today[0]!.overdueDays).toBe(5); // missed days roll forward
  });

  it('a bigger section gets bigger first-week quizzes, and so does its first quiz after (no score yet)', () => {
    const big = { ...section(l), firstPage: 1, lastPage: 30 };
    expect(summary(plan('2026-11-02', { lectures: [l], sections: [big] }).today)).toEqual([`study1:${big.id}:17/15q`]);
    const done = [studied(big, '2026-11-02', 1), studied(big, '2026-11-04', 2), studied(big, '2026-11-08', 3)];
    expect(summary(plan('2026-11-15', { lectures: [l], sections: [big], sessions: done }).today)).toEqual([`quiz:${big.id}:10/15q`]);
    const after = [quizzed(big, '2026-11-15', 1)]; // then the score table takes over
    expect(summary(plan('2026-12-03', { lectures: [l], sections: [big], sessions: done, attempts: after }).today)).toEqual([`quiz:${big.id}:2/3q`]);
  });

  it('90% or more: 2.5x the gap, 3 questions; 70-89%: 1.5x, 5 questions', () => {
    const great = parts([quizzed(s, '2026-11-15', 1)]); // gap 7 → 18 days: Dec 3
    expect(plan('2026-12-02', great).today).toEqual([]);
    expect(summary(plan('2026-12-03', great).today)).toEqual([`quiz:${s.id}:2/3q`]);
    const good = parts([quizzed(s, '2026-11-15', 0.8), quizzed(s, '2026-11-26', 0.8)]); // 7 → 11 → 17: Dec 13
    expect(plan('2026-12-12', good).today).toEqual([]);
    expect(summary(plan('2026-12-13', good).today)).toEqual([`quiz:${s.id}:4/5q`]);
  });

  it('50-69%: again in 2 days, 8 questions, and 10 minutes of extra study first', () => {
    const p = parts([quizzed(s, '2026-11-15', 0.6)]);
    expect(summary(plan('2026-11-16', p).today)).toEqual([`extra:${s.id}:10`]);
    expect(summary(plan('2026-11-17', p).today)).toEqual([`extra:${s.id}:10`, `quiz:${s.id}:6/8q`]);
    const studiedExtra = parts([quizzed(s, '2026-11-15', 0.6)], [studied(s, '2026-11-16', null, 10)]);
    expect(summary(plan('2026-11-17', studiedExtra).today)).toEqual([`quiz:${s.id}:6/8q`]);
  });

  it('under 50%: tomorrow, 10 questions, 20 minutes extra, until the score recovers', () => {
    const p = parts([quizzed(s, '2026-11-15', 0.3)]);
    expect(summary(plan('2026-11-16', p).today)).toEqual([`extra:${s.id}:20`, `quiz:${s.id}:7/10q`]);
    const again = parts([quizzed(s, '2026-11-15', 0.3), quizzed(s, '2026-11-16', 0.4)], [studied(s, '2026-11-16', null, 20, 10)]);
    expect(summary(plan('2026-11-17', again).today)).toEqual([`extra:${s.id}:20`, `quiz:${s.id}:7/10q`]); // still weak: again
    const recovered = parts([quizzed(s, '2026-11-15', 0.3), quizzed(s, '2026-11-16', 0.9)], [studied(s, '2026-11-16', null, 20, 10)]);
    expect(plan('2026-11-17', recovered).today).toEqual([]); // 0.9 after a 1-day gap: at least 3 days
    expect(summary(plan('2026-11-19', recovered).today)).toEqual([`quiz:${s.id}:2/3q`]);
  });

  it('a low score in the first week asks for extra study the next day too', () => {
    const l2 = lecture('2026-11-16');
    const s2 = section(l2);
    const p = { lectures: [l2], sections: [s2], sessions: [studied(s2, '2026-11-17', 1)], attempts: [quizzed(s2, '2026-11-17', 0.4)] };
    expect(summary(plan('2026-11-18', p).today)).toEqual([`extra:${s2.id}:20`]);
  });
});

describe('fitting the day', () => {
  // A weak section (last score 40%), a new lecture's day 1, and an ordinary quiz 3 days overdue
  const lw = lecture('2026-11-01');
  const weak = section(lw);
  const ln = lecture('2026-11-17', 60);
  const fresh = section(ln);
  const lo = lecture('2026-10-01');
  const ok = section(lo);
  const history = {
    lectures: [lw, ln, lo],
    sections: [ok, fresh, weak],
    sessions: [
      studied(weak, '2026-11-02', 1),
      studied(weak, '2026-11-04', 2),
      studied(weak, '2026-11-08', 3),
      studied(ok, '2026-10-02', 1),
      studied(ok, '2026-10-04', 2),
      studied(ok, '2026-10-08', 3),
    ],
    attempts: [quizzed(weak, '2026-11-17', 0.4), quizzed(ok, '2026-10-15', 0.8), quizzed(ok, '2026-10-26', 0.8)],
  }; // ok: 7 → 11 → 17 days after Oct 26 = Nov 12, so 6 days overdue on the 18th

  it('weakest first, then new lectures, then the most overdue', () => {
    const p = plan('2026-11-18', history, 120);
    expect(summary(p.today)).toEqual([`extra:${weak.id}:20`, `quiz:${weak.id}:7/10q`, `study1:${fresh.id}:20/5q`, `quiz:${ok.id}:4/5q`]);
    expect(p.plannedMinutes).toBe(51);
    expect(p.later).toEqual([]);
  });

  it('never more than the daily minutes: what doesn’t fit rolls on', () => {
    const p = plan('2026-11-18', history, 30);
    expect(summary(p.today)).toEqual([`extra:${weak.id}:20`, `quiz:${weak.id}:7/10q`]);
    expect(summary(p.later)).toEqual([`study1:${fresh.id}:20/5q`, `quiz:${ok.id}:4/5q`]);
    expect(p.overBudget).toBe(false);
  });

  it('what’s already done today uses up the minutes', () => {
    const p = plan('2026-11-18', { ...history, sessions: [...history.sessions, studied(ok, '2026-11-18', null, 25, 9)] }, 30);
    expect(p.doneMinutes).toBe(25);
    expect(p.today.map((i) => i.minutes)).toEqual([4]); // only the 4-minute quiz fits in the 5 left
  });

  it('one item bigger than the whole day is still planned, and says so', () => {
    const big = lecture('2026-11-17', 300);
    const bs = section(big);
    const p = plan('2026-11-18', { lectures: [big], sections: [bs] }, 60);
    expect(summary(p.today)).toEqual([`study1:${bs.id}:100/5q`]);
    expect(p.overBudget).toBe(true);
  });

  it('sections whose lecture is gone are left out', () => {
    expect(plan('2026-11-18', { lectures: [], sections: [weak] }).today).toEqual([]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
