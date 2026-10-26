# Architecture

SkillBridge is deliberately small: **zero npm dependencies**, about 210 KB of front end, and a single Node process. That is a feature: it runs on a cheap server, a laptop, or a school lab machine, and anyone can read all of it.

```mermaid
flowchart LR
  subgraph Browser["Student's browser (works offline)"]
    UI["App (vanilla JS)"]
    LDB[("LocalDB<br/>localStorage<br/>profile, coursework,<br/>evidence copy, drafts,<br/>offline queue, private key")]
    SW["Service worker<br/>app shell + tasks + public key cached"]
    VER["Verifier<br/>Ed25519 via WebCrypto"]
    JM["Job match<br/>(runs on device)"]
    UI --- LDB
    UI --- JM
    UI --- VER
  end
  subgraph Server["SkillBridge server (stateless logic + small shared DB)"]
    API["JSON API"]
    GR["Grader<br/>answer keys, hidden tests<br/>in sandbox, rubric / AI"]
    SIG["Signer<br/>Ed25519 private key"]
    DB[("db.json<br/>signed evidence registry<br/>opt-in portfolios<br/>cohort membership")]
    COH["Cohort aggregator<br/>k-anonymity"]
    API --> GR --> SIG --> DB
    API --> COH --> DB
  end
  UI -- "submit answer + owner key" --> API
  API -- "signed evidence" --> UI
  VER -. "public key (cached)" .- API
  Employer["Employer"] -- "verify link / file" --> VER
  Employer -- "registry lookup (optional)" --> API
  Uni["University"] -- "class code" --> COH
```

## Two databases, one job each

| | LocalDB (browser) | Server DB (`lib/db.js`) |
|---|---|---|
| Holds | profile, coursework, evidence copy, drafts, queue, cache, private key | signed evidence registry, opt-in portfolios, cohort membership |
| Never holds | | names (except inside signed evidence), emails, coursework, drafts, the private key itself (only its SHA-256) |
| Why | personal data stays on the device; works offline | sharing and verification must work for people who are not the student |

A person is linked to their server records by a random key generated in their browser. The server stores only its hash. The key travels in the student's backup file, so restoring a backup restores ownership.

## Trust model: who can do what

- **Only the server** can create valid evidence (it holds the Ed25519 private key).
- **Anyone** can verify evidence with the published public key (`/.well-known/skillbridge-keys.json`), in their browser, offline. The signature covers every field, including the student's name, score, rubric, submission hash and key id.
- **Key rotation:** retired public keys stay in `data/retired-keys/` and keep being published, so old evidence stays verifiable.
- **Not proven:** who did the work, or that it was unaided (see Limitations in the README).

## Request flow: earning evidence

1. Student writes an answer. Drafts autosave to LocalDB. Offline? The answer waits in the queue.
2. `POST /api/submit` with `x-owner-key`. The server grades (mcq/scenario by key, code by hidden tests in a worker + `vm`, written by AI or rubric), and on a pass signs and stores a record.
3. The browser stores its own copy in LocalDB (best score per task).
4. Employer opens `/verify/<id>`: the page checks the signature **locally** with the public key and asks the registry. Or checks a portfolio file fully offline.

## Simulations: a virtual workday for any job

```mermaid
sequenceDiagram
  participant L as Learner (browser plays the script)
  participant S as Server (scores and keys live here)
  participant AI as AI + research tools
  L->>S: POST /api/sims {job}
  S->>AI: research the job, design company + team + 3 day themes (validated)
  L->>S: enrol, then prepare day n
  S->>AI: write the day's script once, shared by everyone (validated, options shuffled)
  L->>S: clock in {shift start, tz}
  S-->>L: public script (no scores or keys) + saved progress
  loop each reply / decision / quiz / task
    L->>S: the choice (or pasted text / screenshot / PDF)
    S->>AI: review work against the rubric (checklist fallback for samples)
    S-->>L: that step's result only
  end
  L->>S: clock out, then certificate after the last day
  S-->>L: signed certificate built from the server's own record
```

- **Script on the browser, truth on the server.** The day's script reaches the browser without scores, answer keys, option feedback or model answers; each answer returns only its own result. A run records every choice, so the certificate cannot be inflated from the browser.
- **Same job system as everything else.** Building a job and writing a day are background jobs (one AI call per day however many learners start it at once), each with a daily budget.
- **Resume anywhere.** Progress is saved per step; reopening the day replays what you did instantly and continues.
- **Reuses the trust model.** The certificate is signed with the same Ed25519 key and verified by the same Verify page; the sample jobs need no AI.

## Learn: courses on any subject

```mermaid
flowchart LR
  L["Learner"] -- "topic (or link)" --> API["POST /api/courses (background job)"]
  API --> R["research.js: gather\n(model searches only if needed,\ncached, budgeted)"]
  R -- "web search / Wikipedia / readPage (SSRF-safe)" --> Web(("Internet"))
  R --> W["courses.js: outline, lesson, quiz writers\nevery AI reply validated"]
  W --> C[("shared courses and lessons")]
  L -- "quiz / final" --> A["assessments: fresh questions,\nanswer keys stay on the server"]
  A -- "pass: signed evidence" --> E[("evidence registry")]
  E -- "all quizzes + final passed?" --> CERT["signed certificate"]
```

- **One job system.** Anything the AI writes runs as a background job (`startJob`): the request returns at once and the page polls `GET /api/jobs/:id`, so no connection is held open for a minute. One job per person at a time; daily budgets cap the cost of each kind of work.
- **Courses are shared, progress is personal.** Course outlines and lessons hold no personal data and serve everyone. Progress, offline lesson copies and certificates live in the learner's browser (`localdb.js`); the server only knows the signed evidence.
- **Certificates come from evidence.** The server issues one only after finding signed, passing evidence for every module quiz and the final in its own registry. It signs the record with the same Ed25519 key, so the Verify page checks it in the browser, offline.
- **Works without AI.** The hand-written sample course (`democourse.js`) ships its lessons and a question bank, so the whole journey runs with no key at all.

## Privacy-by-design choices

- Coursework, drafts and job ads never leave the device (job matching is local).
- Class dashboards need a minimum group size (default 5), show only aggregates, round percentages to 5, and never return names or identifiers.
- One key cannot read or delete another person's records. Erasing yourself removes evidence, portfolio and class membership.
- Strict CSP, no inline scripts, all user text via `textContent`, the practice-test worker has a policy that forbids every network call.

## Low-bandwidth design

~210 KB of app code (about 63 KB gzipped), no frameworks or CDNs, ETag revalidation (a 304 costs a few hundred bytes), service worker caching, local sample tests for instant feedback, offline queue that grades on reconnect.

## Testing

`node --test` runs 90 tests: AI task generation (validation, shuffled answers, reference-solution check, privacy, daily cap, AI-down behaviour), signing and tamper detection, offline verification with only the public key, sandbox escapes and endless loops, grading for all four task types, answer-position balance, LocalDB (quota, blocked storage, backup/restore), owner isolation, persistence across restarts, cohort privacy rules, job-match scoring, ETags, and the service worker in a simulated environment. `npm run smoke` walks the student, employer and university paths on a real server.
