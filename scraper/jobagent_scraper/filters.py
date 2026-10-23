"""Entry-level and relevance filtering over normalized postings."""

from __future__ import annotations

import re

from .country import country

_RANGE_RE = re.compile(r"(\d{1,2})\s*[-–—]\s*\d{1,2}\s*\+?\s*(?:years?|yrs?)", re.IGNORECASE)
_PLUS_RE = re.compile(r"(\d{1,2})\s*\+?\s*(?:years?|yrs?)", re.IGNORECASE)
_EXPERIENCE_WINDOW = 60

# JDs also spell bars out: "three to five years", "FIVE (5) years", "two years'
# experience". Normalizing to digit form lets the digit patterns (and their
# range-lower-bound rule) apply unchanged. About one posting in ten states its
# bar only in words.
_WORD_NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
_WORD_NUM_RE = re.compile(r"\b(one|two|three|four|five|six|seven|eight|nine|ten)\b(\s*\(\s*\d{1,2}\s*\))?", re.IGNORECASE)
_TO_RANGE_RE = re.compile(r"(\d{1,2})\s+to\s+(\d{1,2})(\s*\+?\s*(?:years?|yrs?))", re.IGNORECASE)


def _normalize_years_text(lower: str) -> str:
    lower = _WORD_NUM_RE.sub(lambda match: str(_WORD_NUMBERS[match.group(1).lower()]), lower)
    return _TO_RANGE_RE.sub(r"\1-\2\3", lower)


def years_required(description: str) -> int | None:
    """Highest years-of-experience demand stated in the posting.

    MAX, not min: a JD saying "3-5 years of experience, with at least 2 years
    in support ops" requires BOTH — taking the minimum let the smaller
    sub-requirement mask the real bar (this mislabeled real postings as entry).
    Conservative direction: over-estimating drops a maybe; under-estimating
    wastes tailoring and applications on roles that state a hard bar.
    Values > 10 are ignored as noise ("25 years in business").
    """
    if not description:
        return None
    found: list[int] = []
    lower = _normalize_years_text(description.lower())
    consumed: list[tuple[int, int]] = []
    for pattern in (_RANGE_RE, _PLUS_RE):
        for match in pattern.finditer(lower):
            start, end = match.span()
            # A range like "0-2 years" contributes its LOWER bound once; the
            # plus-pattern must not re-capture the range's upper bound.
            if pattern is _PLUS_RE and any(s <= start < e for s, e in consumed):
                continue
            window = lower[max(0, start - _EXPERIENCE_WINDOW) : end + _EXPERIENCE_WINDOW]
            trailing = lower[end : end + 4]
            if "experience" in window or trailing.startswith((" in ", " of ", " as ")):
                value = int(match.group(1))
                if value <= 10:
                    found.append(value)
                    if pattern is _RANGE_RE:
                        consumed.append((start, end))
    return max(found) if found else None


def classify_experience(title: str, description: str, cfg: dict) -> str:
    include_re = re.compile(cfg["entry_level"]["include_title"])
    exclude_re = re.compile(cfg["entry_level"]["exclude_title"])
    years = years_required(description)
    if years is not None:
        if years <= 2:
            return "entry"
        if years <= 5:
            return "mid"
        return "senior"
    if include_re.search(title):
        return "entry"
    if exclude_re.search(title):
        return "senior"
    return "unknown"


def is_entry_level(title: str, description: str, cfg: dict) -> bool:
    entry_cfg = cfg["entry_level"]
    # Off for experienced searches: every seniority is kept and only tagged.
    if entry_cfg.get("enabled", True) is False:
        return True
    include_re = re.compile(entry_cfg["include_title"])
    exclude_re = re.compile(entry_cfg["exclude_title"])

    # Seniority markers in the title beat junior markers: "Senior Associate" is
    # not entry level even though it contains "associate".
    years = years_required(description)
    if years is not None and years > entry_cfg["max_years_required"]:
        return False
    if exclude_re.search(title):
        return False
    if include_re.search(title):
        return True
    if years is not None:
        return years <= entry_cfg["max_years_required"]
    return bool(entry_cfg.get("keep_unknown", True))


