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

export interface MakeQuestionsRequest {
  pages: SlideText[];
  count: number;
  /** Questions already in the bank, so new ones don't repeat them. */
  avoid?: string[];
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

export interface AiBackend {
  makeQuestions(request: MakeQuestionsRequest, signal?: AbortSignal): Promise<McQuestion[]>;
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
