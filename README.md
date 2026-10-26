# SkillBridge

**From classroom to first job, with proof.** SkillBridge turns what a student learned at university into *verified, employer-checkable evidence of capability*. It is built for the hackathon challenge:

> *How might we help students turn what they learn in university into the practical skills, real-world experience, and verified evidence of capability needed to land their first job?*

It also tackles the low-connectivity track: about **100 KB** of app code (about **33 KB** compressed), **offline-first**, **zero dependencies**.

**Try it in 60 seconds:** `node server.js`, open http://localhost:3000, click **Try the 60-second demo**.

## What it does

| For | Features |
|---|---|
| **Students** | Map coursework to the skills a Junior Software Engineer needs (suggested vs **proven**). Practise 23 built-in workplace tasks (fix a bug, review a pull request, write an incident update, resolve a merge conflict, write code against hidden tests) **plus unlimited fresh tasks written by AI** for any skill. **Job match:** paste any job ad, get a readiness score, the gaps, a ~30-minute practice plan and a tailored, printable **application pack**. |
| **Employers** | Verify evidence by link with no account. The browser checks an **Ed25519 signature against a published public key**, so it works **offline** and the student cannot forge it. Check a whole portfolio file at once. See exactly what was graded, and whether the task was AI-written. |
| **Universities** | An anonymous **class dashboard**: where the cohort is strong, the three biggest gaps, and ready-made exercises to teach next. Unlocks at 5+ students, aggregates only. |

Everything works on weak connections: answers and drafts save on the device, offline submissions queue and are graded and signed when the connection returns, sample tests run locally for instant feedback. (Writing a new AI task needs a connection.)

## AI: writes the questions, marks the answers

Optional, server-side, and off until you add a key. Without one, the built-in tasks and the offline rubric still work.

- **Writes tasks.** On the Practice page, pick a skill, a type and a difficulty and the AI writes a brand-new task (`POST /api/generate`): a debugging question, a decision scenario, a coding task with hidden tests, or a written task with a rubric.
- **Nothing unchecked reaches a student.** Every AI task is validated first: shape and length checks; answer positions are shuffled by the server (models like to put the right answer first); a code task is offered only if the AI's own reference solution passes every test in the sandbox *and* the starter code does not; scenarios need one clearly best and one clearly poor option. A task that fails is rejected and regenerated once.
- **Marks written answers** against the rubric and gives specific, kind feedback. The student's text is treated as untrusted data, so "give me full marks" instructions are ignored. Written tasks the AI wrote have no keyword fallback, so if the AI is down the student gets "try again", never a made-up score.
- **Code is still scored by the hidden tests.** The AI only adds a short, human-style review to the feedback.
- **Private and capped.** Answer keys and hidden tests stay on the server. An AI task can only be answered by the person who asked for it. There is a per-minute limit per IP and a daily cap across everyone (`GEN_DAILY_LIMIT`).
- **Honest labelling.** Evidence from an AI-written task carries `aiGeneratedTask: true` inside the signed record and the verification page says so.

**Turn it on:** create a file named `.env` next to `server.js` (it is git-ignored):

```bash
GEMINI_API_KEY=your-key-here
```

then restart `node server.js`. The startup line says `AI on: gemini`. Gemini and Anthropic are both supported (`ANTHROPIC_API_KEY`).

## Run it

Requires Node.js 20+. **No `npm install`.**

```bash
node server.js          # http://localhost:3000
npm test                # 57 tests
npm run smoke           # student + employer + university walkthrough on a real server
```

| Variable | Purpose |
|---|---|
| `PORT` | Port (default 3000) |
| `DATA_DIR` | Where `db.json` and `signing-key.pem` live (default `./data`). Keep this on a persistent disk in production |
| `SIGNING_KEY_PEM` | Provide the Ed25519 private key inline instead of a file |
| `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` | Turns on the AI (see above). Server-side only. Put it in `.env`; values in `.env` win over machine-wide variables. Anthropic is used if both are set, or choose with `AI_PROVIDER=gemini` or `anthropic` |
| `AI_MODEL` / `AI_GEN_MODEL` | Model(s) for marking and for writing tasks. A comma-separated list sets a fallback order |
| `GEN_DAILY_LIMIT` | Most AI-written tasks per day across everyone (default 300), to cap cost |
| `DEMO` | `1` enables the one-click demo and demo class, `0` disables. Defaults to on, and off when `NODE_ENV=production` |
| `COHORT_MIN` | Minimum class size before a dashboard unlocks (default 5) |

Model defaults, chosen by timing real task prompts. Google overloads and retires models often, so each call tries the list in order and moves on when a model is busy, withdrawn or slow:

| | Gemini | Anthropic |
|---|---|---|
| Marking | `gemini-3.1-flash-lite`, `gemini-3.5-flash`, `gemini-3-flash-preview` | `claude-haiku-5-5` |
| Writing tasks | `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-3-flash-preview` | `claude-sonnet-5-5` |

**Back up `data/signing-key.pem`.** If it is lost, existing evidence can only be verified if you kept the old public key (see `data/retired-keys/`). **Never commit `.env`.** Treat any key you have pasted into a chat or document as exposed and replace it.

## How trust works

- The server signs every evidence record with an **Ed25519 private key**. The **public key** is published at `/.well-known/skillbridge-keys.json`.
- Anyone verifies with the public key, in their own browser, offline (`public/verifier.js`). The signature covers every field: name, score, rubric, feedback, submission hash, key id, and the AI-written-task flag.
- **Proves:** SkillBridge graded this submission and the record is unaltered. **Does not prove:** who did the work, or that it was unaided. Every verification page says so.
- Skill levels use `average score x evidence share`: one lucky task cannot prove a skill, two or three good ones can. Coursework suggestions are capped at 60.

