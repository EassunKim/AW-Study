// A stand-in AiBackend for tests and for building screens: answers instantly from the slide text,
// sends nothing anywhere, costs nothing. It records every request, and can be told to fail.
import { AiError, type AiBackend, type AiErrorCode, type AskRequest, type ExplainRequest, type GradeRequest, type McQuestion, type MakeQuestionsRequest } from './backend';

export type FakeCall =
  | { job: 'makeQuestions'; request: MakeQuestionsRequest }
  | { job: 'gradeAnswer'; request: GradeRequest }
  | { job: 'explain'; request: ExplainRequest }
  | { job: 'ask'; request: AskRequest };

export class FakeAiBackend implements AiBackend {
  readonly calls: FakeCall[] = [];
  /** Set to make the next calls fail with this error code. */
  failWith: AiErrorCode | null = null;

  async makeQuestions(request: MakeQuestionsRequest): Promise<McQuestion[]> {
    this.record({ job: 'makeQuestions', request });
    const pages = request.pages.filter((p) => p.text.trim() !== '');
    if (pages.length === 0) throw new AiError('unavailable', 'Nothing to ask about.');
    return Array.from({ length: request.count }, (_, i) => {
      const page = pages[i % pages.length]!;
      const fact = firstWords(page.text);
      return {
        question: `Question ${i + 1}: which is on slide ${page.page}?`,
        options: [fact, `Not ${fact}`, `Neither (${i + 1})`, `Both (${i + 1})`],
        answer: 0,
        page: page.page,
        explanation: `Slide ${page.page} says “${fact}”.`,
      } satisfies McQuestion;
    });
  }

  async gradeAnswer(request: GradeRequest) {
    this.record({ job: 'gradeAnswer', request });
    const answer = request.answer.toLowerCase();
    const mark = request.points.filter((p) => answer.includes(p.toLowerCase())).length;
    return { mark, outOf: request.points.length, feedback: mark === request.points.length ? 'All there.' : 'Some points are missing.' };
  }

  async explain(request: ExplainRequest) {
    this.record({ job: 'explain', request });
    return `An explanation of “${request.selection}”.`;
  }

  async ask(request: AskRequest) {
    this.record({ job: 'ask', request });
    return `An answer to “${request.question}”.`;
  }

  private record(call: FakeCall) {
    this.calls.push(call);
    if (this.failWith) throw new AiError(this.failWith, `Fake failure: ${this.failWith}.`);
  }
}

function firstWords(text: string): string {
  return text.trim().split(/\s+/).slice(0, 6).join(' ');
}
