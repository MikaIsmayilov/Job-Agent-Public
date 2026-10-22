# Job Agent

Personal job-search agent for one user, run locally with Claude Code. It scrapes real postings from job boards and company career sites, scores them against the user's resume and targets, shows them in a private dashboard, tailors resumes and cover letters per job, and tracks outcomes.

**First check:** if `data/profile.json` has an empty `displayName` or no `roleFamilies`, the user has not onboarded. Suggest `/onboard` (`.claude/skills/onboard/SKILL.md`) before any scraping, scoring or application work.

## Who does what

- **Claude (this repo):** onboarding, scraping, fit scoring, the dashboard, tailored resumes and cover letters, interview prep, mail tracking, funnel analytics.
- **Codex (optional):** submits applications following `AGENTS.md`, and must mark each UI-confirmed submission `applied` through the API so the applied date, follow-up nudges and funnel stay correct.

Before application-related work read `AGENTS.md`, `data/APPLICATION-MEMORY.md` (standing instructions, approvals, open items) and the latest `data/application-session-*.json` if any. New documents go to `outputs/tailored/<Company>-<Role>-YYYY-MM-DD/`.

## The user's data

- `data/resume.json`: facts (single source of truth; every skill cites bullet ids). Plus `formatting` preferences for printed resumes.
- `data/profile.json`: targets, read through `lib/profile.ts`: role families (title regex, boost skills, probe), `seniority`, `places`, `remoteOk`, `workAuthorization` (`citizen`, `permanent_resident`, `opt`, `needs_sponsorship`, `unset`), `device` (`macos`, `windows`, `linux`).
- `data/answers.yml`: form answers. `UNCONFIRMED` means stop and ask; never guess legal or immigration answers.
- `assets/Resume.docx` / `.pdf`: the one-page formatting base tailoring mirrors.

`node scripts/check-profile.mjs` (`pnpm check:profile`) validates resume and profile and prints each family's score on its probe.

## Where the data lives

