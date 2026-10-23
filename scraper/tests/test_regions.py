from jobagent_scraper import discovery, sponsorship
from jobagent_scraper.common import load_companies


def test_regional_packs_are_opt_in():
    core = {company.name for company in load_companies()}
    with_canada = {company.name for company in load_companies(regions=["canada"])}
    assert "Wealthsimple" not in core
    assert "Wealthsimple" in with_canada
    assert core < with_canada
    assert "Mass General Brigham" not in core
    assert "Mass General Brigham" in {company.name for company in load_companies(regions=["boston"])}


def test_unknown_region_is_skipped():
    assert len(load_companies(regions=["atlantis"])) == len(load_companies())


def test_discovery_knows_pack_companies():
    known = discovery._known_identities()
    assert "ashby:wealthsimple" in known
    assert "workday:massgeneralbrigham" in known


def test_h1b_annotation_is_us_only():
    postings = [{"company": "PwC", "title": "Analyst"}]
    sponsorship.annotate_postings(None, postings, cfg={"search": {"country": "CA"}})
    assert "sponsorship_hint" not in postings[0]
