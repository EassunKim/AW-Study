// The AI helper's entry point (helper/Dockerfile runs it). Settings come from the environment:
//
//   ACCESS_TEAM_DOMAIN  https://<team>.cloudflareaccess.com (Zero Trust → Settings → Custom pages)
//   ACCESS_AUD          the Access application's "Application Audience (AUD) Tag"
//   PERSON_1_EMAIL      matt@…  (the email they sign in to Access with)
//   PERSON_1_TOKEN      the token from that person's own `claude setup-token`
//   PERSON_2_EMAIL, PERSON_2_TOKEN, …
//   APP_ORIGIN          https://honed.pacificfish.ca (default)
//   HELPER_MODEL        claude-opus-5-5 (default)
//   HELPER_DAILY_LIMIT  requests per person per day, 200 (default)
//   HELPER_TIMEOUT_MS   per Claude Code run, 120000 (default)
//   PORT                3001 (default)
import { createServer } from 'node:http';
import { accessChecker } from './access.mjs';
import { createHelper, peopleFromEnv } from './app.mjs';

const env = process.env;
const people = peopleFromEnv(env);
if (people.length === 0) throw new Error('No people configured: set PERSON_1_EMAIL and PERSON_1_TOKEN.');

const handle = createHelper({
  checkAccess: accessChecker({ teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD }),
  people,
  appOrigin: env.APP_ORIGIN ?? 'https://honed.pacificfish.ca',
  model: env.HELPER_MODEL ?? 'claude-opus-5-5',
  dailyLimit: Number(env.HELPER_DAILY_LIMIT ?? 200),
  timeoutMs: Number(env.HELPER_TIMEOUT_MS ?? 120_000),
});

const port = Number(env.PORT ?? 3001);
createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500).end();
  });
}).listen(port, () => console.log(JSON.stringify({ at: new Date().toISOString(), started: true, port, people: people.length })));
