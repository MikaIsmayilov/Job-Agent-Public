"""Phenom People careers sites (e.g. PwC's jobs-us.pwc.com).

Search via the site's /widgets refineSearch JSON endpoint, then pull each job's
detail page and read its JSON-LD JobPosting for the full grounded description.
Phenom payload shapes vary per site — everything here is defensive.
"""

from __future__ import annotations

from ..common import (
    Company,
    extract_jobposting_jsonld,
    html_to_text,
    make_posting,
    post_json,
    REQUEST_TIMEOUT,
)


def _search(sess, base_url: str, term: str) -> list[dict]:
    payload = {
        "lang": "en_us",
        "deviceType": "desktop",
        "country": "us",
        "pageName": "search-results",
        "ddoKey": "refineSearch",
        "sortBy": "Most recent",
        "subsearch": "",
        "from": 0,
        "jobs": True,
        "counts": True,
        "all_fields": ["category", "country", "state", "city", "type"],
        "size": 20,
        "clearAll": False,
        "jdsource": "facets",
        "isSliderEnable": False,
        "siteType": "external",
        "keywords": term,
        "global": True,
        "selected_fields": {},
        "locationData": {},
    }
    data = post_json(sess, f"{base_url.rstrip('/')}/widgets", payload)
    refine = data.get("refineSearch") or {}
    return ((refine.get("data") or {}).get("jobs")) or []


def _job_url(base_url: str, job: dict) -> str:
    for key in ("jobUrl", "applyUrl", "externalApply", "url"):
        value = job.get(key)
        if isinstance(value, str) and value.startswith("http"):
            return value
    seq = job.get("jobSeqNo") or job.get("jobId")
    return f"{base_url.rstrip('/')}/job/{seq}" if seq else ""


def fetch(sess, company: Company, cfg: dict) -> list[dict]:
    detail_limit = cfg["ats"]["detail_fetch_limit"]
    base_url = company.base_url
    seen: dict[str, dict] = {}
    for term in cfg["search"]["terms"]:
        try:
            for job in _search(sess, base_url, term):
                url = _job_url(base_url, job)
                if url and url not in seen:
                    seen[url] = job
        except Exception:
            continue
        if len(seen) >= detail_limit * 2:
            break

    postings = []
    for url, job in list(seen.items())[:detail_limit]:
        title = job.get("title", "")
        location = job.get("cityState") or ", ".join(p for p in (job.get("city", ""), job.get("state", "")) if p)
        date_posted = (job.get("postedDate") or "")[:10] or None
        description = ""
        structured = None
        try:
            page = sess.get(url, timeout=REQUEST_TIMEOUT)
            if page.ok:
                structured = extract_jobposting_jsonld(page.text)
                if structured and isinstance(structured.get("description"), str):
                    description = html_to_text(structured["description"])
        except Exception:
            structured = None
        if not description:
            description = job.get("descriptionTeaser") or ""
        if not (title and url and len(description) >= 120):
            continue
        postings.append(
            make_posting(
                title=title,
                company=company.name,
                description=description,
                url=url,
                location=location,
                date_posted=date_posted,
                structured=structured,
            )
        )
    return postings
