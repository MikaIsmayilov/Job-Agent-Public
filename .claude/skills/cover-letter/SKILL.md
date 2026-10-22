---
name: cover-letter
description: Write a grounded, job-specific cover letter (250-350 words, DOCX + PDF) for a job stored in the Job Agent dashboard. Use when asked to create/write a cover letter for a job id or URL, or when the user pastes "/cover-letter <id>" copied from the dashboard's Cover letter button.
---

# Cover Letter

Produce a one-page cover letter (DOCX + PDF) for one job from the Job Agent database. Works standalone — it does not require the resume to have been tailored first, and it never regenerates the resume. The letter must be 100% factual: **every factual claim traces to `data/resume.json`; every company-specific claim traces to the job's `rawDescription`.** Nothing else is a permissible source.

## Hard rules (never violate)

1. `data/resume.json` is the ONLY source for facts about the user (experience, metrics, tools, education, dates). No exaggeration; rephrasing is fine.
2. The job's `rawDescription` is the ONLY source for claims about the company or role ("your team builds X"). No general knowledge, no guessing.
3. No invented names — greet "Dear <Company> Hiring Team," unless the JD itself names a recruiter/manager.
4. Never mention salary, and never raise visa/sponsorship in the letter (work-authorization questions are answered truthfully on the application form, not volunteered here).
5. The verification pass (step 6) is mandatory; do not finish without printing its three result lines.

## Content spec (researched: what actually gets read)

Recruiters skim; ~70% of employers prefer a half-page letter or "shorter the better", and 400 words is the hard ceiling before attention drops. A good letter is a fit story, not a resume rehash.

- **Length: 260–340 words** (target ~300). Outside 250–400 = fail, rewrite. Exactly **3–4 short paragraphs**, one page.
- **Paragraph 1 — the hook (40–60 words).** Name the exact job title and company in the first sentence and lead with the single strongest, most JD-relevant qualification. Banned openers: "To whom it may concern", "I am writing to apply", "My name is".
- **Paragraph 2 (and optionally 3) — evidence (100–150 words).** Pick the 2–3 resume achievements that best match the JD's top requirements and tell them as a story of fit, with the real numbers from `resume.json`. Mirror the JD's own keywords/ATS terms naturally (e.g. if the JD says "stakeholder reporting", use those words where the resume evidence supports them). Do NOT walk through the resume chronologically — select, don't summarize.
- **Paragraph 3/4 — company fit + close (60–90 words).** One or two sentences on why this role/company, grounded strictly in the JD's own language (product, team, mission as *they* describe it). Close confidently with a call to action ("I'd welcome the chance to discuss…") and thanks.
- **Banned everywhere:** clichés without evidence ("fast learner", "team player", "passionate"), underselling ("although I lack…", "despite limited experience"), apologies, salary, invented company facts, restating the whole resume, and **em dashes (—)** anywhere in the letter (hard user rule; use a comma, a period, or a colon instead).

## Steps

1. **Resolve the job** — identical to tailor-resume: `uv run --directory scraper python -m jobagent_scraper.api request GET "/api/jobs?id=<id>"` → `jobs[0]` (URL argument: fetch the list and match `canonicalUrl`/`sourceUrl`). Read-only sqlite fallback as documented in tailor-resume.
2. **Check validation.** A job is validated when `verificationStatus == "verified"` OR `status == "ready"` (the user marked it Ready to apply — explicit human validation; proceed without asking, and note in COVER-LETTER-REPORT.md that company claims come from the user-validated aggregator text). If neither holds, stop and ask before proceeding (unvalidated JDs make keyword mirroring untrustworthy).
3. **Load ground truth.** `data/resume.json` for facts; the job's `rawDescription` + precomputed `skills`/`gaps` for requirements and keywords.
4. **Plan before writing.** List: (a) the JD's top 3 requirements, (b) the resume bullet ids that answer each, (c) the JD keywords to mirror. A claim with no bullet id gets cut at this stage.
5. **Generate** into the job's existing `outputs/tailored/<Company>-<Title-slug>-<date>/` directory if one exists, else create `outputs/tailored/<Company>-<Title-slug>-<YYYY-MM-DD>/`:
   - `<First>-<Last>-Cover-Letter.docx` + `.pdf` (name from `contact.name`) — same docx-js mechanics as tailor-resume (build the script in a scratchpad dir OUTSIDE the repo — `npm install docx` fails inside the pnpm tree; PDF via `soffice --headless --convert-to pdf`; keep `make_cover_letter.cjs` in the output folder). Header matches the resume: name, phone, email, LinkedIn from the `resume.json` contact block, with a city/state only when `formatting.showLocationInHeader` is true; then date, greeting, body, "Sincerely, <contact.name>".
   - `COVER-LETTER-REPORT.md`: word count; grounding map (each factual claim → resume.json bullet id; each company claim → the JD phrase it comes from); keyword-mirror table (JD keyword → sentence using it / "not used — no supporting evidence").
6. **Verification pass (mandatory).** Print exactly three lines when clean:
   - `GROUNDING: PASS (<n> claims, 0 violations)` — every proper noun, number, tool, and company fact checked against its source; fix violations before passing.
   - `LENGTH: PASS (<n> words)` — body word count within 250–400 (target 260–340).
   - `LAYOUT: PASS (1 page)` — render the PDF, Read it, confirm one page, no overflow, sensible margins.
7. **Make it downloadable.** Run `uv run --directory scraper python -m jobagent_scraper.api upload <id> <absolute paths of the DOCX, PDF, report>`; any `FAILED` line means it is not done. Re-uploading a filename replaces it. Do NOT touch `tailoredPath`/`tailoredChanges` (those describe the resume). Then tell the user: files are in the job's detail pane, plus a 2–3 sentence summary of the letter's angle (which achievements were led with and why).
8. **Open the output folder** so the user lands directly on the files: `open "<output dir>"` on macOS, `explorer "<output dir>"` on Windows (see `device` in `data/profile.json`); quote the path. Skip this only inside batch runs (prep-queue), where opening a Finder window per job would spam the desktop.
