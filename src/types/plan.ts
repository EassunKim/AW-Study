// The shared contract for planning (#47, docs/DESIGN.md "Planning the day"): the study sessions done,
// and the study settings. The planner (src/plan/) works out each day's checklist from these, the
// lectures and the quiz attempts (src/types/quiz.ts); nothing it works out is stored. Change these
// only in their own small PR, announced in the task issues.
//
// Plain JSON. Times are ISO 8601 strings in UTC. Ids are crypto.randomUUID() strings.

/**
 * What a study session was for: one of a new section's three first-week sessions (days 1, 3 and 7
 * after the lecture), or extra study the planner asked for after a low quiz score.
 */
export type StudyKind = 'first-week' | 'extra';

/** Time spent on a section's slides. Only ever added: the history the plan is worked out from. */
export interface StudySession {
  id: string;
  courseId: string;
  sectionId: string;
  kind: StudyKind;
  step: 1 | 2 | 3 | null; // which first-week session; null for extra study
  startedAt: string;
  finishedAt: string;
  minutes: number; // spent on the slides, 0-600, whole minutes
  createdAt: string;
}

export type StudySessionInput = Pick<StudySession, 'sectionId' | 'kind' | 'step' | 'startedAt' | 'finishedAt' | 'minutes'>;

export interface StudySettings {
  dailyMinutes: number; // the time the planner fills each day, 10-600; 60 to start with
  /**
   * Course ids in the order the user dragged them into on the Tasks page (#72; docs/design/README.md).
   * Classes not in it come after, in the planner's order; ids of deleted classes are ignored. At most
   * 200, no repeats. Settings saved before #72 read as [].
   */
  classOrder: string[];
}

export const DEFAULT_STUDY_SETTINGS: StudySettings = { dailyMinutes: 60, classOrder: [] };

/**
 * The store methods for planning. Part of StudyStore (src/db/store.ts), with its rules: 'locked'
 * while locked, 'invalid' (with a user-ready message) or 'not-found' as appropriate. Deleting a
 * lecture or a class deletes its sections' study sessions too.
 */
export interface PlanStore {
  /** Saves a study session. 'invalid' for a first-week session without its step (1-3), or extra with one. */
  recordStudySession(input: StudySessionInput): Promise<StudySession>;
  /** Sessions, newest first: one section's, or every section's (what the planner reads). */
  listStudySessions(sectionId?: string): Promise<StudySession[]>;
  /** The settings, or DEFAULT_STUDY_SETTINGS before they're first saved. */
  getStudySettings(): Promise<StudySettings>;
  /** Saves the settings given, keeping the others as they were (e.g. { dailyMinutes } leaves the order). */
  saveStudySettings(settings: Partial<StudySettings>): Promise<StudySettings>;
}
