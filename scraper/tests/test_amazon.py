from unittest.mock import patch

from jobagent_scraper.ats import amazon
from jobagent_scraper.common import Company

FIXTURE = {
    "jobs": [
        {
            "title": "Business Intelligence Engineer I",
            "company_name": "Amazon.com Services LLC",
            "job_path": "/en/jobs/3000001/business-intelligence-engineer-i",
            "city": "Boston",
            "state": "MA",
            "country_code": "USA",
            "posted_date": "August 8, 2026",
            "description_short": "Entry level analytics role on the retail team.",
            "basic_qualifications": "<p>Bachelor's degree. Experience with SQL and dashboards. 0-2 years of experience.</p>",
            "preferred_qualifications": "<p>Python, Tableau, statistics coursework.</p>",
            "job_schedule_type": "full-time",
        },
        {
            "title": "Data Analyst",
            "company_name": "Amazon Development Centre",
            "job_path": "/en/jobs/3000002/data-analyst-bangalore",
            "city": "Bengaluru",
            "country_code": "IND",
            "description_short": "x" * 200,
        },
        {
            "title": "Short Desc",
            "job_path": "/en/jobs/3000003/short",
            "country_code": "USA",
            "description_short": "too short",
        },
    ]
}

CFG = {"ats": {"per_company_limit": 60}, "search": {"terms": ["business intelligence engineer"]}}


def test_amazon_normalization_filters_and_merges_qualifications():
    with patch.object(amazon, "get_json", return_value=FIXTURE):
        postings = amazon.fetch(None, Company(name="Amazon", ats="amazon"), CFG)
    assert len(postings) == 1  # non-US and short-description rows dropped
    posting = postings[0]
    assert posting["title"] == "Business Intelligence Engineer I"
    assert posting["url"] == "https://www.amazon.jobs/en/jobs/3000001/business-intelligence-engineer-i"
    assert posting["location"] == "Boston, MA"
    assert posting["date_posted"] == "2026-08-08"
    assert posting["job_type"] == "fulltime"
    # description merges summary + basic + preferred quals, tags stripped
    assert "SQL" in posting["description"] and "Tableau" in posting["description"]
    assert "<p>" not in posting["description"]
    assert posting["structured"]["hiringOrganization"]["name"] == "Amazon.com Services LLC"


def test_amazon_dedupes_across_terms():
    cfg = {"ats": {"per_company_limit": 60}, "search": {"terms": ["data analyst", "business analyst"]}}
    with patch.object(amazon, "get_json", return_value=FIXTURE):
        postings = amazon.fetch(None, Company(name="Amazon", ats="amazon"), cfg)
    assert len(postings) == 1  # same job_path returned for both terms counts once
