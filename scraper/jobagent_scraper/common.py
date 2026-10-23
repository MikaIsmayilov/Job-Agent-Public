"""Shared config loading, HTTP helpers, and the normalized posting contract.

A normalized posting is a plain dict matching the ingest API's jobs[] element:
  title, company, description, url  (required)
  location, date_posted, valid_through, salary, work_mode,
  job_type, experience_level, structured  (optional)
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests
import yaml

SCRAPER_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SCRAPER_DIR.parent
OUT_DIR = SCRAPER_DIR / "out"

USER_AGENT = "JobAgent/0.3 personal job aggregator (contact: local use)"
REQUEST_TIMEOUT = 20


def env_value(key: str) -> str:
    """Read a secret from the shell environment, falling back to the repo .env.

    The daily routine invokes subcommands directly (without sourcing .env the
    way scrape.sh does), so every credential lookup must have this fallback.
    """
    value = os.environ.get(key, "")
    if value:
        return value
    env_file = REPO_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip()
    return ""


@dataclass
class Company:
    name: str
    ats: str
    token: str = ""
    tenant: str = ""
    wd: str = "wd1"
    site: str = ""
    base_url: str = ""
    careers_url: str = ""
    tags: list = field(default_factory=list)
    extra: dict = field(default_factory=dict)


def load_config(path: Path | None = None) -> dict:
    with open(path or SCRAPER_DIR / "config.yml", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_companies(path: Path | None = None, regions: list[str] | None = None) -> list[Company]:
    """companies.yml plus each opt-in regional pack scraper/companies/<region>.yml.

    Packs are listed in config.yml `ats.regions` (e.g. ["canada"]); /onboard
    picks them from the user's places. A company in both files is loaded once.
    """
    paths = [path or SCRAPER_DIR / "companies.yml"]
    for region in regions or []:
        pack = SCRAPER_DIR / "companies" / f"{region}.yml"
        if pack.exists():
            paths.append(pack)
        else:
            print(f"[ats] regional company pack '{region}' not found at {pack}, skipping", file=sys.stderr)
    companies = []
    seen: set[str] = set()
    for source in paths:
        with open(source, encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        for entry in data.get("companies", []):
            known = {k: entry[k] for k in ("name", "ats", "token", "tenant", "wd", "site", "base_url", "careers_url", "tags") if k in entry}
            extra = {k: v for k, v in entry.items() if k not in known}
            if known.get("name", "").lower() in seen:
                continue
            seen.add(known.get("name", "").lower())
            companies.append(Company(**known, extra=extra))
    return companies


def session() -> requests.Session:
    sess = requests.Session()
    sess.headers.update({"user-agent": USER_AGENT, "accept": "application/json, text/html;q=0.8"})
    return sess


def get_json(sess: requests.Session, url: str, **kwargs) -> Any:
    response = sess.get(url, timeout=REQUEST_TIMEOUT, **kwargs)
    response.raise_for_status()
    return response.json()


def post_json(sess: requests.Session, url: str, payload: dict, **kwargs) -> Any:
    response = sess.post(url, json=payload, timeout=REQUEST_TIMEOUT, **kwargs)
    response.raise_for_status()
    return response.json()


_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_RE = re.compile(r"<(script|style)[\s\S]*?</\1>", re.IGNORECASE)
_BLOCK_RE = re.compile(r"</(p|div|li|h[1-6]|section|tr)>|<br\s*/?>", re.IGNORECASE)


def html_to_text(value: str) -> str:
    """Strip HTML to readable plain text (mirrors lib/job-provenance.ts htmlToText).

    Unescapes BEFORE stripping: Greenhouse-style APIs return entity-escaped
    HTML ("&lt;p&gt;…"), and unescaping after stripping would resurrect tags.
    """
    if not value:
        return ""
    text = html.unescape(value)
    text = _SCRIPT_RE.sub(" ", text)
    text = _BLOCK_RE.sub("\n", text)
    text = _TAG_RE.sub(" ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def to_structured(
    title: str,
    company: str,
    location: str = "",
    date_posted: str | None = None,
    valid_through: str | None = None,
    description_text: str = "",
    remote: bool = False,
) -> dict:
    """Synthesize the JSON-LD JobPosting shape the app treats as structured evidence."""
    parts = [part.strip() for part in (location or "").split(",")]
    structured: dict[str, Any] = {
        "@type": "JobPosting",
        "title": title,
        "hiringOrganization": {"name": company},
        "description": description_text,
    }
    if location:
        structured["jobLocation"] = {
            "address": {"addressLocality": parts[0], "addressRegion": parts[1] if len(parts) > 1 else ""}
        }
    if remote:
        structured["jobLocationType"] = "TELECOMMUTE"
    if date_posted:
        structured["datePosted"] = date_posted
    if valid_through:
        structured["validThrough"] = valid_through
    return structured


def make_posting(
    *,
    title: str,
    company: str,
    description: str,
    url: str,
    location: str = "",
    date_posted: str | None = None,
    valid_through: str | None = None,
    salary: str | None = None,
    work_mode: str | None = None,
    job_type: str | None = None,
    structured: dict | None = None,
) -> dict:
    posting = {
        "title": title.strip(),
        "company": company.strip(),
        "description": description.strip(),
        "url": url,
        "location": location.strip(),
    }
    if date_posted:
        posting["date_posted"] = date_posted
    if valid_through:
        posting["valid_through"] = valid_through
    if salary:
        posting["salary"] = salary
    if work_mode:
        posting["work_mode"] = work_mode
    if job_type:
        posting["job_type"] = job_type
    if structured:
        posting["structured"] = structured
    return posting


JSONLD_SCRIPT_RE = re.compile(
    r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>([\s\S]*?)</script>", re.IGNORECASE
)


def extract_jobposting_jsonld(page_html: str) -> dict | None:
    """Find a JSON-LD JobPosting object in an HTML page (handles @graph and arrays)."""
    for match in JSONLD_SCRIPT_RE.finditer(page_html):
        try:
            parsed = json.loads(html.unescape(match.group(1)))
        except (json.JSONDecodeError, ValueError):
            continue
        candidates = parsed if isinstance(parsed, list) else [parsed]
        queue = list(candidates)
        while queue:
            candidate = queue.pop(0)
            if not isinstance(candidate, dict):
                continue
            graph = candidate.get("@graph")
            if isinstance(graph, list):
                queue.extend(graph)
            types = candidate.get("@type")
            type_list = types if isinstance(types, list) else [types]
            if "JobPosting" in [t for t in type_list if isinstance(t, str)]:
                return candidate
    return None
