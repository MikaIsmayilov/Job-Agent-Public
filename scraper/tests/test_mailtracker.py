from jobagent_scraper.mailtracker import classify, company_names, company_tokens, evaluate_messages, match_jobs

REJECTION = (
    "Update on your application to BrightHome",
    "Thank you for your interest in the Customer Experience Analyst position. "
    "Unfortunately, we have decided to move forward with other candidates at this time.",
)
INTERVIEW = (
    "Interview invitation - Data Analyst",
    "Thank you for applying to Ledgerly. We'd like to schedule a call to discuss your application. "
    "Please share your availability for next week.",
)
CONFIRMATION = (
    "We received your application",
    "Thank you for applying to the Business Analyst role at Fairway. Your application has been received.",
)
NEWSLETTER = (
    "10 interview tips for analysts",
    "Read our newsletter about how to ace your next interview. Subscribe for more career content.",
)


AMAZON_CONFIRMATION_BOILERPLATE = (
    "Thank you for Applying to Amazon!",
    "Thank you for applying. What happens next? If we decide to move forward with your "
    "application, the Amazon recruiting team will reach out to discuss next steps. Any updates "
    "to your application status will be reflected on your Application dashboard.",
)
ASSESSMENT_INVITE = (
    "Your Amazon application: action required",
    "Thank you for applying to Amazon. The next step is to complete an online assessment. "
    "Please finish it within 5 days.",
)


def test_classification():
    assert classify(*REJECTION) == "rejected"
    assert classify(*INTERVIEW) == "interview"
    assert classify(*CONFIRMATION) == "confirmation"
    # Regression 2026-08-12: confirmation boilerplate saying "IF we move
    # forward ... discuss next steps" must NOT count as an interview.
    assert classify(*AMAZON_CONFIRMATION_BOILERPLATE) == "confirmation"
    # ...but a concrete "next step is to complete X" invitation still does.
    assert classify(*ASSESSMENT_INVITE) == "interview"
    # newsletters mention interviews but have application context words too —
    # the guard is the conservative matcher, but pure marketing mail without
    # application words is dropped outright
    assert classify("Weekly digest", "Top stories in tech this week.") is None


def test_company_tokens_skip_stopwords():
    assert company_tokens("The BrightHome Company") == ["brighthome"]
    assert company_tokens("Ledgerly") == ["ledgerly"]
    assert company_tokens("John Calloway / Maplelife") == ["john", "calloway"]


def test_match_jobs_by_sender_domain_and_subject():
    jobs = [
        {"id": "1", "company": "BrightHome", "title": "CX Analyst", "status": "applied"},
        {"id": "2", "company": "Ledgerly", "title": "PM", "status": "applied"},
    ]
    matches = match_jobs(jobs, "no-reply@brighthome.com", "Your application", "body text")
    assert [j["id"] for j in matches] == ["1"]
    matches = match_jobs(jobs, "careers@greenhouse.io", "Update from Ledgerly recruiting", "")
    assert [j["id"] for j in matches] == ["2"]
    assert match_jobs(jobs, "newsletter@medium.com", "Weekly digest", "unrelated") == []


def test_evaluate_messages_shared_pipeline():
    # Regression: evaluate_messages is the pure core both run_mail (IMAP) and
    # run_mail_from_messages (Gmail MCP, /mail-check skill) call, so it must
    # apply the exact same conservative rules regardless of message source.
    tracked = [
        {"id": "1", "company": "BrightHome", "title": "Customer Experience Analyst", "status": "applied"},
        {"id": "2", "company": "Ledgerly", "title": "PM", "status": "applied"},
        {"id": "3", "company": "John Calloway / Maplelife", "title": "Analyst", "status": "interview"},
    ]
    messages = [
        {"sender": "no-reply@brighthome.com", "subject": REJECTION[0], "body": REJECTION[1]},
        {"sender": "careers@ledgerly.com", "subject": INTERVIEW[0], "body": INTERVIEW[1]},
        {"sender": "newsletter@medium.com", "subject": NEWSLETTER[0], "body": NEWSLETTER[1]},
        # No company match at all — dropped silently, no note.
        {"sender": "careers@fairway.com", "subject": CONFIRMATION[0], "body": CONFIRMATION[1]},
    ]
    updates, notes = evaluate_messages(messages, tracked)
    assert set(updates.keys()) == {"1", "2"}
    assert updates["1"][1] == "rejected"
    assert updates["2"][1] == "interview"
    assert notes == []  # Fairway confirmation matches no tracked job, so it's dropped, not noted.

    # The sender's full company name identifies Calloway Logistics; the shared
    # word "Calloway" no longer drags in John Calloway / Maplelife.
    jobs_with_calloway = tracked + [{"id": "4", "company": "Calloway Logistics", "title": "Ops", "status": "applied"}]
    updates2, _ = evaluate_messages(
        [{"sender": "hr@callowaylogistics.com", "subject": "Your Calloway application",
          "body": "Thank you for your interest. Unfortunately, we have decided to move forward with other candidates."}],
        jobs_with_calloway,
    )
    assert set(updates2) == {"4"}

    # Two open jobs at one company and an email naming neither: note, never guess.
    two_at_ramp = [
        {"id": "5", "company": "Ledgerly", "title": "Data Analyst", "status": "applied"},
        {"id": "6", "company": "Ledgerly", "title": "Finance Analyst", "status": "applied"},
    ]
    updates3, notes3 = evaluate_messages(
        [{"sender": "careers@ledgerly.com", "subject": "Your application to Ledgerly", "body": REJECTION[1].replace("Customer Experience Analyst ", "")}],
        two_at_ramp,
    )
    assert updates3 == {}
    assert any("AMBIGUOUS" in n for n in notes3)


