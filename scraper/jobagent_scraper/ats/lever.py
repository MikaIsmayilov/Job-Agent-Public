"""Lever public postings API: api.lever.co/v0/postings/{token}?mode=json"""

from __future__ import annotations

from datetime import datetime, timezone

from ..common import Company, get_json, make_posting, to_structured


def fetch(sess, company: Company, cfg: dict) -> list[dict]:
    data = get_json(sess, f"https://api.lever.co/v0/postings/{company.token}", params={"mode": "json"})
    postings = []
    for job in data if isinstance(data, list) else []:
        title = job.get("text", "")
        url = job.get("hostedUrl", "")
        categories = job.get("categories") or {}
        location = categories.get("location", "") or ""
        commitment = (categories.get("commitment") or "").lower()
        description = job.get("descriptionPlain") or ""
        created = job.get("createdAt")
        date_posted = (
            datetime.fromtimestamp(created / 1000, tz=timezone.utc).date().isoformat() if isinstance(created, (int, float)) else None
        )
        workplace = (job.get("workplaceType") or "").lower()
        work_mode = {"remote": "Remote", "hybrid": "Hybrid", "on-site": "Onsite", "onsite": "Onsite"}.get(workplace)
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
                work_mode=work_mode,
                job_type="fulltime" if "full" in commitment else None,
                structured=to_structured(title, company.name, location, date_posted, None, description,
                                         remote=workplace == "remote"),
            )
        )
    return postings
