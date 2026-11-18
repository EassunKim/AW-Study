// The quiz side of StudyStore (#40): each section's question bank, and the quizzes taken on it. Built
// on the store's own helpers like lectures.ts, so the same rules hold: sealed per docs/SECURITY.md
// once set up, refused while locked, writes inside `exclusive()`, every write in the change log.
// Attempts are only ever added: deleting a lecture or class (lectures.ts) is the only way they go.
import type { Section } from '../types/lecture';
import type { OptionIndex, Question, QuestionInput, QuizAttempt, QuizStore } from '../types/quiz';
import { writeRows, type StoreContext } from './lectures';
import { StoreError } from './store';

export const QUESTION_MAX = 1_000;
export const OPTION_MAX = 500;
export const EXPLANATION_MAX = 2_000;
export const QUESTIONS_PER_CALL = 100;
export const QUESTIONS_PER_SECTION = 500;
const ANSWERS_MAX = 500;
const DAY_MS = 86_400_000;

const invalid = (message: string) => new StoreError('invalid', message);

/** How two questions are compared for repeats: case, spacing and end punctuation don't count. */
export function questionKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[\s?.!:]+$/, '').trim();
}

const isOption = (v: unknown): v is OptionIndex => v === 0 || v === 1 || v === 2 || v === 3;
const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));

function text(value: unknown, max: number, what: string, { empty = false } = {}): string {
  if (typeof value !== 'string') throw invalid(`${what} is missing.`);
  const clean = value.trim();
  if (!clean && !empty) throw invalid(`${what} can’t be empty.`);
  if (clean.length > max) throw invalid(`${what} can be at most ${max.toLocaleString('en')} characters.`);
  return clean;
}

/** A question from the AI, checked and cleaned for this section (throws 'invalid' with a reason). */
function checkQuestion(q: QuestionInput, section: Section, n: number): QuestionInput {
  const which = `Question ${n}`;
  if (typeof q !== 'object' || q === null) throw invalid(`${which} is missing.`);
  if (!Number.isInteger(q.page) || q.page < section.firstPage || q.page > section.lastPage) {
    throw invalid(`${which} names slide ${String(q.page)}, outside slides ${section.firstPage}–${section.lastPage}.`);
  }
  const question = text(q.question, QUESTION_MAX, `${which}’s text`);
  if (!Array.isArray(q.options) || q.options.length !== 4) throw invalid(`${which} needs exactly four options.`);
  const options = q.options.map((o, i) => text(o, OPTION_MAX, `${which}’s option ${i + 1}`)) as Question['options'];
  if (new Set(options.map((o) => o.toLowerCase())).size !== 4) throw invalid(`${which}’s four options must all be different.`);
  if (!isOption(q.answer)) throw invalid(`${which}’s answer must be one of its four options.`);
  const explanation = text(q.explanation ?? '', EXPLANATION_MAX, `${which}’s explanation`, { empty: true });
  return { page: q.page, question, options, answer: q.answer, explanation };
}

