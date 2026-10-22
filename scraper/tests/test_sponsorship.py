from jobagent_scraper import sponsorship

FAKE_H1B_HTML = """
<table><tr><th>Employer</th></tr>
<tr><td><a href="/x">HARVEY NASH INC</a></td><td>ENGINEER</td></tr>
<tr><td><a href="/x">HARVEY NASH INC</a></td><td>ANALYST</td></tr>
<tr><td><a href="/x">HARVEY MUDD COLLEGE</a></td><td>PROFESSOR</td></tr>
<tr><td><a href="/x">HARVEY AI CORPORATION</a></td><td>ENGINEER</td></tr>
<tr><td><a href="/x">HARVEY AI CORPORATION</a></td><td>ANALYST</td></tr>
<tr><td><a href="/x">HARVEY TOOL COMPANY LLC</a></td><td>MACHINIST</td></tr>
</table>
"""


def test_filing_count_matches_only_the_actual_employer():
    # Regression: "harvey" must count Harvey AI Corporation rows, not the
    # staffing firm Harvey Nash or Harvey Mudd College (the old contains-match
    # reported ~384 filings for a company with 7).
    count, display = sponsorship._matched_filings(FAKE_H1B_HTML, "harvey")
    assert count == 2
    assert "Harvey Ai" in display
    count, _ = sponsorship._matched_filings(FAKE_H1B_HTML, "harvey nash")
    assert count == 2
    count, _ = sponsorship._matched_filings(FAKE_H1B_HTML, "acme")
    assert count == 0


def test_curated_stances_match_by_whole_word():
    stance, note = sponsorship.company_stance(None, "PwC US")
    assert stance == "likely"
    assert "H-1B" in note
    stance, _ = sponsorship.company_stance(None, "Deloitte Consulting LLP")
    assert stance == "likely"
    stance, _ = sponsorship.company_stance(None, "EY")
    assert stance == "likely"


def test_curated_match_never_fires_inside_other_words(monkeypatch, tmp_path):
    # "ey" must not match "Harvey"; block network + isolate the cache so a
    # previously cached live lookup can't leak into the assertion
    monkeypatch.setattr(sponsorship, "MAX_LOOKUPS_PER_RUN", 0)
    monkeypatch.setattr(sponsorship, "_cache", {})
    monkeypatch.setattr(sponsorship, "CACHE_PATH", tmp_path / "cache.json")
    stance, note = sponsorship.company_stance(None, "Harvey")
    assert stance is None and note is None


def test_annotate_respects_existing_hint(monkeypatch):
    monkeypatch.setattr(sponsorship, "company_stance", lambda sess, name: ("likely", "note"))
    postings = [
        {"company": "Acme", "sponsorship_hint": "not_offered"},
        {"company": "Acme"},
    ]
    sponsorship.annotate_postings(None, postings)
    assert postings[0]["sponsorship_hint"] == "not_offered"
    assert postings[1]["sponsorship_hint"] == "likely"
    assert postings[1]["sponsorship_note"] == "note"
