// The planning side of StudyStore (#47): study sessions done, and the study settings. Built on the
// store's own helpers like lectures.ts and quiz.ts. The plan itself is worked out from these (and
// the lectures and quiz attempts) by src/plan/, and never stored.
import { DEFAULT_STUDY_SETTINGS, type PlanStore, type StudySession, type StudySettings } from '../types/plan';
import type { Section } from '../types/lecture';
import { writeRows, type StoreContext } from './lectures';
import { StoreError } from './store';

export const DAILY_MINUTES_MIN = 10;
export const DAILY_MINUTES_MAX = 600;
export const CLASS_ORDER_MAX = 200;
const SETTINGS_ID = 'study';

/** Saved settings as the app uses them: anything missing (classOrder before #72) takes its default. */
export function readSettings(saved: Partial<StudySettings>): StudySettings {
  return {
    dailyMinutes: saved.dailyMinutes ?? DEFAULT_STUDY_SETTINGS.dailyMinutes,
    classOrder: Array.isArray(saved.classOrder) ? saved.classOrder.filter((id): id is string => typeof id === 'string') : [],
  };
}

const invalid = (message: string) => new StoreError('invalid', message);
const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));

export function planMethods(ctx: StoreContext): PlanStore {
  const { db, open, openAll, seal, change, exclusive, requireOpen } = ctx;

  return {
    recordStudySession: (input) =>
      exclusive(async () => {
        requireOpen();
        const row = await db.get('sections', input?.sectionId);
        if (!row) throw new StoreError('not-found', 'That part of the lecture no longer exists.');
        const section = await open<Section>('sections', row);
        if (input.kind === 'first-week') {
          if (input.step !== 1 && input.step !== 2 && input.step !== 3) throw invalid('A first-week session is step 1, 2 or 3.');
        } else if (input.kind === 'extra') {
          if (input.step !== null) throw invalid('Extra study has no step.');
        } else throw invalid('Unknown kind of study session.');
        if (!isIso(input.startedAt) || !isIso(input.finishedAt) || input.finishedAt < input.startedAt) {
          throw invalid('The session’s start and end times aren’t valid.');
        }
        if (!Number.isInteger(input.minutes) || input.minutes < 0 || input.minutes > 600) throw invalid('A session lasts 0 to 600 whole minutes.');
        const session: StudySession = {
          id: ctx.newId(),
          courseId: section.courseId,
          sectionId: section.id,
          kind: input.kind,
          step: input.step,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
          minutes: input.minutes,
          createdAt: ctx.clock().toISOString(),
        };
        const [sealed, log] = await Promise.all([seal('studySessions', { ...session }), change('studySession', 'put', session.id, session)]);
        await writeRows(db, [{ store: 'studySessions', row: sealed }], [], [log]);
        return session;
      }),

    async listStudySessions(sectionId) {
      requireOpen();
      const rows = sectionId ? await db.getAllFromIndex('studySessions', 'bySection', sectionId) : await db.getAll('studySessions');
      return (await openAll<StudySession>('studySessions', rows)).sort(
        (a, b) => b.finishedAt.localeCompare(a.finishedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      );
    },

    async getStudySettings() {
      requireOpen();
      const row = await db.get('settings', SETTINGS_ID);
      if (!row) return { ...DEFAULT_STUDY_SETTINGS };
      return readSettings(await open<Partial<StudySettings> & { id: string }>('settings', row));
    },

    saveStudySettings: (settings) =>
      exclusive(async () => {
        requireOpen();
        const row = await db.get('settings', SETTINGS_ID);
        const now = row ? readSettings(await open<Partial<StudySettings> & { id: string }>('settings', row)) : { ...DEFAULT_STUDY_SETTINGS };
        const minutes = settings?.dailyMinutes ?? now.dailyMinutes;
        if (!Number.isInteger(minutes) || minutes < DAILY_MINUTES_MIN || minutes > DAILY_MINUTES_MAX) {
          throw invalid(`Daily study time is ${DAILY_MINUTES_MIN} to ${DAILY_MINUTES_MAX} whole minutes.`);
        }
        const order = settings?.classOrder ?? now.classOrder;
        if (
          !Array.isArray(order) ||
          order.length > CLASS_ORDER_MAX ||
          order.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 100) ||
          new Set(order).size !== order.length
        ) {
          throw invalid('The class order is a list of up to ' + CLASS_ORDER_MAX + ' different classes.');
        }
        const saved: StudySettings = { dailyMinutes: minutes, classOrder: [...order] };
        const record = { id: SETTINGS_ID, ...saved };
        const [sealed, log] = await Promise.all([seal('settings', { ...record }), change('settings', 'put', SETTINGS_ID, record)]);
        await writeRows(db, [{ store: 'settings', row: sealed }], [], [log]);
        return saved;
      }),
  };
}