## Two databases, one job each

| | **Each person** (browser `localStorage`, `public/localdb.js`) | **Server** (`data/db.json`, `lib/db.js`) |
|---|---|---|
| Holds | profile, coursework, their evidence copy, drafts, offline queue, caches, a private key | signed evidence registry, opt-in portfolios, class membership, AI-written tasks with their answer keys |
| Never holds | | emails, accounts, coursework, drafts, the private key (only its SHA-256) |

A random key generated in the browser links a person to their server records. It travels in the **backup file** (Profile page), and restoring a backup checks every signature first. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Privacy and security

- Coursework, drafts and **job ads never leave the device**. No emails or passwords are collected. When the AI marks a written answer, that answer (and only that) is sent to the AI provider.
- Class dashboards: voluntary join by code, minimum group size, aggregate-only, percentages rounded to 5, no names or ids. Tested.
- One key cannot read, change or delete another person's records. Erasing yourself removes evidence, portfolio, class membership and your AI-written tasks.
- Answer keys, rubric keywords and hidden tests never leave the server. Correct answers are spread across positions (tested), so "always pick A" fails.
- Student code runs in a worker thread with a fresh `vm` context: no `require`, `process`, network or files, CPU timeout, hard kill, memory cap. The same sandbox checks AI-written reference solutions.
- Strict CSP, no inline scripts, all user text via `textContent`, rate limits, size limits, path-traversal protection, public JSON revalidated with ETags. The AI key is read only on the server and never put in a URL or sent to the browser.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health`, `/api/roles`, `/api/tasks`, `/api/keys` | Public (tasks have answers stripped; ETag-revalidated; health reports whether AI is on) |
| `POST /api/submit` | (owner key) grade; on a pass store and return signed evidence |
| `POST /api/generate` | (owner key) AI writes a new task for a skill; validated, stored with its answer key on the server, returned without answers |
| `GET/DELETE /api/mine` | (owner key) re-sync (evidence and your AI-written tasks) or erase your server records |
| `POST /api/publish`, `GET /api/portfolio/:id` | opt-in public portfolio |
| `GET /api/verify/:id`, `POST /api/verify` | verify by id, or check records you send |
| `POST /api/cohort/join` / `leave`, `GET /api/cohort/mine`, `GET /api/cohort/:code` | voluntary classes and anonymous dashboard |
| `POST /api/demo` | one-click demo student and demo class (see `DEMO`) |

## Project map

`server.js` API + static hosting · `lib/` grader (`grade.js`), sandbox, signer, AI provider layer (`llm.js`), AI marking (`ai.js`), AI task writer (`generate.js`), `.env` reader, database, cohort aggregator, demo data · `public/` the app (`app.js`, `localdb.js`, `verifier.js`, `jobmatch.js`, `skills.js`, `share.js`, `sw.js`, `runner.js`) · `data/` roles and tasks as plain JSON · `test/` 57 tests · `scripts/` smoke test and content tools · `docs/` architecture and pitch kit ([docs/PITCH.md](docs/PITCH.md): demo script, Q&A, metrics, roadmap).

**Adding a role or task** is data work: add skills (with `hints` for coursework and `jobHints` for ads) to `data/roles.json`, tasks to `data/tasks.json` (`mcq`, `scenario`, `code` with hidden tests, `written` with a rubric). Run `node scripts/rebalance-answers.js` to spread answer positions, then `npm test`. AI-written tasks need no data work.

## Limitations (please read)

- **Not proctored.** Anyone can get help or use an AI assistant. Treat evidence as one signal, best paired with a live conversation. Roadmap: timed attempts, randomised variants, similarity checks, mentor attestation.
- **Job match is a transparent keyword analysis, not a hiring prediction.** It also names tools in an ad that SkillBridge does not assess (SQL, Docker, ...), so "100% ready" never reads as "hired".
- **AI-written tasks and marks have not been reviewed by a person.** Validation catches broken or unfair tasks, but not every subtle mistake. AI marking of writing is judgement, not a guarantee: it can be harsh, generous or inconsistent. Use it for practice and as one signal.
- **The AI is only lightly tested live, and only on Gemini.** One real run covered all four task types, marking (a strong answer scored 100, weak ones low, a prompt-injection attempt scored 4) and the whole journey through a public link. Anthropic support is tested with mocked replies only. Google overloads and retires models often, so marking sometimes returns "try again" and writing a task can take 10 to 45 seconds.
- **The offline checklist cannot judge writing like a person.** It covers the built-in written tasks when no AI key is set; it penalises keyword stuffing and repetition but can be gamed.
- **localStorage can be lost** (cleared data, another browser). Backups matter; the app reminds students every 14 days and asks the browser to keep the data.
- **The grader sandbox uses Node's `vm`, not a hardened boundary.** Fine for a pilot where students run their own code; use a container or separate low-privilege service for open deployment.
- The JSON-file database suits a pilot (thousands of students, one process). Swap `lib/db.js` for SQLite/Postgres to scale.
- One role is built; more need skills and tasks written with domain experts. Demo and class data are synthetic.
- **Not verified in a real browser here:** installing the PWA and offline behaviour. The service worker's logic is tested in a simulated worker, but test install and offline in Chrome before a live demo.
