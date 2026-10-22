import copy

from jobagent_scraper.common import load_config
from jobagent_scraper.filters import (
    apply_filters,
    classify_experience,
    detect_job_type,
    is_acceptable_location,
    is_entry_level,
    is_relevant,
    years_required,
)

CFG = copy.deepcopy(load_config())
# The shipped config has no keywords until /onboard; tests use an analytics
# search so they never depend on whoever has onboarded.
CFG["relevance"]["title_keywords"] = [
    "analyst", "analytics", "business intelligence", "data science", "data scientist",
    "reporting", "power bi", "insights", "product manager", "product management",
    "strategy", "market research",
]
CFG["entry_level"]["enabled"] = True


def test_years_required_parses_common_phrasings():
    assert years_required("Requires 5+ years of experience in analytics") == 5
    assert years_required("0-2 years of professional experience preferred") == 0
    assert years_required("You have 3 years experience with SQL") == 3
    # "N+ years in <field>" without the word "experience"
    assert years_required("5+ years in Sales Ops, RevOps, or a similar analytical GTM role") == 5
    assert years_required("4 years as a business analyst") == 4
    assert years_required("Ten years leading teams") is None
    assert years_required("We ship every 2 weeks") is None


def test_years_required_parses_spelled_out_bars():
    # About one posting in ten states its bar only in words.
    assert years_required("Three to five years of Marketing/Business Analytics experience") == 3
    assert years_required("Minimum of five (5) years of experience in data analytics") == 5
    assert years_required("At least two years of relevant experience required") == 2
    assert years_required("2 to 4 years of experience with SQL") == 2
    # noise phrasings stay excluded by the experience-context guard
    assert years_required("Average employee tenure above five years") is None
    assert years_required("Serve a one year probationary period, if required") is None


def test_years_required_takes_the_highest_stated_bar():
    # Regression: Harvey's real posting. The old min() semantics let the
    # smaller sub-requirement (2 years support ops) mask the 3-5 year bar,
    # mislabeling an experienced role as entry-level.
    harvey = ("3-5 years of experience in analytics, business intelligence, or operations, "
              "with at least 2 years directly in support operations or customer success operations")
    assert years_required(harvey) == 3
    # company-age noise is ignored, not treated as a requirement
    assert years_required("Our team brings 25 years of experience to every engagement") is None


def test_entry_level_filter():
    assert is_entry_level("Data Analyst", "0-2 years of experience with SQL", CFG)
    assert is_entry_level("Junior Data Analyst", "", CFG)
    assert is_entry_level("Associate Product Manager", "Work with AI teams", CFG)
    assert not is_entry_level("Senior Data Analyst", "", CFG)
    assert not is_entry_level("Data Analyst III", "", CFG)
    # seniority markers beat junior markers
    assert not is_entry_level("Deal Data Technology & Analytics, Senior Associate", "", CFG)
    assert not is_entry_level("Test Analyst Lead - Senior Associate", "", CFG)
    assert not is_entry_level("Data Strategy-Manager", "", CFG)
    assert not is_entry_level("Marketing Manager", "", CFG)
    # ...but "product manager" survives the manager exclusion
    assert is_entry_level("Associate Product Manager", "", CFG)
    assert not is_entry_level("Data Analyst", "Requires 7+ years of experience", CFG)
    # junior marker in title cannot override a hard years demand
    assert not is_entry_level("Junior Analyst", "Requires 6+ years of relevant experience", CFG)
    # unknown seniority is kept by default
    assert is_entry_level("Data Analyst", "You will build dashboards", CFG)
    # regression: the Harvey posting must NOT pass the entry-level filter
    assert not is_entry_level(
        "Support Operations Data Analyst",
        "3-5 years of experience in analytics, with at least 2 years directly in support operations",
        CFG,
    )
    # "3+ years" alone is above the new-grad bar
    assert not is_entry_level("Data Analyst", "3+ years of experience with SQL required", CFG)


def test_classify_experience():
    assert classify_experience("Data Analyst", "1+ years of experience", CFG) == "entry"
    assert classify_experience("Data Analyst", "4+ years of experience", CFG) == "mid"
    assert classify_experience("Junior Analyst", "", CFG) == "entry"
    assert classify_experience("Principal Analyst", "", CFG) == "senior"
    assert classify_experience("Data Analyst", "", CFG) == "unknown"


