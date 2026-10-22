import json
from pathlib import Path

from jobagent_scraper.boards import normalize_jobspy_row
from jobagent_scraper.common import extract_jobposting_jsonld, html_to_text, to_structured
from jobagent_scraper.discovery import detect_ats

FIXTURES = Path(__file__).parent.parent / "fixtures"

INGEST_REQUIRED_KEYS = {"title", "company", "description", "url"}


def test_normalize_jobspy_rows():
    rows = json.loads((FIXTURES / "jobspy_rows.json").read_text())
    good = normalize_jobspy_row(rows[0])
    assert INGEST_REQUIRED_KEYS <= set(good)
    assert good["_source_site"] == "linkedin"
    # direct ATS link becomes the canonical URL (cross-source dedup)
    assert good["url"] == "https://boards.greenhouse.io/acmeanalytics/jobs/998877"
    # a non-ATS direct link is ignored
    no_ats = normalize_jobspy_row({**rows[0], "job_url_direct": "https://example.com/careers"})
    assert no_ats["url"] == rows[0]["job_url"]
    assert good["work_mode"] == "Remote"
    assert good["salary"] == "USD 70000–90000 YEARLY"
    assert good["job_type"] == "fulltime"
    assert good["date_posted"] == "2026-08-07"

    # short description → unusable
    assert normalize_jobspy_row(rows[1]) is None
    # unknown site → unusable
    assert normalize_jobspy_row({**rows[0], "site": "myspace"}) is None


def test_html_to_text_strips_markup():
    text = html_to_text("<div><h2>About</h2><p>We build &amp; ship.</p><script>x()</script><li>SQL</li></div>")
    assert "About" in text and "We build & ship." in text and "SQL" in text
    assert "script" not in text and "<" not in text


def test_to_structured_shape():
    structured = to_structured("Data Analyst", "Acme", "Boston, MA", "2026-08-01", None, "desc", remote=True)
    assert structured["@type"] == "JobPosting"
    assert structured["hiringOrganization"]["name"] == "Acme"
    assert structured["jobLocation"]["address"]["addressLocality"] == "Boston"
    assert structured["jobLocation"]["address"]["addressRegion"] == "MA"
    assert structured["jobLocationType"] == "TELECOMMUTE"


def test_extract_jobposting_jsonld():
    html = (FIXTURES / "jsonld_page.html").read_text()
    posting = extract_jobposting_jsonld(html)
    assert posting is not None
    assert posting["title"] == "Business Analyst"
    assert posting["hiringOrganization"]["name"] == "Example Corp"
    # page without a JobPosting
    assert extract_jobposting_jsonld("<html><body>nothing here</body></html>") is None


def test_detect_ats_from_direct_urls():
    assert detect_ats("https://boards.greenhouse.io/acme/jobs/123") == {"ats": "greenhouse", "token": "acme"}
    assert detect_ats("https://jobs.lever.co/acme/uuid") == {"ats": "lever", "token": "acme"}
    assert detect_ats("https://jobs.ashbyhq.com/acme/uuid") == {"ats": "ashby", "token": "acme"}
    assert detect_ats("https://jobs.smartrecruiters.com/AcmeCorp/744000") == {"ats": "smartrecruiters", "token": "AcmeCorp"}
    assert detect_ats("https://apply.workable.com/acme/j/ABC/") == {"ats": "workable", "token": "acme"}
    assert detect_ats("https://acme.recruitee.com/o/analyst") == {"ats": "recruitee", "token": "acme"}
    assert detect_ats("https://acme.wd5.myworkdayjobs.com/en-US/External/job/Boston/Analyst_R123") == {
        "ats": "workday",
        "tenant": "acme",
        "wd": "wd5",
        "site": "External",
    }
    assert detect_ats("https://www.linkedin.com/jobs/view/123") is None


def _board_row(**overrides):
    row = {
        "title": "Data Analyst Intern",
        "company": "Example Corp",
        "description": "d" * 200,
        "job_url": "https://example.com/jobs/1",
        "location": "Boston, MA",
        "site": "linkedin",
    }
    row.update(overrides)
    return row


def test_job_type_falls_back_to_the_searched_pass_type():
    """A board row that omits job_type inherits the type its search pass filtered on.

    Regression: fetch_board_jobs used to pass only job_types[0] to jobspy and
    main.py blanket-tagged every row with that same type, so a config asking for
    fulltime AND internship both searched no internships and mislabeled rows.
    """
    posting = normalize_jobspy_row(_board_row(_searched_job_type="fulltime"))
    assert posting["job_type"] == "fulltime"

    # An explicit value from the board always wins over the pass type.
    posting = normalize_jobspy_row(_board_row(job_type="parttime", _searched_job_type="fulltime"))
    assert posting["job_type"] == "parttime"

    # No signal anywhere means no claim: the field stays absent for the
    # entry-level filter to classify from the description instead.
    assert "job_type" not in normalize_jobspy_row(_board_row())


def test_internship_search_pass_alone_does_not_label_a_row_an_internship():
    """Board job-type filters are advisory, so an internship pass is not proof.

    Indeed and LinkedIn return regular analyst roles for an internship-filtered
    query. Trusting the filter tagged 14 of 16 rows wrong in a live run: five
    "Business Intelligence Analyst" postings at Halden became internships.
    Real internships are labelled downstream from the title by
    filters.detect_job_type.
    """
    posting = normalize_jobspy_row(_board_row(title="Business Intelligence Analyst", _searched_job_type="internship"))
    assert "job_type" not in posting, "an internship search pass must not label the row by itself"

    # An explicit internship value FROM THE BOARD is still trusted.
    posting = normalize_jobspy_row(_board_row(job_type="internship", _searched_job_type="internship"))
    assert posting["job_type"] == "internship"
