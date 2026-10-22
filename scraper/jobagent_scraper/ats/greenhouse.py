"""Greenhouse public board API: boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"""

from __future__ import annotations

from ..common import Company, get_json, html_to_text, make_posting, to_structured


def fetch(sess, company: Company, cfg: dict) -> list[dict]:
    # No raw cap: relevance/entry-level filtering happens downstream, and capping
    # raw rows would hide relevant roles deep in large boards. per_company_limit
    # is applied to KEPT postings by the caller.
    data = get_json(sess, f"https://boards-api.greenhouse.io/v1/boards/{company.token}/jobs", params={"content": "true"})
    postings = []
    for job in data.get("jobs", []):
        title = job.get("title", "")
        url = job.get("absolute_url", "")
        location = (job.get("location") or {}).get("name", "")
        description = html_to_text(job.get("content", ""))
        date_posted = (job.get("first_published") or job.get("updated_at") or "")[:10] or None
        if not (title and url and description):
            continue
        postings.append(
            make_posting(
                title=title,
                company=company.name,
                description=description,
                url=url,
                location=location,
                date_posted=date_posted,
                work_mode="Remote" if "remote" in location.lower() else None,
                structured=to_structured(title, company.name, location, date_posted, None, description,
                                         remote="remote" in location.lower()),
            )
        )
    return postings
