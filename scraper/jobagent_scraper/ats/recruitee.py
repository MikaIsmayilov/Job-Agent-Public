"""Recruitee public offers API: {token}.recruitee.com/api/offers/"""

from __future__ import annotations

from ..common import Company, get_json, html_to_text, make_posting, to_structured


def fetch(sess, company: Company, cfg: dict) -> list[dict]:
    data = get_json(sess, f"https://{company.token}.recruitee.com/api/offers/")
    postings = []
    for job in data.get("offers", []):
        title = job.get("title", "")
        url = job.get("careers_url") or ""
        location = job.get("location", "") or ""
        description = html_to_text((job.get("description") or "") + "\n" + (job.get("requirements") or ""))
        date_posted = (job.get("published_at") or "")[:10] or None
        remote = (job.get("remote_option") or "") in ("fully_remote", "hybrid_remote") or "remote" in location.lower()
        employment = (job.get("employment_type_code") or "").lower()
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
                job_type="fulltime" if "fulltime" in employment or "full_time" in employment else None,
                structured=to_structured(title, company.name, location, date_posted, None, description, remote=remote),
            )
        )
    return postings
