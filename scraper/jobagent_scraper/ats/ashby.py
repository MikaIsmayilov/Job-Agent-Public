"""Ashby public posting API: api.ashbyhq.com/posting-api/job-board/{token}"""

from __future__ import annotations

from ..common import Company, get_json, html_to_text, make_posting, to_structured


def fetch(sess, company: Company, cfg: dict) -> list[dict]:
    data = get_json(
        sess,
        f"https://api.ashbyhq.com/posting-api/job-board/{company.token}",
        params={"includeCompensation": "true"},
    )
    postings = []
    for job in data.get("jobs", []):
        title = job.get("title", "")
        url = job.get("jobUrl") or job.get("applyUrl") or ""
        location = job.get("location", "") or ""
        description = html_to_text(job.get("descriptionHtml") or "") or (job.get("descriptionPlain") or "")
        date_posted = (job.get("publishedAt") or "")[:10] or None
        is_remote = bool(job.get("isRemote"))
        employment = (job.get("employmentType") or "").lower()
        salary = job.get("compensation", {}).get("compensationTierSummary") if isinstance(job.get("compensation"), dict) else None
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
                salary=salary,
                work_mode="Remote" if is_remote else None,
                job_type="fulltime" if "fulltime" in employment or "full-time" in employment or "full time" in employment else None,
                structured=to_structured(title, company.name, location, date_posted, None, description, remote=is_remote),
            )
        )
    return postings
