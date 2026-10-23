"""Discovery flywheel: harvest company ATS boards from aggregator results.

Aggregator postings usually carry a job_url_direct pointing at the company's own
ATS page. Detect the ATS platform + board token from those URLs and propose new
companies.yml entries, so the registry converges toward every company that
posts the target roles anywhere — including ones that skip LinkedIn/Indeed.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlparse

import yaml

from .common import OUT_DIR, SCRAPER_DIR

_WORKDAY_RE = re.compile(r"^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$", re.IGNORECASE)


def detect_ats(url: str) -> dict | None:
    """Return a companies.yml-shaped entry guess for a direct ATS URL, else None."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    host = parsed.netloc.lower().replace("www.", "")
    parts = [part for part in parsed.path.split("/") if part]

    if host in ("boards.greenhouse.io", "job-boards.greenhouse.io") and parts:
        return {"ats": "greenhouse", "token": parts[0]}
    if host == "jobs.lever.co" and parts:
        return {"ats": "lever", "token": parts[0]}
    if host == "jobs.ashbyhq.com" and parts:
        return {"ats": "ashby", "token": parts[0]}
    if host == "jobs.smartrecruiters.com" and parts:
        return {"ats": "smartrecruiters", "token": parts[0]}
    if host == "apply.workable.com" and parts:
        return {"ats": "workable", "token": parts[0]}
    if host.endswith(".recruitee.com"):
        return {"ats": "recruitee", "token": host.split(".")[0]}
    workday = _WORKDAY_RE.match(host)
    if workday and parts:
        # Path shape: /{locale}/{site}/job/... or /{site}/job/...
        site = parts[1] if parts and re.match(r"^[a-z]{2}-[A-Z]{2}$", parts[0]) and len(parts) > 1 else parts[0]
        return {"ats": "workday", "tenant": workday.group(1), "wd": workday.group(2).lower(), "site": site}
    return None


def discover_from_archives(archive_dir: Path | None = None) -> list[dict]:
    """Scan archived board scrapes for direct ATS URLs and propose new companies."""
    directory = archive_dir or OUT_DIR
    known_tokens = _known_identities()
    proposals: dict[str, dict] = {}

    for jsonl in sorted(directory.glob("raw-boards-*.jsonl")):
        for line in jsonl.read_text().splitlines():
            try:
                posting = json.loads(line)
            except json.JSONDecodeError:
                continue
            direct = posting.get("_direct_url") or ""
            if not direct:
                continue
            entry = detect_ats(direct)
            if not entry:
                continue
            identity = _identity(entry)
            if identity in known_tokens or identity in proposals:
                continue
            proposals[identity] = {
                "name": posting.get("company", identity),
                **entry,
                "sample_posting": posting.get("title", ""),
                "sample_url": direct,
            }
    return list(proposals.values())


def apply_proposals(proposals: list[dict], companies_path: Path | None = None) -> int:
    """Append proposals to companies.yml (minus the sample_* annotations)."""
    path = companies_path or SCRAPER_DIR / "companies.yml"
    if not proposals:
        return 0
    lines = ["", "  # ---- auto-discovered (verify with a curl before trusting) ----"]
    for proposal in proposals:
        entry = {key: value for key, value in proposal.items() if not key.startswith("sample_")}
        rendered = ", ".join(f'{key}: "{value}"' if key == "name" else f"{key}: {value}" for key, value in entry.items())
        lines.append(f"  - {{ {rendered} }}")
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    return len(proposals)


def _identity(entry: dict) -> str:
    if entry["ats"] == "workday":
        return f"workday:{entry['tenant']}"
    return f"{entry['ats']}:{entry.get('token', '')}"


def _known_identities(companies_path: Path | None = None) -> set[str]:
    # Regional packs count as known too, so discovery never re-proposes them.
    paths = [companies_path] if companies_path else [SCRAPER_DIR / "companies.yml", *sorted((SCRAPER_DIR / "companies").glob("*.yml"))]
    identities = set()
    for path in paths:
        if not path.exists():
            continue
        data = yaml.safe_load(path.read_text()) or {}
        for entry in data.get("companies", []):
            if entry.get("ats") == "workday":
                identities.add(f"workday:{entry.get('tenant', '')}")
            else:
                identities.add(f"{entry.get('ats', '')}:{entry.get('token', '')}")
    return identities
