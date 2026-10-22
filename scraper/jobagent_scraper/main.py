"""Job Agent scraper CLI.

  python -m jobagent_scraper.main scrape [--source boards|ats|all] [--company NAME] [--dry-run] [--limit N]
  python -m jobagent_scraper.main discover [--apply]
"""

from __future__ import annotations

from .server_auth import access_headers

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone

from . import discovery, sponsorship
from .ats import ATS_CONNECTORS
from .boards import fetch_board_jobs, normalize_jobspy_row
from .niche_boards import NICHE_CONNECTORS
from .common import OUT_DIR, load_companies, load_config, session
from .filters import apply_filters
from .ingest_client import post_batches


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _archive(name: str, postings: list[dict]) -> None:
    OUT_DIR.mkdir(exist_ok=True)
    path = OUT_DIR / f"raw-{name}-{_timestamp()}.jsonl"
    with open(path, "w", encoding="utf-8") as fh:
        for posting in postings:
            fh.write(json.dumps(posting) + "\n")


def _log(line: str) -> None:
    print(line, flush=True)
    OUT_DIR.mkdir(exist_ok=True)
    with open(OUT_DIR / "scrape.log", "a", encoding="utf-8") as fh:
        fh.write(f"{datetime.now(timezone.utc).isoformat()} {line}\n")


def run_boards(cfg: dict, dry_run: bool, limit: int | None) -> list[tuple[str, dict]]:
    rows, errors = fetch_board_jobs(cfg, limit=limit)
    for error in errors:
        _log(f"[boards] WARN {error}")

    normalized = [posting for posting in (normalize_jobspy_row(row) for row in rows) if posting]
    _archive("boards", normalized)
    kept, dropped = apply_filters(normalized, cfg)
    # job_type is stamped per search pass in boards.fetch_board_jobs (several types
    # can be searched in one run, so a blanket default here would mislabel rows).
    sponsorship.annotate_postings(session(), kept)
    _log(f"[boards] fetched={len(rows)} usable={len(normalized)} kept={len(kept)} dropped={dropped}")

    by_site: dict[str, list[dict]] = defaultdict(list)
    for posting in kept:
        by_site[posting["_source_site"]].append(posting)

    results = []
    for site, postings in sorted(by_site.items()):
        summary = post_batches(cfg["server"]["base_url"], site, postings, dry_run=dry_run)
        results.append((site, summary))
    return results


def run_ats(cfg: dict, dry_run: bool, company_filter: str | None, limit: int | None) -> list[tuple[str, dict]]:
    companies = load_companies()
    if company_filter:
        companies = [company for company in companies if company_filter.lower() in company.name.lower()]
        if not companies:
            _log(f"[ats] no company matches '{company_filter}'")
            return []

    sess = session()
    results = []
    for company in companies:
        connector = ATS_CONNECTORS.get(company.ats)
        if not connector:
            _log(f"[ats] {company.name}: unknown ats '{company.ats}', skipping")
            continue
        try:
            postings = connector(sess, company, cfg)
        except Exception as error:
            _log(f"[ats] {company.name} ({company.ats}): FAILED {type(error).__name__}: {error}")
            continue
        kept, dropped = apply_filters(postings, cfg)
        kept = kept[: limit or cfg["ats"]["per_company_limit"]]
        _log(f"[ats] {company.name} ({company.ats}): fetched={len(postings)} kept={len(kept)} dropped={dropped}")
        if not kept:
            continue
        sponsorship.annotate_postings(sess, kept, company_name=company.name)
        if company.tags:
            for posting in kept:
                posting["company_tags"] = list(company.tags)
        _archive(f"ats-{company.ats}", kept)
        source_site = company.ats if company.ats in ATS_SOURCE_SITES else "company_site"
        summary = post_batches(cfg["server"]["base_url"], source_site, kept, dry_run=dry_run)
        results.append((company.name, summary))
    return results


ATS_SOURCE_SITES = {"amazon", "greenhouse", "lever", "ashby", "smartrecruiters", "workday", "workable", "recruitee", "phenom"}


