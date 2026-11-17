import { describe, expect, it } from 'vitest';
import { studyDay } from './studyDay';

const at = (iso: string) => new Date(iso);

describe('studyDay', () => {
  it('counts the hours before 4 a.m. as the previous day', () => {
    expect(studyDay(at('2026-11-17T03:59:00Z'), 'UTC')).toBe('2026-11-16');
    expect(studyDay(at('2026-11-17T04:00:00Z'), 'UTC')).toBe('2026-11-17');
  });

  it('uses the local clock of the given time zone', () => {
    // 18:59 UTC is 03:59 the next morning in Tokyo (UTC+9)
    expect(studyDay(at('2026-11-16T18:59:00Z'), 'Asia/Tokyo')).toBe('2026-11-16');
    expect(studyDay(at('2026-11-16T19:00:00Z'), 'Asia/Tokyo')).toBe('2026-11-17');
  });

  it('follows the wall clock on the night clocks spring forward', () => {
    // New York, Mar 8 2026: 2:00 EST jumps to 3:00 EDT. 07:30 UTC is 3:30 EDT, still the night
    // before; 08:00 UTC is 4:00 EDT, the new day. Subtracting 4 hours from UTC would get the
    // second one wrong (it lands on 23:00 EST the day before).
    expect(studyDay(at('2026-03-08T07:30:00Z'), 'America/New_York')).toBe('2026-03-07');
    expect(studyDay(at('2026-03-08T08:00:00Z'), 'America/New_York')).toBe('2026-03-08');
  });

  it('crosses month and year ends', () => {
    expect(studyDay(at('2027-01-01T02:00:00Z'), 'UTC')).toBe('2026-12-31');
    expect(studyDay(at('2026-03-01T01:00:00Z'), 'UTC')).toBe('2026-02-28');
  });

  it('uses the calendar date when the day starts at midnight', () => {
    expect(studyDay(at('2026-11-17T00:30:00Z'), 'UTC', 0)).toBe('2026-11-17');
  });

  it('rejects a start hour that is not a whole hour of the day', () => {
    expect(() => studyDay(at('2026-11-17T12:00:00Z'), 'UTC', 24)).toThrow(RangeError);
    expect(() => studyDay(at('2026-11-17T12:00:00Z'), 'UTC', 3.5)).toThrow(RangeError);
  });

  it('rejects an invalid date or time zone', () => {
    expect(() => studyDay(new Date('not a date'), 'UTC')).toThrow(RangeError);
    expect(() => studyDay(at('2026-11-17T12:00:00Z'), 'Not/A_Zone')).toThrow(RangeError);
  });
});