def test_env_value_falls_back_to_repo_dotenv(monkeypatch, tmp_path):
    # The daily routine runs subcommands without sourcing .env; credentials
    # must still resolve from the repo .env file (regression: mail tracking
    # reported "not configured" despite valid credentials on 2026-08-12).
    from jobagent_scraper import common

    monkeypatch.delenv("GMAIL_ADDRESS", raising=False)
    monkeypatch.setattr(common, "REPO_DIR", tmp_path)
    (tmp_path / ".env").write_text("OTHER=x\nGMAIL_ADDRESS=me@example.com\n")
    assert common.env_value("GMAIL_ADDRESS") == "me@example.com"
    assert common.env_value("MISSING_KEY") == ""

    monkeypatch.setenv("GMAIL_ADDRESS", "env-wins@example.com")
    assert common.env_value("GMAIL_ADDRESS") == "env-wins@example.com"


# Wording from real decisions the tracker missed in the 2026-10-12 audit.
REAL_REJECTIONS = [
    ("Thank you for your interest in Lindell", "We regret to inform you that the Associate Analytics Engineer position has been closed."),
    ("Follow up", "Thank you for expressing your interest. We regret to inform you that we will not be taking your application further at this time."),
    ("Thank you for your interest", "We have reviewed your application carefully and would like to inform you we did not select you for further consideration for the role."),
    ("Thank you for applying to Northgate", "Thank you for your interest. Your application shows many outstanding qualities, but our team did not see a fit for your skills at this time."),
    ("Thank you for your interest", "Thank you for your interest in the Analyst opportunity. At this time, we are unable to consider you for the position."),
    # Hard-wrapped plain-text body splits the phrase across lines.
    ("Thank You from Pinboard", "After careful review, we've made the decision to not move\r\nforward with your candidacy for the Sales Incentives Analyst role."),
]


def test_real_rejection_wording():
    for subject, body in REAL_REJECTIONS:
        assert classify(subject, body) == "rejected", subject


def test_company_names_split_aliases_and_drop_suffixes():
    assert company_names("John Calloway / Maplelife") == ["john calloway", "maplelife"]
    assert company_names("QZT, Inc.") == ["qzt"]
    assert company_names("CJ's Wholesale") == ["cjs wholesale"]


def test_match_requires_whole_company_name():
    jobs = [
        {"id": "1", "company": "Best Nest", "title": "Treasury Analyst", "status": "applied"},
        {"id": "2", "company": "Hum Group", "title": "Risk Analyst", "status": "applied"},
        {"id": "3", "company": "Summit Media", "title": "Analyst, Search Engine Marketing", "status": "applied"},
        {"id": "4", "company": "Kestrel Media", "title": "Data Analyst I", "status": "applied"},
        {"id": "5", "company": "Gray Brothers Whitman", "title": "Commodities Analyst", "status": "applied"},
    ]
    # 'Best,' sign-off and 'human' must not match Best Nest / Hum Group.
    assert match_jobs(jobs, "a@lindell.com", "Thanks", "Our human resources team. Best, Lindell") == []
    # Shared word 'Media' must not pull in other media companies.
    assert [j["id"] for j in match_jobs(jobs, "summitmedia@myworkday.com", "Thank You for Your Interest in Summit Media", "")] == ["3"]
    # Company squashed into the sender display name still counts.
    assert [j["id"] for j in match_jobs(jobs, '"GrayBrothersWhitman.DoNotReply" <gbw@myworkday.com>', "Follow up", "")] == ["5"]


