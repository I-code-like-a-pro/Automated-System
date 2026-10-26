# SkillBridge: pitch kit

**Challenge (Track 2):** *How might we help students turn what they learn in university into the practical skills, real-world experience, and verified evidence of capability needed to land their first job?*

## One sentence

SkillBridge turns a graduate's coursework into **proven, employer-checkable skills**: practise real workplace tasks, see exactly how ready you are for a real job ad, and carry tamper-proof evidence that anyone can verify in seconds, even offline.

## The problem (say it in 20 seconds)

Graduates are asked for experience they cannot get without a job. What they do have, a degree and a list of courses, tells an employer little about what they can actually do. Employers cannot tell candidates apart, and universities rarely learn which skills their graduates are missing until it is too late.

> Add one cited statistic from your own research here (for example from a labour-market or graduate-employability report for your country). **Do not quote a number you have not verified.**

## The solution: three audiences, one loop

| | What they get | Where to see it |
|---|---|---|
| **Student** | See the gap between coursework and job skills; practise 23 workplace tasks (fix a bug, review a pull request, write an incident update, resolve a merge conflict); paste any job ad and get a readiness score, the gaps, a 30-minute practice plan and a tailored application pack | Dashboard, Job match, Practice |
| **Employer** | Verify evidence in seconds with no account. The browser checks an **Ed25519 signature against a published public key**, so it works **offline** and cannot be forged by the student. See the rubric that was graded | Verify |
| **University** | An anonymous class dashboard: which skills the cohort lacks, plus ready-made exercises to close the gap. Appears only when 5+ students join; never shows names or scores | `/#/cohort/<code>` |

## What makes it different

1. **Evidence, not certificates.** Most certificates prove completion. SkillBridge issues *graded, signed* records: hidden tests for code, a rubric for writing, decision quality for scenarios.
2. **Verifiable without trusting us in the moment.** Public-key signatures mean an employer's own browser can check a portfolio offline. Edit one character and verification fails (try it live).
3. **Job-first, not course-first.** The job-match engine starts from a real ad and works backwards to what the student needs to prove. The ad never leaves the device.
4. **Built for poor connectivity.** About 100 KB of app code (33 KB compressed), offline-first, answers queue and grade on reconnect, sample tests run locally, ETag revalidation keeps updates tiny.
5. **Privacy by design.** Personal data lives in the student's own browser. The server keeps only signed evidence and opt-in portfolios, tied to a hashed random key. No emails, no accounts, no passwords.
6. **Honest about its limits.** Every verification page says what it proves (graded and unaltered) and what it does not (who did the work). Readiness is guidance, not a hiring prediction.

## Demo script (3 minutes)

Start the server (`node server.js`, demo is on by default) and open the app in a fresh browser profile.

| Time | Do | Say |
|---|---|---|
| 0:00 | Landing page. Click **Try the 60-second demo** | "This loads a student with real, signed evidence. Nothing is faked: the tasks were graded by the same code a real student uses." |
| 0:20 | Dashboard: skill map | "Grey is what their coursework suggests. Teal is what they have *proven*. The tick is what employers expect. That gap is the product." |
| 0:45 | **Job match** > click the first example ad | "Paste any real ad. 9 skills found. Readiness is the share of what the ad needs that she has proven. Here is the 30-minute plan to close the gap. The ad never leaves her device." |
| 1:15 | **Build my application pack** | "A pack with only the evidence relevant to this job, printable, or a file employers can check offline." |
| 1:35 | **Verify** (open an evidence link from Portfolio) | "Two independent checks: the registry, and the signature checked right here in the browser with a public key." |
| 1:55 | Turn the network off (devtools > Network > Offline). Open Verify, upload the downloaded pack file, include a tampered copy | "Fully offline. The genuine record passes, the edited score is caught." |
| 2:25 | `#/cohort/DEMO-UNI-2026` | "Universities see class-wide gaps (testing, code review, security) with exercises to teach next. Anonymous, only above five students." |
| 2:50 | Close | "Three audiences, one loop, zero server-side personal data. It runs on a school lab PC." |

Backup plan if the network misbehaves: run `npm run smoke` and show the passing checklist.

## Questions you will be asked

**How do you stop cheating or students using AI?** We do not claim to. Evidence proves *this was graded and not altered*, not who typed it. Mitigations built in: hidden tests and randomised answer positions defeat memorising or sharing keys; the roadmap adds timed attempts, randomised variants and similarity checks. For high-stakes hiring we recommend pairing evidence with a short live follow-up, and the verification page says so.

**Why would an employer trust it?** They do not have to trust a claim on a CV: they can verify a signature themselves, and read the rubric. Trust in the *tasks* grows with employer co-design, which is the first thing we would do in a pilot.

**Where does AI fit?** Two jobs, both server-side and optional. (1) It writes fresh tasks for any skill, so practice never runs out. Every task is validated before a student sees it: answer positions are shuffled, and a code task is only offered if a reference solution passes all of its tests and the starter does not. (2) It marks written tasks against a rubric and reviews code. Evidence from AI-written tasks is labelled as such inside the signed record. **Does the AI decide anything?** Optional. Without an API key, written tasks use a transparent rubric checklist. With a key, AI scores against the same rubric. Code, debugging and scenario tasks are still scored by hidden tests or an answer key, never by AI opinion. All scoring is shown to the student.

**What about privacy?** Coursework, drafts and job ads stay on the device. The server stores signed evidence tied to a hashed random key, and opt-in portfolios. Students can erase everything. Class dashboards need 5+ students and show only rounded aggregates.

**Can it scale?** The pilot design uses one process and a JSON file. The data model is small and every request is cheap; the next step is swapping `lib/db.js` for SQLite or Postgres. Content is plain JSON, so new roles are data work, not code.

**How would it make money / stay alive?** Hypotheses to test in the pilot: employers pay for verification and candidate discovery, universities license the dashboard, students are always free. Grants and NGO partnerships fund the first roles.

**What did you build versus reuse?** Everything here is original code with no runtime dependencies: grader, sandbox, signing and offline verification, local database, job-match engine, cohort aggregator, service worker, tests.

## What to measure in a pilot

- Time from sign-up to first piece of evidence (target: under 15 minutes)
- Skills moved from "suggested" to "verified" per student
- Share of students who run the job-match and then complete a recommended task
- Employer verification views per shared link, and interview invitations
- Class-level gap movement between terms
- Offline use: answers queued and later synced successfully

## Roadmap

1. **Employer co-design:** employers contribute tasks and skill requirements for their roles
2. **More roles:** data analyst, product manager, designer (content with domain experts)
3. **Higher-assurance mode:** timed attempts, randomised variants, optional mentor attestation
4. **Reach:** local-language content, SMS/USSD-style access for very low bandwidth, shared-device mode
5. **Interoperability:** export evidence as Open Badges / W3C Verifiable Credentials
6. **Hardening:** container-isolated grader, SQLite/Postgres, key rotation tooling

## Honest limitations (put these on a slide, it builds trust)

Not proctored. The offline checklist cannot judge writing like a person. Browser storage can be lost without a backup. Only one role is built. AI grading was not tested against the live API. The grader sandbox is fine for a pilot, not for open public deployment without a container.