def run_niche(cfg: dict, dry_run: bool, limit: int | None) -> list[tuple[str, dict]]:
    sess = session()
    results = []
    for site, connector in NICHE_CONNECTORS.items():
        try:
            postings = connector(sess, cfg)
        except Exception as error:
            _log(f"[niche] {site}: FAILED {type(error).__name__}: {error}")
            continue
        if limit:
            postings = postings[:limit]
        kept, dropped = apply_filters(postings, cfg)
        _log(f"[niche] {site}: fetched={len(postings)} kept={len(kept)} dropped={dropped}")
        if not kept:
            continue
        _archive(f"niche-{site}", kept)
        sponsorship.annotate_postings(sess, kept)
        results.append((site, post_batches(cfg["server"]["base_url"], site, kept, dry_run=dry_run)))
    return results


def run_prune(cfg: dict, dry_run: bool) -> None:
    """Re-apply current filters to everything stored in the dashboard; delete failures.

    Useful after tightening filter rules: scrapes only add/refresh rows, they
    never remove ones that no longer qualify.
    """
    import requests as _requests

    from .filters import is_acceptable_location, is_entry_level, is_relevant

    from datetime import datetime, timedelta, timezone

    base = cfg["server"]["base_url"].rstrip("/")
    jobs = _requests.get(f"{base}/api/jobs", headers=access_headers(base), timeout=60).json().get("jobs", [])
    prune_cfg = cfg.get("prune", {})
    stale_days = prune_cfg.get("stale_after_days", 21)
    stale_cutoff = (datetime.now(timezone.utc) - timedelta(days=stale_days)).isoformat()
    removed = 0
    for job in jobs:
        detail = _requests.get(f"{base}/api/jobs", headers=access_headers(base), params={"id": job["id"]}, timeout=60).json().get("jobs", [{}])[0]
        title = detail.get("title", "")
        description = detail.get("rawDescription", "") or ""
        location = detail.get("location", "")
        reasons = []
        if not is_relevant(title, cfg):
            reasons.append("irrelevant title")
        if not is_acceptable_location(location, cfg):
            reasons.append("foreign location")
        markers = cfg.get("location", {}).get("exclude_markers", [])
        if any(marker.lower() in title.lower() for marker in markers):
            reasons.append("foreign title")
        if not is_entry_level(title, description, cfg):
            reasons.append("not entry level")
        # Stale rule: untouched "new" postings older than the cutoff are dead
        # weight — postings the user shortlisted/tailored/applied are kept forever.
        if detail.get("status") == "new" and (detail.get("fetchedAt") or "9999") < stale_cutoff:
            reasons.append(f"stale (untouched > {stale_days}d)")
        if not reasons:
            continue
        # Jobs the user touched (shortlisted/ready/applied/...) are never
        # auto-deleted — surface the mismatch and let the human decide.
        if detail.get("status") != "new":
            _log(f"[prune] FLAGGED (kept — status {detail.get('status')}): {title} @ {detail.get('company')} ({'; '.join(reasons)})")
            continue
        removed += 1
        _log(f"[prune] {'would remove' if dry_run else 'removing'}: {title} @ {detail.get('company')} ({'; '.join(reasons)})")
        if not dry_run:
            _requests.delete(f"{base}/api/jobs", headers=access_headers(base), json={"id": job["id"]}, timeout=60)
    _log(f"[prune] {'flagged' if dry_run else 'removed'} {removed} of {len(jobs)} stored jobs")


def run_discover(apply: bool) -> None:
    proposals = discovery.discover_from_archives()
    if not proposals:
        _log("[discover] no new companies found — run a boards scrape first (archives feed discovery)")
        return
    OUT_DIR.mkdir(exist_ok=True)
    out_path = OUT_DIR / "discovered-companies.yml"
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("# Proposed companies detected from aggregator job_url_direct links\n")
        for proposal in proposals:
            fh.write(f"- {json.dumps(proposal)}\n")
    _log(f"[discover] proposed {len(proposals)} companies -> {out_path}")
    for proposal in proposals[:20]:
        _log(f"[discover]   {proposal.get('name')}: {proposal.get('ats')} ({proposal.get('sample_url', '')[:80]})")
    if apply:
        added = discovery.apply_proposals(proposals)
        _log(f"[discover] appended {added} entries to companies.yml")


