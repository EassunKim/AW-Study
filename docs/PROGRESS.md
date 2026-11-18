# Progress

The shared status board for everyone working on Honed: Matt, Nathan and each one's Claude Code.
**Read it at the start of every session. Update it in every PR** (your task's row, and a line in the
log). The design is in `DESIGN.md`; how we work together is in `../CLAUDE.md` ("Working together").

## Now (updated Nov 18, 2026)

Milestone 2, **Study by hand**, is split into three tasks. Each has a GitHub issue labelled
`agent-task`; questions about a task go in its issue's comments.

| Task | Issue | Who | Files it owns | Status |
| --- | --- | --- | --- | --- |
| Scheduler and cloze: FSRS, the daily queue, cloze parsing | #5 | Matt's Claude | `src/lib/scheduler.ts`, `src/lib/cloze.ts` + tests | Ready to start once the kickoff PR is merged |
| Data layer: SQLite in a worker, schema, change log, `StudyStore` | #6 | Nathan's Claude | `src/db/` | Starting after the kickoff PR |
| Screens: decks, card editor, review | #7 | Whoever is free after #5 and #6 | `src/ui/`, `src/App.tsx` | Waiting for #5 and #6 |

The contract all three code against: `src/types/study.ts`, plus the signatures in the
`scheduler.ts` and `cloze.ts` stubs. Change it only in its own small PR, announced in the issues.

## Milestones

| # | Milestone | State |
| --- | --- | --- |
| 1 | Skeleton: installable offline PWA, server, tests, CI | **Done** (#2, #3). Live at https://honed.pacificfish.ca |
| 2 | Study by hand: decks, hand-made cards, FSRS reviews, review log, change log | **In progress** (#5, #6, #7) |
| 3 | Lock it down: encryption, recovery key, persistent storage, backup and restore | Not started |
| 4 | Time budget: pacing, daily ring, streak | Not started |
| 5 | Slides to cards: PDF in the browser, AI drafts, approve screen | Not started |
| 6 | Polish the reward loop | Not started |
| 7 | v2: encrypted sync | Not started |

## Live

https://honed.pacificfish.ca runs whatever `main` was when someone last pressed **Update from
GitHub** at apps.pacificfish.ca (Matt and Nathan both have the button). After merging, wait for
the "Test and publish" run on `main` to finish, then press Update.

## Decisions (newest first)

- **Nov 18:** Review rule changed (Matt and Nathan): the PR's author merges once CI is green.
  Review is optional: ask for one when wanted, and before changing the shared contract or files
  another open task owns.
- **Nov 18:** The repo moved from EassunKim/AW-Study to the **NandMinc** organisation
  (github.com/NandMinc/AW-Study; Matt and Nathan are admins). The image follows the repo's name:
  `ghcr.io/nandminc/aw-study`. Update your clone: `git remote set-url origin
  https://github.com/NandMinc/AW-Study.git`.
- **Nov 18:** Matt's and Nathan's Claudes coordinate through GitHub: one issue per task (label
  `agent-task`), a draft PR as soon as work starts, this file updated in every PR. They can't
  message each other directly (different accounts and machines).
- **Nov 18:** Notes and cards are separate, as in Anki: a note is what you write, a card is what
  you review. A basic note makes one card, a cloze note one per cloze number ("siblings").
- **Nov 18:** FSRS through **ts-fsrs 6** (MIT). Storage: **SQLite** (`@sqlite.org/sqlite-wasm`,
  Apache-2.0) in a Web Worker on OPFS (`opfs-sahpool`). To be confirmed by the #6 spike in WebKit;
  IndexedDB is the fallback.
- **Nov 17:** Licence: proprietary, all rights reserved (Matt, #4).
- **Nov 17:** Name: **Honed** (working name), only in `src/brand.ts`. The repo, package and image
  stay `aw-study`.
- **Nov 17:** Stack: TypeScript, React, Vite, Vitest, Playwright. Ships as a small image like
  Nathan's chess site.
- **Nov 17:** Local-first: users' data stays encrypted on their own devices; the server only serves
  the app. v2 adds end-to-end encrypted sync.

## Log (newest first)

- **Nov 18:** Repo moved to NandMinc (Matt). References updated; the server switches to
  `ghcr.io/nandminc/aw-study` after the first publish from the new home. (Nathan's Claude)
- **Nov 18:** Kickoff for milestone 2: shared types, scheduler and cloze stubs, ts-fsrs and
  sqlite-wasm added, this file, the "Working together" rules, issues #5-#7. (Nathan's Claude)
- **Nov 18:** First deploy of the skeleton to honed.pacificfish.ca, checked live in Chromium and
  WebKit. (Nathan's Claude)
- **Nov 18:** Licence added (#4, Matt). Name Honed (#3).
- **Nov 17:** Skeleton merged (#2). Design merged (#1).

## Gotchas worth knowing

- The image name comes from the repo's owner (`ghcr.io/${GITHUB_REPOSITORY,,}` in the workflow).
  Moving or renaming the repo moves the image, and the home server keeps deploying the old name
  until Nathan switches its compose file and `apps.json`. Tell Nathan before any such move.
- A merged PR ignores later pushes to its branch. Before pushing more, check
  `gh pr view <n> --json state`; if it's merged, start a new branch from that commit.
- The service worker needs `clientsClaim` (in `vite.config.ts`), or the first visit isn't
  offline-ready.
- Playwright can only take Chromium offline with a service worker; offline tests skip WebKit.
- Never pass an `async` function to Playwright's `waitForFunction` (its promise counts as true).
- Everything is LF (`.gitattributes`). Nathan's PC has Node 26; CI uses Node 24.
