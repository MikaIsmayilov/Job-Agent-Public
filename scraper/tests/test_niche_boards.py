from unittest.mock import patch

from jobagent_scraper import niche_boards

REMOTIVE_FIXTURE = {
    "jobs": [
        {
            "title": "Data Analyst",
            "company_name": "RemoteCo",
            "url": "https://remotive.com/remote-jobs/data/data-analyst-1",
            "description": "<p>" + "Entry level data analyst role using SQL, dashboards and Python forecasting for stakeholders. " * 3 + "</p>",
            "candidate_required_location": "USA Only",
            "publication_date": "2026-08-08T10:00:00",
            "salary": "$60k - $75k",
            "job_type": "full_time",
        },
        {"title": "Short", "company_name": "X", "url": "https://remotive.com/2", "description": "too short"},
    ]
}

THEMUSE_FIXTURE = {
    "page_count": 1,
    "results": [
        {
            "name": "Business Analyst",
            "company": {"name": "MuseCo"},
            "refs": {"landing_page": "https://www.themuse.com/jobs/museco/business-analyst"},
            "contents": "<p>" + "Analyze business performance with SQL and dashboards, supporting entry level decision making. " * 3 + "</p>",
            "locations": [{"name": "Boston, MA"}],
            "publication_date": "2026-08-07T00:00:00Z",
        }
    ],
}


def test_remotive_normalization():
    with patch.object(niche_boards, "get_json", return_value=REMOTIVE_FIXTURE):
        postings = niche_boards.fetch_remotive(None, {})
    # deduped across the three search terms; the short one is dropped
    assert len(postings) == 1
    posting = postings[0]
    assert posting["company"] == "RemoteCo"
    assert posting["work_mode"] == "Remote"
    assert posting["salary"] == "$60k - $75k"
    assert posting["job_type"] == "fulltime"
    assert posting["date_posted"] == "2026-08-08"
    assert "<p>" not in posting["description"]


def test_themuse_normalization():
    with patch.object(niche_boards, "get_json", return_value=THEMUSE_FIXTURE):
        postings = niche_boards.fetch_themuse(None, {})
    assert len(postings) == 1
    # no experience annotation: the API's level filter is not honored server-side,
    # so classification is left to the local filters
    assert "experience_level" not in postings[0]
    assert postings[0]["location"] == "Boston, MA"
