# AW-Study: Design

Nov 17, 2026 · Nathan, with Claude. Exported from the shared design doc; edit here once we start building, and keep it current.

## Summary

AW-Study is a spaced-repetition app for lecture content that keeps each user's data on their own devices. You give it a daily time budget (say 60 minutes); it shows you new material and reviews at the right intervals, and never lets the review pile grow past that budget. Lecture slides often aren't meant to be shared, so slides and cards are stored encrypted on the device, and anything that syncs between devices is encrypted before it leaves. Cards come from slides (AI drafts you approve) or are written by hand, and reviewing should feel rewarding without rewarding fake progress.

Goals for the first version:

- Local-first: slides, cards and review history live on the device, encrypted; our server only serves the app's code.
- Reviews scheduled by FSRS, the open algorithm Anki now uses, not a home-made one.
- A daily time budget that sets how many new cards you get.
- Cards from slides: open a PDF or PPTX, approve the drafts.
- Works well on a phone, installable, offline, and quick to open for a few minutes.

End-to-end encrypted sync between devices follows in the second version.

Code: [github.com/EassunKim/AW-Study](https://github.com/EassunKim/AW-Study) (Matt's repo; Nathan is a collaborator).

## Who it's for and scope

The first version is for Matt and Nathan, built so classmates can join later without a rewrite. Because data stays on each device, the first version has no accounts; the second version adds sync, which needs a sign-in.

| In the first version | Later |
| --- | --- |
| Decks and cards (Q/A and fill-in-the-blank), encrypted on the device | End-to-end encrypted sync between devices (v2) |
| FSRS reviews with a daily time budget | FSRS tuned to each user from their review log |
| Slides read in the browser, optional AI drafts to approve | Images and diagrams as card content |
| Backup and restore to a file or folder the user picks | Shared decks between users |
| Streak, daily ring, simple stats | Leaderboards, friends, achievements |
| Installable web app (PWA) that works offline | Anki `.apkg` import |

Which AI options to offer is an open question below.

## The daily loop and scheduling

You set a time budget, not a card count; the app fills it with due reviews first, then as many new cards as the next two weeks can absorb. This fixes Anki's classic problem: a fixed "20 new a day" that turns into a wall of reviews two weeks later.

**Scheduler: FSRS.** Each card keeps a stability, a difficulty and a due date; each answer (Again / Hard / Good / Easy) updates them. Use the maintained MIT library (`ts-fsrs` for JS/TS; ports exist for Python and Rust) with a target retention of 90%. Every review is logged (card, grade, time taken, timestamp) so FSRS can later fit its parameters to each person.

**Daily session:**

1. Due reviews, oldest-overdue first. If they alone exceed the budget, show the most overdue and carry the rest (FSRS handles late reviews).
2. New cards, in the order of the lecture they came from, until the budget is used.
3. Cards failed today come back a few minutes later in the same session (learning steps).

**Pacing new cards:** measure each user's average seconds per review and per new card. Using FSRS's predicted due dates, estimate the review minutes for each of the next 14 days. Add a new card only if no day in that window goes over the budget. Until there's history, assume 10 s per review and 30 s per new card.

**The day** ends at a set hour (default 4 a.m., local time), so late-night study counts for the night it was done.

**Exams:** later, a deck can have an exam date; cards then get scheduled to be reviewed at least once in the days before it, even if FSRS says they could wait.

## Making cards

AI writes drafts; nothing joins a deck until the user approves it. Bad AI cards are the main way apps like this fail, and approving them is itself a first pass over the material.

**By hand:** a quick editor for question/answer and fill-in-the-blank (`{{c1::word}}` style), with simple formatting and maths (KaTeX).

**From slides** (all in the browser; the file never goes to our server):

1. Open a PDF or PPTX. PDFs are read with PDF.js; a PPTX is a zip of XML files, unpacked in the browser.
2. Split into one record per slide: its text, its speaker notes, and (for PDFs) a rendered image of the page.
3. If the user turns AI on for this lecture, send slides in batches to the chosen model with a fixed prompt: make 0-3 atomic cards per slide, one fact each, skip title and agenda slides, quote the slide's own terms. Slides that are mostly a diagram are sent as the image.
4. Show the drafts beside their slide: keep, edit, or discard each, or keep all from a slide.
5. Kept cards remember their lecture and slide number, so during review you can tap through to the original slide.

**AI and privacy:** sending slides to an AI is the one step where content can leave the device, so it is the user's choice per lecture, made before anything is sent.

| Option | Where the slides go | Trade-off |
| --- | --- | --- |
| Own API key | Straight from the browser to the AI provider, never through our server | The provider sees the slides, under its API terms; the user pays per use |
| Local model (e.g. Ollama on the user's PC) | Nowhere: they stay on the machine | Weaker cards, needs a decent GPU, not on phones |
| No AI | Nowhere | Cards made by hand |

The API key is stored encrypted with the rest of the data. Cap the pages per run, and keep drafts so reopening a lecture never pays twice.

## Motivation

Reward finishing the day's work and remembering honestly, never pressing buttons. If grading yourself "Easy" earns more points, people inflate their grades and FSRS schedules them wrong, which hurts their exam.

| Mechanic | What earns it | Guardrail |
| --- | --- | --- |
| Daily ring | Fills as the day's budget is worked through; a burst when it closes | Fills by time spent on due cards, not cards skipped |
| Streak | Every day the ring closes | One freeze day a week, earned, so one bad day doesn't erase a month |
| Combo | Consecutive correct answers in a session; sound and a small animation | Same reward for Hard and Good; Easy earns nothing extra |
| XP and levels | Reviews done and new cards learned | No XP for reviewing cards that aren't due |
| Stats | Cards mastered per lecture, predicted retention, a calendar heatmap | Shows true retention, even when it drops |
| Reminder | A notification when today's session is ready, at a time the user picks (needs the v2 server) | Off by default; at most one a day |

Feel matters as much as the rules: answers should respond instantly (no waiting on the network), with sound that can be turned off.

## Privacy, storage and sync

Everything is encrypted on the device with a key only the user holds, so our server never stores anything it can read, in v1 or once sync exists.

**Storage on the device:**

- The collection is a SQLite database (WebAssembly build) in the browser's private file storage (OPFS), with its contents encrypted.
- The app asks the browser to keep its storage permanently (`navigator.storage.persist()`) and asks to be installed to the Home Screen, where Safari is much less likely to clear it.
- Backups: on Chrome and Edge on a computer, the app automatically writes an encrypted backup into a folder the user picks (e.g. in OneDrive). Elsewhere it reminds the user to save one (on iPhone, to Files). Restore takes the same file.

**Encryption:**

- Data is encrypted with the browser's WebCrypto (AES-GCM) under a random data key.
- The data key is unlocked by a passkey (Face ID, Windows Hello) through the WebAuthn PRF extension, or by a passphrase where the browser lacks PRF.
- At setup the user gets a recovery key to print or keep in a password manager. Losing every device and the recovery key means the data is gone: nobody else can unlock it.
- Only standard building blocks and a written-down design; no home-made cryptography.

**What it protects against:** our server, a stolen backup file, and other people using the same computer account; the device's own lock and disk encryption cover a lost device. It cannot stop malicious code running in the page itself once unlocked, so the app has a strict Content-Security-Policy, no outside scripts or analytics, and few dependencies.

**Sync (v2):**

1. From v1 on, every change goes into an append-only log with a device id, so sync means shipping that log.
2. Each device encrypts its new log entries before upload. The server stores blobs it cannot read and sees only sizes and times.
3. Reviews never conflict: FSRS state is rebuilt by replaying the review log, so two devices reviewing offline simply merge. Card edits use latest-edit-wins; deletions are recorded as markers.
4. A new device joins by scanning a QR code shown on an existing one (it carries the data key), or by signing in with a passkey synced through iCloud Keychain or Google Password Manager.
5. The server knows whose blobs are whose through a sign-in, and keeps a size limit per user. Whether slides sync or stay on the device that imported them is open.

## Platform and architecture

A static web app, installable as a PWA, that does all its work in the browser; the server only hands out the app's files (and, in v2, stores encrypted sync blobs).

```mermaid
flowchart LR
    subgraph device["Your device: the installed app"]
        app["App code<br/>Reviews, FSRS, slide reader; works offline"]
        storage["Encrypted storage (OPFS)<br/>SQLite: decks, cards, reviews, slides"]
        key["Key unlock<br/>Passkey (Face ID, Hello) or passphrase"]
    end
    site["Static site<br/>Serves the app's files only"]
    ai["AI (optional, per lecture)<br/>Provider with your own key,<br/>or a local model on your PC"]
    sync["Sync server (v2)<br/>Stores blobs it can't read<br/>Sees only sizes and times"]
    other["Your other devices (v2)<br/>Join by QR code or passkey"]
    backup["Backup file<br/>Encrypted, in a folder you pick"]
    site -->|"app files"| device
    device -->|"slides you choose"| ai
    device <-->|"encrypted log"| sync
    sync <--> other
    device --> backup
    classDef v2 stroke-dasharray: 5 4
    class sync,other v2
```

Dashed boxes come with sync in v2. The page and its service worker are cached on the device, so the app opens and works offline. The stack is still open (see Open questions), but it must run entirely in the browser: `ts-fsrs`, SQLite in WebAssembly, PDF.js and WebCrypto.

**Main data (all on the device):**

| Table | Holds |
| --- | --- |
| settings | Time budget, day-start hour, time zone, AI choice (API key encrypted) |
| decks | Name, optional exam date |
| lectures | Original file, title, slide count, deck |
| slides | Lecture, page number, text, notes, rendered image |
| cards | Deck, type, front/back, source slide, FSRS state, due date |
| drafts | AI-made cards waiting for approval, per slide |
| reviews | Card, grade, seconds taken, time, device; never edited, only added |
| changes | Every change with its device id and time: the log that v2 syncs |

The `reviews` table is the most valuable data: stats, streaks and per-user FSRS tuning are all computed from it.

## Hosting and deploys

The app is a static site, so hosting holds nothing private. Nathan's home server serves it, deployed like his other sites: merge to `main`, wait for the green tick, then press **Update from GitHub** at apps.pacificfish.ca.

- **Deploy form:** the deploy copies a static site's files as they are in the repo, with no build step. If the chosen stack needs a build, the app ships as a small image instead (as the chess site does).
- **Address:** a subdomain such as study.pacificfish.ca, through the existing Cloudflare Tunnel. v1 needs no sign-in to protect data; keeping the site behind Cloudflare Access is a preference.
- **Headers:** a strict Content-Security-Policy, `no-transform` (so Cloudflare injects nothing), and no-cache on the page so an update reaches everyone at once. SQLite's OPFS storage may also need cross-origin isolation headers, depending on which of its modes we use.
- **Sync server (v2):** a small service that stores and returns encrypted blobs per user, with a size limit per user and a sign-in. It holds no keys and can't read anything.
- **No secrets on the server:** each user's AI key stays on their own device.

Nathan sets up the server side (app entry, subdomain) once the skeleton exists.

## Working together

Matt and Nathan each work with Claude Code on their own PC, so the repo itself must hold the rules both Claudes follow.

- **`CLAUDE.md` in the repo:** the stack, how to run and test, the rules below, and decisions made. Personal notes stay in each person's own Claude memory, not the repo.
- **Branches and PRs only:** nobody pushes to `main`. CI runs every test on each PR; the other person reviews and merges. `main` deploys only when someone presses Update.
- **Owners by area** to avoid colliding PRs (to be agreed): for example Matt on slide import and AI, Nathan on scheduling, review screen, storage and hosting.
- **Small PRs, merged often.** A PR open for days drifts from `main` and conflicts.
- **Tests are the contract:** the scheduler and pacing get unit tests with fixed dates; the review screen gets browser tests on phone and desktop sizes. A new rule is proved by a test that fails without it.
- **Privacy is tested too:** tests check that nothing readable is ever sent to the sync server, and that no slide leaves the device unless AI is on for that lecture.
- **Few dependencies:** no scripts, fonts or analytics loaded from other sites at runtime (libraries are copied into the repo), and each new dependency is agreed in its PR.
- **Nothing secret in git:** `.env` files, keys and any test data from real lectures are in `.gitignore` from the first commit.

## Milestones

Each milestone is usable on its own and deployed before the next starts. No dates yet: set them once the stack is chosen.

1. **Skeleton:** `CLAUDE.md`, `.gitattributes`, CI that runs the tests, the static site deployed at the subdomain with its headers, installable and opening offline.
2. **Study by hand:** decks, hand-made cards, FSRS reviews and the review log, in on-device storage, with the change log in place.
3. **Lock it down:** encryption with a passkey or passphrase, the recovery key, persistent storage, backup and restore. Daily use starts here.
4. **Time budget:** per-user timing, new-card pacing over 14 days, the daily ring and streak.
5. **Slides to cards:** PDF in the browser, the AI choice per lecture (own key, local model, none), the approve screen, tap-through to the slide. Then PPTX.
6. **Polish the reward loop:** combos, sounds, XP, stats.
7. **v2, sync:** the sync server, encrypted log upload, QR pairing, the daily reminder.
8. **Later:** Anki import, FSRS fitted per user, exam dates, classmates and shared decks.

## Open questions

Tick each once Matt and Nathan agree, and write the answer under it (then copy it into `CLAUDE.md`).

- [ ] **Stack:** it must run entirely in the browser. Plain JavaScript (like Yagoodle's pages) or TypeScript? A framework, or none? Whether it needs a build step decides static files or a small image.
- [ ] **AI options:** own API key, local model, or both? Which provider(s) first?
- [ ] **Encryption at rest:** encrypt the whole SQLite file, or field by field with slide images as separate encrypted files? Decide when building milestone 3.
- [ ] **Slides in sync (v2):** sync slides too, or only cards and reviews, with slides staying on the device that imported them?
- [ ] **Sync sign-in (v2):** Cloudflare Access for us two, or simple accounts so classmates can join?
- [ ] **Area owners:** who takes which part of the milestones?
- [ ] **Subdomain name:** study.pacificfish.ca, or something else?
- [ ] **Card types beyond Q/A and fill-in-the-blank:** image occlusion (hide part of a diagram)? Worth it in the first version?
- [ ] **App name:** keep AW-Study?
