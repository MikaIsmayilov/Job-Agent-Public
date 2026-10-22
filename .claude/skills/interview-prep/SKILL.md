---
name: interview-prep
description: Build a grounded interview-preparation pack for a job stored in the Job Agent dashboard — STAR story bank from real resume bullets, likely questions from the JD, company research, and negotiation notes. Use when asked to prep for an interview, build STAR stories, or "/interview-prep <job-id>".
---

# Interview Prep

Produce an interview-preparation pack for one job from the Job Agent database. Same grounding contract as tailor-resume: **experience claims come only from `data/resume.json`** — the pack coaches how to tell true stories, never invents them.

## Steps

1. **Resolve the job** (id or URL): run `uv run --directory scraper python -m jobagent_scraper.api request GET "/api/jobs?id=<id>"` — use `title`, `company`, `rawDescription`, `skills` (matched evidence), `gaps`.
2. **Load ground truth**: `data/resume.json`.
3. **Build `outputs/interview/<Company>-<Title-slug>-<date>/PREP.md`** with these sections:
   a. **Role brief** — what the JD actually asks for, in plain words; the 5–8 keywords the interviewer will listen for.
   b. **STAR story bank** — for each major JD requirement, pick the best-matching resume bullet(s) and expand into Situation/Task/Action/Result scaffolding. Every story cites its bullet id(s). Numbers must match resume.json exactly, digit for digit. Where the resume has no story (the job row's `gaps`), write an honest bridge line ("I haven't used GA4 in production; the closest I've done is X — here's how I'd close that gap") — never a fabricated story.
   c. **Likely questions** — 8–12 role-specific technical/behavioral questions inferred from the JD, each with a one-line pointer to which STAR story or resume fact answers it.
   d. **Questions to ask them** — 5 informed questions referencing specifics from the JD.
   e. **Company research** — use web search for recent public facts about the company (product, news, competitors); cite sources; clearly separate researched facts from JD content.
   f. **Logistics & negotiation notes** — the posting's salary field if listed (from the job row), the sponsorship stance and its evidence, and the candidate's own constraints read from `data/answers.yml` (`work_authorization`, `availability`, `preferences`) plus the target seniority. State work-authorization facts only as that file states them; if a value is missing or `UNCONFIRMED`, say so instead of filling a plausible one. General guidance to include: do not raise visa status before an offer unless asked directly, and answer honestly if asked.
4. **Verify**: re-read the STAR bank; every metric, employer, tool, and date must exist in resume.json. Print `GROUNDING: PASS (<n> stories)` or fix violations first.
5. Tell the user where the pack is and give a 3-line summary of their strongest angle for this interview.

## Notes

- `outputs/` is gitignored.
- Do not promise wage/offer outcomes; negotiation notes are talking points, not advice to accept or reject anything.
