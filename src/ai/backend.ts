// AI in the app: every AI job goes through `AiBackend` (CLAUDE.md, "AI"). The real one,
// HttpAiBackend, calls our AI helper at /ai/ on this same site (helper/, #27), behind Cloudflare
// Access. Tests and development use FakeAiBackend (./fake.ts), so nothing is spent or sent.
//
// What leaves the device: only each job's inputs below (slide text, a selection, a question, an
// answer), and only to /ai/ on our own site (CLAUDE.md, "Privacy and security").

/** One slide's text, with its number in the deck (from 1). */
export interface SlideText {
  page: number;
  text: string;
}

/** A multiple-choice question, as made by the AI and checked on the device. */
export interface McQuestion {
  question: string;
  options: [string, string, string, string];
  answer: 0 | 1 | 2 | 3; // index of the right option
  page: number; // the slide it comes from
  explanation: string;
}

/** The models the helper lets a request choose (helper/app.mjs MODELS), to compare them. */
export const AI_MODELS = [
  { id: 'claude-haiku-5-5', name: 'Haiku' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet' },
  { id: 'claude-opus-5-5', name: 'Opus' },
] as const;
export type AiModel = (typeof AI_MODELS)[number]['id'];

export interface MakeQuestionsRequest {
  pages: SlideText[];
  count: number;
  /** Questions already in the bank, so new ones don't repeat them. */
  avoid?: string[];
  /** A model to use instead of the helper's own (comparing models). */
  model?: AiModel;
}

/** Short-answer questions for exam practice (#87): the slides to ask about and how many. */
export interface WrittenRequest {
  pages: SlideText[];
  count: number; // 1-10
}

/** A short-answer question as the AI writes it: graded later (gradeAnswer) against its points. */
export interface WrittenQuestion {
  question: string;
  points: string[]; // 1-6, what a full answer says
  page: number; // one of the slides sent
}

export interface GradeRequest {
  question: string;
  /** What a full answer says, one point each. */
  points: string[];
  answer: string;
  slides: SlideText[];
}

export interface Grade {
  mark: number; // points the answer got, 0 to outOf
  outOf: number;
  feedback: string;
}

export interface ExplainRequest {
  selection: string;
  slides: SlideText[]; // the slide and its neighbours
}

export interface AskRequest {
  question: string;
  selection?: string;
  slides: SlideText[];
}

/** Who the helper sees you as and today's use (its GET /ai/whoami), for Settings. Uses no AI. */
export interface AiStatus {
  email: string;
  usedToday: number;
  dailyLimit: number;
}

export interface AiBackend {
  /** Whether you're signed in for AI; fails like the jobs do ('signed-out', 'not-allowed', 'offline'...). */
  status(signal?: AbortSignal): Promise<AiStatus>;
  makeQuestions(request: MakeQuestionsRequest, signal?: AbortSignal): Promise<McQuestion[]>;
  /** Short-answer questions for exam practice (#87), checked on the device like the others. */
  makeWrittenQuestions(request: WrittenRequest, signal?: AbortSignal): Promise<WrittenQuestion[]>;
  gradeAnswer(request: GradeRequest, signal?: AbortSignal): Promise<Grade>;
  explain(request: ExplainRequest, signal?: AbortSignal): Promise<string>;
  ask(request: AskRequest, signal?: AbortSignal): Promise<string>;
}

export type AiErrorCode =
  | 'signed-out' // the Cloudflare Access sign-in has lapsed: open signInUrl() and try again
  | 'not-allowed' // signed in, but this account isn't set up for AI
  | 'limit' // today's limit reached, or another request still running
  | 'invalid' // the request was refused as badly formed or too large (a bug, or too much text)
  | 'unavailable' // the helper or the AI failed, or gave an unusable answer
  | 'offline' // no connection
  | 'cancelled';

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
