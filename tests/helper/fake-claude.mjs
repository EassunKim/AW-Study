#!/usr/bin/env node
// A stand-in for the `claude` program in the AI helper's tests, so CI never uses a subscription or
// sends anything. It records what it was given (arguments, environment, stdin, its home folder)
// to FAKE_DIR/calls.jsonl, then answers with the next entry of FAKE_DIR/replies.json:
//   { "result": "text" }   a successful run whose answer is that text
//   { "raw": "text" }      exactly this on stdout
//   { "error": true }      Claude Code reporting an error
//   { "exit": 3 }          stops with that exit code
//   { "sleep": 5000 }      waits first (for the time limit)
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.FAKE_DIR;
const stdin = readFileSync(0, 'utf8');
const callsFile = join(dir, 'calls.jsonl');
const calls = existsSync(callsFile) ? readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).length : 0;
const home = process.env.HOME;
writeFileSync(join(home, 'left-behind.txt'), 'a file written during the run'); // must be wiped after
appendFileSync(
  callsFile,
  `${JSON.stringify({ argv: process.argv.slice(2), env: process.env, stdin, home, cwd: process.cwd() })}\n`,
);
const replies = JSON.parse(readFileSync(join(dir, 'replies.json'), 'utf8'));
const reply = replies[Math.min(calls, replies.length - 1)];

if (reply.sleep) await new Promise((resolve) => setTimeout(resolve, reply.sleep));
if (reply.exit !== undefined) process.exit(reply.exit);
if (reply.raw !== undefined) process.stdout.write(reply.raw);
else if (reply.error) process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true }));
else process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: reply.result }));