def test_title_picks_among_one_companys_jobs():
    jobs = [
        {"id": "1", "company": "PlayField", "title": "Data Scientist", "status": "applied"},
        {"id": "2", "company": "PlayField", "title": "Data Scientist, Pricing Models", "status": "applied"},
        {"id": "3", "company": "PlayField", "title": "Commercial Analyst - Gaming", "status": "applied"},
    ]
    body = "Unfortunately we will not be moving forward with your application for the {} role."
    assert [j["id"] for j in match_jobs(jobs, "no-reply@playfield.com", "Update", body.format("Commercial Analyst - Gaming"))] == ["3"]
    assert [j["id"] for j in match_jobs(jobs, "no-reply@playfield.com", "Update", body.format("Data Scientist, Pricing Models"))] == ["2"]
    assert [j["id"] for j in match_jobs(jobs, "no-reply@playfield.com", "Update", body.format("Data Scientist"))] == ["1"]


def test_email_naming_a_different_role_is_noted_not_applied():
    # Pinnacle 2026-10-08: rejection for a role other than the one tracked.
    tracked = [{"id": "1", "company": "Pinnacle Automation", "title": "Procurement Analyst", "status": "applied"}]
    msg = {
        "sender": "Pinnacle Automation Hiring Team <no-reply@ashbyhq.com>",
        "subject": "Pinnacle Automation Application Update",
        "body": "Thank you for applying for the Supply Chain Operations Lead role at Pinnacle. Unfortunately, we will not be moving forward.",
    }
    updates, notes = evaluate_messages([msg], tracked)
    assert updates == {}
    assert any("ROLE MISMATCH" in n for n in notes)


def test_apply_updates_reports_failed_patch(monkeypatch):
    from jobagent_scraper import mailtracker

    class Resp:
        ok, status_code = False, 403

    monkeypatch.setattr(mailtracker.requests, "patch", lambda *a, **k: Resp())
    monkeypatch.setattr(mailtracker, "access_headers", lambda base: {})
    lines = []
    job = {"id": "1", "company": "Ledgerly", "title": "Data Analyst"}
    mailtracker.apply_updates("http://x", {"1": (job, "rejected")}, [], dry_run=False, log=lines.append)
    assert any("FAILED (403)" in line for line in lines)


def test_ambiguous_and_role_mismatch_replies_become_reviews():
    from jobagent_scraper.mailtracker import evaluate_messages_with_reviews, review_id

    tracked = [
        {"id": "f1", "company": "PlayField", "title": "Data Analyst", "status": "applied"},
        {"id": "f2", "company": "PlayField", "title": "Business Analyst", "status": "applied"},
    ]
    msg = {"sender": "PlayField <no-reply@playfield.com>", "subject": "Important information about your application to PlayField",
           "body": "Unfortunately, we have decided to move forward with other candidates."}
    updates, notes, reviews = evaluate_messages_with_reviews([msg, msg], tracked)
    assert updates == {}
    assert len(notes) == 2
    assert reviews[0]["reason"] == "ambiguous" and reviews[0]["kind"] == "rejected"
    assert set(reviews[0]["candidateIds"]) == {"f1", "f2"}
    # The same reply always gets the same id, so a resolved review stays resolved.
    assert reviews[0]["id"] == reviews[1]["id"] == review_id("rejected", msg["sender"], msg["subject"])


def test_local_check_defers_only_to_a_recent_cloud_run(monkeypatch):
    from datetime import datetime, timezone

    from jobagent_scraper import mailtracker

    now = datetime(2026, 10, 14, 18, 0, tzinfo=timezone.utc)
    cfg = {"server": {"base_url": "http://x"}}
    monkeypatch.setattr(mailtracker, "access_headers", lambda base: {})

    def serve(payload=None, error=None):
        class Resp:
            def raise_for_status(self):
                if error:
                    raise error

            def json(self):
                return payload

        monkeypatch.setattr(mailtracker.requests, "get", lambda *a, **k: Resp())

    lines = []
    serve({"lastCloudMail": "2026-10-14T16:00:00.000Z"})  # 2h ago: cloud is healthy
    assert mailtracker.cloud_checked_recently(cfg, lines.append, now) is True
    serve({"lastCloudMail": "2026-10-14T12:00:00.000Z"})  # 6h ago: cloud stopped, run locally
    assert mailtracker.cloud_checked_recently(cfg, lines.append, now) is False
    serve({"lastCloudMail": None})  # never ran in the cloud
    assert mailtracker.cloud_checked_recently(cfg, lines.append, now) is False
    serve(error=RuntimeError("503"))  # dashboard down: never skip on doubt
    assert mailtracker.cloud_checked_recently(cfg, lines.append, now) is False
