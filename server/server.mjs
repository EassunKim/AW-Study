// AW-Study's server. It only hands out the built app (dist/) and answers /healthz: no data, no
// accounts, no secrets. Everything a user stores stays in their own browser. Node's own modules only.
//   node server/server.mjs              listens on PORT (default 3000): how the container runs it
//   node server/server.mjs --port 8091  try the built app on this PC (npm run serve, after npm run build)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADERS, cacheControl } from './headers.mjs';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}

// A file from the site folder. Paths can't climb out of it (".." is resolved first, then checked).
// Each file gets an ETag from its size and time, so a browser checking for a newer copy gets a 304.
async function file(req, res, root, path) {
  let full = normalize(join(root, path));
  if (!(full + sep).startsWith(root)) return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
  try {
    let info = await stat(full);
    if (info.isDirectory()) {
      full = join(full, 'index.html');
      info = await stat(full);
    }
    const type = TYPES[extname(full)] || 'application/octet-stream';
    const tag = `W/"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
    const caching = { ETag: tag, 'Cache-Control': cacheControl(path) };
    if (req.headers['if-none-match'] === tag) return send(res, 304, type, undefined, caching);
    const body = req.method === 'HEAD' ? undefined : await readFile(full);
    send(res, 200, type, body, { ...caching, 'Content-Length': info.size });
  } catch {
    send(res, 404, 'text/plain; charset=utf-8', 'Not found', { 'Cache-Control': 'no-cache, no-transform' });
  }
}

export function handle(req, res, root = DIST) {
  let path;
  // The path from the request line without its ?query (not new URL(): it reads "//x" as a host)
  try {
    path = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    return send(res, 400, 'text/plain; charset=utf-8', 'Bad request');
  }
  if (path === '/healthz') {
    return send(res, 200, 'application/json', JSON.stringify({ ok: true }), { 'Cache-Control': 'no-store' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed', { Allow: 'GET, HEAD' });
  }
  return file(req, res, root, path);
}

/** Starts listening and resolves with the http.Server. Port 0 picks a free port (the tests do). */
export function start({ port = 3000, host = '0.0.0.0', root = DIST } = {}) {
  const dir = root.endsWith(sep) ? root : root + sep;
  const server = createServer((req, res) => {
    Promise.resolve(handle(req, res, dir)).catch(() => {
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Something went wrong');
    });
  });
  return new Promise((ok) => server.listen(port, host, () => ok(server)));
}

// Run directly: listen, and stop cleanly when the container is stopped
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const flag = process.argv.indexOf('--port');
  const local = flag > 0;
  const port = local ? Number(process.argv[flag + 1]) : Number(process.env.PORT) || 3000;
  const host = local ? '127.0.0.1' : '0.0.0.0'; // on this PC, only this PC; in the container, its own network
  const server = await start({ port, host });
  console.log(`AW-Study on http://${local ? host : 'localhost'}:${server.address().port}/`);
  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
