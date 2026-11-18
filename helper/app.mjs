// The helper's HTTP API (served at /ai/ behind Cloudflare Access):
//   POST /ai/questions, /ai/grade, /ai/explain, /ai/ask: JSON in, JSON out (helper/jobs.mjs)
//   GET  /healthz: for the container's health check (no sign-in, says nothing)
//
// For each request: check it's JSON from our own site, check the Access token and find the person,
// check the input, check their limits, run Claude Code with their own token, check the reply's
// shape (retrying once), and answer. Logs are counts and errors only, never content.
import { AccessError } from './access.mjs';
import { ClaudeError, runClaude } from './claude.mjs';
import { InputError, JOBS, ReplyError, systemPrompt } from './jobs.mjs';

export const MAX_BODY = 512 * 1024;

/**
 * @param {object} options
 * @param {(headers: object) => Promise<string>} options.checkAccess  the signed-in email, or throws AccessError
 * @param {{ email: string, token: string, label: string }[]} options.people
 * @param {string} options.appOrigin  e.g. https://honed.pacificfish.ca
 * @param {string} options.model
 * @param {number} options.dailyLimit  requests per person per day (UTC)
 * @param {number} options.timeoutMs
 * @param {typeof runClaude} [options.run]  (tests)
 * @param {string[]} [options.command]  the claude program (tests use a fake)
 * @param {object} [options.extraEnv]  (tests only)
 * @param {(line: object) => void} [options.log]
 * @param {() => Date} [options.now]
 */
export function createHelper(options) {
  const { checkAccess, appOrigin, model, dailyLimit, timeoutMs } = options;
  const run = options.run ?? runClaude;
  const log = options.log ?? ((line) => console.log(JSON.stringify(line)));
  const now = options.now ?? (() => new Date());
  const people = new Map(options.people.map((p) => [p.email.toLowerCase(), p]));
  const used = new Map(); // label -> { day, count }
  const busy = new Set(); // labels with a request running

  return async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://helper');
    const job = url.pathname.startsWith('/ai/') ? url.pathname.slice(4) : null; // also 'whoami'
    let person = null;
    let attempts = 0;

    const send = (status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(text);
      // Counts and errors only: never the request or the reply
      if (job !== null) log({ at: now().toISOString(), job, person: person?.label ?? null, status, attempts, ms: Date.now() - started });
    };

    if (url.pathname === '/healthz' && req.method === 'GET') return send(200, { ok: true });

    // For setting up: open /ai/whoami in a browser to check the tunnel, Access and your token
    // mapping, without using any AI
    if (url.pathname === '/ai/whoami' && req.method === 'GET') {
      try {
        const email = await checkAccess(req.headers);
        person = people.get(email) ?? null;
        if (!person) return send(403, { email, ready: false, error: 'This account can’t use the AI helper.' });
        const today = used.get(person.label);
        const count = today?.day === now().toISOString().slice(0, 10) ? today.count : 0;
        return send(200, { email, ready: true, usedToday: count, dailyLimit });
      } catch (err) {
        if (err instanceof AccessError) return send(401, { error: err.message });
        return send(503, { error: 'Couldn’t check the sign-in. Try again.' });
      }
    }
    if (job === null || !Object.hasOwn(JOBS, job)) return send(404, { error: 'Not found.' });
    if (req.method !== 'POST') return send(405, { error: 'Use POST.' });

    // Only our own site's pages may call (a page elsewhere can't, even with the Access cookie):
    // a JSON content type forces a browser's cross-site preflight, which we never answer.
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== appOrigin) return send(403, { error: 'Wrong site.' });
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return send(415, { error: 'Send JSON.' });

    try {
      const email = await checkAccess(req.headers);
      person = people.get(email) ?? null;
      if (!person) return send(403, { error: 'This account can’t use the AI helper.' });
    } catch (err) {
      if (err instanceof AccessError) return send(401, { error: err.message });
      return send(503, { error: 'Couldn’t check the sign-in. Try again.' });
    }

    let body;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY));
    } catch (err) {
      if (err instanceof TooLarge) return send(413, { error: 'The request is too large.' });
      return send(400, { error: 'The request isn’t valid JSON.' });
    }

    let input;
    try {
      input = JOBS[job].validate(body);
    } catch (err) {
      if (err instanceof InputError) return send(400, { error: err.message });
      throw err;
    }

    // Limits: one request at a time per person, and so many a day
    if (busy.has(person.label)) return send(429, { error: 'Your previous AI request is still running.' });
    const day = now().toISOString().slice(0, 10);
    const today = used.get(person.label)?.day === day ? used.get(person.label) : { day, count: 0 };
    if (today.count >= dailyLimit) return send(429, { error: `You’ve used today’s ${dailyLimit} AI requests. More tomorrow.` });
    today.count += 1;
    used.set(person.label, today);
    busy.add(person.label);

    try {
      const prompt = JOBS[job].prompt(input);
      let lastProblem = null;
      while (attempts < 2) {
        attempts += 1;
        try {
          const text = await run({
            prompt,
            system: systemPrompt(),
            token: person.token,
            model,
            timeoutMs,
            command: options.command,
            extraEnv: options.extraEnv,
          });
          return send(200, JOBS[job].check(text, input));
        } catch (err) {
          if (err instanceof ClaudeError && err.code === 'timeout') return send(504, { error: err.message });
          if (!(err instanceof ReplyError || err instanceof ClaudeError)) throw err;
          lastProblem = err;
        }
      }
      return send(502, { error: `The AI’s answer wasn’t usable, twice (${lastProblem?.message}). Try again.` });
    } catch (err) {
      log({ at: now().toISOString(), job, person: person.label, error: err instanceof Error ? err.name : 'unknown' });
      return send(500, { error: 'Something went wrong in the AI helper.' });
    } finally {
      busy.delete(person.label);
    }
  };
}

class TooLarge extends Error {}

/** The body as text; rejects with TooLarge past `max` bytes (after draining a little, so the client hears why). */
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= max) chunks.push(chunk);
      else if (size > max * 4) req.destroy(); // still sending far too much: hang up
    });
    req.on('end', () => (size > max ? reject(new TooLarge()) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
    req.on('close', () => size > max && reject(new TooLarge()));
  });
}

/** The people and their tokens, from PERSON_1_EMAIL / PERSON_1_TOKEN, PERSON_2_..., in the environment. */
export function peopleFromEnv(env) {
  const people = [];
  for (let n = 1; n <= 20; n++) {
    const email = env[`PERSON_${n}_EMAIL`];
    const token = env[`PERSON_${n}_TOKEN`];
    if (!email && !token) continue;
    if (!email || !token) throw new Error(`PERSON_${n}_EMAIL and PERSON_${n}_TOKEN must both be set.`);
    people.push({ email: email.trim().toLowerCase(), token: token.trim(), label: `person${n}` });
  }
  return people;
}