def test_relevance_filter():
    assert is_relevant("Marketing Analyst", CFG)
    assert is_relevant("Business Intelligence Developer", CFG)
    assert is_relevant("Associate Product Manager", CFG)
    assert not is_relevant("Forklift Operator", CFG)
    assert not is_relevant("Registered Nurse", CFG)


def test_location_filter_drops_only_clearly_foreign():
    assert is_acceptable_location("Boston, MA", CFG)
    assert is_acceptable_location("Remote", CFG)
    assert is_acceptable_location("", CFG)
    assert is_acceptable_location("Denver", CFG)
    assert not is_acceptable_location("Milton Keynes, United Kingdom", CFG)
    assert not is_acceptable_location("Toronto, Ontario", CFG)
    assert not is_acceptable_location("Bengaluru, India", CFG)
    # non-US region code and city-only foreign locations
    assert not is_acceptable_location("Mississauga, ON L5R 0G1", CFG)
    assert not is_acceptable_location("Jakarta", CFG)
    assert not is_acceptable_location("Redhill", CFG)
    assert is_acceptable_location("Scottsdale, AZ;Denver", CFG)
    # Santander global Workday leaks caught in the 2026-08-12 audit
    assert not is_acceptable_location("Boadilla del Monte", CFG)
    assert not is_acceptable_location("SANTIAGO", CFG)
    # Australian state codes are 3 letters (TJX leak, 2026-08-13)
    assert not is_acceptable_location("Mascot, NSW 2020", CFG)
    assert not is_acceptable_location("Sydney, Australia", CFG)
    assert not is_acceptable_location("Bogotá", CFG)


def test_detect_job_type_from_text():
    assert detect_job_type("Data Analyst", "This is a full-time position with benefits") == "fulltime"
    assert detect_job_type("Data Analyst", "Part-time role, 20 hours per week") == "parttime"
    assert detect_job_type("Data Analytics Intern", "Join our team") == "internship"
    assert detect_job_type("Analyst", "Summer co-op program for students") == "internship"
    assert detect_job_type("Analyst", "12-month fixed-term contract") == "contract"
    # title beats description: an internship that mentions full-time hours is an internship
    assert detect_job_type("Data Analyst Intern", "This is a full-time internship") == "internship"
    assert detect_job_type("Data Analyst", "We analyze data") is None


def test_apply_filters_drops_foreign_titles():
    postings = [
        {"title": "Innovation Product Manager, Australia", "location": "Sydney", "description": "Entry level product manager role with analytics dashboards and stakeholder reporting for the local market team."},
        {"title": "Audit Analyst - IT SOX", "location": "Remote", "description": "Entry level analyst role reviewing IT controls with SQL dashboards and documentation for stakeholders across teams."},
    ]
    kept, dropped = apply_filters(postings, CFG)
    assert len(kept) == 1 and kept[0]["title"].startswith("Audit Analyst"), "IT SOX must survive; Australia must not"
    assert dropped["foreign_location"] == 1


def test_apply_filters_fills_job_type():
    postings = [{"title": "Data Analyst", "description": "A full-time entry level data analyst role with SQL and dashboards"}]
    kept, _ = apply_filters(postings, CFG)
    assert kept[0]["job_type"] == "fulltime"


def test_apply_filters_annotates_experience():
    postings = [
        {"title": "Data Analyst", "description": "0-2 years of experience with SQL dashboards"},
        {"title": "Senior Data Analyst", "description": ""},
        {"title": "Chef", "description": ""},
    ]
    kept, dropped = apply_filters(postings, CFG)
    assert len(kept) == 1
    assert kept[0]["experience_level"] == "entry"
    assert dropped == {"irrelevant_title": 1, "not_entry_level": 1, "foreign_location": 0}


def test_entry_level_filter_can_be_switched_off():
    cfg = copy.deepcopy(CFG)
    senior = ("Senior Data Analyst", "Requires 7+ years of experience in analytics.")
    assert not is_entry_level(*senior, cfg)
    cfg["entry_level"]["enabled"] = False
    assert is_entry_level(*senior, cfg)
    assert classify_experience(*senior, cfg) == "senior"
