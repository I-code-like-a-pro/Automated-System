# SkillBridge

**Get work experience before your first job.** SkillBridge is a virtual workplace: pick any job (or type one and the AI invents the company, your manager and team), clock in, chat, make decisions, hand in real work for review, clock out, and earn a **signed certificate** with a skill breakdown anyone can verify. Around it sits a course catalogue in the spirit of an online-course site: pick or create a course on **any subject**, read AI-written lessons that use real examples from the web, take quizzes and a final exam, and earn a **certificate anyone can verify**. It also turns what a student learned at university into *verified, employer-checkable evidence of capability*. It is built for the hackathon challenge:

> *How might we help students turn what they learn in university into the practical skills, real-world experience, and verified evidence of capability needed to land their first job?*

It also tackles the low-connectivity track: about **210 KB** of app code (about **63 KB** compressed), **offline-first**, **zero dependencies**.

**Try it in 60 seconds:** `node server.js`, open http://localhost:3000, click **Try the 60-second demo**.

## What it does

| For | Features |
|---|---|
| **Simulations (any job)** | Spend 1 to 3 workdays at a fictional company as a new hire. A manager and teammates chat with you, you choose how to reply, make an urgent trade-off, hand in a deliverable (pasted text, or a screenshot or PDF the AI reads) and get reviewed with specific fixes (one chance to revise), answer an afternoon check-in, and clock out. Punctuality is scored against the shift start you choose and your device clock. Two hand-written sample jobs (Project Manager, Junior Software Engineer) work with no AI. |
| **Learners (any subject)** | Browse the course catalogue or type any topic (nursing, accounting, Spanish, public speaking...) and the AI designs a course. Read lessons with worked examples and sources, take module quizzes and a final exam (fresh questions every attempt), and claim a signed, printable **certificate**. A hand-written sample course works with no AI at all. |
| **Students** | Map coursework to the skills a Junior Software Engineer needs (suggested vs **proven**). Practise 23 built-in workplace tasks (fix a bug, review a pull request, write an incident update, resolve a merge conflict, write code against hidden tests) **plus unlimited fresh tasks written by AI** for any skill. **Job match:** paste any job ad, get a readiness score, the gaps, a ~30-minute practice plan and a tailored, printable **application pack**. |
| **Employers** | Verify evidence by link with no account. The browser checks an **Ed25519 signature against a published public key**, so it works **offline** and the student cannot forge it. Check a whole portfolio file at once. See exactly what was graded, and whether the task was AI-written. |
| **Universities** | An anonymous **class dashboard**: where the cohort is strong, the three biggest gaps, and ready-made exercises to teach next. Unlocks at 5+ students, aggregates only. |

Everything works on weak connections: answers and drafts save on the device, offline submissions queue and are graded and signed when the connection returns, sample tests run locally for instant feedback. (Writing a new AI task needs a connection.)

## Simulations: a virtual workday for any job

The home page. Pick a sample or type any job ("Nurse", "Accountant", "Electrician apprentice").