_JOB_TYPE_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("internship", re.compile(r"\b(intern(ship)?|co-?op)\b", re.IGNORECASE)),
    ("contract", re.compile(r"\b(contract(or)?|fixed[- ]term|temporary|temp)\b", re.IGNORECASE)),
    ("parttime", re.compile(r"\bpart[- ]?time\b", re.IGNORECASE)),
    ("fulltime", re.compile(r"\bfull[- ]?time\b", re.IGNORECASE)),
]


def detect_job_type(title: str, description: str) -> str | None:
    """Infer employment type from the posting text when the source omits it."""
    for candidate, pattern in _JOB_TYPE_PATTERNS:
        if pattern.search(title):
            return candidate
    for candidate, pattern in _JOB_TYPE_PATTERNS:
        if pattern.search(description):
            return candidate
    return None


def is_relevant(title: str, cfg: dict) -> bool:
    lower = title.lower()
    return any(keyword.lower() in lower for keyword in cfg["relevance"]["title_keywords"])


_REGION_CODE_RE = re.compile(r",\s*([A-Z]{2})\b")


def _exclude_markers(cfg: dict) -> list[str]:
    """Config markers plus the searched country's neighbour markers."""
    return list(cfg.get("location", {}).get("exclude_markers", [])) + country(cfg)["foreign_markers"]


def _has_word(text: str, markers: list[str]) -> bool:
    # Whole words: "usa" must not match "Usak", "India" not "Indianapolis",
    # "Maine" not the French "domaine".
    lower = text.lower()
    return any(re.search(rf"(?<![a-zà-ÿ]){re.escape(marker.lower())}(?![a-zà-ÿ])", lower) for marker in markers)


def _names_home(text: str, cfg: dict) -> bool:
    return _has_word(text, country(cfg)["home_markers"])


def is_acceptable_location(location: str, cfg: dict) -> bool:
    """Drop clearly-foreign postings; keep home-country and ambiguous ones (drop-only heuristic).

    The home country is config.yml `search.country` (US or CA, see country.py).
    A location naming the home country is always kept, so multi-country
    listings ("Toronto, ON or New York, NY") survive either search.
    """
    if not location:
        return True
    if _names_home(location, cfg):
        return True
    # "City, XX" with a foreign region code (e.g. "Mississauga, ON" in a US
    # search, "Austin, TX" in a Canadian one) is foreign.
    codes = _REGION_CODE_RE.findall(location)
    home_codes = country(cfg)["region_codes"]
    if codes and not any(code in home_codes for code in codes):
        return False
    # Every code a home state/province: keep even when the city shares a
    # marker's name ("London, ON" in a Canadian search, "Paris, TX").
    if codes and all(code in home_codes for code in codes):
        return True
    words = country(cfg)["foreign_words"]
    if words and re.search(words, location):
        return False
    return not _has_word(location, _exclude_markers(cfg))


def is_foreign_title(title: str, cfg: dict) -> bool:
    """Global companies often put the country in the title ("PM, Australia").

    Markers only: the region-code rule would false-positive on titles like
    "Analyst, IT".
    """
    if _names_home(title, cfg):
        return False
    return _has_word(title, _exclude_markers(cfg))


def apply_filters(postings: list[dict], cfg: dict) -> tuple[list[dict], dict]:
    """Filter postings; annotate survivors with experience_level. Returns (kept, drop_counts)."""
    kept: list[dict] = []
    dropped = {"irrelevant_title": 0, "not_entry_level": 0, "foreign_location": 0}
    for posting in postings:
        title = posting.get("title", "")
        description = posting.get("description", "")
        if not is_relevant(title, cfg):
            dropped["irrelevant_title"] += 1
            continue
        if not is_acceptable_location(posting.get("location", ""), cfg):
            dropped["foreign_location"] += 1
            continue
        if is_foreign_title(title, cfg):
            dropped["foreign_location"] += 1
            continue
        if not is_entry_level(title, description, cfg):
            dropped["not_entry_level"] += 1
            continue
        posting.setdefault("experience_level", classify_experience(title, description, cfg))
        if not posting.get("job_type"):
            detected = detect_job_type(title, description)
            if detected:
                posting["job_type"] = detected
        kept.append(posting)
    return kept, dropped
