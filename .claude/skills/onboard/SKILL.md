---
name: onboard
description: First-time setup for a new Job Agent user. Checks the computer, reads their resume, interviews them about target roles, places, seniority, work authorization and form answers, then writes data/resume.json, data/profile.json, data/answers.yml and the scraper search config, and runs the first scrape. Use for "/onboard", "set me up", "start onboarding", or when data/profile.json is still empty. Also use "/onboard update" to change targets or refresh the resume later.
---

# Onboard

Turn a new user's resume and preferences into everything the Job Agent needs:
grounded resume facts, a scoring profile, a form-answer bank, and scraper
search terms. The output decides which jobs they see and what goes on their
applications, so **accuracy beats speed**: never invent a fact, never guess a
legal answer.

## Ground rules

1. **Facts only from the user.** Everything in `data/resume.json` comes from
   their resume file(s) or something they tell you in this session. Rephrasing
   for structure is fine; new numbers, tools, titles or dates are not. If the
   resume is ambiguous (two dates, a missing year), ask.
2. **Legal answers are never inferred.** Work authorization, sponsorship,
   legal name and citizenship are asked directly. If the user skips one, write
   `UNCONFIRMED` in `data/answers.yml`, so the application skills stop and ask
   later instead of guessing.
3. **Sensitive answers are optional.** Home address and EEO (gender,
   race/ethnicity, disability, veteran status) default to blank, which means
   "decline to self-identify". Ask once, accept "skip", and say these stay on
   their computer.
4. **Ask in small batches** with AskUserQuestion (at most 4 questions per
   call), offering sensible options and a recommendation, so it feels quick.
   Use free text for things like target role names.
5. **Never print secrets.** The ingest token and any Gmail app password go into
   `.env` only.
6. **No em dashes (—)** in any file you write for the user's documents or
   answers.

`/onboard update` skips to the step the user names (new resume, new targets,
moving cities) and rewrites only those files, then runs step 8's rescore.

## Steps

### 1. Device and tools

Detect the OS (`uname` / `$env:OS`), then confirm it with the user in the first
question batch, together with the questions in step 2. Record it as `device`
(`macos`, `windows` or `linux`) in `data/profile.json`.

Check the tools and say plainly what is missing, with the install command:

| Tool | Check | macOS | Windows |
|---|---|---|---|
| Node 23.6+ | `node -v` | `brew install node` | `winget install OpenJS.NodeJS` |
| pnpm | `pnpm -v` | `npm i -g pnpm` | `npm i -g pnpm` |
| uv (Python) | `uv --version` | `brew install uv` | `winget install astral-sh.uv` |
| LibreOffice (DOCX to PDF) | `soffice --version` | `brew install --cask libreoffice` | `winget install TheDocumentFoundation.LibreOffice` |
| Git (Windows: Git Bash) | `git --version` | built in | `winget install Git.Git` |

On **Windows** also run once: `npm config set script-shell "C:\Program Files\Git\bin\bash.exe"`
(the package.json scripts use POSIX syntax), and use the `scripts/windows/*.ps1`
scripts wherever this skill says `scripts/*.sh`.

Install dependencies: `pnpm install` and `uv sync --directory scraper`. If
`.env` does not exist, copy `.env.example` to `.env` and set `INGEST_TOKEN` to
a fresh random value (`python3 -c "import secrets; print(secrets.token_hex(32))"`
or `openssl rand -hex 32`) without printing it.

### 2. Resume intake

Ask for the resume file path(s): the current one-page resume (DOCX preferred,
since tailoring mirrors its layout; PDF also accepted), plus optional extras
such as a longer master resume, LinkedIn "Save to PDF" export, or a portfolio
URL. Extras can add true facts that the one-pager omits, and tailoring picks
from that superset per job.

- Copy the base resume to `assets/Resume.docx` and/or `assets/Resume.pdf`.
  If they only have a PDF, render it, then build a clean one-page
  `assets/Resume.docx` that mirrors it (docx skill; same section order,
  fonts close to the original), show them the rendered PDF, and get an OK. If
  they only have a DOCX, export the PDF with `soffice --headless --convert-to pdf`.
