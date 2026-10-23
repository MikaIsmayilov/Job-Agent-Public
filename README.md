# Job Agent

**Your own AI job-search assistant, run inside Claude Code.**

Job Agent finds real job postings every day, ranks them by how well they fit
*your* resume, and shows them in a private dashboard on your computer. When you
find a job you like, Claude writes a one-page resume and cover letter tailored
to it, using only facts from your real resume, then helps you fill in the
application form and prepare for the interview.

You don't need to know how to code. You set it up by chatting with Claude.

---

## Contents

1. [What it does](#what-it-does)
2. [What you need](#what-you-need)
3. [Setup, step by step](#setup-step-by-step)
4. [Your daily routine](#your-daily-routine)
5. [All the commands](#all-the-commands)
6. [The dashboard](#the-dashboard)
7. [Optional extras](#optional-extras)
8. [Changing your profile later](#changing-your-profile-later)
9. [Privacy](#privacy)
10. [Troubleshooting](#troubleshooting)
11. [FAQ](#faq)
12. [For developers](#for-developers)

---

## What it does

| Feature | What you get |
|---|---|
| **Finds jobs** | Searches LinkedIn, Indeed and Google Jobs in the United States or Canada, plus about 90 national company career sites (Greenhouse, Lever, Workday and others) and optional regional packs, every day. |
| **Scores every job** | A fit score from 35 to 95 based on your skills, which of the job's requirements your resume covers, and the seniority you want. Each job shows the skills it matched and what you're missing. |
| **Filters out the junk** | "Worth applying" shows only fresh jobs in your cities (or remote), at your level, that you're legally able to take. Postings that need citizenship (or Canadian PR) you don't have, or that don't sponsor when you need it, are flagged. |
| **Tailors your resume** | A one-page DOCX and PDF for a specific job. Every line traces back to your real resume, and Claude checks that nothing was invented. |
| **Writes cover letters** | 260 to 340 words, specific to the job and grounded in your experience. |
| **Preps your queue** | `/prep-queue` picks the best new jobs and tailors resumes for all of them, ready for you to review in the morning. |
| **Helps fill applications** | Opens the application in your browser and fills in your details. **You** review it and click Submit. |
| **Interview prep** | STAR stories built from your real experience, likely questions, and research on the company. |
| **Tracks replies** (optional) | Reads recruiter emails in Gmail and moves jobs to "Interview" or "Rejected" for you. |
| **Shows your funnel** | Applications sent, response rate, time to response, and follow-up reminders. |

---

## What you need

- **A Claude subscription** (Pro or Max) and the **Claude Code** app.
- A **Mac or Windows** computer (Linux works too).
- Your **resume**, ideally as a Word file (.docx). A PDF works too.
- About **30 minutes** for setup, plus about 30 minutes while the first job
  search runs in the background.

Claude installs the rest of the tools for you during setup.

---

## Setup, step by step

### Step 1. Install Claude Code

Download the Claude desktop app from https://claude.com/download, sign in, and
open the **Code** tab. (Or install the Claude Code command-line tool from
https://claude.com/claude-code. Everything below works the same there.)

### Step 2. Get this project onto your computer

**The easy way:** at the top of this page click the green **Code** button,
then **Download ZIP**. Unzip it and move the folder somewhere permanent, for
example your Documents folder.

**With git** (if you already use it):

```bash
git clone https://github.com/MikaIsmayilov/Job-Agent-Public.git
```

> **Mac tip:** avoid keeping the folder on the Desktop. macOS asks for extra
> permissions before scheduled jobs can run there. Documents or your home
> folder is simpler.

### Step 3. Open the folder in Claude Code

In the Claude Code app, start a new session and choose the **Job-Agent-Public**
folder as the project folder. Claude now sees the project and its instructions.

### Step 4. Run the onboarding

Type this and press Enter:

```
/onboard
```

Claude walks you through everything. Here is what to expect:

1. **Your computer.** Claude asks whether you're on Mac or Windows, checks
   for the tools it needs (Node, pnpm, uv, LibreOffice, Git), and gives you
   the exact command for anything missing. Approve the install steps when
   Claude asks.
2. **Your resume.** Give Claude the path to your resume file. (You can drag
   the file into the chat.) Claude reads it and turns it into structured facts:
   your jobs, projects, education and skills. You can also add a longer
   "master" resume or your LinkedIn PDF for extra true details. Check the
   summary Claude shows you and correct anything wrong.
3. **What you want.** Claude asks about:
   - the roles you're targeting (for example "data analyst, business analyst")
   - your level: entry (0 to 2 years), mid (3 to 5) or senior (6+)
   - full-time, internship, part-time or contract
   - the country you're searching (United States or Canada), the cities you
     want, whether remote counts, and whether you'd relocate
   - your **work authorization** there: in the U.S., citizen, green card,
     F-1 OPT/STEM OPT or needing visa sponsorship; in Canada, citizen,
     permanent resident, open work permit (such as a PGWP) or needing an
     employer-supported permit (LMIA)
   - a salary number for forms that insist on one (you can skip this)
   - companies you especially want (optional)
4. **Form answers.** Your legal name and similar details for applications.
   Address and demographic (EEO) questions are optional. Skip them and
   forms will "decline to answer".
5. **A check.** Claude scores a sample job for each of your target roles, so
   you can see whether the ranking makes sense, and adjusts if it doesn't.
6. **Your first job search.** Claude starts the dashboard and runs the first
   scrape. It takes 10 to 40 minutes, and you can keep chatting while it runs.

### Step 5. Open your dashboard

Go to **http://localhost:3000** in your browser. Jobs appear as the first
search finishes. Bookmark it.

If the page doesn't load later (after a restart, say), ask Claude
"start my dashboard", or run `pnpm dev` in the project folder.

### Step 6 (recommended). Run it every day automatically

Ask Claude "set up the daily schedule". This installs a job that searches every
morning at 9:00 (and checks your email every 3 hours, if you turned that on):

- **Mac:** `bash scripts/install-schedule.sh`. If macOS asks to let "Job
  Agent Scrape" access a folder, click **Allow**.
- **Windows:** `powershell -ExecutionPolicy Bypass -File scripts\windows\install-schedule.ps1`
  (Task Scheduler; runs while you're logged in).

Your computer needs to be on (or wake up) for it to run. A missed run starts
when the computer wakes.

---

## Your daily routine

About 20 minutes a day:

1. **Open the dashboard.** The **Worth applying** tab shows today's best new
   matches, with the freshest strong fits on top.
2. **Skim and shortlist.** Click a job to read it, see why it scored the way it
   did, and mark it **Shortlisted**, or delete it.
3. **Prepare applications.** In Claude Code:
   ```
   /prep-queue 5
   ```
   Claude picks the 5 best jobs, double-checks each full posting (experience
   bar, location, visa), skips the ones that don't fit and says why, then
   tailors a resume for each. You get a table with what changed in each resume.
4. **Apply.** For each prepared job:
   ```
   /cover-letter <job-id>        (if the job wants one)
   /fill-application <job-id>    (fills the form in your browser)
   ```
   Review everything and click **Submit** yourself. Then mark the job
   **Applied** in the dashboard.
5. **Interviews.** When you get one:
   ```
   /interview-prep <job-id>
   ```

> **Where's the job id?** Each job's detail panel in the dashboard has buttons
> such as **Tailor application** and **Cover letter**. They copy the exact
> command, so paste it into Claude Code.

Tailored files are saved under `outputs/tailored/<Company>-<Role>-<date>/` and
can be downloaded from the job in the dashboard.

---

## All the commands

Type these in Claude Code:

| Command | What it does |
|---|---|
| `/onboard` | First-time setup. |
| `/onboard update` | Change your resume, target roles, cities and so on. |
| `/prep-queue 5` | Tailor resumes for the best 5 new jobs (any number works). |
| `/tailor-resume <job-id>` | Tailored one-page resume (DOCX and PDF) plus a report on what changed and why. |
| `/cover-letter <job-id>` | Tailored cover letter (DOCX and PDF). |
| `/fill-application <job-id>` | Pre-fills the application form in your browser. Never submits. |
| `/interview-prep <job-id>` | Interview prep pack: STAR stories, likely questions, company research. |
| `/mail-check` | Checks your Gmail for recruiter replies (needs Claude's Gmail connector). |

You can also just ask in plain English: "find me more remote jobs", "why did
this job score low?", "add Spotify to the companies list", "start my dashboard".

Terminal commands, if you prefer them (run them in the project folder):

| Command | What it does |
|---|---|
| `pnpm dev` | Start the dashboard at http://localhost:3000 |
| `pnpm scrape` (Windows: `pnpm scrape:win`) | Run a job search now |
| `pnpm mail` (Windows: `pnpm mail:win`) | Check Gmail for replies now |
| `pnpm check:profile` | Check your profile and see how each target role scores |

---

## The dashboard

**Job inbox**
- **Worth applying**: jobs that pass your rules (place, level, freshness,
  work authorization). **All jobs**: everything found.
- Each row shows the score, how old the posting is, the role type, work mode,
  experience level, a visa-sponsorship chip, and where it came from.
- **Search and filters**: by status, role type, work mode, location, job type,
  experience, source, sponsorship, salary listed and minimum score.
- **Keyboard**: press `?` to see the shortcuts.

**Job detail** (click any job)
- The score, which of your skills matched, and what's missing ("Requires: …").
- Warnings, such as no visa sponsorship or a citizenship requirement, quoted
  from the posting.
- Salary, dates, and the original posting link (**Apply ↗**).
- Buttons that copy the Claude commands, and downloads of tailored files.
- Change the status: Shortlisted, Ready, Applied, Interview, Rejected.

**Applications**: every job you're working on, in a table or as cards, with
**Your next moves** (assessments, interviews, follow-ups with due dates), a
response-rate funnel, and follow-up reminders for applications that have gone
quiet.

**Documents**: every job with tailored files.

**Profile card** (bottom left)
- How each of your target roles scores against your resume.
- **Salary benchmarks** from scraped postings that list pay.
- **Resume gap insights**: the skills employers keep asking for that your
  resume doesn't show yet, and how many jobs each would unlock.

**Job statuses**

```
new → shortlisted → ready (resume tailored) → applied → interview / rejected
```

---

## Optional extras

### Gmail reply tracking
Moves applied jobs to **Interview** or **Rejected** when recruiters email you.
It's cautious: anything ambiguous goes to a "replies need you" card instead.

1. Turn on 2-Step Verification for your Google account.
2. Create an **App Password**: Google Account → Security → App passwords.
3. Open the `.env` file in the project folder and fill in:
   ```
   GMAIL_ADDRESS=you@gmail.com
   GMAIL_APP_PASSWORD=the 16-letter app password
   ```
   Do this yourself in a text editor; don't paste the password into the chat.

The daily schedule then checks every 3 hours. (Without this, `/mail-check`
does a one-off check through Claude's Gmail connector.)

### Let Codex submit applications for you
If you also use OpenAI's Codex, it can submit applications by following
`AGENTS.md`. By default it fills everything in and stops before Submit. To let
it submit without your final review, set
`autonomous_submission_authorization.authorized: true` in `data/answers.yml`.

### Use the dashboard from your phone
Deploy your own private copy to Cloudflare by following
[docs/CLOUDFLARE-DEPLOYMENT.md](docs/CLOUDFLARE-DEPLOYMENT.md). It needs a
Cloudflare account and their Workers Paid plan (about $5 a month). It stays
locked behind a login with your email.

### Add companies you care about
Ask Claude: "add <Company> to my company list". Claude finds the company's
careers system and tests it. After a few searches, `pnpm scrape:discover`
suggests more companies based on what the job boards found.

---

## Changing your profile later

Run `/onboard update` and say what changed: "I have a new resume", "I'm
moving to Chicago", "add product analyst roles", "I got my green card".
Claude updates the right files and re-scores every job already in your
dashboard.

You can also edit the files by hand:

| File | What's in it |
|---|---|
| `data/resume.json` | Your resume facts and skills (the only source Claude may use when writing your documents) |
| `data/profile.json` | Your targets: roles, level, cities, remote, work authorization |
| `data/answers.yml` | Answers for application forms |
| `scraper/config.yml` | Search terms, locations, and which job boards to use |
| `scraper/companies.yml` | Company career sites to search |
| `assets/Resume.docx` | Your base resume layout, which tailored resumes copy |

After a hand edit, run `pnpm check:profile` to make sure nothing broke.

---

## Privacy

- **Everything stays on your computer.** Your resume, answers and job data
  live in this folder. Nothing goes to a server unless you deploy to
  Cloudflare yourself.
- **Your secrets** (in `.env`) and generated files (in `outputs/`) are
  excluded from git automatically.
- **If you put your copy on GitHub, make it a private repository.** After
  onboarding, `data/` holds your resume, contact details and form answers.
- **Claude never invents facts.** Every tailored resume and cover letter is
  checked against `data/resume.json`, and visa or legal questions are only
  answered from what you told it. When it's not sure, it asks.
- **Nothing is submitted without you**, unless you turn on Codex submissions.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Dashboard won't load | Ask Claude "start my dashboard", or run `pnpm dev` in the project folder. |
| "No search terms" when searching | Onboarding isn't finished: run `/onboard`. |
| Very few jobs | Ask Claude to widen your search terms or cities, or turn remote on. The first search covers the last 3 days only. |
| Lots of irrelevant or too-senior jobs | Ask Claude to tighten your search ("drop sales roles", "only entry level"). |
| Scores seem wrong | Run `pnpm check:profile`, then ask Claude "why did <job> score <n>?" and to adjust your skills or roles. |
| PDF creation fails | Install LibreOffice: `brew install --cask libreoffice` (Mac) or `winget install TheDocumentFoundation.LibreOffice` (Windows). |
| Windows: `pnpm dev` errors about `WRANGLER_LOG_PATH` | Run once: `npm config set script-shell "C:\Program Files\Git\bin\bash.exe"` |
| LinkedIn "429" errors in the logs | Normal rate limiting. The search carries on with the other sources. |
| The daily search didn't run | The computer was off or asleep. It runs on wake. Logs are in `scraper/out/`. |

Still stuck? Ask Claude in the project folder. It knows how everything works.

---

## FAQ

**Does this cost anything?**
Only your Claude subscription. Everything else is free, unless you choose the
optional Cloudflare deployment.

**Does it work outside the U.S.?**
Yes, in Canada. Onboarding asks which country you're searching. For Canada it
searches Indeed Canada (and Glassdoor Canada if you turn it on), LinkedIn and
Google Jobs with Canadian locations, adds a pack of Canadian employers'
career sites, treats provinces as home and U.S.-only postings as foreign, and
checks eligibility against Canadian rules (citizen, permanent resident, open
work permit, or needing an LMIA). One country per setup. Other countries are
not supported yet.

**Does it work for any field, or only analytics?**
Any field. Your role types, skills and search terms all come from your
onboarding. The included company list is national; city and country packs
(`scraper/companies/`, today Boston and Canada) switch on from your places.
Name the companies you want during onboarding, and `pnpm scrape:discover`
proposes more from what the job boards return.

**Will it apply to jobs on its own?**
No. Claude prepares and fills in; you submit. (Codex can submit only if you
explicitly allow it.)

**Can it lie on my resume?**
It's built not to. Every line must come from `data/resume.json`, and each
tailoring run ends with a check (`GROUNDING: PASS`) that compares every
number, tool and date against your facts.

---

## For developers

```bash
pnpm install && uv sync --directory scraper   # dependencies
pnpm test                                     # build + app tests
uv run --directory scraper pytest tests       # scraper tests
pnpm lint
```

- **App:** Next.js 16 through vinext on the Cloudflare Workers runtime, with
  local D1 (SQLite). UI in `app/`, logic in `lib/`, database in `db/`.
- **Scoring:** `lib/matching.ts` (skills from `data/resume.json`, role
  families from `data/profile.json`), `lib/eligibility.ts` (work
  authorization), `lib/worth-applying.ts`.
- **Scraper:** Python with uv in `scraper/`. Add a careers platform as a
  connector in `scraper/jobagent_scraper/ats/`.
- **Skills:** `.claude/skills/*/SKILL.md`.
- Tests run against a fictional candidate in `tests/fixtures/`, so they pass
  whoever has onboarded.

See [CLAUDE.md](CLAUDE.md) for the full architecture and conventions.
