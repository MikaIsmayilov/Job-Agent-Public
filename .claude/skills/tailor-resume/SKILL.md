---
name: tailor-resume
description: Tailor the user's resume to a specific job stored in the Job Agent dashboard, with every claim grounded in data/resume.json. Use when asked to tailor a resume for a job id or job URL, or when the user pastes "/tailor-resume <id>" copied from the dashboard.
---

# Tailor Resume

Produce a job-specific resume (DOCX + PDF) plus a grounding report for one job from the Job Agent database. The output must be 100% factual: **every statement must trace back to `data/resume.json`**. This skill exists because generic AI tailoring invents experience; this one is forbidden to.

## Hard rules (never violate)

1. `data/resume.json` is the ONLY permissible source of facts. No employer, job title, date, metric, number, tool, or skill may appear in the output unless it exists in that file.
2. Rephrasing and reordering are allowed; inventing or exaggerating is not. "Queried a 500-table SQL Server database" may become "Worked across a 500-table SQL Server database", but it may NOT become "600 tables" or gain tools the bullet doesn't cite.
3. Gaps between the job's requirements and the resume are handled by omission or by honestly emphasizing adjacent evidence — never by fabrication.
4. The self-verification pass (step 7) is mandatory. Do not declare the task done without printing its result.
5. Never use em dashes (—) anywhere in a generated document (hard user rule). Use a comma, a period, or a colon instead; check for "—" before finalizing.
6. Never leave the page under-filled (hard user rule). Exactly one rendered page is mandatory, not merely a maximum: if the rendered page has more than about an inch of blank space below the last line, go back and add more grounded content (an extra bullet, an extra experience/project entry, or a bullet trimmed elsewhere restored) before shipping. Never fix it by inflating font size, margins, or line spacing beyond the base template's values, and never pad a bullet with restated or filler words to stretch it, those aren't findable next to real experience.
7. Education and header formatting follow `data/resume.json` → `formatting` (written by /onboard from the user's own preferences): `gpaRules` says when to print a GPA (never invent or round one differently), `showLocationInHeader` says whether the contact line carries a city/state. Print honors exactly as each education entry's `honors` field states them. If a preference is missing, mirror what `assets/Resume.docx` does.
8. Header contact line: built only from `data/resume.json` → `contact` (name, email, phone, LinkedIn, website or GitHub when present), separated by " | ". Apply the same header to the cover letter. If a form asks for an address, that is a `fill-application`/`data/answers.yml` concern, not something this skill adds.

## Steps

1. **Resolve the job.** The argument is a job id (UUID, preferred — the dashboard's Tailor button copies it) or a job URL.
   - `uv run --directory scraper python -m jobagent_scraper.api request GET "/api/jobs?id=<id>"` → `jobs[0]`. The client targets `server.base_url` in `scraper/config.yml` (the local dashboard by default; start it with `pnpm dev` if the request cannot connect). For a URL argument, fetch `uv run --directory scraper python -m jobagent_scraper.api request GET /api/jobs` and match on `canonicalUrl`/`sourceUrl`.
   - Fallback if the local server cannot start: query its D1 sqlite READ-ONLY:
     `sqlite3 -readonly "$(ls ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/"*.sqlite | head -1)" "SELECT title, company, raw_description FROM jobs WHERE id='<id>'"`.
     Never write to that file.
2. **Check validation.** A job is validated when `verificationStatus == "verified"` (source-verified) OR `status == "ready"` (the user marked it Ready to apply — explicit human validation; proceed without asking, and note in REPORT.md that grounding used the user-validated aggregator text). If neither holds, stop and tell the user the job's source could not be verified and ask whether to proceed. Proceed only on explicit confirmation.
3. **Load ground truth.** Read `data/resume.json` (facts and `formatting`) and look at `assets/Resume.docx` / `assets/Resume.pdf` (the formatting base: one page, section order from `formatting.sectionOrder`). Before the first tailoring run, render the base PDF and note its fonts, sizes, margins and section layout so the output mirrors it.
4. **Analyze the job.** From the job's `rawDescription` (in the API row) extract: required hard skills, tools, soft requirements, and recurring keywords (ATS terms). Cross-reference with the job row's precomputed `skills` (matched resume evidence) and `gaps`.
5. **Plan the tailoring.** Select which resume bullets to keep, reorder, or rephrase so the most job-relevant evidence leads. Build a **grounding map before writing**: for each planned output bullet, list the `resume.json` bullet id(s) it derives from. A planned bullet with no source id must be deleted.
6. **Generate the documents** into `outputs/tailored/<Company>-<Title-slug>-<YYYY-MM-DD>/`:
   - `<First>-<Last>-Resume.docx` (name from `contact.name`, e.g. `Alex-Rivera-Resume.docx`): use the docx skill; mirror the base resume's structure, one page.
   - Export `<First>-<Last>-Resume.pdf` as well.
   - `REPORT.md` with three sections:
     a. **Keyword coverage** — table: each key job requirement → covered by which output bullet / "NOT COVERED (true gap)".
     b. **Grounding map** — table: each output bullet → source bullet id(s) + the original resume text, each labeled `verbatim` / `reordered` / `rephrased` / `omitted`.
     c. **Change log** — what was reordered, rephrased, or omitted versus the base resume, and why. If nothing differs, say exactly that: "No changes — the base resume was used as-is."
7. **Self-verification pass (mandatory).** Two checks:
   a. **Grounding**: re-extract the text of the generated DOCX. For every sentence, verify each proper noun, number, date, tool, and skill exists in `data/resume.json`. Fix any violation and re-verify. Finish by printing exactly one line:
      `GROUNDING: PASS (<n> bullets, 0 violations)` — or list the violations and do not finish until they are fixed.
   b. **Layout** (the "looks fine in source" trap): render the PDF and inspect it with the Read tool. Verify: exactly one page; no orphaned section header at the bottom; dates flush right; no text overflow or truncated bullets; **no more than about an inch of blank space below the last line** (hard rule 6 — if there's a visible gap, add another grounded bullet or entry, not bigger fonts/margins). If any check fails, fix the generation script and re-render before delivering. Check the actual page count of the final PDF exported from the final DOCX; do not trust DOCX metadata or an earlier render. Repeat after every edit. Record `PAGE_COUNT: 1` and `LAYOUT: PASS (1 page)` only when the final file passes. Do not deliver, upload, or mark Ready if the count is not exactly 1 or the rendering cannot be verified. Shorten lower-priority grounded content before reducing typography; never clip, hide, or make text unreadable to force a fit.
8. **Record it — including WHAT CHANGED — and make it downloadable.**
   - Write a one-to-three-sentence `tailoredChanges` summary stating plainly what differs from the base resume (e.g. "Reordered the Example Co bullets, reporting automation first; skills line SQL-first. No wording changes.") or, when nothing differs, exactly: "No changes — base resume used as-is." It must stand alone without the report; the dashboard displays it under "Tailored resume".
   - Write `{"id":"<id>","status":"ready","tailoredPath":"outputs/tailored/<dir>","tailoredAt":"<ISO now>","tailoredChanges":"<summary>"}` to a scratchpad JSON file (the summary is free text, so a file avoids shell quoting), then `uv run --directory scraper python -m jobagent_scraper.api request PATCH /api/jobs --json-file <absolute path>`.
   - Upload each file (DOCX, PDF, REPORT.md) so the dashboard's "Tailored resume" panel shows download links — the Workers runtime cannot read outputs/ from disk. Run `uv run --directory scraper python -m jobagent_scraper.api upload <id> <absolute paths of the DOCX, PDF, REPORT.md>`; it base64-encodes each file and adds the ingest token itself. Each file prints `uploaded` or `FAILED`; treat any failure as unfinished. Re-uploading the same filename replaces the stored copy.
   - Then tell the user: the files are downloadable from the job's detail pane (and where they live on disk), **the change summary verbatim**, and the coverage-table highlights (covered / true gaps). Never present a tailored resume without stating what changed — "nothing changed" is itself a required statement.

## Optional: cover letter

If the user asks for a cover letter (e.g. `/tailor-resume <id> with cover letter`), also generate one in the same output directory by following `.claude/skills/cover-letter/SKILL.md` — that file is the single source of truth for the content spec (260–340 words, 3–4 paragraphs, hook → evidence → company fit → close), grounding rules, and its own GROUNDING/LENGTH/LAYOUT verification lines. The cover letter can also be generated standalone later via `/cover-letter <id>` (the dashboard's Cover letter button copies that command).

## Notes

- **Header:** name centered and bold, then a centered contact line from `contact` (see hard rule 8). Include the city/state only when `formatting.showLocationInHeader` is true.
- **Education:** school and location on one line (location right-aligned), degree and date in italics below. GPA and honors per hard rule 7. **Related Coursework** is optional per degree, when job-relevant or to fill the page: pick 2 to 4 names only from that education entry's `coursework` array in `data/resume.json`; never invent course names.
- **DOCX generation mechanics** (learned from the first run): write a docx-js script, but `npm install docx` FAILS inside this repo (npm chokes on the pnpm-managed node_modules) — install and run the script from a scratchpad directory outside the repo and write the .docx into the output folder by absolute path. Convert to PDF with `soffice --headless --convert-to pdf` (LibreOffice; on Windows the binary is usually `C:\\Program Files\\LibreOffice\\program\\soffice.exe`). If LibreOffice is missing, ask the user to install it (/onboard checks for it). For right-aligned dates use `tabStops: [{ type: TabStopType.RIGHT, position: 10368 }]` + `new Tab()` — NOT `PositionalTab`, which LibreOffice renders inline. Keep the generation script (`make_resume.cjs`) in the output folder so the document can be regenerated/edited later.
- `outputs/` is gitignored; tailored resumes never enter version control.
- If the user's resume changes: update `assets/Resume.pdf`/`Resume.docx` AND regenerate `data/resume.json` to match (keep the skills/aliases/weights structure and bullet ids stable where content is unchanged) — matching scores and tailoring both read the JSON.
