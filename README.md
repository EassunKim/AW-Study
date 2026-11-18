# Honed

*(Working name; the repository stays AW-Study.)*

Spaced repetition for lecture content. Set a daily time budget, turn lecture slides into cards
(written by hand, or drafted by AI and approved by you), and review them at the right moments with
[FSRS](https://github.com/open-spaced-repetition). Your slides and cards stay on your own device.

Status: early. The skeleton (installable, works offline) is in place; studying arrives next.
The plan is in [docs/DESIGN.md](docs/DESIGN.md).

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
