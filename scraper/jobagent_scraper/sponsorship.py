"""Company-level visa-sponsorship stance.

Used only as a fallback when a posting doesn't state its own policy. Sources:
1. data/sponsorship.yml — curated stances for known employers.
2. h1bdata.info — public DOL LCA disclosure data; a company with recent H-1B
   filings is marked "likely" (history, not a promise). Results are cached for
   30 days in scraper/out/sponsorship-cache.json; lookups per run are capped.

Both sources describe US (H-1B) sponsorship, so annotation is skipped when
config.yml searches another country: a US filing history says nothing about
a Canadian work permit.
"""

from __future__ import annotations

import json
import re
import time

import yaml

from .common import OUT_DIR, REPO_DIR, REQUEST_TIMEOUT
from .country import country_code

CACHE_PATH = OUT_DIR / "sponsorship-cache.json"
CURATED_PATH = REPO_DIR / "data" / "sponsorship.yml"
CACHE_TTL_SECONDS = 30 * 24 * 3600
MIN_FILINGS_FOR_LIKELY = 5
_ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_CELL_RE = re.compile(r"<td[^>]*>(?:<a[^>]*>)?([^<]+)")
# Tokens allowed after the company name in a legal employer name. Anything
# else ("HARVEY NASH", "HARVEY MUDD") is a different company entirely.
_GENERIC_SUFFIX = {
    "inc", "llc", "corp", "corporation", "co", "company", "ltd", "llp", "plc", "pc",
    "group", "holdings", "technologies", "technology", "tech", "labs", "lab",
    "ai", "io", "com", "us", "usa", "america", "services", "software",
}


def _matched_filings(html: str, company_norm: str) -> tuple[int, str]:
    """Count LCA rows whose employer IS this company (strict), not merely contains it."""
    count = 0
    display = ""
    for row in _ROW_RE.findall(html):
        cells = _CELL_RE.findall(row)
        if not cells:
            continue
        employer_norm = _normalize(cells[0])
        if not employer_norm.startswith(company_norm):
            continue
        remainder = employer_norm[len(company_norm):].split()
        if remainder and not all(token in _GENERIC_SUFFIX for token in remainder):
            continue
        count += 1
        display = display or cells[0].strip().title()
    return count, display

_curated: list[dict] | None = None
_cache: dict | None = None
_lookups_this_run = 0
MAX_LOOKUPS_PER_RUN = 40


def _normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()


def _load_curated() -> list[dict]:
    global _curated
    if _curated is None:
        try:
            data = yaml.safe_load(CURATED_PATH.read_text()) or {}
            _curated = data.get("companies", [])
        except Exception:
            _curated = []
    return _curated


def _load_cache() -> dict:
    global _cache
    if _cache is None:
        try:
            _cache = json.loads(CACHE_PATH.read_text())
        except Exception:
            _cache = {}
    return _cache


def _save_cache() -> None:
    if _cache is not None:
        OUT_DIR.mkdir(exist_ok=True)
        CACHE_PATH.write_text(json.dumps(_cache))


def company_stance(sess, company_name: str) -> tuple[str | None, str | None]:
    """Returns (stance, note) or (None, None) when nothing is known."""
    global _lookups_this_run
    normalized = _normalize(company_name)
    if not normalized:
        return None, None

    for entry in _load_curated():
        match = _normalize(str(entry.get("match", "")))
        # Whole-word match only: "ey" must not match "harvey".
        if match and re.search(rf"\b{re.escape(match)}\b", normalized):
            return entry.get("stance"), entry.get("note")

    cache = _load_cache()
    cached = cache.get(normalized)
    if cached and time.time() - cached.get("at", 0) < CACHE_TTL_SECONDS:
        return cached.get("stance"), cached.get("note")

    if _lookups_this_run >= MAX_LOOKUPS_PER_RUN:
        return None, None
    _lookups_this_run += 1

    stance: str | None = None
    note: str | None = None
    try:
        response = sess.get(
            "https://h1bdata.info/index.php",
            params={"em": company_name, "job": "", "city": "", "year": "All Years"},
            timeout=REQUEST_TIMEOUT,
        )
        if response.ok:
            filings, employer = _matched_filings(response.text, normalized)
            if filings >= MIN_FILINGS_FOR_LIKELY:
                stance = "likely"
                note = f"~{filings} H-1B LCA filings by {employer or company_name} on public record (h1bdata.info)"
    except Exception:
        return None, None

    cache[normalized] = {"stance": stance, "note": note, "at": time.time()}
    _save_cache()
    return stance, note


def annotate_postings(sess, postings: list[dict], company_name: str | None = None, cfg: dict | None = None) -> None:
    """Attach sponsorship_hint/_note to postings lacking them (in place). US searches only."""
    if cfg is not None and country_code(cfg) != "US":
        return
    for posting in postings:
        if posting.get("sponsorship_hint"):
            continue
        name = company_name or posting.get("company", "")
        stance, note = company_stance(sess, name)
        if stance:
            posting["sponsorship_hint"] = stance
            posting["sponsorship_note"] = note
