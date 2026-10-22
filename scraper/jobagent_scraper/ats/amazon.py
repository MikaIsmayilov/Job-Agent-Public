"""Amazon's first-party job board: amazon.jobs public search JSON.

GET https://www.amazon.jobs/en/search.json?base_query=<term>&result_limit=50
Searches every configured term, keeps US postings, and builds the description
from the summary + basic + preferred qualifications so the fit scorer and the
years-of-experience filter see the real requirements.
"""

from __future__ import annotations

from datetime import datetime

from ..common import Company, get_json, html_to_text, make_posting, to_structured

BASE = "https://www.amazon.jobs"


def _posted_date(value: str) -> str | None:
    try:
        return datetime.strptime(value, "%B %d, %Y").date().isoformat()
    except (ValueError, TypeError):
        return None


def fetch(sess, company: Company, cfg: dict) -> list[dict]:
    limit = cfg["ats"]["per_company_limit"]
    seen: set[str] = set()
    postings: list[dict] = []

    for term in cfg["search"]["terms"]:
        if len(postings) >= limit:
            break
        try:
            data = get_json(
                sess,
                f"{BASE}/en/search.json",
                params={"base_query": term, "result_limit": 50, "offset": 0, "normalized_country_code[]": "USA"},
            )
        except Exception:
            continue
        for job in data.get("jobs", []):
            path = job.get("job_path", "")
            if not path or path in seen:
                continue
            seen.add(path)
            country = (job.get("country_code") or job.get("normalized_country_code") or "").upper()
            if country and country not in ("USA", "US"):
                continue
            title = job.get("title", "")
            description = html_to_text(
                " ".join(
                    part
                    for part in (
                        job.get("description") or job.get("description_short") or "",
                        job.get("basic_qualifications") or "",
                        job.get("preferred_qualifications") or "",
                    )
                    if part
                )
            )
            location = ", ".join(part for part in (job.get("city", ""), job.get("state", "")) if part)
            date_posted = _posted_date(job.get("posted_date", ""))
            schedule = (job.get("job_schedule_type") or "").lower().replace("-", "")
            if not (title and len(description) >= 120):
                continue
            postings.append(
                make_posting(
                    title=title,
                    company=job.get("company_name") or "Amazon",
                    description=description,
                    url=f"{BASE}{path}",
                    location=location,
                    date_posted=date_posted,
                    job_type="fulltime" if "fulltime" in schedule else None,
                    structured=to_structured(title, job.get("company_name") or "Amazon", location, date_posted, None, description),
                )
            )
            if len(postings) >= limit:
                break
    return postings
