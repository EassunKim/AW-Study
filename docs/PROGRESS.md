# Progress

The shared status board for everyone working on Honed: Matt, Nathan and each one's Claude Code.
**Read it at the start of every session. Update it in every PR** (your task's row, and a line in the
log). The design is in `DESIGN.md`; how we work together is in `../CLAUDE.md` ("Working together").

## Now (updated Nov 18, 2026)

Milestone 3, **Lock it down**: encryption, the recovery key, persistent storage, backup and
restore. Four tasks, each a GitHub issue labelled `agent-task` in the GitHub milestone
"M3: Lock it down". **#15 goes first**: it writes `docs/SECURITY.md` and the shared contract
(`src/types/crypto.ts` + stubs, merged early like the M2 kickoff). Then #16 and #17 can run in
parallel, and #18 follows #16. Claim a task with a comment on its issue.

| Task | Issue | Who | Files it owns | Status |
| --- | --- | --- | --- | --- |
| Encryption design and crypto core | #15 | Nathan's Claude | `docs/SECURITY.md`, `src/types/crypto.ts`, `src/lib/crypto.ts`, `src/lib/passkey.ts` | **Done** (PR #20 contract, PR #22 implementation) |
| Encrypted storage: records encrypted, migration of M2 data, lock/unlock | #16 | Nathan's Claude | `src/db/` | **Done** (PR #23) |
| Setup and unlock screens, recovery key, settings | #17 | Matt's Claude | `src/ui/`, `src/App.tsx`, `src/main.tsx` | **Done** (PR #21). Passkeys still to try by hand on an iPhone after deploy |
| Persistent storage, backup and restore | #18 | Matt's Claude | `src/backup/`, the backup part of Settings, backup methods in `src/db/store.ts` | **Done** (PR #29) |

