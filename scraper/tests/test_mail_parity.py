"""Shared mail-tracking cases, also run against lib/mail-tracker.ts (the cloud cron)."""

import json
from pathlib import Path

import pytest

from jobagent_scraper.mailtracker import classify, company_names, evaluate_messages_with_reviews, match_jobs

CASES = json.loads((Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "mail-cases.json").read_text())


@pytest.mark.parametrize("case", CASES["classify"], ids=lambda c: c["subject"][:40])
def test_classify(case):
    assert classify(case["subject"], case["body"]) == case["expect"]


@pytest.mark.parametrize("case", CASES["companyNames"], ids=lambda c: c["company"])
def test_company_names(case):
    assert company_names(case["company"]) == case["expect"]


@pytest.mark.parametrize("group", CASES["match"])
def test_match(group):
    for case in group["cases"]:
        assert [j["id"] for j in match_jobs(group["jobs"], case["sender"], case["subject"], case["body"])] == case["expect"], case


@pytest.mark.parametrize("case", CASES["evaluate"], ids=lambda c: c["name"])
def test_evaluate(case):
    updates, notes, reviews = evaluate_messages_with_reviews(case["messages"], case["tracked"])
    assert {job_id: status for job_id, (_, status) in updates.items()} == case["expect"]["updates"]
    assert len(notes) == case["expect"]["notes"]
    assert [{k: r[k] for k in ("id", "kind", "reason", "candidateIds")} for r in reviews] == case["expect"]["reviews"]


@pytest.mark.parametrize("case", CASES["bodies"], ids=lambda c: c["subject"][:40])
def test_body_extraction(case):
    import email
    import re

    from jobagent_scraper.mailtracker import _body_text, _decode

    msg = email.message_from_bytes(case["raw"].encode())
    assert _decode(msg.get("From")) == case["sender"]
    assert _decode(msg.get("Subject")) == case["subject"]
    body = re.sub(r"\s+", " ", _body_text(msg))
    for text in case["contains"]:
        assert text in body
    for text in case["excludes"]:
        assert text not in body
