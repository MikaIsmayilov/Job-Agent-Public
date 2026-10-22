"""Workday CXS API: POST {tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs

Searches with the configured terms server-side, then fetches each posting's
detail endpoint for the full description.
"""

from __future__ import annotations

from ..common import Company, get_json, html_to_text, make_posting, post_json, to_structured


def fetch(sess, company: Company, cfg: dict) -> list[dict]:
    detail_limit = cfg["ats"]["detail_fetch_limit"]
    base = f"https://{company.tenant}.{company.wd}.myworkdayjobs.com"
    cxs = f"{base}/wday/cxs/{company.tenant}/{company.site}"

    seen: dict[str, dict] = {}
    for term in cfg["search"]["terms"]:
        try:
            data = post_json(sess, f"{cxs}/jobs", {"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": term})
        except Exception:
            continue
        for item in data.get("jobPostings", []):
            path = item.get("externalPath")
            if path and path not in seen:
                seen[path] = item
        if len(seen) >= detail_limit * 2:
            break

    postings = []
    for path, item in list(seen.items())[:detail_limit]:
        try:
            detail = get_json(sess, f"{cxs}{path}")
        except Exception:
            continue
        info = detail.get("jobPostingInfo") or {}
        title = info.get("title") or item.get("title", "")
        description = html_to_text(info.get("jobDescription", ""))
        location = info.get("location", "") or item.get("locationsText", "")
        date_posted = (info.get("startDate") or "")[:10] or None
        url = info.get("externalUrl") or f"{base}/en-US/{company.site}{path}"
        time_type = (info.get("timeType") or "").lower()
        remote = "remote" in ((info.get("remoteType") or "") + location).lower()
        if not (title and description):
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
                job_type="fulltime" if "full" in time_type else None,
                structured=to_structured(title, company.name, location, date_posted, None, description, remote=remote),
            )
        )
    return postings