- Read every source fully (render PDFs and look at them; do not trust text
  extraction alone for dates and layout).

### 3. Build `data/resume.json`

Keep the template's keys. Fill:

- `contact` (name as printed on the resume, email, phone, location, LinkedIn,
  website, GitHub; only what they actually have), `positioning` (one line, in
  their words if the resume has a summary).
- `education[]`: `{id, school, location, degree, graduated | expected, gpa?,
  honors?, coursework?[]}`. GPA and honors exactly as printed or stated.
- `experience[]` and `projects[]`: `{id, org, role, location, dates, current?,
  bullets: [{id, text, skills: [skill ids]}]}`. Bullet `text` is the resume
  bullet, verbatim or lightly normalized. Ids are short and stable
  (`acme-1`, `acme-2`, `proj-churn-1`). Put clubs and volunteering in
  `leadership[]` with the same shape.
- `certifications[]`, `skillsLine`, `additionalTools`, `spokenLanguages`.
- `skills[]`: **the scoring engine.** 12 to 30 entries of
  `{id, label, aliases[], weight, evidence: [bullet ids]}`:
  - One entry per real capability that postings ask for (a tool, method or
    domain), each citing the bullet ids that prove it. No evidence, no skill.
  - `aliases` are lowercase phrases matched as substrings of the posting.
    Pick phrases that cannot fire on ordinary English: not "excel" (matches
    "excellent"; use "in excel", "excel,", "microsoft excel"), not "r"
    (use "rstudio", "r programming"), not "react" ("react to change"; use
    "react.js", "reactjs"), not "aws" alone (matches "laws"; use " aws",
    "(aws", "amazon web services"). `tests/fixtures/sample-resume.json`
    shows a full, tested set for an analytics profile.
  - `weight` 2 to 7: 7 for core skills the user would lead with and that
    target postings require, 4 to 5 for solid secondary skills, 2 to 3 for
    minor or incidental ones.
