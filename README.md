# SkillBridge

**From classroom to first job, with proof.** SkillBridge turns what a student learned at university into *verified, employer-checkable evidence of capability*. It is built for the hackathon challenge:

> *How might we help students turn what they learn in university into the practical skills, real-world experience, and verified evidence of capability needed to land their first job?*

It also tackles the low-connectivity track: about **95 KB** of app code (about **28 KB** compressed), **offline-first**, **zero dependencies**.

**Try it in 60 seconds:** `node server.js`, open http://localhost:3000, click **Try the 60-second demo**.

## What it does

| For | Features |
|---|---|
| **Students** | Map coursework to the skills a Junior Software Engineer needs (suggested vs **proven**). Practise 23 workplace tasks: fix a bug, review a pull request, write an incident update, resolve a merge conflict, write code against hidden tests. **Job match:** paste any job ad, get a readiness score, the gaps, a ~30-minute practice plan and a tailored, printable **application pack**. |
| **Employers** | Verify evidence by link with no account. The browser checks an **Ed25519 signature against a published public key**, so it works **offline** and the student cannot forge it. Check a whole portfolio file at once. See exactly what was graded. |
| **Universities** | An anonymous **class dashboard**: where the cohort is strong, the three biggest gaps, and ready-made exercises to teach next. Unlocks at 5+ students, aggregates only. |

Everything works on weak connections: answers and drafts save on the device, offline submissions queue and are graded and signed when the connection returns, sample tests run locally for instant feedback.

## Run it

Requires Node.js 20+. **No `npm install`.**

```bash
node server.js          # http://localhost:3000
npm test                # 43 tests
npm run smoke           # student + employer + university walkthrough on a real server
```

Or with Docker (untested here, see note): `docker compose up --build`.

| Variable | Purpose |
|---|---|
| `PORT` | Port (default 3000) |
| `DATA_DIR` | Where `db.json` and `signing-key.pem` live (default `./data`). **Mount a volume here in production** |
| `SIGNING_KEY_PEM` | Provide the Ed25519 private key inline instead of a file |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Optional AI feedback for written tasks (server-side only; default model `claude-haiku-5-5`) |
| `DEMO` | `1` enables the one-click demo and demo class, `0` disables. Defaults to on, and off when `NODE_ENV=production` |
| `COHORT_MIN` | Minimum class size before a dashboard unlocks (default 5) |

**Back up `data/signing-key.pem`.** If it is lost, existing evidence can only be verified if you kept the old public key (see `data/retired-keys/`).

## How trust works

- The server signs every evidence record with an **Ed25519 private key**. The **public key** is published at `/.well-known/skillbridge-keys.json`.
- Anyone verifies with the public key, in their own browser, offline (`public/verifier.js`). The signature covers every field: name, score, rubric, feedback, submission hash, key id.
- **Proves:** SkillBridge graded this submission and the record is unaltered. **Does not prove:** who did the work, or that it was unaided. Every verification page says so.
- Skill levels use `average score x evidence share`: one lucky task cannot prove a skill, two or three good ones can. Coursework suggestions are capped at 60.

## Two databases, one job each

| | **Each person** (browser `localStorage`, `public/localdb.js`) | **Server** (`data/db.json`, `lib/db.js`) |
|---|---|---|
| Holds | profile, coursework, their evidence copy, drafts, offline queue, caches, a private key | signed evidence registry, opt-in portfolios, class membership |
| Never holds | | emails, accounts, coursework, drafts, the private key (only its SHA-256) |

A random key generated in the browser links a person to their server records. It travels in the **backup file** (Profile page), and restoring a backup checks every signature first. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Privacy and security

- Coursework, drafts and **job ads never leave the device**. No emails or passwords are collected.
- Class dashboards: voluntary join by code, minimum group size, aggregate-only, percentages rounded to 5, no names or ids. Tested.
- One key cannot read, change or delete another person's records. Erasing yourself removes evidence, portfolio and class membership.
- Answer keys, rubric keywords and hidden tests never leave the server. Correct answers are spread across positions (tested), so "always pick A" fails.
- Student code runs in a worker thread with a fresh `vm` context: no `require`, `process`, network or files, CPU timeout, hard kill, memory cap.
- Strict CSP, no inline scripts, all user text via `textContent`, rate limits, size limits, path-traversal protection, public JSON revalidated with ETags.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health`, `/api/roles`, `/api/tasks`, `/api/keys` | Public (tasks have answers stripped; ETag-revalidated) |
| `POST /api/submit` | (owner key) grade; on a pass store and return signed evidence |
| `GET/DELETE /api/mine` | (owner key) re-sync or erase your server records |
| `POST /api/publish`, `GET /api/portfolio/:id` | opt-in public portfolio |
| `GET /api/verify/:id`, `POST /api/verify` | verify by id, or check records you send |
| `POST /api/cohort/join` / `leave`, `GET /api/cohort/mine`, `GET /api/cohort/:code` | voluntary classes and anonymous dashboard |
| `POST /api/demo` | one-click demo student and demo class (see `DEMO`) |

## Project map

`server.js` API + static hosting · `lib/` grader, sandbox, signer, AI, database, cohort aggregator, demo data · `public/` the app (`app.js`, `localdb.js`, `verifier.js`, `jobmatch.js`, `skills.js`, `share.js`, `sw.js`, `runner.js`) · `data/` roles and tasks as plain JSON · `test/` 43 tests · `scripts/` smoke test and content tools · `docs/` architecture and pitch kit ([docs/PITCH.md](docs/PITCH.md): demo script, Q&A, metrics, roadmap).

**Adding a role or task** is data work: add skills (with `hints` for coursework and `jobHints` for ads) to `data/roles.json`, tasks to `data/tasks.json` (`mcq`, `scenario`, `code` with hidden tests, `written` with a rubric). Run `node scripts/rebalance-answers.js` to spread answer positions, then `npm test`.

## Limitations (please read)

- **Not proctored.** Anyone can get help or use an AI assistant. Treat evidence as one signal, best paired with a live conversation. Roadmap: timed attempts, randomised variants, similarity checks, mentor attestation.
- **Job match is a transparent keyword analysis, not a hiring prediction.** It also names tools in an ad that SkillBridge does not assess (SQL, Docker, ...), so "100% ready" never reads as "hired".
- **The offline checklist cannot judge writing like a person.** It penalises keyword stuffing and repetition but can be gamed. AI scoring or a human reviewer is better for high-stakes use.
- **AI grading was not tested against the live API** (only a mocked response and the failure fallback).
- **localStorage can be lost** (cleared data, another browser). Backups matter; the app reminds students every 14 days and asks the browser to keep the data.
- **The grader sandbox uses Node's `vm`, not a hardened boundary.** Fine for a pilot where students run their own code; use a container or separate low-privilege service for open deployment.
- The JSON-file database suits a pilot (thousands of students, one process). Swap `lib/db.js` for SQLite/Postgres to scale.
- One role is built; more need tasks written with domain experts. Demo and class data are synthetic.
- **Not verified in a real browser here:** installing the PWA and offline behaviour. The service worker's logic is tested in a simulated worker, but test install and offline in Chrome before a live demo. The Docker files were not built here.
#   A u t o m a t e d - S y s t e m  
 