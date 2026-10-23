"""Niche job boards with public JSON APIs (idea borrowed from job-ops).

These skew remote/startup-friendly and cost a few HTTP requests each — no
scraping fragility. All are aggregator-kind sources (stay "unverified").

NOTE (verified live 2026-08): The Muse ignores its documented category/level
params and Remotive ignores `search` — both return generic feeds. We therefore
treat all three as raw feeds and rely entirely on the local relevance /
entry-level / location filters to pick the rare relevant posting.
"""

from __future__ import annotations

from .common import get_json, html_to_text, make_posting


def fetch_themuse(sess, cfg: dict) -> list[dict]:
    """The Muse public API (generic feed; server-side filters are ignored)."""
    postings = []
    for page in range(0, 3):
        data = get_json(
            sess,
            "https://www.themuse.com/api/public/jobs",
            params={"page": page, "level": "Entry Level"},
        )
        for job in data.get("results", []):
            title = job.get("name", "")
            company = (job.get("company") or {}).get("name", "")
            url = (job.get("refs") or {}).get("landing_page", "")
            description = html_to_text(job.get("contents", ""))
            locations = ", ".join(loc.get("name", "") for loc in job.get("locations", [])[:2])
            if not (title and company and url and len(description) >= 120):
                continue
            postings.append(
                make_posting(
                    title=title,
                    company=company,
                    description=description,
                    url=url,
                    location=locations,
                    date_posted=(job.get("publication_date") or "")[:10] or None,
                    work_mode="Remote" if "flexible / remote" in locations.lower() or "remote" in locations.lower() else None,
                )
            )
        if page + 1 >= data.get("page_count", 1):
            break
    return postings


def fetch_remotive(sess, cfg: dict) -> list[dict]:
    """Remotive public API — remote-only jobs, often with salary text."""
    postings = []
    seen: set[str] = set()
    # Remotive ignores `search` today, but the user's own terms cost nothing if it starts honouring it.
    for term in ((cfg.get("search") or {}).get("terms") or [""])[:3]:
        data = get_json(sess, "https://remotive.com/api/remote-jobs", params={"search": term, "limit": 50})
        for job in data.get("jobs", []):
            url = job.get("url", "")
            title = job.get("title", "")
            company = job.get("company_name", "")
            description = html_to_text(job.get("description", ""))
            if not (title and company and url and len(description) >= 120) or url in seen:
                continue
            seen.add(url)
            job_type_raw = (job.get("job_type") or "").replace("_", "")
            postings.append(
                make_posting(
                    title=title,
                    company=company,
                    description=description,
                    url=url,
                    location=job.get("candidate_required_location", "") or "Remote",
                    date_posted=(job.get("publication_date") or "")[:10] or None,
                    salary=job.get("salary") or None,
                    work_mode="Remote",
                    job_type="fulltime" if job_type_raw == "fulltime" else None,
                )
            )
    return postings


def fetch_workingnomads(sess, cfg: dict) -> list[dict]:
    """Working Nomads public API — remote jobs, one call for the full list."""
    data = get_json(sess, "https://www.workingnomads.com/api/exposed_jobs/")
    postings = []
    for job in data if isinstance(data, list) else []:
        title = job.get("title", "")
        company = job.get("company_name", "")
        url = job.get("url", "")
        description = html_to_text(job.get("description", ""))
        if not (title and company and url and len(description) >= 120):
            continue
        postings.append(
            make_posting(
                title=title,
                company=company,
                description=description,
                url=url,
                location=job.get("location", "") or "Remote",
                date_posted=(job.get("pub_date") or "")[:10] or None,
                work_mode="Remote",
            )
        )
    return postings


NICHE_CONNECTORS = {
    "themuse": fetch_themuse,
    "remotive": fetch_remotive,
    "workingnomads": fetch_workingnomads,
}
