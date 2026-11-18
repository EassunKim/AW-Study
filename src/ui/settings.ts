// Study settings. Fixed for milestone 2; milestone 4 replaces newPerDay with the daily time
// budget, and the user will be able to change the day start.
import { deviceTimeZone } from '../lib/studyDay';

export const DAY_START_HOUR = 4;
export const NEW_PER_DAY = 20;

export function queueOptions(deckId: string, now: Date) {
  return { deckId, now, timeZone: deviceTimeZone(), dayStartHour: DAY_START_HOUR, newPerDay: NEW_PER_DAY };
}
