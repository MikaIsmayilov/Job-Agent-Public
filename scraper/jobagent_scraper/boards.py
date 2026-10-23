"""Job-board scraping via python-jobspy (LinkedIn, Indeed, ZipRecruiter, Google, Glassdoor).

Indeed and Glassdoor search the country in config.yml `search.country`
(indeed.ca / glassdoor.ca for Canada); LinkedIn and Google follow the location strings.
"""

from __future__ import annotations

import math

from .country import country


def fetch_board_jobs(cfg: dict, limit: int | None = None) -> tuple[list[dict], list[str]]:
    """Run jobspy for every search term. Returns (normalized postings, error messages)."""
    from jobspy import scrape_jobs  # imported lazily: heavy dependency

    search = cfg["search"]
    boards = cfg["boards"]
    home = country(cfg)
    errors: list[str] = []
    rows: list[dict] = []

    # One pass per (job type, location) plus a remote pass per job type. Every
    # configured job_type is searched: taking only job_types[0] silently ignored
    # the rest, so a config asking for fulltime AND internship returned no
    # internships at all.
    job_types: list[str | None] = list(search.get("job_types") or [None])
    passes: list[dict] = [
        {"location": location, "is_remote": False, "job_type": job_type}
        for job_type in job_types
        for location in search["locations"]
    ]
    if search.get("remote_ok"):
        passes.extend(
            {"location": search.get("remote_location") or home["remote_location"], "is_remote": True, "job_type": job_type}
            for job_type in job_types
        )

    for term in search["terms"]:
        for search_pass in passes:
            try:
                frame = scrape_jobs(
                    site_name=boards["sites"],
                    search_term=term,
                    google_search_term=f"{term} jobs near {search_pass['location']}",
                    location=search_pass["location"],
                    distance=search.get("distance_miles", 50),
                    is_remote=search_pass["is_remote"],
                    results_wanted=search["results_wanted_per_term"],
                    hours_old=search["hours_old"],
                    job_type=search_pass["job_type"],
                    country_indeed=boards.get("country_indeed") or home["indeed"],
                    linkedin_fetch_description=boards.get("linkedin_fetch_description", True),
                    enforce_annual_salary=boards.get("enforce_annual_salary", True),
                    proxies=boards.get("proxies") or None,
                    verbose=0,
                )
            except Exception as error:
                errors.append(f"jobspy '{term}' @ {search_pass['location']}: {error}")
                continue
            # Remember which job_type this pass asked for: a board row that omits
            # the field still carries that classification, and with several types
            # searched the pass is the only place that knows which one.
            for record in frame.to_dict("records"):
                record["_searched_job_type"] = search_pass["job_type"]
                rows.append(record)
            if limit and len(rows) >= limit:
                return rows[:limit], errors
    return rows, errors


def _clean(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    return str(value).strip()


def normalize_jobspy_row(row: dict) -> dict | None:
    """Map one jobspy DataFrame row to the ingest jobs[] shape. None if unusable."""
    title = _clean(row.get("title"))
    company = _clean(row.get("company"))
    description = _clean(row.get("description"))
    url = _clean(row.get("job_url"))
    if not (title and company and url) or len(description) < 120:
        return None

    site = _clean(row.get("site")).lower()
    source_site = {"linkedin": "linkedin", "indeed": "indeed", "glassdoor": "glassdoor", "google": "google", "zip_recruiter": "zip_recruiter"}.get(site)
    if not source_site:
        return None

    currency = _clean(row.get("currency")) or "USD"
    min_amount = _clean(row.get("min_amount"))
    max_amount = _clean(row.get("max_amount"))
    interval = _clean(row.get("interval"))
    salary = None
    if min_amount and max_amount:
        salary = f"{currency} {min_amount}–{max_amount}" + (f" {interval.upper()}" if interval else "")

    job_type_raw = _clean(row.get("job_type")).lower()
    job_type = None
    for candidate in ("fulltime", "parttime", "internship", "contract"):
        if candidate in job_type_raw.replace("-", "").replace("_", ""):
            job_type = candidate
            break

    is_remote = row.get("is_remote") is True or _clean(row.get("is_remote")).lower() == "true"
    date_posted = _clean(row.get("date_posted"))[:10] or None

    # Prefer the company's own ATS page as the canonical URL when the board
    # exposes it: the row then dedups against a direct ATS scrape of the same
    # job, and applying happens at the source instead of through the board.
    direct = _clean(row.get("job_url_direct"))
    if direct.startswith("http"):
        from .discovery import detect_ats

        if detect_ats(direct):
            url = direct

    posting = {
        "title": title,
        "company": company,
        "description": description,
        "url": url,
        "location": _clean(row.get("location")),
        "_source_site": source_site,
        "_direct_url": direct,
    }
    if date_posted:
        posting["date_posted"] = date_posted
    if salary:
        posting["salary"] = salary
    searched = _clean(row.get("_searched_job_type"))
    if job_type:
        posting["job_type"] = job_type
    elif searched and searched != "internship":
        # The board omitted the field, so fall back to the type this search pass
        # filtered on. NOT for internship: board job-type filters are advisory,
        # and Indeed/LinkedIn happily return regular analyst roles for an
        # internship-filtered query. Trusting the filter mislabeled 14 of 16
        # rows ("Business Intelligence Analyst" at Halden became an internship).
        # Real internships are caught downstream by filters.detect_job_type,
        # which reads the title.
        posting["job_type"] = searched
    if is_remote:
        posting["work_mode"] = "Remote"
    return posting
