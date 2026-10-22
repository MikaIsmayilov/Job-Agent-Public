"""SmartRecruiters public API: api.smartrecruiters.com/v1/companies/{token}/postings"""

from __future__ import annotations

from ..common import Company, get_json, html_to_text, make_posting, to_structured


def fetch(sess, company: Company, cfg: dict) -> list[dict]:
    limit = cfg["ats"]["per_company_limit"]
    detail_limit = cfg["ats"]["detail_fetch_limit"]
    base = f"https://api.smartrecruiters.com/v1/companies/{company.token}/postings"
    data = get_json(sess, base, params={"limit": min(limit, 100)})
    postings = []
    for item in data.get("content", [])[:detail_limit]:
        posting_id = item.get("id")
        title = item.get("name", "")
        location_data = item.get("location") or {}
        city = location_data.get("city", "")
        region = location_data.get("region", "")
        location = ", ".join(part for part in (city, region) if part)
        remote = bool(location_data.get("remote"))
        released = (item.get("releasedDate") or "")[:10] or None
        employment = ((item.get("typeOfEmployment") or {}).get("label") or "").lower()
        if not (posting_id and title):
            continue
        try:
            detail = get_json(sess, f"{base}/{posting_id}")
        except Exception:
            continue
        sections = ((detail.get("jobAd") or {}).get("sections")) or {}
        description = "\n".join(
            html_to_text(section.get("text", ""))
            for key in ("companyDescription", "jobDescription", "qualifications", "additionalInformation")
            if isinstance((section := sections.get(key)), dict)
        ).strip()
        url = f"https://jobs.smartrecruiters.com/{company.token}/{posting_id}"
        if not description:
            continue
        postings.append(
            make_posting(
                title=title,
                company=company.name,
                description=description,
                url=url,
                location=location,
                date_posted=released,
                work_mode="Remote" if remote else None,
                job_type="fulltime" if "full" in employment else None,
                structured=to_structured(title, company.name, location, released, None, description, remote=remote),
            )
        )
    return postings