1. **The AI builds the workplace** (about 10 seconds, researched on the web where it helps): a *fictional* company, a manager and three teammates with believable roles, three workday themes, and what you will learn. It refuses harmful requests; jobs in health, law, finance or safety carry a visible "this is a learning exercise" note.
2. **Enrol** for 1, 2 or 3 days and put your name on the certificate.
3. **Clock in.** You choose your shift start time; arrival is judged early, on time or late against that time and your device clock (the day's script is written the first time it is needed, about 10 to 30 seconds, and shared with everyone after).
4. **Work the day** in a chat-style office: team messages arrive with typing indicators, you pick replies (a clearly best, a middling and a poor option, shuffled), you hand in a deliverable, you make a two-way urgent decision (optionally say why), and you answer an afternoon check-in. Refresh at any time: your progress is saved and the day replays instantly.
5. **Hand in work.** Paste text or attach a PNG, JPG or PDF (the AI reads it). A reviewer in your manager's voice scores it against a rubric and lists the most important fixes; below 80% you may revise once and the better attempt counts. Hand-written samples fall back to a transparent keyword checklist (clearly labelled) if the AI is unavailable; AI-written tasks never get a made-up score.
6. **Clock out, then repeat** for each day. The **certificate** shows job, company (marked as simulated), days, on-time check-ins, overall score, five scored skill rows (punctuality, task quality, decision-making, critical thinking, communication) and a work log. It is signed, so the Verify page checks it in the browser, even offline, and it can be added to LinkedIn, printed or downloaded.

The browser only plays the script: **every score, answer key and the AI's reasoning stay on the server**, which records each choice and builds the certificate from its own record of your run. The certificate says plainly that the company, people and scenarios are fictional, written by AI (or by hand for the samples), and that it is not employment, real work experience or an accredited qualification.

## Learn: courses on any subject, with a certificate

Open **Learn** in the top bar.

1. **Pick or create a course.** Type what you want to learn (or paste the address of a syllabus or article to base it on). The AI designs 3 to 5 modules of 2 to 3 lessons, with learning outcomes, for the level you choose. Courses are shared: once one exists, everyone can use it. Topics asking for something harmful are refused, and health, legal and money topics get a visible disclaimer.
2. **Learn.** A lesson is written the first time anyone opens it (then cached for everyone): an explanation, a worked example, key terms, self-check questions, a recap, and the **sources** the AI used. Lessons are saved on your device for offline reading.
3. **Practise.** Every module has a quiz and the course ends with a final exam. Questions are written fresh by the AI on each attempt (multiple choice, plus short written answers marked against a rubric), so retakes cannot be memorised. Pass mark 70%.
4. **Get certified.** After passing every quiz and the final, you claim a **certificate** with your name, the course, your grade (Pass, Merit, Distinction) and scores. It is signed like all other evidence, so it can be checked on the Verify page by link or ID, in the browser, even offline. Eligibility is decided by the server from signed evidence, never from the browser's word. It says plainly that it shows completion of a course written and marked by AI and is **not an accredited qualification**.

**Sample course.** *Personal Budgeting Basics* is written by hand: its lessons are ready and its quizzes draw from a fixed question bank (reshuffled every attempt). The whole journey including the certificate works with **no AI key and no internet to Google**, which makes it a dependable demo.

### How the AI checks the internet (`lib/research.js`)

Facts and examples are only as good as their sources, so the course writer has research tools and uses them only when needed:

| Tool | What it does |
|---|---|
| `gather` | The main tool. Asks the model to search the web **itself, only if it judges it necessary** (Google Search for Gemini, the `web_search` tool for Claude), then return notes plus the sources it used. For timeless topics it answers without searching. Results are cached for 12 hours, a daily budget caps the cost (`RESEARCH_DAILY_LIMIT`), and the lesson shows which sources were used. |
| `wikipedia` | A key-less fallback when live search is unavailable. A hit is kept only if it is really about the topic, so you get no sources rather than wrong ones. |
| `readPage` | Reads one public web page, used when you base a course on a link. Hardened against server-side request forgery: only http(s) on ports 80/443, every address must be public (private, loopback and cloud-metadata ranges are refused), DNS is pinned so a lookup cannot be re-pointed, redirects are re-checked, and size and time are capped. |

Anything fetched from the web is passed to the model as *data* with an instruction to ignore directions inside it.

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
npm test                # 90 tests (never touches a real AI service)
npm run smoke           # student + employer + university walkthrough on a real server
```

| Variable | Purpose |
|---|---|
| `PORT` | Port (default 3000) |
| `DATA_DIR` | Where `db.json` and `signing-key.pem` live (default `./data`). Keep this on a persistent disk in production |
| `SIGNING_KEY_PEM` | Provide the Ed25519 private key inline instead of a file |
| `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` | Turns on the AI (see above). Server-side only. Put it in `.env`; values in `.env` win over machine-wide variables. Anthropic is used if both are set, or choose with `AI_PROVIDER=gemini` or `anthropic` |
| `AI_MODEL` / `AI_GEN_MODEL` | Model(s) for marking and for writing tasks. A comma-separated list sets a fallback order |
| `SIM_DAILY_LIMIT` / `SIMDAY_DAILY_LIMIT` | Daily caps on new simulations (60) and newly written workdays (300) |
| `GEN_DAILY_LIMIT` | Most AI-written practice tasks per day across everyone (default 300), to cap cost |
| `COURSE_DAILY_LIMIT` / `LESSON_DAILY_LIMIT` / `QUIZ_DAILY_LIMIT` / `RESEARCH_DAILY_LIMIT` | Daily caps on new courses (60), newly written lessons (600), newly written quizzes (600) and web research calls (200) |
| `SAMPLE_COURSE` | `0` removes the hand-written sample course and sample simulations from the catalogue |
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
| Holds | profile, coursework, their evidence and certificates, course progress, offline copies of lessons, drafts, offline queue, caches, a private key | signed evidence registry, certificates, opt-in portfolios, class membership, shared courses and lessons (no personal data), AI-written tasks and quizzes in progress with their answer keys |
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
| `POST /api/generate` | (owner key) AI writes a new practice task for a skill; validated, stored with its answer key on the server, returned without answers. Answers `202` with a job |
| `GET /api/sims`, `GET /api/sims/:id`, `POST /api/sims` | Simulation catalogue, one job (people, skills, day themes: never scripts or scores), and (owner key) AI builds a new job. Background job |
| `POST /api/sims/:id/runs`, `GET /api/runs`, `GET /api/runs/:runId` | (owner key) enrol, list your runs, resume one |
| `POST /api/runs/:runId/days/:n/prepare`, `GET /api/runs/:runId/days/:n` | (owner key) make sure the day's script exists (background job if the AI must write it), or fetch the public script and your saved progress |
| `POST /api/runs/:runId/days/:n/clockin`, `.../steps/:i`, `.../clockout` | (owner key) clock in, answer one step (reply, decision, quiz, or submit work for review), clock out. The server returns each result only after you answer |
| `POST /api/runs/:runId/certificate` | (owner key) the signed certificate once every day is finished |
| `GET /api/courses`, `GET /api/courses/:id` | Public course catalogue (searchable with `?q=`) and one course outline |
| `POST /api/courses` | (owner key) AI designs a course from a topic (and optionally a link). Background job |
| `POST /api/courses/:id/lessons/:lessonId` | (owner key) a lesson: instant if already written, otherwise a background job |
| `POST /api/courses/:id/assessments`, `POST /api/assessments/:attemptId/submit` | (owner key) start a module quiz or the `final` exam (fresh questions, no answers sent), then submit answers: graded here, signed evidence on a pass |
| `GET /api/courses/:id/progress`, `POST /api/courses/:id/certificate` | (owner key) your passes from the signed registry, and the signed certificate once every quiz and the final are passed |
| `GET /api/jobs/:jobId` | (owner key) poll a background job: `working`, `done` with its result, or `error` |
| `GET/DELETE /api/mine` | (owner key) re-sync (evidence and your AI-written tasks) or erase your server records |
| `POST /api/publish`, `GET /api/portfolio/:id` | opt-in public portfolio |
| `GET /api/verify/:id`, `POST /api/verify` | verify by id, or check records you send |
| `POST /api/cohort/join` / `leave`, `GET /api/cohort/mine`, `GET /api/cohort/:code` | voluntary classes and anonymous dashboard |
| `POST /api/demo` | one-click demo student and demo class (see `DEMO`) |

## Project map

`server.js` API + static hosting · `lib/` **simulation engine (`sim.js`), hand-written sample jobs (`simsamples.js`)**, grader (`grade.js`), sandbox, signer, AI provider layer (`llm.js`), AI marking (`ai.js`), AI practice-task writer (`generate.js`), **course engine (`courses.js`), web research tools (`research.js`), hand-written sample course (`democourse.js`)**, `.env` reader, database, cohort aggregator, demo data · `public/` the app (`app.js`, **`sim.js`**, `learn.js`, `localdb.js`, `verifier.js`, `jobmatch.js`, `skills.js`, `share.js`, `sw.js`, `runner.js`) · `data/` roles and tasks as plain JSON · `test/` 90 tests · `scripts/` smoke test and content tools · `docs/` architecture and pitch kit ([docs/PITCH.md](docs/PITCH.md): demo script, Q&A, metrics, roadmap).

**Adding a role or task** is data work: add skills (with `hints` for coursework and `jobHints` for ads) to `data/roles.json`, tasks to `data/tasks.json` (`mcq`, `scenario`, `code` with hidden tests, `written` with a rubric). Run `node scripts/rebalance-answers.js` to spread answer positions, then `npm test`. AI-written tasks need no data work.

## Limitations (please read)

- **Not proctored.** Anyone can get help or use an AI assistant. Treat evidence as one signal, best paired with a live conversation. Roadmap: timed attempts, randomised variants, similarity checks, mentor attestation.
- **Job match is a transparent keyword analysis, not a hiring prediction.** It also names tools in an ad that SkillBridge does not assess (SQL, Docker, ...), so "100% ready" never reads as "hired".
- **Simulations are practice, not real work experience.** Companies and people are fictional and scenarios are written by AI (or by hand for the samples) and not reviewed by a person; AI reviews of submitted work are judgement, not a guarantee. Punctuality is measured against a start time you choose and your own device clock, so it is a self-discipline signal, not proof. Reading images and PDFs needs the AI. The server keeps your run (choices and scores, tied to a hashed random key) so the certificate can be built; erasing yourself removes it. Only the hand-written samples have been played end to end in a browser by hand; AI-built jobs were checked through the API (a job and a first workday for "Customer support agent" validated on the first try).
- **AI-made courses are not reviewed by a person and certificates are not accredited.** A course can contain mistakes (the lesson shows its sources so learners can check). The certificate says it shows completion of a course written and marked by AI. Anyone can create a course on a harmless topic; the AI refuses harmful ones, but that is a best effort, not moderation. Run it behind sign-in or review before opening it to the public.
- **Free AI plans run out.** The AI key used while building was on Google's free tier, whose daily quota ran out during testing: stronger models were blocked for hours, live web search was unavailable, and a full live run could not be finished. The server then falls back to other models, to Wikipedia (research) or to "try again" (marking), and the sample course keeps working. For real use, use a key with billing enabled and set the daily caps.
- **Live web research is only tested at small scale.** A real search-grounded run was blocked by that quota. The code path is tested with mocked replies (Gemini and Claude response shapes) and the Wikipedia fallback and page reader were tested live. DuckDuckGo blocks scripted searches, so it is not used.
- **AI-written tasks and marks have not been reviewed by a person.** Validation catches broken or unfair tasks, but not every subtle mistake. AI marking of writing is judgement, not a guarantee: it can be harsh, generous or inconsistent. Use it for practice and as one signal.
- **The AI is only lightly tested live, and only on Gemini.** One real run covered all four task types, marking (a strong answer scored 100, weak ones low, a prompt-injection attempt scored 4) and the whole journey through a public link. Anthropic support is tested with mocked replies only. Google overloads and retires models often, so marking sometimes returns "try again" and writing a task can take 10 to 45 seconds.
- **The offline checklist cannot judge writing like a person.** It covers the built-in written tasks when no AI key is set; it penalises keyword stuffing and repetition but can be gamed.
- **localStorage can be lost** (cleared data, another browser). Backups matter; the app reminds students every 14 days and asks the browser to keep the data.
- **The grader sandbox uses Node's `vm`, not a hardened boundary.** Fine for a pilot where students run their own code; use a container or separate low-privilege service for open deployment.
- The JSON-file database suits a pilot (thousands of students, one process). Swap `lib/db.js` for SQLite/Postgres to scale.
- **Job match and the skill map are still built around one role (Junior Software Engineer).** Courses work for any subject, but turning an arbitrary course into a job-readiness map is not built. Demo and class data are synthetic.
- **Not verified in a real browser here:** installing the PWA and offline behaviour. The service worker's logic is tested in a simulated worker, but test install and offline in Chrome before a live demo.
