import json

from jobagent_scraper import runs_client


def test_report_run_posts_with_token(monkeypatch):
    sent = {}

    class Resp:
        def raise_for_status(self):
            pass

    def fake_post(url, json, headers, timeout):
        sent.update(url=url, body=json, headers=headers)
        return Resp()

    monkeypatch.setattr(runs_client.requests, "post", fake_post)
    monkeypatch.setattr(runs_client, "access_headers", lambda base: {})
    monkeypatch.setenv("INGEST_TOKEN", "tok")
    assert runs_client.report_run("https://dash.example.com/", "mail", True, {"scanned": 3}, print, [{"id": "r"}])
    assert sent["url"] == "https://dash.example.com/api/runs"
    assert sent["headers"]["x-ingest-token"] == "tok"
    assert sent["body"] == {"kind": "mail", "ok": True, "summary": {"scanned": 3}, "reviews": [{"id": "r"}]}


def test_report_failure_is_logged_not_raised(monkeypatch):
    lines = []

    def boom(*args, **kwargs):
        raise OSError("offline")

    monkeypatch.setattr(runs_client.requests, "post", boom)
    monkeypatch.setattr(runs_client, "access_headers", lambda base: {})
    monkeypatch.setenv("INGEST_TOKEN", "tok")
    assert runs_client.report_run("https://dash.example.com", "scrape", True, {}, lines.append) is False
    assert "offline" in lines[0]