def print_summary(results: list[tuple[str, dict]]) -> dict:
    if not results:
        return {"sent": 0, "created": 0, "refreshed": 0, "skipped": 0, "errors": 0}
    _log(f"{'source':<28} {'sent':>5} {'created':>8} {'refreshed':>10} {'skipped':>8}")
    totals = {"sent": 0, "created": 0, "refreshed": 0, "skipped": 0}
    for name, summary in results:
        _log(f"{name:<28} {summary['sent']:>5} {summary['created']:>8} {summary['refreshed']:>10} {summary['skipped']:>8}")
        for key in totals:
            totals[key] += summary[key]
        for error in summary["errors"]:
            _log(f"  ERROR {name}: {error}")
    _log(f"{'TOTAL':<28} {totals['sent']:>5} {totals['created']:>8} {totals['refreshed']:>10} {totals['skipped']:>8}")
    return {**totals, "errors": sum(len(summary["errors"]) for _, summary in results)}


def main() -> int:
    # Windows' console encoding defaults to the system locale (not UTF-8), which
    # silently mangles the non-ASCII characters (em dashes, etc.) used in log
    # messages below. Force UTF-8 for stdout/stderr when this runs as the CLI.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(prog="jobagent-scraper")
    subparsers = parser.add_subparsers(dest="command")

    scrape = subparsers.add_parser("scrape", help="Scrape sources and ingest into the dashboard")
    scrape.add_argument("--source", choices=["boards", "ats", "niche", "all"], default="all")
    scrape.add_argument("--company", help="Only this company (substring match, ats source)")
    scrape.add_argument("--dry-run", action="store_true", help="Fetch + filter + archive, but do not POST")
    scrape.add_argument("--limit", type=int, help="Cap postings per source (for testing)")

    discover = subparsers.add_parser("discover", help="Propose new companies from archived board scrapes")
    discover.add_argument("--apply", action="store_true", help="Append proposals to companies.yml")

    prune = subparsers.add_parser("prune", help="Delete stored jobs that no longer pass current filters")
    prune.add_argument("--dry-run", action="store_true", help="Report what would be removed without deleting")

    mail = subparsers.add_parser("mail", help="Scan Gmail for application responses and update statuses")
    mail.add_argument("--days", type=int, default=7, help="How many days of mail to scan (default 7)")
    mail.add_argument("--dry-run", action="store_true", help="Report without changing statuses")
    mail.add_argument(
        "--defer-to-cloud", action="store_true",
        help="Skip when the cloud cron checked mail recently (the scheduled launchd run uses this)",
    )

    mail_json = subparsers.add_parser(
        "mail-from-json",
        help="Same conservative status-update pass as `mail`, but for messages pre-fetched by the /mail-check "
        "skill via the Gmail MCP connector instead of IMAP (used when no GMAIL_APP_PASSWORD is configured)",
    )
    mail_json.add_argument("path", help="JSON file: a list of {sender, subject, body} message dicts")
    mail_json.add_argument("--dry-run", action="store_true", help="Report without changing statuses")

    args = parser.parse_args()
    command = args.command or "scrape"

    if command == "discover":
        run_discover(args.apply)
        return 0
    if command == "prune":
        run_prune(load_config(), args.dry_run)
        return 0
    if command == "mail":
        from .mailtracker import cloud_checked_recently, run_mail

        cfg = load_config()
        if args.defer_to_cloud and cloud_checked_recently(cfg, _log):
            return 0
        run_mail(cfg, args.days, args.dry_run, _log)
        return 0
    if command == "mail-from-json":
        from .mailtracker import run_mail_from_messages

        with open(args.path, encoding="utf-8") as fh:
            messages = json.load(fh)
        run_mail_from_messages(load_config(), messages, args.dry_run, _log)
        return 0

    cfg = load_config()
    if not cfg["search"].get("terms") or not cfg["relevance"].get("title_keywords"):
        print("No search terms in scraper/config.yml yet. Run /onboard in Claude Code first.", file=sys.stderr)
        return 1
    results: list[tuple[str, dict]] = []
    if args.source in ("ats", "all"):
        results.extend(run_ats(cfg, args.dry_run, args.company, args.limit))
    if args.source in ("niche", "all") and not args.company:
        results.extend(run_niche(cfg, args.dry_run, args.limit))
    if args.source in ("boards", "all") and not args.company:
        results.extend(run_boards(cfg, args.dry_run, args.limit))
    totals = print_summary(results)
    # Only a full scrape counts as "the daily scrape" on the dashboard.
    if args.source == "all" and not (args.company or args.limit or args.dry_run):
        from .runs_client import report_run

        report_run(cfg["server"]["base_url"], "scrape", totals["errors"] == 0, totals, _log)
    return 0


if __name__ == "__main__":
    sys.exit(main())