The dashboard runs locally (`pnpm dev`, http://localhost:3000, D1 in `.wrangler/state/`) unless the user deployed it to Cloudflare (`docs/CLOUDFLARE-DEPLOYMENT.md`). `server.base_url` in `scraper/config.yml` names the one in use, and that dashboard is the system of record. Never write to the D1 sqlite file directly. Skills and scripts reach it through one client, which reads the ingest token (and, for a cloud dashboard, Access credentials) from the environment or `.env` (never print or commit them):

```bash
uv run --directory scraper python -m jobagent_scraper.api request GET "/api/jobs?id=<id>"
uv run --directory scraper python -m jobagent_scraper.api request PATCH /api/jobs --json '{"id": "<id>", "status": "applied"}'
uv run --directory scraper python -m jobagent_scraper.api upload <job-id> Resume.docx Resume.pdf
uv run --directory scraper python -m jobagent_scraper.api rescore-all   # after changing scoring, resume.json or profile.json
```

Add `--local` before the subcommand to force `http://localhost:3000`. Details: `docs/PROJECT-GUIDE.md`, "Dashboard API from skills".

## Architecture

- **App:** Next.js 16 App Router through vinext (Next-on-Vite) on the Workers runtime. UI in `app/page.tsx` (state and URL sync) plus `app/_components/`. Light and dark themes via CSS variables in `app/globals.css`.
- **API routes:** `app/api/jobs` (GET list or `?id=`, POST import, PATCH status/tailoring/rescore, DELETE), `app/api/jobs/ingest` (bulk ingest, `x-ingest-token`), `app/api/documents`, `app/api/actions` (assessments, interviews, follow-ups), `app/api/runs` (scheduled run reports and mail replies to review).
- **Scoring (`lib/matching.ts`):** 35 to 95, from evidence rules in `data/resume.json` and role families in `data/profile.json` (`buildRules`). It scores how many requirement lines the resume covers (`lib/jd-sections.ts` splits required, preferred, duties and boilerplate; `profile.coveragePattern` counts broad field language), weights skills by rarity (`data/skill-rarity.json`, regenerate with `scripts/skill-rarity.mjs`), and lists unmet lines as "Requires: …" gaps. Postings the user's work authorization cannot satisfy (`lib/eligibility.ts`) are capped at 40 with a "Blocker:" gap. Postings away from the target seniority lose points (`seniorityAdjustedScore`). Role families are matched in profile order, first match wins; no match is "Adjacent role".
- **"Worth applying" (`lib/worth-applying.ts`):** new or shortlisted, not screened out, in a profile place or stated remote, experience level fitting the target seniority, not stale (`lib/freshness.ts`: fresh 7 days, stale 30), no blocker.
- **Provenance (`lib/job-provenance.ts`):** only structured identity plus an `official_ats` source makes a job `verified`, which unlocks tailoring. The user setting a job to `ready` is explicit human validation and also unlocks tailoring; prep-queue tailors those first.
- **Scraper (`scraper/`, Python, uv):** jobspy boards (LinkedIn, Indeed, Google), native ATS connectors (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Workable, Recruitee, Phenom, Amazon), niche boards, and a JSON-LD crawler. Registry `scraper/companies.yml`; search terms and filters in `scraper/config.yml` (`entry_level.enabled: false` keeps all seniorities); logic in `filters.py`. Ingests in batches of 25 with retries.
- **Mail tracking:** local by default (`main.py mail`, Gmail IMAP; needs `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` in `.env`, skips without them). A cloud deployment adds a Worker cron (`worker/mail.ts`, `lib/mail-tracker.ts`), and the local run then passes `--defer-to-cloud`. Both conservatively move applied to interview or rejected and must pass `tests/fixtures/mail-cases.json`; change `mailtracker.py` and `lib/mail-tracker.ts` together. Ambiguous replies go to the dashboard's "replies need you" card. `/mail-check` does the same through the Gmail connector.
- **Skills (`.claude/skills/`):** `onboard`, `tailor-resume`, `cover-letter` (260 to 340 words), `interview-prep`, `prep-queue` (batch-tailors top verified jobs), `mail-check`, `fill-application` (pre-fills forms, never submits; work-authorization answers only from `data/answers.yml`, and any `UNCONFIRMED` value stops the run), `humanizer`.

## Commands

```bash
pnpm dev                 # local dashboard on http://localhost:3000
pnpm test                # build + node --test tests/*.test.mjs
pnpm lint
pnpm check:profile       # validate resume.json + profile.json
uv run --directory scraper pytest tests   # scraper tests
pnpm scrape              # full scrape (macOS/Linux; starts the local dashboard if needed)
pnpm scrape:win          # same on Windows (scripts/windows/scrape.ps1)
pnpm mail / pnpm mail:win   # one mail check
uv run --directory scraper python -m jobagent_scraper.main scrape --source ats --company "Acme"   # one company
```

On Windows use the `scripts/windows/*.ps1` equivalents of `scripts/*.sh`; package.json scripts need npm's `script-shell` set to Git Bash. Open folders with `open` on macOS and `explorer` on Windows (`device` in the profile).

Cloud deploy (optional; see `docs/CLOUDFLARE-DEPLOYMENT.md`):

```bash
pnpm test && bash scripts/prep-remote-deploy.sh && pnpm exec wrangler deploy --config dist/server/wrangler.json
```

Workers limits: about 1,000 D1 queries and limited CPU per request, so bulk operations must be paged (see `rescoreAll` with `offset`/`limit`). A cloud dashboard needs Workers Paid.

## Scheduling

macOS: `scripts/install-schedule.sh` installs two launchd jobs (scrape daily at 09:00, mail every 3 hours at :30) running through small apps in `~/Applications/Job Agent/`, because macOS blocks background jobs from `~/Desktop` and only an app can be allowed Desktop access. Windows: `scripts/windows/install-schedule.ps1` registers two Task Scheduler tasks. Both report to `/api/runs`, which drives the dashboard's "Last scrape / Mail checked" line (amber when overdue). Logs are in `scraper/out/`.

## Resume length: mandatory

Every resume must be exactly one page. Render the final DOCX to PDF, check the actual PDF page count equals 1, and visually inspect that page before delivery, marking Ready, dashboard upload, or application attachment. Repeat the check after every edit; a template, DOCX page-count property, or older render is not proof. If it overflows, shorten or remove lower-priority grounded content while preserving readable typography and the base layout. Never clip text, hide overflow, or shrink it into unreadability. If it is under-filled, add only relevant verified content; never pad or invent facts. Record `PAGE_COUNT: 1` and `LAYOUT: PASS (1 page)` in the tailoring report only after validation. Apply this to new, reused, and fallback resumes; do not use an unverified file.

## Conventions

- Tests import `.ts` sources directly under `node --test` (Node 23.6+ type stripping): relative imports in lib code need explicit `.ts` extensions and `import type` for type-only imports.
- Scoring tests run against the fictional candidate in `tests/fixtures/sample-resume.json` and `sample-profile.json`, never against the user's data, so they stay green for any user.
- Schema changes: edit `db/schema.ts`, add new job columns to `PROVENANCE_COLUMNS` in `db/jobs.ts` (runtime self-migration), and run `pnpm run db:generate`. New tables are also created at runtime (`CREATE TABLE IF NOT EXISTS` in the `db/*.ts` module).
- New scraping source: a connector in `scraper/jobagent_scraper/ats/` returning `common.make_posting` dicts, registered in `ats/__init__.py`, mapped in `lib/ingest.ts` `SITE_TO_KIND`.
- Every phase of work ends with green tests. No demo or synthetic jobs in the database, ever.
- Resume facts come only from `data/resume.json` and explicit user statements recorded there with a source note. Never invent experience.
- **Never use em dashes (—) in any generated document** (cover letters, resumes, reports, drafted answers). Use a comma, a period, or a colon.