Milestone 2 (#5, #6, #7) is done: see the log.

### Next: the redesign (Nov 18)

**Matt and Nathan redesigned the app** around lectures, slides and AI quizzes (`docs/DESIGN.md`,
rewritten). Milestone 3 continues unchanged. The new work, in GitHub milestones "M4: Classes and
slides" and "M6: AI helper and quizzes":

| Task | Issue | Who | Files it owns | Status |
| --- | --- | --- | --- | --- |
| Contract and storage: classes, exams, decks, lectures, sections | #24 | Nathan's Claude | `src/types/lecture.ts`, `src/db/`, SECURITY.md's table | Starting: contract first |
| PDF slide viewer component | #25 | Matt's Claude (after #18) | `src/viewer/`, `tests/fixtures/` | Ready (independent) |
| Class and lecture screens; remove the flashcard layer | #26 | unclaimed | `src/ui/` (not #17's screens), routes, old flashcard files | Waits for #24's contract and #25 |
| AI helper on the server | #27 | unclaimed | `helper/`, its CI job | Ready (independent) |

## Milestones

| # | Milestone | State |
| --- | --- | --- |
| 1 | Skeleton: installable offline PWA, server, tests, CI | **Done** (#2, #3). Live at https://honed.pacificfish.ca |
| 2 | Study by hand (flashcards, FSRS) | **Done**, then **superseded** by the Nov 18 redesign; removed in #26 |
| 3 | Lock it down: encryption, recovery key, persistent storage, backup and restore | **In progress** (#15-#18) |
| 4 | Classes and slides: classes, exams, PDFs, the viewer, lectures and sections | **Starting** (#24-#26) |
| 5 | Planner and the daily checklist with Play | Not started |
| 6 | AI helper and quizzes | **Helper starting** (#27); the app side later |
| 7 | Viewer tools: highlights, notes, explain, ask | Not started |
| 8 | First run (tutorial) and after-class prompts | Not started |
| 9 | Exams: pulling forward, practice tests with AI-graded short answers | Not started |

## Live

https://honed.pacificfish.ca runs whatever `main` was when someone last pressed **Update from
GitHub** at apps.pacificfish.ca (Matt and Nathan both have the button). After merging, wait for
the "Test and publish" run on `main` to finish, then press Update.

## Decisions (newest first)

- **Nov 18: Redesign** (Matt and Nathan). FSRS and flashcards were a reference, not the product.
  Honed is built around **lectures**: classes, PDF slides studied in a built-in viewer, and AI
  multiple-choice quizzes whose scores schedule each section (a low score adds study time later,
  never an immediate re-study). Data stays on the device. AI is Claude Code in a locked-down helper
  on Nathan's server, on Matt's and Nathan's own subscriptions. PDF only for now; flashcards out.
  Everything in `docs/DESIGN.md`; the flashcard code goes in #26.

- **Nov 18 (#15):** Encryption, as written in `docs/SECURITY.md`: one random AES-GCM data key
  encrypts every record's private part (fresh random IV, additional data
  `honed:v1:<store>:<id>`); it is stored only wrapped (AES-KW) under a passphrase (PBKDF2-SHA-256,
  600,000 iterations), a passkey (WebAuthn PRF + HKDF) and a recovery key (128 bits + a 4-byte
  check, 8 groups of 4 Crockford base32 characters; HKDF). Ids, links and due/review times stay
  readable for the indexes. Changing how you unlock rewraps the same key.

- **Nov 18:** Merging widened (Nathan): **either Claude may merge any PR**, its own or the
  other's, once CI is green on the latest commit. Say so on the PR first; if it needs `main`
  merged in or a small fix, push to that branch and tell its owner to pull.
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
- **Nov 18 (replaces the SQLite decision below):** Storage is **IndexedDB** through `idb` (ISC,
  ~1 KB, no dependencies); tests use `fake-indexeddb` (Apache-2.0). The #6 spike showed SQLite on
  OPFS working in Chromium, but **Playwright's WebKit has no working OPFS at all**
  (`navigator.storage.getDirectory()` fails with "UnknownError", on Windows and on Linux in CI,
  with a throwaway or a saved profile), so its iPhone behaviour could never be tested. IndexedDB
  works in every engine, needs no worker or 860 KB WebAssembly download, and suits per-record
  encryption in milestone 3. `@sqlite.org/sqlite-wasm` is removed.
- **Nov 18:** FSRS through **ts-fsrs 6** (MIT). Storage: **SQLite** (`@sqlite.org/sqlite-wasm`,
  Apache-2.0) in a Web Worker on OPFS (`opfs-sahpool`). To be confirmed by the #6 spike in WebKit;
  IndexedDB is the fallback. *(Storage part replaced, see above.)*
- **Nov 17:** Licence: proprietary, all rights reserved (Matt, #4).
- **Nov 17:** Name: **Honed** (working name), only in `src/brand.ts`. The repo, package and image
  stay `aw-study`.
- **Nov 17:** Stack: TypeScript, React, Vite, Vitest, Playwright. Ships as a small image like
  Nathan's chess site.
- **Nov 17:** Local-first: users' data stays encrypted on their own devices; the server only serves
  the app. v2 adds end-to-end encrypted sync.

## Log (newest first)

- **Nov 18:** #18 backups (PR #29): `.honed` backup files (the database as stored, no record
  decrypted; format in SECURITY.md "Backups"), download or share from Settings, automatic backups
  to a folder on Chrome/Edge desktops (hourly at most, newest 5 kept), a reminder after a week,
  restore on the setup screen ("Moving from another device?") or in Settings, persistent storage
  asked after setup and shown in Settings. The store gains `exportSealed`, `replaceFromBackup`
  (one transaction, all or nothing) and `latestChange`. Backups copy every store in
  `RECORD_STORES`, so #24's stores join automatically. 23 unit tests and browser tests on all
  three engines (download, restore on a new device, replace in Settings, wrong passphrase, a
  non-backup file); 17 deliberate bugs each caught. Folder backups can't be driven by Playwright
  (no way to answer the folder picker): unit-tested with a fake folder. (Matt's Claude)

- **Nov 18:** #17 screens (PR #21): first-run setup (passkey or passphrase, the recovery key shown once and typed back), the unlock screen (passkey, passphrase, recovery key, then a new passphrase), Settings (change passphrase, add/remove passkeys, new recovery key, Lock now), on the encrypted store from #16. Browser tests on all three engines, including an end-to-end scan of the real IndexedDB for plaintext; passkeys tested in Chromium with a virtual authenticator with PRF. 15 rules proved to fail without them. (Matt's Claude)

- **Nov 18:** Redesign written into `docs/DESIGN.md`, `CLAUDE.md` (product, schedule and AI rules)
  and this file; milestones 4-9 replace the old 4-7; issues #24-#27. (Nathan's Claude)

- **Nov 18:** #16 encrypted storage (PR #23): `StudyStore` gains the `Vault` methods agreed with
  #17 (`status`, `getKeyring`, `setUp` with progress, `unlock`, `lock`, three keyring
  operations); records are sealed per SECURITY.md (only index fields readable); `setUp`
  encrypts milestone 2 data in place, resumable; schema step 2. The whole store test suite runs
  twice (plain and encrypted), plus 15 encryption tests (no plaintext on disk, exact readable
  fields, locking, wrong keys, keyring rules, a v1 database migrated with progress, an
  interrupted setup finished by unlock, moved records). Eight deliberate bugs each caught.
  2,000 encrypted cards: listDecks 6 ms, studyQueue 30 ms in Node. (Nathan's Claude)

- **Nov 18:** #15 crypto core (PRs #20, #22): `docs/SECURITY.md`; `src/lib/crypto.ts` (data key,
  wrapping under passphrase / recovery key / passkey PRF, `unlock`, recovery key format,
  record encryption with additional data) and `src/lib/passkey.ts` (create a passkey with PRF, get
  its secret, `isPrfSupported`), 31 tests on Node's WebCrypto and a fake `navigator.credentials`.
  Nine deliberate bugs (fixed IV, ignored additional data, no NFC, skipped recovery check,
  passkey id not matched, extractable keys, fewer iterations, no user verification) each caught.
  #16 and #17 can start. (Nathan's Claude)

- **Nov 18:** Milestone 3 planned: issues #15-#18 in the GitHub milestone "M3: Lock it down".
  (Nathan's Claude)

- **Nov 18:** #7 screens (PR #14): decks (counts, create, rename, delete with an in-page
  confirmation), a deck's notes (add, edit, delete; Basic or Cloze with live cloze checks and card
  previews), review (Show answer / Space, Again-Hard-Good-Easy / 1-4 with interval labels, time to
  answer recorded, "Done for now"), hash routes `#/`, `#/deck/<id>`, `#/review/<id>`. Card text is
  never HTML. Browser tests click through all of it on desktop, Android and iPhone (28 checks);
  four deliberate UI bugs each caught. **Milestone 2 is complete.** (Nathan's Claude)

- **Nov 18:** #5 scheduler and cloze (PR #12): `src/lib/scheduler.ts` (ts-fsrs 6, retention 0.9,
  max 36500 days, deterministic fuzz; the daily queue with the study day, new-card limit,
  suspended cards and one card per note per day; button labels) and `src/lib/cloze.ts`
  (`checkCloze`, `renderCloze`), with 71 Vitest tests. Each key rule was proved to fail without it
  (30 of 32; the other two are already enforced by ts-fsrs). Signatures unchanged. (Matt's Claude)
- **Nov 18:** CI's test job runs in Playwright's own image (`mcr.microsoft.com/playwright`) after
  `playwright install --with-deps` hung twice on Ubuntu's mirrors; jobs get time limits (20 and
  15 min); Docker actions moved to their Node 24 majors (#10). (Nathan's Claude)
- **Nov 18:** #6 data layer (PR #9): `src/db/schema.ts` (IndexedDB, migration step 1),
  `src/db/store.ts` (`StudyStore`: decks, notes and their cards, suspend, study queue, answers,
  change log), 18 Vitest tests (each key rule proved to fail without it) and browser tests in all
  three engines (persistence across reload, offline). SQLite tried and dropped (see Decisions).
  (The temporary `globalThis.__honedStore` was removed in #14: the screens get the store through
  React context.)
  (Nathan's Claude)
- **Nov 18:** Repo moved to NandMinc (Matt). References updated; the server switches to
  `ghcr.io/nandminc/aw-study` after the first publish from the new home. (Nathan's Claude)
- **Nov 18:** Kickoff for milestone 2: shared types, scheduler and cloze stubs, ts-fsrs and
  sqlite-wasm added, this file, the "Working together" rules, issues #5-#7. (Nathan's Claude)
- **Nov 18:** First deploy of the skeleton to honed.pacificfish.ca, checked live in Chromium and
  WebKit. (Nathan's Claude)
- **Nov 18:** Licence added (#4, Matt). Name Honed (#3).
- **Nov 17:** Skeleton merged (#2). Design merged (#1).

## Gotchas worth knowing

- WebAuthn (passkeys) refuses an IP-address origin: Playwright's passkey test opens `localhost`, not `127.0.0.1`. Chromium's virtual authenticator supports PRF (`hasPrf: true`); WebKit has none, so iPhone passkeys are tried by hand.

- **Writing to the encrypted store: read, decrypt, compute, encrypt, then write** in a second
  transaction (never encrypt inside one). Wrap every write in `exclusive()` in
  `src/db/store.ts` so nothing slips in between. Counting cards uses their readable fields
  (`cardFacts`), so it needs no decryption.

- **WebCrypto and `Uint8Array` types:** TypeScript wants `Uint8Array<ArrayBuffer>` for WebCrypto
  inputs. Copy with `new Uint8Array(data)` (the `bytes()` helper in `src/lib/crypto.ts`) rather
  than casting.
- **Keys you'll want to wrap again must be extractable.** `unlock()` gives a non-extractable key
  for everyday use; Settings must call it with `{ extractable: true }` (after the user proves who
  they are) to add or change an unlock method.

- **Keyboard shortcuts in React: register the listener once and read state through a ref
  updated in `useLayoutEffect`.** A listener re-added in `useEffect` after each new card left a
  gap where a key reached the old card's handler and was lost (5 of 6 WebKit runs failed). See
  `src/ui/ReviewScreen.tsx`.
- **A test run stopped half-way can leave WebKit processes behind** (`WebKitNetworkProcess`) that
  make the next run hang. On Windows: `Get-Process WebKit* | Stop-Process` before running again.
- **On Windows PowerShell 5.1, don't round-trip source files through `Get-Content`/`Set-Content`**:
  it reads UTF-8 as Windows-1252 and adds a byte-order mark, turning “quotes” into "â€œ". Edit
  files with your editor or Node instead.

- ts-fsrs's review log `due` field is the card's previous review time, not its old due date.
  `review()` fills `ReviewEntry.dueBefore` from the state passed in instead. ts-fsrs 6 also marks
  the classic `fsrs()` API we use as deprecated (it still works); only `scheduler.ts` would change.
- `npm install` on a different Node version (Matt's PC has Node 22) can rewrite
  `package-lock.json`. Don't commit that unless the PR is about dependencies.
- **Don't use `America/Vancouver` in tests.** BC moved to permanent UTC-7 in 2026, and only newer
  time zone data knows it: Node 26 says UTC-7 in November, Node 22 says UTC-8, so a test that
  passes on one PC fails on another. Use a zone whose rules haven't changed (`America/Los_Angeles`,
  `America/New_York`, `Asia/Tokyo`, `UTC`).
- **Upgrading Playwright?** Also change the image tag in `.github/workflows/publish.yml`
  (`mcr.microsoft.com/playwright:v<version>-noble`) and the version in its check step, or CI fails.
- **Playwright's WebKit has no OPFS** (the browser's private file system): anything built on it
  can't be tested for iPhones here. Real Safari has it; our tests can't show it.
- **IndexedDB transactions commit as soon as nothing is pending.** Inside one, await only
  IndexedDB requests; do other async work (fetch, crypto.subtle, timers) before opening it.
- **Aborting an IndexedDB transaction rejects `tx.done`**: unless something catches that, the
  browser logs an unhandled rejection (which fails our "no errors" tests). Use `abort()` in
  `src/db/store.ts`.
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
