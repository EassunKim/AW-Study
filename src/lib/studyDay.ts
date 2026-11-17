// Which study day a moment belongs to. A study day starts at `dayStartHour` local time (4 a.m. by
// default), so reviews done at 1 a.m. still count for the evening before: streaks, the daily ring
// and "due today" all use this, never the calendar date.
//
// It works on the wall clock of `timeZone` (an IANA name such as "America/New_York"), not by
// subtracting hours from UTC: on the nights clocks change, those two answers differ by an hour.

export const DEFAULT_DAY_START_HOUR = 4;

/** The study day `at` falls in, as "YYYY-MM-DD", for someone in `timeZone`. */
export function studyDay(at: Date, timeZone: string, dayStartHour: number = DEFAULT_DAY_START_HOUR): string {
  if (!Number.isInteger(dayStartHour) || dayStartHour < 0 || dayStartHour > 23) {
    throw new RangeError(`dayStartHour must be a whole hour from 0 to 23, got ${dayStartHour}`);
  }
  if (Number.isNaN(at.getTime())) throw new RangeError('studyDay was given an invalid date');

  const { year, month, day, hour } = wallClock(at, timeZone);
  // Before the day starts, it's still the previous study day. Date.UTC handles month and year ends.
  const date = new Date(Date.UTC(year, month - 1, hour < dayStartHour ? day - 1 : day));
  return date.toISOString().slice(0, 10);
}

/** The time zone this device is set to, e.g. "America/Vancouver". */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function wallClock(at: Date, timeZone: string) {
  // Throws a RangeError for a time zone name it doesn't know
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}
