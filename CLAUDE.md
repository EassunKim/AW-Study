# Honed (repo: AW-Study)

Spaced repetition for lecture content, built by Matt and Nathan, each working with Claude Code on
their own PC. This file is shared: both Claudes follow it. Keep personal notes in your own Claude
memory, not here. The full design is `docs/DESIGN.md`. Read it before any feature work, and update it
in the same PR when a decision changes.

## Working together (two Claudes on two machines)

Matt's Claude and Nathan's Claude run on different machines and accounts and **cannot message each
other**. GitHub is the shared channel. Each human relays only when something needs a person.

**At the start of every session**, before any work:
1. `git switch main && git pull`.
2. Read `docs/PROGRESS.md` (the status board: who is doing what, decisions, gotchas).
3. `gh issue list --label agent-task` and `gh pr list`: open tasks and work in progress. Read the
   comments on any issue you're involved in: the other Claude may have asked you something.

**Taking a task:**
- Work only on a task that has an issue labelled `agent-task`. No issue yet? Make one first
  (what, which files, done when).
- Claim it with a comment: `[Matt's Claude] taking this` or `[Nathan's Claude] taking this`.
- Branch, and open a **draft PR** at once with `Closes #<issue>`, so `gh pr list` shows the
  work is in progress.
- Only edit the files your task owns (its row in `docs/PROGRESS.md`). Need a change elsewhere,
  especially to the shared contract `src/types/study.ts`? Ask in the issue first.

**Talking to the other Claude:** comment on the task's issue (or the PR), signed `[Matt's Claude]`
or `[Nathan's Claude]`. Write so it makes sense to a reader with no other context: what you
need, which file, why. Don't `@`-mention people unless a human must act (it notifies them).

**Finishing:** update your row and add a log line in `docs/PROGRESS.md` in the same PR. Note any
decision there and in `docs/DESIGN.md`, and any trap you hit under "Gotchas". Mark the PR ready,
wait for green CI on the latest commit, then merge it (`gh pr merge <n> --merge --delete-branch`):
both Claudes have standing permission to merge any PR (see Git below). If you can't finish, say
in the issue exactly where you stopped and what's left.

**Before pushing more to a PR,** check it's still open (`gh pr view <n> --json state`): a
merged PR ignores later pushes.

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

- `src/brand.ts`: the app's name (**Honed**, a working name). Every user-visible name comes from
  here: never type the name anywhere else. The repo, npm package and image stay `aw-study`.
- `src/`: the app. Pure logic in `src/lib/` with a `*.test.ts` beside each file.
- `src/types/study.ts`: the shared contract (decks, notes, cards, FSRS state, review log). Plain
  JSON types only; changes go in their own PR, announced in the task issues.
- `src/lib/scheduler.ts` (the only file importing ts-fsrs), `src/lib/cloze.ts`: FSRS and cloze.
- `src/lib/crypto.ts`, `src/lib/passkey.ts`, `src/types/crypto.ts`: encryption, exactly as
  `docs/SECURITY.md` describes. Change SECURITY.md first, in its own PR, then the code.
- `src/db/`: storage. `schema.ts` (IndexedDB stores, numbered migrations, sealed record shapes)
  and `store.ts` (the `StudyStore` the screens call, including lock/unlock and the keyring; the
  only code that touches the database). Read the top of `store.ts` before changing it: records are
  sealed (encrypted) per `docs/SECURITY.md`, and every write is read, compute, encrypt, then
  write, inside `exclusive()`.
- `src/ui/`: the screens (React). `route.ts` (hash routes, no router library), `store-context.ts`
  (the store reaches screens through React context), `DecksScreen`, `DeckScreen`, `NoteEditor`,
  `ReviewScreen`, `CardText` (card text is always React text, never HTML), `ConfirmDialog` (never
  `confirm()`), `settings.ts` (day start 4 a.m., 20 new cards a day until milestone 4).
- `docs/PROGRESS.md`: the status board. `docs/DESIGN.md`: the design.
- `server/`: the production server (Node's own modules only): serves `dist/`, `/healthz`, and every
  security header (`server/headers.mjs`).
- `tests/server.test.mjs`: the server. `tests/browsers/`: Playwright against the built app.
- `.github/workflows/publish.yml`: tests every PR and push; on `main` publishes
  `ghcr.io/nandminc/aw-study:main`, which the home server deploys when someone presses Update.

## Rules

**Git**
- Never push to `main`. Work on a branch, open a PR, wait for the green check, then merge it.
  **Either Claude may merge any PR, its own or the other's**, once CI is green on its latest
  commit and the work is finished (Nathan, Nov 18: "permission to merge ANYTHING ... Same goes for
  Matt's claude"). Merging someone else's PR? Say so in a comment first, and if it needs `main`
  merged in or a small fix, push it to their branch and tell them to pull before continuing.
  Review is optional: ask for one when you want a second look, and always before changing the
  shared contract (`src/types/study.ts`) or files another open task owns. Small PRs, merged often.
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
