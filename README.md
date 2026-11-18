# Honed

*(Working name; the repository stays AW-Study.)*

Learn each lecture in the time you have. After a lecture, give Honed the slides and what was
covered; it plans that material into your daily study minutes, shows you the original slides in a
built-in viewer, then quizzes you. Quiz scores decide when each part comes back. Your classes and
slides stay encrypted on your own device.

Status: being rebuilt around lectures and quizzes (Nov 18 redesign). Classes, slides and lectures
work; the planner, the daily checklist and quizzes are next. The plan is in
[docs/DESIGN.md](docs/DESIGN.md) and progress in [docs/PROGRESS.md](docs/PROGRESS.md).

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
