# AW-Study

Spaced repetition for lecture content, built by Matt and Nathan, each working with Claude Code on
their own PC. This file is shared: both Claudes follow it. Keep personal notes in your own Claude
memory, not here. The full design is `docs/DESIGN.md`. Read it before any feature work, and update it
in the same PR when a decision changes.

## The product in one paragraph

A local-first PWA. Slides, cards and review history live on the user's device, encrypted; the
server only serves the app's files (v2 adds end-to-end encrypted sync of an append-only change log).
FSRS schedules reviews inside a daily time budget. AI drafts cards from slides that the user
approves; AI is a per-lecture choice (own API key, local model through Ollama, or none).

## Stack and commands

TypeScript, React 19, Vite 8 (with vite-plugin-pwa), Vitest, Playwright. Node 24+.

| Command | What it does |
| --- | --- |
| `npm install` then `npx playwright install chromium webkit` | First-time setup |
| `npm run dev` | Dev server with live reload (no service worker in dev) |
| `npm test` | Everything: unit tests, type check, build, browser tests (desktop, Android, iPhone) |
| `npm run test:unit` | Vitest only (`src/**/*.test.ts`, `tests/**/*.test.mjs`), under a second |
| `npm run build` then `npm run serve` | The production build on http://127.0.0.1:8091 with the real headers |
| `npm run icons` | Redraw the PNG icons from `public/icons/icon.svg` |

## Layout

- `src/`: the app. Pure logic in `src/lib/` with a `*.test.ts` beside each file.
- `server/`: the production server (Node's own modules only): serves `dist/`, `/healthz`, and every
  security header (`server/headers.mjs`).
- `tests/server.test.mjs`: the server. `tests/browsers/`: Playwright against the built app.
- `.github/workflows/publish.yml`: tests every PR and push; on `main` publishes
  `ghcr.io/eassunkim/aw-study:main`, which the home server deploys when someone presses Update.

## Rules

**Git**
- Never push to `main`. Work on a branch, open a PR, wait for the green check, and the other person
  reviews and merges. Small PRs, merged often.
- Line endings are LF everywhere (`.gitattributes`); don't fight it.

**Tests**
- Every rule gets a test, and you prove the test fails without the rule before trusting it (break
  the code on purpose, watch it fail, put it back).
- Never fix a flaky test by rerunning until green: find the cause.
- Tests must not depend on today's date or the machine's time zone: pass dates and zones in.
- Keep the WebKit (iPhone) project: it catches what Chromium doesn't.

**Privacy and security**
- No user data leaves the device, except slides sent to AI for a lecture where the user turned AI
  on. Tests must check both.
- Nothing loaded from other sites at runtime: no CDNs, fonts, analytics or scripts. Libraries are
  npm packages bundled by Vite. Each new dependency is agreed in its PR.
- The Content-Security-Policy in `server/headers.mjs` stays strict: no `unsafe-inline`, no
  `unsafe-eval`. When AI arrives, `connect-src` gains only the AI provider's API and
  `http://localhost:11434` (Ollama). No inline `<script>` or `<style>`, and no `style=` in HTML.
- Never commit API keys, `.env` files, real lecture slides or databases. Test data comes from
  public material (e.g. MIT OpenCourseWare).
- Encryption uses WebCrypto building blocks only (AES-GCM, PRF/PBKDF2 for keys). No home-made crypto.

**FSRS** (it learns only from grades and dates)
1. Only the user's confirmed grade reaches FSRS, never an AI-suggested one.
2. The review log is never edited, only added to.
3. Reading a card or its explanation is not a review.
4. A small fix keeps a card's FSRS state; a real change retires it and starts fresh cards.
5. Practice questions stay outside FSRS.
6. One fact per card, no duplicates.

**AI**
- AI suggests, the user decides. Nothing joins a deck without approval.
- Every AI call goes through the `AiBackend` interface; tests use a fake backend, so CI never spends
  money or sends data.
- Default model `claude-opus-5-5`. A step moves to a cheaper model only on test-set results, decided
  by Matt and Nathan.
- Follow the cost measures in `docs/DESIGN.md` (skip duplicate/empty slides, text before images,
  short replies, caching, never pay twice).

## Hosting

The home server runs the image as a TrueNAS app (named when the server side is added), with its
port on 127.0.0.1 behind a Cloudflare Tunnel. Nathan handles the server side.
After merging to `main`, wait for the publish run to finish before pressing Update.
