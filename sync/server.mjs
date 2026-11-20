// The sync server's entry point (sync/Dockerfile runs it; #95). Settings come from the environment:
//
//   GOOGLE_CLIENT_ID      the OAuth client's id (not secret; in the compose file)
//   GOOGLE_CLIENT_SECRET  its secret (from google.env, which Nathan makes on the server; no Claude reads it)
//   ALLOWED_EMAILS        who may have an account, comma-separated (testing phase); empty lets nobody in
//   APP_ORIGIN            https://honed.pacificfish.ca (default)
//   DATA_DIR              /data (default): sync.db goes here
//   PORT                  3002 (default)
import { createServer } from 'node:http';
import { createSync } from './app.mjs';
import { openDb } from './db.mjs';
import { googleClient } from './google.mjs';

const env = process.env;
const appOrigin = (env.APP_ORIGIN ?? 'https://honed.pacificfish.ca').replace(/\/+$/, '');
const allowedEmails = (env.ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean);
if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');

const handle = createSync({
  db: openDb(env.DATA_DIR ?? '/data'),
  google: googleClient({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: `${appOrigin}/api/auth/callback` }),
  allowedEmails,
  appOrigin,
});

const port = Number(env.PORT ?? 3002);
createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.log(JSON.stringify({ at: new Date().toISOString(), error: String(err?.message ?? err).slice(0, 200) }));
    if (!res.headersSent) res.writeHead(500, { 'Cache-Control': 'no-store' }).end();
  });
}).listen(port, () => console.log(JSON.stringify({ at: new Date().toISOString(), started: true, port, allowed: allowedEmails.length })));
