---
name: mail-check
description: On-demand post-application email tracking (applied to interview/rejected) via the already-connected Gmail MCP tools, for when the app's built-in IMAP tracker (main.py mail) has no GMAIL_APP_PASSWORD configured. Use for "check my email for updates", "check for interview/rejection emails", "/mail-check [days]".
---

# Mail Check (Gmail MCP)

Read-only stand-in for the app's automated `main.py mail` step. Same conservative
rules, same shared classification code in `scraper/jobagent_scraper/mailtracker.py`
(`evaluate_messages` / `run_mail_from_messages`), different mail source: Gmail MCP
tools (`mcp__claude_ai_Gmail__*`) instead of IMAP + an app password.

**Why this exists:** the daily automated scrape (`scripts/scrape.sh` → `main.py mail`)
runs unattended via launchd and needs `GMAIL_ADDRESS`/`GMAIL_APP_PASSWORD` in `.env`.
When App Passwords aren't available on the account (common on managed/school
Google Workspace orgs), this skill does the same job on demand, in a live session,
using whichever Gmail account is already OAuth-connected via MCP. It does **not**
replace the unattended daily run — it only runs when invoked.

## Hard rules

1. **Read-only against Gmail.** Only ever call `list_labels`, `search_threads`,
   `get_thread`, `get_message`. Never call `send_message`, `reply`, `forward`,
   `create_draft`, or any labeling/trash/spam tool — this skill's entire job is
   reading mail and updating the job-agent DB, nothing else.
2. **Same conservative transitions as the automated tracker, no others:**
   `applied → interview`, `applied → rejected`, `interview → rejected`. A job
   in any other status is never touched. A message must classify as
   application-related AND match exactly one tracked job's company —
   ambiguous matches (multiple companies) are reported, never guessed.
3. Never re-derive the classification/matching rules by eye. Always run them
   through `mailtracker.py`'s shared code (step 4) so this stays byte-identical
   to what the IMAP path would have decided.

## Steps

1. **Target the dashboard.** Every read and write below goes to `server.base_url` in `scraper/config.yml` (local by default; a cloud dashboard also needs Access credentials from the environment or `.env`). Use the API client, never the database file directly.

2. **Get tracked jobs + their search tokens.** Reuse the same company-token
   logic the tracker uses (don't hand-roll it):
   ```
   uv run --directory scraper python -c "
   import json
   from jobagent_scraper.api import get_json
   from jobagent_scraper.mailtracker import company_tokens
   jobs = get_json('/api/jobs')['jobs']
   tracked = [j for j in jobs if j.get('status') in ('applied', 'interview')]
   out = [{'id': j['id'], 'company': j['company'], 'title': j['title'], 'status': j['status'],
           'tokens': company_tokens(j['company'])} for j in tracked]
   print(json.dumps(out, indent=2))
   "
   ```
   If this prints an empty list, stop and tell the user there's nothing in
   `applied`/`interview` status to track yet.

3. **Search Gmail with a scoped query** — never browse the raw inbox. Build one
   query from every tracked job's tokens, OR'd together, restricted to a date
   window (default 7 days, or the number the user gave as `/mail-check <days>`):
   `newer_than:<days>d ("token1" OR "token2" OR "token3" ...)`.
   Call `search_threads` with that query (`in:inbox` is implicit; `pageSize` up
   to 50). This keeps the search bounded to plausible application mail instead
   of pulling from a 20k+ message inbox.

4. **Fetch each candidate thread's text and classify through the shared pipeline.**
   For every thread `search_threads` returned, call `get_thread` with
   `messageFormat: "PLAIN_TEXT"`, take the most recent message's sender/subject/
   `plaintext_body`, and collect `{sender, subject, body}` dicts into one JSON
   array. Write it to a scratchpad file, then run:
   ```
   uv run --directory scraper python -m jobagent_scraper.main mail-from-json <path-to-json> [--dry-run]
   ```
   This calls `run_mail_from_messages`, which reuses `evaluate_messages` (identical
   classify/match_jobs rules to the IMAP path) and PATCHes `/api/jobs`
   for every accepted update. Run without `--dry-run` unless the user asked to preview first.

5. **Report the result** exactly as printed (mirrors the automated tracker's log):
   which jobs moved to `interview` or `rejected`, any `AMBIGUOUS ...` notes that need
   manual review, and the final `[mail] done — N status update(s), M note(s)` line.
   Also remind the user this account is whichever one the Gmail MCP connector is
   authorized for — if they want a second inbox (e.g. a school account) checked,
   that needs a separate connector authorization, which this skill can't add itself.

## Notes

- The company-token / classify / ambiguous-match rules are documented and tested in
  `scraper/jobagent_scraper/mailtracker.py` and `scraper/tests/test_mailtracker.py` —
  read those before changing behavior here rather than re-deriving matching logic ad hoc.
- If both this skill's Gmail account and a configured `GMAIL_APP_PASSWORD` account ever
  exist at once, running both `mail` and `mail-check` in the same window is safe: updates
  are idempotent (a job already moved to `interview` won't move again), but duplicate
  notes may print — mention that to the user rather than silently deduping.
