// The real AiBackend: our AI helper at /ai/ on this same site (helper/, #27). Same-site, so the
// Content-Security-Policy's `connect-src 'self'` already allows it, and the Cloudflare Access
// cookie goes along.
//
// When the Access sign-in has lapsed, Access answers with a redirect to its sign-in page (on
// another site). We never follow it (`redirect: 'manual'`): the fetch sees an "opaque redirect",
// and we say 'signed-out' so the screen can open signInUrl() in a window for the user.
import { AiError, type AiBackend, type AskRequest, type ExplainRequest, type GradeRequest, type MakeQuestionsRequest } from './backend';
import { checkGrade, checkQuestions, checkText } from './check';

/**
 * Opens in a window to sign in to Cloudflare Access. The helper's /ai/signin page then says you're in
 * and links back to `then` (by default the screen you're on): an iPhone Home Screen app opens it in
 * its own window, with no Back button (Nov 19: it was left on /ai/whoami's JSON).
 */
export function signInUrl(base = '/ai/', then = here()): string {
  return `${base}signin?then=${encodeURIComponent(then)}`;
}

function here(): string {
  const at = globalThis.location;
  return at ? `${at.pathname}${at.search}${at.hash}` : '/';
}

export class HttpAiBackend implements AiBackend {
  constructor(
    private readonly base = '/ai/',
    private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {
    if (!base.startsWith('/') || base.startsWith('//')) throw new Error('The AI helper must be on this same site (a path like /ai/).');
  }

  async makeQuestions(request: MakeQuestionsRequest, signal?: AbortSignal) {
    const reply = await this.post('questions', request, signal);
    return checkQuestions(reply, request.pages.map((p) => p.page), request.count);
  }

  async gradeAnswer(request: GradeRequest, signal?: AbortSignal) {
    return checkGrade(await this.post('grade', request, signal), request.points.length);
  }

  async explain(request: ExplainRequest, signal?: AbortSignal) {
    return checkText(await this.post('explain', request, signal));
  }

  async ask(request: AskRequest, signal?: AbortSignal) {
    return checkText(await this.post('ask', request, signal));
  }

  private async post(job: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${job}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin', // the Access cookie, and only to our own site
        redirect: 'manual',
        cache: 'no-store',
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw new AiError('cancelled', 'Cancelled.');
      if (globalThis.navigator?.onLine === false) throw new AiError('offline', 'You’re offline. AI needs a connection.');
      // A followed redirect to Access's sign-in page would also fail here (another site)
      throw new AiError('unavailable', 'Couldn’t reach the AI helper. Check your connection, or sign in again.');
    }

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new AiError('signed-out', 'Sign in again to use AI.');
    }
    const data = await readJson(response);
    const said = typeof (data as { error?: unknown } | null)?.error === 'string' ? (data as { error: string }).error : null;
    if (response.ok) {
      if (data === undefined) throw new AiError('unavailable', 'The AI helper’s answer wasn’t readable.');
      return data;
    }
    switch (response.status) {
      case 401:
        throw new AiError('signed-out', 'Sign in again to use AI.');
      case 403:
        throw new AiError('not-allowed', said ?? 'This account can’t use AI.');
      case 429:
        throw new AiError('limit', said ?? 'Too many AI requests. Try again later.');
      case 400:
      case 413:
      case 415:
        throw new AiError('invalid', said ?? 'The AI helper refused the request.');
      default:
        throw new AiError('unavailable', said ?? `The AI helper failed (${response.status}). Try again.`);
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (!/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
