---
name: fill-application
description: Open a job's application form in the browser and pre-fill it from data/resume.json — profile fields, education, work history, and drafted answers to free-text questions. Never submits; the user reviews and clicks Submit. Use when asked to fill/apply/start an application, or "/fill-application <job-id>".
---

# Fill Application

Speed up applying by pre-filling ATS application forms with grounded resume data. **This skill fills; the human submits.** That line is absolute.

## Hard rules (never violate, no user override)

1. **Never click Submit / Send / Apply-final buttons.** The run always ends with every field filled and the user reviewing. This is both a safety rule and an accuracy safeguard — a wrong autofilled answer on a submitted application can't be unsent.
2. **Never create accounts, log in, or enter passwords.** If the portal requires an account (Workday almost always does), stop and ask the user to log in themselves first — with Claude-in-Chrome the user's existing session is already there; prefer that surface for account-gated portals.
3. **Never enter SSN, government IDs, bank/payment details, or references' private contacts.** If a form demands them, leave blank and flag to the user.
4. **Never solve CAPTCHAs** — hand back to the user.
5. **Answer eligibility questions ONLY from `data/answers.yml` → `work_authorization`.** Never infer an immigration answer from the resume, from context, or from what would score better. Read the block fresh each run and match the answer to the exact question asked, because forms split the question differently and the truthful answers differ per phrasing:
   - "Will you require sponsorship **in the future**?" and the combined "**now or in the future**" phrasing → `requires_future_sponsorship`.
   - "Do you require sponsorship **now** / to work for X?" (the "now" half of a two-question pair) → `requires_current_sponsorship`.
   - "Are you authorized to work in the US?" → `authorized_to_work_us`.
   - "Are you legally entitled / eligible to work in Canada?" → `authorized_to_work_canada`. "Do you require an LMIA / employer sponsorship?" follows the same now / future split as above. A permit-expiry question → `work_permit_expiry`.
   - Questions that define their own terms ("including OPT/STEM OPT support", "without employer support of any kind") must be answered against that definition. If the bank has no answer that fits the exact definition, STOP and ask; record the user's answer in `data/answers.yml` with the date so the next form reuses it.
   **If any needed value is missing or marked `UNCONFIRMED`, STOP and ask the user for that specific fact.** Leave the field blank and flag it rather than guessing. Misrepresenting work authorization on an application is never acceptable, even when the truthful answer filters the candidate out, and an educated guess here is misrepresentation.
   Use `name_on_forms.legal_name` for legal/full-name fields and `preferred_name` where a form asks for a preferred or display name.
6. Free-text answers ("Why us?", "Describe a project…") follow tailor-resume grounding: facts only from `data/resume.json`; motivation sentences allowed; company claims only from the job's `rawDescription`.

## Profile facts and standing answers (read both fresh each run)

- `data/resume.json` — contact, education, experience, skills.
- `data/answers.yml` — the **answer bank**: standing answers for recurring screening questions (start date, relocation, salary expectation, work-authorization phrasing, EEO defaults, "how did you hear"). Use these verbatim; they are user-maintained. Anything under `never_fill` stays blank and gets flagged no matter what the form says. If a screening question has no bank entry and isn't derivable from resume.json, leave it blank and flag it in the summary rather than guessing.

## Steps

1. **Resolve the job**: `uv run --directory scraper python -m jobagent_scraper.api request GET "/api/jobs?id=<id>"` (see `docs/PROJECT-GUIDE.md` "Dashboard API from skills"). Get `sourceUrl`, `title`, `company`, `rawDescription`.
   **Fit sanity check (mandatory before opening the form):** read `rawDescription` for a years-of-experience bar above the user's target (`seniority` in `data/profile.json`: entry means a bar above 2 years, mid above 5, senior has no upper bar), seniority language, or eligibility conflicts the stored tags missed. On a mismatch, STOP and tell the user the quoted line ("requires 3-5 years of analytics experience") and ask skip-or-proceed — never silently fill a role whose stated bar the profile clearly doesn't meet.
   **Work-authorization check before opening anything**: run `sponsorshipRisk(sponsorship, sponsorshipNote, rawDescription)` from `lib/eligibility.ts` (or apply the same rules by reading the JD). It applies the user's `workAuthorization` from `data/profile.json`. A `blocker` (the posting rules out the user's status) or a `warning` means STOP: quote the posting's exact sentence to the user and ask whether to continue. Do not fill until they answer. Never decide this yourself, and never change any `work_authorization` answer because of it.
2. **Pick the browser surface**: default in-app Browser for public Greenhouse/Lever/Ashby forms; Claude-in-Chrome when the portal needs the user's logged-in session (Workday, iCIMS, SuccessFactors). Say which one you're using.
3. **Open the application form** (the job's Apply page). If it 404s or the role closed, PATCH nothing — report it and suggest removing the job.
4. **Verify the resume before attaching.** The exact resume used must be exactly one rendered page. Check the final PDF page count and visually inspect it, including for reused tailored files and the fallback `assets/Resume.pdf`. If uploading DOCX, verify a fresh PDF export of that exact DOCX. Do not attach an unverified or multi-page resume; repair and re-render it first. Keep facts grounded and text readable.

   **Fill mechanically**: name, email, phone, location, LinkedIn URL, education (school/degree/dates/GPA), work history (org/role/dates from resume.json). Use the tailored resume for this job if one exists (`tailoredPath` on the job row → attach the `<First>-<Last>-Resume.pdf` from that folder via the file-upload tool); otherwise `assets/Resume.pdf`.
5. **Draft free-text answers** grounded per rule 6; fill them in; list each drafted answer in your summary so the user can rewrite before submitting. Never use em dashes (—) in drafted answers (hard user rule; comma, period, or colon instead).
6. **Eligibility/EEO questions** per rules 5 and profile defaults.
7. **Stop before submission.** Take a screenshot of the completed form, then tell the user: which fields you filled, which you left blank and why (rule 3/4 items), the drafted free-text answers, and that they should review everything and click Submit themselves. Optionally PATCH the job to `shortlisted` if it was `new`.

## Notes

- One run = one job's form. Batch requests ("fill all 10") run sequentially with a per-job summary; the user still submits each one.
- If the form is a multi-step wizard, fill each step but do not pass any step whose "next" button also submits (some single-step Lever forms have only "Submit application" — fill everything and stop there).
