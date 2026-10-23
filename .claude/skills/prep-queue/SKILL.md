---
name: prep-queue
description: Batch-prepare the top N applications — select the best untailored verified jobs, run grounded tailoring for each, and present a morning review queue where every application is one review + one click away. Use for "prep my queue", "prepare applications", or "/prep-queue [N]".
---

# Prep Queue

Turn the inbox into a ready-to-submit morning queue. This is batch orchestration
of the existing skills — all their grounding rules apply unchanged.

## Steps

1. **Select candidates.** `uv run --directory scraper python -m jobagent_scraper.api request GET /api/jobs` (the dashboard at `server.base_url` in `scraper/config.yml`).
   **User-validated jobs come first:** any job with `status == "ready"` and no `tailoredPath` was explicitly validated by the user (marking Ready to apply IS the validation) — it takes a queue slot ahead of everything else, skips the eligibility filters below AND step 2's screening (never mark it `screenedOut`), and goes straight to tailoring.
   Then fill remaining slots with jobs that are ALL of:
   - `verificationStatus == "verified"` (the tailoring gate)
   - `sponsorship != "not_offered"` and `redFlags` empty
   - **Profile rules:** `worthApplying(job, Date.now())` from `lib/worth-applying.ts` is true. It applies `data/profile.json`: the target places (or remote, when `remoteOk`), experience levels that fit the target `seniority`, freshness and work authorization. Read `profile.json` and restate those rules in one line at the top of the report so the user can see what was applied.
   - `screenedOut` empty — jobs a previous run rejected at step 2 stay rejected; never re-screen them (the verdict is stored on the row and survives refreshes)
   - no `tailoredPath` yet
   - not a duplicate of an already-selected or already-tailored posting (same company + same title = one slot; ATS boards list the same role twice with different URLs)
   - **Freshness (2026-10-13 funnel review):** `datePosted` no more than 30 days old, or undated. Stale postings are excluded here (the user can still mark one Ready to override). Use `freshnessBand` from `lib/freshness.ts`.
   - **Work authorization:** `sponsorshipRisk(sponsorship, sponsorshipNote)` from `lib/eligibility.ts` is not a `blocker`. Re-check against the full JD in step 2.
   Sort fresh (posted within 7 days) first, then recent and undated together, each by score descending (`byFreshnessThenScore`); take the top **N** (argument, default **5**). If fewer qualify, say so and continue with what's there.
   **User-validated Ready jobs with a sponsorship blocker or warning** still get tailored (the user chose them), but put the risk message in that job's row of the final table so it is seen before submitting.
2. **Verify each candidate against its FULL JD before spending any tailoring time** — the stored tag is a regex heuristic and has mislabeled real postings; the full text is the truth. Fetch `rawDescription` via `?id=` and check:
   - **Years bar**: compare against the target `seniority` in `data/profile.json` (entry: bar above 2 years; mid: above 5; senior: no years skip). A stated requirement whose BAR is above the limit → SKIP. Examples below are for entry level. The bar of a range is its MINIMUM: "3-5 years" = bar 3 (skip); "2-4 years" = bar 2 (pass); "1-3 years" = bar 1 (pass). A JD with multiple separate requirements ("3-5 years analytics" AND "2 years support ops") requires all of them — judge by the highest bar among them. Do not reject a job merely because a range's upper end exceeds 2.
   - **Seniority language**: "seasoned", "proven track record of N years", "you have led teams" → SKIP.
   - **Location/eligibility**: location outside the searched country (`profile.country`), explicit no-sponsorship text the chip missed, or any `sponsorshipRisk` blocker found in the full JD (`sponsorshipRisk(sponsorship, sponsorshipNote, rawDescription)`) → SKIP. Re-check the location rule against the full JD: an onsite/hybrid role must actually be in one of the profile's places, and a "remote" role must be remote in the user's country without a required office elsewhere, otherwise SKIP.
   - **Hard qualification gaps**: required credentials the resume cannot ground (actuarial exams, security certs, clinical licensure) or non-full-time postings (per diem, 0 scheduled hours) → SKIP.
   **Record every skip permanently**: write `{"id":"<id>","screenedOut":"<short reason with the quoted JD phrase>"}` to a scratchpad JSON file and run `uv run --directory scraper python -m jobagent_scraper.api request PATCH /api/jobs --json-file <absolute path>` — this removes the job from every future run's pool (and shows a gray "screened out" chip in the dashboard). Each skip also goes into the report with the quoted JD line, and the next-best candidate takes its slot. This check is mandatory per job — a wasted tailoring costs 5 minutes; a wasted application costs credibility. If a skip verdict later looks wrong, clear it with `{"id":"<id>","screenedOut":null}`.
3. **One-page gate for every resume.** Before any resume is delivered, uploaded, or marked Ready, verify that the final DOCX exports to a PDF with exactly 1 page and visually inspect it. Require `PAGE_COUNT: 1` and `LAYOUT: PASS (1 page)` in REPORT.md. This also applies to reused packets; edits invalidate earlier checks. A failed or unavailable page-count check leaves that packet unfinished.

   **Tailor each surviving job** by following `.claude/skills/tailor-resume/SKILL.md` end to end (DOCX + PDF + REPORT.md, `GROUNDING: PASS` + `LAYOUT: PASS`, upload documents, PATCH to `ready`). Reuse one scratchpad docx workspace across jobs; budget ~5 minutes per job. If one job fails (dead posting, layout fights), report it and move on — never let one failure kill the batch.
4. **Present the queue.** End with a table the user can work top-down in the morning:

   | # | Job | Score | Posted | Sponsorship | What changed in the resume | Next step |
   |---|-----|-------|--------|-------------|---------------------------|-----------|
   | 1 | Title @ Company | 91 | 3d ago | Sponsor history | Reordered Example Co bullets; skills line SQL-first | `/fill-application <id>` |

   The "What changed" column is mandatory per job — use each tailoring's
   `tailoredChanges` summary, and write "No changes — base resume as-is" when
   that is the truth.

   Plus one line: total prepared, total skipped and why. The user then reviews
   each: fill → check → **they** click Submit → mark Applied.

## Notes

- Never tailor `not_offered` or red-flagged jobs even if asked for "top N" — call out that they were excluded and why.
- This skill prepares; it never opens application forms itself (that's `/fill-application`, run per job with the user present) and never submits anything.
- Safe to run nightly or on demand; already-tailored jobs are naturally excluded, so repeated runs just top up the queue.
