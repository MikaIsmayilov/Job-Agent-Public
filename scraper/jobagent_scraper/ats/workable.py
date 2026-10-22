"""Workable public widget API: apply.workable.com/api/v1/widget/accounts/{token}?details=true"""

from __future__ import annotations

from ..common import Company, get_json, html_to_text, make_posting, to_structured


def fetch(sess, company: Company, cfg: dict) -> list[dict]:
    data = get_json(
        sess,
        f"https://apply.workable.com/api/v1/widget/accounts/{company.token}",
        params={"details": "true"},
    )
    postings = []
    for job in data.get("jobs", []):
        title = job.get("title", "")
        url = job.get("url") or job.get("shortlink") or ""
        location = ", ".join(part for part in (job.get("city", ""), job.get("state", "")) if part)
        description = html_to_text(job.get("description", ""))
        date_posted = (job.get("published_on") or "")[:10] or None
        employment = (job.get("employment_type") or "").lower()
        remote = bool(job.get("telecommuting"))
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
                work_mode="Remote" if remote else None,
                job_type="fulltime" if "full" in employment else None,
                structured=to_structured(title, company.name, location, date_posted, None, description, remote=remote),
            )
        )
    return postings
