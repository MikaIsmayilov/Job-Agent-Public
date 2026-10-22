"""Generic careers-site crawler: works for any company regardless of ATS.

Given a careers URL, collect candidate job-detail links (listing page + sitemap),
fetch each, and keep pages that expose a JSON-LD JobPosting — the same schema
the app's importer parses. This is the long-tail catch-all for companies on
proprietary career systems.
"""

from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

from .common import Company, extract_jobposting_jsonld, html_to_text, make_posting, REQUEST_TIMEOUT

_HREF_RE = re.compile(r"href=[\"']([^\"'#]+)[\"']", re.IGNORECASE)
_JOB_PATH_RE = re.compile(r"/(job|jobs|careers?|position|opening|vacancy|requisition)[s]?/", re.IGNORECASE)
_SITEMAP_LOC_RE = re.compile(r"<loc>([^<]+)</loc>", re.IGNORECASE)


def _candidate_links(sess, careers_url: str, limit: int) -> list[str]:
    origin = f"{urlparse(careers_url).scheme}://{urlparse(careers_url).netloc}"
    candidates: list[str] = []
    seen: set[str] = set()

    def add(url: str) -> None:
        absolute = urljoin(careers_url, url)
        if not absolute.startswith("http") or urlparse(absolute).netloc != urlparse(careers_url).netloc:
            return
        if _JOB_PATH_RE.search(urlparse(absolute).path) and absolute not in seen and absolute != careers_url:
            seen.add(absolute)
            candidates.append(absolute)

    try:
        page = sess.get(careers_url, timeout=REQUEST_TIMEOUT)
        if page.ok:
            for href in _HREF_RE.findall(page.text):
                add(href)
    except Exception:
        pass

    if len(candidates) < limit:
        try:
            sitemap = sess.get(f"{origin}/sitemap.xml", timeout=REQUEST_TIMEOUT)
            if sitemap.ok:
                for loc in _SITEMAP_LOC_RE.findall(sitemap.text)[:2000]:
                    add(loc.strip())
        except Exception:
            pass

    return candidates[: limit * 4]


def fetch_company_site(sess, company: Company, cfg: dict) -> list[dict]:
    detail_limit = cfg["ats"]["detail_fetch_limit"]
    postings = []
    for url in _candidate_links(sess, company.careers_url, detail_limit):
        if len(postings) >= detail_limit:
            break
        try:
            page = sess.get(url, timeout=REQUEST_TIMEOUT)
            if not page.ok:
                continue
            structured = extract_jobposting_jsonld(page.text)
        except Exception:
            continue
        if not structured:
            continue
        title = structured.get("title") if isinstance(structured.get("title"), str) else ""
        org = structured.get("hiringOrganization")
        org_name = org.get("name") if isinstance(org, dict) and isinstance(org.get("name"), str) else company.name
        description = html_to_text(structured.get("description", "")) if isinstance(structured.get("description"), str) else ""
        date_posted = structured.get("datePosted") if isinstance(structured.get("datePosted"), str) else None
        valid_through = structured.get("validThrough") if isinstance(structured.get("validThrough"), str) else None
        if not (title and len(description) >= 120):
            continue
        postings.append(
            make_posting(
                title=title,
                company=org_name or company.name,
                description=description,
                url=url,
                date_posted=date_posted[:10] if date_posted else None,
                valid_through=valid_through,
                structured=structured,
            )
        )
    return postings
