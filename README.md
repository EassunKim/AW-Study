# Honed

*(Working name; the repository stays AW-Study.)*

Learn each lecture in the time you have. After a lecture, give Honed the slides and what was
covered; it plans that material into your daily study minutes, shows you the original slides in a
built-in viewer, then quizzes you. Quiz scores decide when each part comes back.

## Privacy

Your classes and slides are encrypted on your own device, with a key only your passkey, passphrase or recovery
key opens. A device can remember you after one unlock, so it opens straight in. You can sign in with Google
(testers only for now), which on its own never unlocks anything. If you choose **Google unlock**, a Google
sign-in can open Honed instead of a passkey, but then our server keeps a key that could open your data: it's off
unless you turn it on. AI features send only the text they need to our own helper, which keeps nothing. Syncing
between your devices (classes, lectures, quizzes and notes; slide PDFs not yet) is opt-in and encrypted the same way. The details, including what each piece can and can't see, are
in [docs/SECURITY.md](docs/SECURITY.md).

## Status

Live for testers: classes, slides and lectures, the planner and daily Tasks with Play, AI-made quizzes, exams
that pull their sections forward, the slide viewer with notes and highlights, backups, accounts with Google unlock, and sync between devices.
Next: slide PDFs in sync. The plan is in [docs/DESIGN.md](docs/DESIGN.md) and progress in [docs/PROGRESS.md](docs/PROGRESS.md).

## Run it

Needs Node 24 or newer.

```sh
npm install
npx playwright install chromium webkit   # browsers for the tests, once
npm run dev                               # http://localhost:5173
npm test                                  # all tests
```

Contributors: read [CLAUDE.md](CLAUDE.md) for the rules (it's written for Claude Code, and for people).

## License

Proprietary. All rights reserved. See [LICENSE](LICENSE).