export function quizMethods(ctx: StoreContext): QuizStore {
  const { db, open, openAll, seal, change, exclusive, requireOpen } = ctx;
  const iso = () => ctx.clock().toISOString();

  const getSection = async (id: string): Promise<Section> => {
    const row = await db.get('sections', id);
    if (!row) throw new StoreError('not-found', 'That part of the lecture no longer exists.');
    return open<Section>('sections', row);
  };

  const bank = async (sectionId: string) => openAll<Question>('questions', await db.getAllFromIndex('questions', 'bySection', sectionId));
  const oldestFirst = (a: Question, b: Question) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

  return {
    async listQuestions(sectionId) {
      requireOpen();
      return (await bank(sectionId)).sort(oldestFirst);
    },

    addQuestions: (sectionId, inputs) =>
      exclusive(async () => {
        requireOpen();
        const section = await getSection(sectionId);
        if (!Array.isArray(inputs) || inputs.length === 0) throw invalid('No questions to add.');
        if (inputs.length > QUESTIONS_PER_CALL) throw invalid(`At most ${QUESTIONS_PER_CALL} questions at a time.`);
        const existing = await bank(sectionId);
        if (existing.length + inputs.length > QUESTIONS_PER_SECTION) {
          throw invalid(`A section’s bank holds at most ${QUESTIONS_PER_SECTION} questions.`);
        }
        const seen = new Set(existing.map((q) => questionKey(q.question)));
        // A millisecond apart, so a batch lists in the order it was made (oldest first)
        const start = ctx.clock().getTime();
        const made: Question[] = inputs.map((input, i) => {
          const q = checkQuestion(input, section, i + 1);
          const key = questionKey(q.question);
          if (seen.has(key)) throw invalid(`Question ${i + 1} is already in this section’s bank.`);
          seen.add(key);
          const createdAt = new Date(start + i).toISOString();
          return { id: ctx.newId(), courseId: section.courseId, sectionId, deckId: section.deckId, ...q, createdAt };
        });
        const [rows, logs] = await Promise.all([
          Promise.all(made.map((q) => seal('questions', { ...q }))),
          Promise.all(made.map((q) => change('question', 'put', q.id, q))),
        ]);
        await writeRows(db, rows.map((row) => ({ store: 'questions' as const, row })), [], logs);
        return made;
      }),

    deleteQuestion: (id) =>
      exclusive(async () => {
        requireOpen();
        if (!(await db.get('questions', id))) throw new StoreError('not-found', 'That question is already gone.');
        await writeRows(db, [], [{ store: 'questions', id }], [await change('question', 'delete', id, null)]);
      }),

    recordQuizAttempt: (input) =>
      exclusive(async () => {
        requireOpen();
        const section = await getSection(input?.sectionId);
        if (!isIso(input.startedAt) || !isIso(input.finishedAt) || input.finishedAt < input.startedAt) {
          throw invalid('The quiz’s start and end times aren’t valid.');
        }
        if (!Array.isArray(input.answers) || input.answers.length === 0) throw invalid('A quiz needs at least one answer.');
        if (input.answers.length > ANSWERS_MAX) throw invalid(`A quiz can have at most ${ANSWERS_MAX} answers.`);
        const questions = new Map((await bank(section.id)).map((q) => [q.id, q]));
        const asked = new Set<string>();
        const answers = input.answers.map((a, i) => {
          const q = questions.get(a?.questionId);
          if (!q) throw invalid(`Answer ${i + 1} is to a question that isn’t in this section’s bank.`);
          if (asked.has(q.id)) throw invalid('A question can only be answered once in a quiz.');
          asked.add(q.id);
          if (!isOption(a.chosen)) throw invalid(`Answer ${i + 1} must be one of the four options.`);
          const ms = Number.isFinite(a.ms) && a.ms >= 0 ? Math.min(Math.round(a.ms), DAY_MS) : 0;
          // The store marks it: the score comes from the stored answer, never from the screen
          return { questionId: q.id, chosen: a.chosen, right: a.chosen === q.answer, ms };
        });
        const right = answers.filter((a) => a.right).length;
        const attempt: QuizAttempt = {
          id: ctx.newId(),
          courseId: section.courseId,
          sectionId: section.id,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
          answers,
          right,
          asked: answers.length,
          score: right / answers.length,
          createdAt: iso(),
        };
        const [row, log] = await Promise.all([seal('quizAttempts', { ...attempt }), change('quizAttempt', 'put', attempt.id, attempt)]);
        await writeRows(db, [{ store: 'quizAttempts', row }], [], [log]);
        return attempt;
      }),

    async listQuizAttempts(sectionId) {
      requireOpen();
      const rows = sectionId ? await db.getAllFromIndex('quizAttempts', 'bySection', sectionId) : await db.getAll('quizAttempts');
      return (await openAll<QuizAttempt>('quizAttempts', rows)).sort(
        (a, b) => b.finishedAt.localeCompare(a.finishedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      );
    },
  };
}
