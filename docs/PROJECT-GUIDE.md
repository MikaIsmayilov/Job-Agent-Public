# Project directory guide

The dashboard is the one at `server.base_url` in `scraper/config.yml`: http://localhost:3000 (`pnpm dev`) by default, or your own Cloudflare deployment (`docs/CLOUDFLARE-DEPLOYMENT.md`).

| Location | Purpose |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Agent entry points, scope, development conventions |
| `data/resume.json` | Your resume facts, bullet ids, skill evidence, education and print formatting |
| `data/profile.json` | Your targets: role families, seniority, places, work authorization, device |
| `data/answers.yml` | Screening-form answers; `UNCONFIRMED` means ask |
| `data/APPLICATION-MEMORY.md` | Standing instructions, decisions and open items across sessions |
| `data/application-session-*.json` | Per-batch application state written by Codex (created as you apply) |
| `assets/` | Your base resume (`Resume.docx`, `Resume.pdf`) |
| `outputs/tailored/<Company>-<Role>-YYYY-MM-DD/` | Resume and cover-letter DOCX/PDF, grounding reports |
| `outputs/APPLICATION-STATUS.md` | Optional human-readable application ledger |
| `outputs/backups/` | Daily local database snapshots |
| `work/` | Temporary scripts, drafts and rendering inputs |
| `app/` | Next.js App Router UI and HTTP endpoints |
| `lib/` | Profile, matching, eligibility, provenance, ingest, pipeline, salary and document helpers |
| `db/`, `drizzle/` | Database queries, schema and migrations |
| `scraper/` | Python scraper, ATS connectors, company registry and filters |
| `.claude/skills/` | Onboarding, tailoring, cover letters, application filling, interview prep, mail |
| `scripts/` | Server, scraping, scheduling and backup scripts (`scripts/windows/` for Windows) |
| `tests/` | Application tests (fictional fixtures in `tests/fixtures/`); the scraper has its own |

`outputs/`, `work/`, `scraper/out/`, `.wrangler/` and `.env` are gitignored.

`GET /api/jobs` lists records; `GET /api/jobs?id=<id>` includes the detailed record. `PATCH /api/jobs` updates status or tailoring. Relocating tailoring requires both `tailoredPath` and existing `tailoredAt`; include existing `tailoredChanges` and omit `status` to preserve it.

`GET /api/documents?job=<id>` lists uploaded document metadata; `GET /api/documents?id=<id>` downloads stored bytes. Upload through `POST /api/documents` with jobId, filename, dataBase64 and x-ingest-token read privately from `.env`. Files in the database are independent from filesystem paths.

Source-of-truth order: latest user confirmations; current data files; the dashboard for current status; session files for history. Keep conflicts explicit; never assume a submitted application from an old snapshot.

## Dashboard API from skills

Skills read and write the dashboard through one client, never `curl`:

```bash
uv run --directory scraper python -m jobagent_scraper.api request GET "/api/jobs?id=<id>"
uv run --directory scraper python -m jobagent_scraper.api request PATCH /api/jobs --json-file /abs/path/body.json
uv run --directory scraper python -m jobagent_scraper.api upload <job-id> /abs/path/Resume.docx /abs/path/Resume.pdf
uv run --directory scraper python -m jobagent_scraper.api rescore-all   # after changing resume.json, profile.json or lib/matching.ts
```

Fit scores are stored, so they only change when jobs are rescored. `rescore-all` pages through the jobs 25 at a time. After the job pool grows a lot, refresh skill rarity with `node scripts/skill-rarity.mjs <jobs.json>` (full job records including `rawDescription`) and then rescore.

It reads `server.base_url` from `scraper/config.yml` and `INGEST_TOKEN` (plus `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` for a cloud dashboard) from the environment or `.env`; credentials never appear in commands or output. `uv --directory scraper` runs inside `scraper/`, so pass absolute file paths. Prefer `--json-file` for bodies with free text. A non-zero exit or a `FAILED` line means the write did not happen. Add `--local` before the subcommand to force the local server.

## Pending application actions

The Applications view has a **Your next moves** panel below the pipeline metrics. It stores assessments, interviews, document requests and follow-ups separately from job status. Empty deadlines mean unknown, not overdue. Dates use the viewer's local calendar day.

`GET /api/actions` lists actions. `POST /api/actions` accepts `jobId`, `title`, `kind` (Assessment, Interview, Documents, Follow-up, Other), optional `dueDate` (YYYY-MM-DD), `url`, and `notes`. `PATCH /api/actions` accepts those fields plus `id` for editing, or only `id` and boolean `completed` to complete or reopen. Record only explicitly requested actions, check for duplicates first, and never infer deadlines or completion.