- `gapRules[]`: 4 to 8 `{label, aliases[]}` for requirements common in the
  target field that the resume **cannot** back (e.g. "Cloud data platforms
  (AWS / Azure)"). They lower scores and appear as gap chips. Ask the user
  whether each is really a gap before writing it.
- `formatting`: ask how they want their resume printed: section order (default
  from the base resume), `showLocationInHeader` (true/false), and `gpaRules`
  (e.g. "print GPA only when 3.5 or higher", "never print GPA").
- `sourceFiles`, `updatedAt` (today), and a `notes` line recording which
  sources were merged and anything the user corrected.

Show the user a short summary (roles, projects, the skills list with their
weights) and fix what they flag before moving on.

### 4. Targets interview

Ask, in batches:

1. **Target roles**: free text ("data analyst, BI analyst, maybe product
   analyst"). Suggest 2 to 3 adjacent roles their resume supports and let them
   pick.
2. **Seniority**: entry (0 to 2 years), mid (3 to 5), senior (6+).
3. **Job types**: full-time, internship, part-time, contract. Earliest start date.
4. **Country and places**: which country they are searching, the **United
   States (`US`)** or **Canada (`CA`)**, then cities or regions (one or more),
   whether remote counts, and whether they would relocate. One country per
   setup: the country decides the Indeed/Glassdoor domain, which locations
   count as foreign and which work-authorization rules apply. Anyone searching
   both countries picks the one they are authorized in, or the one they want
   most; say plainly that the other country's postings will be filtered out.
   Other countries are not supported yet: say so rather than improvising.
   For Canada also ask whether they work in French. If yes, add French title
   variants to `relevance.title_keywords` and `search.terms` (e.g. "analyste")
   and to the role families' `titlePattern`; if no, Quebec postings that are
   French-only will mostly be filtered out, which is what they want.
5. **Work authorization** in that country (ask directly, with these options):
   - United States:
     - U.S. citizen → `citizen`
     - Green card / permanent resident → `permanent_resident`
     - F-1 student on OPT or STEM OPT (no sponsorship needed now) → `opt`
     - Needs visa sponsorship now (H-1B or other) → `needs_sponsorship`
   - Canada:
     - Canadian citizen → `citizen`
     - Permanent resident → `permanent_resident`
     - Open work permit, such as a PGWP or spousal open work permit (no
       employer support needed now) → `open_work_permit`; also ask its expiry
       date for `data/answers.yml`
     - Needs an employer-supported permit now (LMIA-based or employer-specific
       work permit) → `needs_sponsorship`
   Then: do they hold an active security clearance? Will they need sponsorship
   in the future? Country of citizenship (forms ask)? Their own one-sentence
   explanation for forms that want one.
6. **Salary**: a number to enter when a form demands one, or "decide later"
   (stays `UNCONFIRMED`; the dashboard's Salary benchmark panel helps once
   postings are in).
7. **Target companies** (optional): names they especially want. Check
   `scraper/companies.yml` (the core list: employers hiring across the US or
   remotely) and the regional packs in `scraper/companies/` (`boston.yml`,
   `canada.yml`). Turn on every pack that matches their places in
   `ats.regions` (step 7). For each missing
   company, find its applicant tracking system from the careers page
   (boards.greenhouse.io/<token>, jobs.lever.co/<token>, jobs.ashbyhq.com/<token>,
   <tenant>.wd<N>.myworkdayjobs.com/<site>, and so on), add an entry shaped
   like its neighbours in `companies.yml`, and test it with
   `uv run --directory scraper python -m jobagent_scraper.main scrape --source ats --company "<Name>" --dry-run`.
   After the first board scrape, `pnpm scrape:discover` proposes more
   companies from what the boards returned. Remove nothing without asking.

### 5. Write `data/profile.json`

Keep the template's shape (see `lib/profile.ts` for every field and
`tests/fixtures/sample-profile.json` for a filled, tested example):

- `displayName` (resume name), `initials`, `device`, `seniority`, `remoteOk`.
- `country`: `"US"` or `"CA"` from step 4. It must match `search.country` in
  `scraper/config.yml`.
- `places`: `[{label: "Chicago, IL", match: ["chicago", "evanston, il"]}]`, or
  for Canada `[{label: "Toronto, ON", match: ["toronto", "mississauga", "markham"]}]`.
  `match` strings are lowercase substrings of a posting's location field; use
  the city name plus ", <state or province code>" forms that cannot collide
  with other places (a code like `", ma"` also matches Madrid in a ", madrid"
  string, and `", ca"` matches both California and Canada, so prefer the full
  state or province name plus the city list when that matters). Include the
  suburbs people actually commute from: board postings name them.
- `workAuthorization`: `{status, holdsClearance}` from step 4.
- `roleFamilies`: one per target role group, **ordered specific first,
  generic last** (the first match wins). Each:
  - `name` (stored on jobs, e.g. "Data analytics"), `label` (sidebar),
    `titlePattern` (case-insensitive regex over job titles covering the real
    title variants for that role), optional `descriptionPattern` (domain
    words that pull a generic "Analyst" title into this family),
  - `boostSkills`: 1 to 2 skill **labels** from `resume.json` whose presence
    makes this a strong fit, `strongBoost` (8 to 15) when all match, else
    `baseBoost` (3 to 9). Strongest-evidence families get the largest numbers.
  - optional `impliedGap` for a family that is a known stretch,
  - `blurb`, `probeTitle` (a typical job title) and `probe` (two sentences
    of a typical posting) for the profile panel. Write the probe as the job
    market describes the role, not as the resume does.
  - End with a catch-all family whose `titlePattern` matches the field's
    generic titles (e.g. `\\banalyst\\b|analytics`), so near-miss titles are
    not all dumped in "Adjacent role".
- `coveragePattern`: a regex of general field language the resume grounds
  broadly (for analytics: `statistic|regression|data analysis|reporting|visuali[sz]ation|metrics|\\bkpis?\\b|modeling`).
  It counts posting requirement lines as covered. Leave it empty if the field
  has no such umbrella language.

Remember JSON escaping: a regex `\b` is written `\\b` in JSON.

### 6. Write `data/answers.yml`

Fill the template from the interview and the resume. For a Canadian search
fill `authorized_to_work_canada` (and `work_permit_expiry` for an open work
permit) and leave `authorized_to_work_us` as `UNCONFIRMED` unless they told you;
`eeo_defaults` also covers Canadian employment-equity self-identification.
Rules: legal and
eligibility keys are only what the user said, else `UNCONFIRMED`; EEO keys
blank unless they chose to answer; `employment_history_authority.complete_record`
stays true only if they confirm the resume lists every employer they have had.
Ask whether Codex may submit applications without a final review
(`autonomous_submission_authorization.authorized`, default false).

Add their standing instructions (anything like "never apply to X", "always
include my portfolio link") to `data/APPLICATION-MEMORY.md` under "Standing
user instructions", dated.

### 7. Write `scraper/config.yml`

Change only these keys, keeping comments:

- `search.country`: `US` or `CA`, the same as `country` in the profile.
- `search.locations`: the places as board search strings ("Chicago, IL",
  "Toronto, ON").
  `search.remote_ok`: as answered. `search.job_types`: their job types.
- `search.terms`: 8 to 20 board search phrases covering each role family's
  common titles. More terms means slower runs and more rate limiting.
- `relevance.title_keywords`: lowercase substrings that every relevant title
  contains (e.g. "analyst", "analytics", "data scientist"). Too narrow drops
  good jobs; too broad floods the inbox.
- `ats.regions`: the regional company packs (target companies question, step 4) that match their
  places (`["canada"]` for any Canadian search, `["boston"]` for Boston). Leave
  it empty when none fits; `pnpm scrape:discover` grows their own list after
  the first scrape.
- `entry_level` by seniority: **entry** keeps `enabled: true` and
  `max_years_required: 2`; **mid** keeps `enabled: true` and sets
  `max_years_required: 5`; **senior** sets `enabled: false` (every level is
  kept and only tagged, and scoring prefers senior postings).

### 8. Validate

1. `node scripts/check-profile.mjs`. Fix every ERROR. Read the per-family
   scores with the user: each target family should score 60 or more on its
   own probe, and the order should match how strong their evidence really is.
   If a family is detected as a different family, fix `titlePattern` or the
   order. Re-run until clean.
2. `pnpm test` must stay green (it tests the engine against the fixture, not
   against the user's data, so a failure means a file was broken, not tuned).
3. If the dashboard already has jobs (an `/onboard update`), rescore them:
   `uv run --directory scraper python -m jobagent_scraper.api rescore-all`.

### 9. First run

1. Start the dashboard: `pnpm dev` in its own terminal (or let
   `scripts/scrape.sh` / `scripts/windows/scrape.ps1` start it), then open
   http://localhost:3000.
2. Run the first scrape: `pnpm scrape` (macOS/Linux) or `pnpm scrape:win`
   (Windows). It takes 10 to 40 minutes; offer to run it in the background.
3. **Optional, ask each:**
   - **Daily schedule**: macOS `bash scripts/install-schedule.sh` (the first run
     asks for Desktop access if the folder is on the Desktop: click Allow);
     Windows `powershell -ExecutionPolicy Bypass -File scripts\windows\install-schedule.ps1`;
     Linux: offer a crontab line for `scripts/scrape.sh` and `scripts/check-mail.sh`.
   - **Gmail tracking** (moves applied jobs to interview/rejected from recruiter
     mail): they create a Google App Password (needs 2-Step Verification) and
     put `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD` in `.env` themselves; never ask
     them to paste the password into the chat.
   - **Codex submissions**: point them at `AGENTS.md`.
   - **Cloud dashboard** (phone access, cloud mail cron): `docs/CLOUDFLARE-DEPLOYMENT.md`.
     Needs their own Cloudflare account and Workers Paid plan.

### 10. Hand-off

Finish with a short summary: what was written (file list), their role families
with probe scores, the places, seniority and work-authorization rules now
applied, every `UNCONFIRMED` answer still open, and the next commands:
`/prep-queue 5` to tailor the best jobs, `/tailor-resume <id>` and
`/cover-letter <id>` for one job (the dashboard's buttons copy these), and
`/onboard update` when anything changes.
