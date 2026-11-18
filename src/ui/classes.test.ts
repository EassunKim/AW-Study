import { describe, expect, it } from 'vitest';
import type { LectureWithSections, Meeting, SlideDeck } from '../types/lecture';
import {
  addDays,
  carryOn,
  describeMeetings,
  expandGroups,
  formatDate,
  formatTime,
  groupMeetings,
  latestLecture,
  localNow,
  orderSections,
  relativeDay,
  slidesLabel,
  titleFromFileName,
} from './classes';

const TZ = 'America/Los_Angeles';
const mwf: Meeting[] = [
  { day: 5, start: '10:30', minutes: 50 },
  { day: 1, start: '10:30', minutes: 50 },
  { day: 3, start: '10:30', minutes: 50 },
];

describe('lecture times', () => {
  it('group by start and length, Monday first, and expand back', () => {
    const meetings: Meeting[] = [...mwf, { day: 2, start: '14:00', minutes: 80 }, { day: 0, start: '09:00', minutes: 50 }];
    const groups = groupMeetings(meetings);
    expect(groups).toEqual([
      { days: [1, 3, 5], start: '10:30', minutes: 50 },
      { days: [2], start: '14:00', minutes: 80 },
      { days: [0], start: '09:00', minutes: 50 },
    ]);
    expect(expandGroups(groups)).toHaveLength(5);
    expect(groupMeetings(expandGroups(groups))).toEqual(groups);
  });

  it('a day at the same start given twice counts once', () => {
    expect(expandGroups([{ days: [1, 1], start: '10:30', minutes: 50 }, { days: [1], start: '10:30', minutes: 80 }])).toEqual([
      { day: 1, start: '10:30', minutes: 50 },
    ]);
  });

  it('are described the way people say them', () => {
    expect(describeMeetings(mwf)).toBe('Mon, Wed, Fri 10:30 am, 50 min');
    expect(describeMeetings([...mwf, { day: 2, start: '14:05', minutes: 80 }])).toBe('Mon, Wed, Fri 10:30 am, 50 min · Tue 2:05 pm, 80 min');
    expect(describeMeetings([])).toBe('No set lecture times');
    expect([formatTime('00:15'), formatTime('12:00'), formatTime('23:59')]).toEqual(['12:15 am', '12:00 pm', '11:59 pm']);
  });
});

describe('latestLecture', () => {
  // Wed Nov 18 2026, in Los Angeles (UTC−8 in November)
  const at = (local: string) => new Date(`${local}-08:00`);

  it('is today’s once it has started, else the one before', () => {
    expect(latestLecture(mwf, at('2026-11-18T10:29'), TZ)).toEqual({ date: '2026-11-16', minutes: 50 });
    expect(latestLecture(mwf, at('2026-11-18T10:30'), TZ)).toEqual({ date: '2026-11-18', minutes: 50 });
    expect(latestLecture(mwf, at('2026-11-18T23:00'), TZ)).toEqual({ date: '2026-11-18', minutes: 50 });
  });

  it('looks back over the weekend and across months', () => {
    expect(latestLecture(mwf, at('2026-11-23T08:00'), TZ)).toEqual({ date: '2026-11-20', minutes: 50 }); // Monday morning → Friday
    expect(latestLecture([{ day: 4, start: '09:00', minutes: 80 }], at('2026-12-02T12:00'), TZ)).toEqual({ date: '2026-11-26', minutes: 80 });
    expect(latestLecture([{ day: 3, start: '18:00', minutes: 120 }], at('2026-11-18T17:00'), TZ)).toEqual({ date: '2026-11-11', minutes: 120 });
  });

  it('takes the later of two the same day, and none without set times', () => {
    const twice: Meeting[] = [
      { day: 3, start: '09:00', minutes: 50 },
      { day: 3, start: '13:00', minutes: 80 },
    ];
    expect(latestLecture(twice, at('2026-11-18T14:00'), TZ)).toEqual({ date: '2026-11-18', minutes: 80 });
    expect(latestLecture(twice, at('2026-11-18T10:00'), TZ)).toEqual({ date: '2026-11-18', minutes: 50 });
    expect(latestLecture([], at('2026-11-18T10:00'), TZ)).toBeNull();
  });

  it('uses the given time zone’s clock, not UTC’s', () => {
    // 01:00 UTC Thursday is still Wednesday 17:00 in Los Angeles
    expect(localNow(new Date('2026-11-19T01:00:00Z'), TZ)).toEqual({ date: '2026-11-18', day: 3, time: '17:00' });
  });
});

describe('labels', () => {
  it('dates, relative days and slide ranges', () => {
    expect(formatDate('2026-11-18')).toBe('Wed, Nov 18');
    expect(formatDate('2027-01-04', '2026')).toBe('Mon, Jan 4, 2027');
    expect(formatDate('2026-01-04', '2026')).toBe('Sun, Jan 4');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(['2026-11-18', '2026-11-19', '2026-11-17', '2026-11-30', '2026-11-15'].map((d) => relativeDay('2026-11-18', d))).toEqual([
      'today',
      'tomorrow',
      'yesterday',
      'in 12 days',
      '3 days ago',
    ]);
    expect(slidesLabel(4, 4)).toBe('slide 4');
    expect(slidesLabel(21, 30)).toBe('slides 21–30');
    expect(titleFromFileName('Week 4.PDF')).toBe('Week 4');
    expect(titleFromFileName('.pdf')).toBe('Slides');
  });
});

describe('carryOn', () => {
  const deck = (id: string, pageCount: number, createdAt: string): SlideDeck => ({
    id,
    courseId: 'c',
    title: id,
    fileName: `${id}.pdf`,
    pageCount,
    byteSize: 1,
    createdAt,
    updatedAt: createdAt,
  });
  const lecture = (date: string, ranges: [string, number, number][]): LectureWithSections => ({
    lecture: { id: date, courseId: 'c', date, minutes: 50, createdAt: date, updatedAt: date },
    sections: ranges.map(([deckId, firstPage, lastPage], i) => ({
      id: `${date}-${i}`,
      courseId: 'c',
      lectureId: date,
      deckId,
      firstPage,
      lastPage,
      schedule: { budgetMinutes: 25, studiedMinutes: 0, nextDue: null, extraMinutes: 0 },
      createdAt: date,
      updatedAt: date,
    })),
  });
  const w3 = deck('w3', 40, '2026-11-01');
  const w4 = deck('w4', 30, '2026-11-10');

  it('picks up after the furthest slide of the newest deck the latest lecture used', () => {
    const latest = lecture('2026-11-18', [
      ['w4', 1, 10],
      ['w3', 35, 40],
      ['w4', 11, 20],
    ]);
    expect(carryOn([latest, lecture('2026-11-16', [['w3', 1, 34]])], [w3, w4])).toEqual({ deck: w4, next: 21 });
  });

  it('orders a lecture’s sections older deck first, then by first slide', () => {
    const { sections } = lecture('2026-11-18', [
      ['w4', 11, 20],
      ['w3', 35, 40],
      ['w4', 1, 10],
    ]);
    expect(orderSections(sections, [w4, w3]).map((s) => `${s.deckId} ${s.firstPage}`)).toEqual(['w3 35', 'w4 1', 'w4 11']);
  });

  it('suggests nothing at the end of a deck, before any lecture, or for a deleted deck', () => {
    expect(carryOn([lecture('2026-11-18', [['w4', 21, 30]])], [w3, w4])).toBeNull();
    expect(carryOn([], [w3, w4])).toBeNull();
    expect(carryOn([lecture('2026-11-18', [['gone', 1, 3]])], [w3, w4])).toBeNull();
  });
});
