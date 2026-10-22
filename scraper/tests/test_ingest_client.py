import requests

from jobagent_scraper import ingest_client


class Resp:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} error", response=self)

    def json(self):
        return self._body


def _setup(monkeypatch, responses):
    calls = []

    def fake_post(url, json, headers, timeout):
        calls.append(len(json["jobs"]))
        return responses.pop(0)

    monkeypatch.setattr(ingest_client.requests, "post", fake_post)
    monkeypatch.setattr(ingest_client.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(ingest_client, "access_headers", lambda base: {})
    monkeypatch.setenv("INGEST_TOKEN", "tok")
    return calls


def test_batches_of_25(monkeypatch):
    calls = _setup(monkeypatch, [Resp(200, {"created": 25}), Resp(200, {"created": 25}), Resp(200, {"created": 10})])
    summary = ingest_client.post_batches("https://dash.example.com", "indeed", [{"title": str(i)} for i in range(60)])
    assert calls == [25, 25, 10]
    assert summary["created"] == 60 and not summary["errors"]


def test_503_is_retried_instead_of_dropped(monkeypatch):
    calls = _setup(monkeypatch, [Resp(503), Resp(503), Resp(200, {"created": 3})])
    summary = ingest_client.post_batches("https://dash.example.com", "indeed", [{"title": "a"}] * 3)
    assert len(calls) == 3
    assert summary["created"] == 3 and not summary["errors"]


def test_client_errors_are_not_retried(monkeypatch):
    calls = _setup(monkeypatch, [Resp(401)])
    summary = ingest_client.post_batches("https://dash.example.com", "indeed", [{"title": "a"}])
    assert len(calls) == 1 and summary["errors"]


def test_gives_up_after_retries(monkeypatch):
    calls = _setup(monkeypatch, [Resp(503)] * 4)
    summary = ingest_client.post_batches("https://dash.example.com", "indeed", [{"title": "a"}])
    assert len(calls) == 4 and "batch 0" in summary["errors"][0]
