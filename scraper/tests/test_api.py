import base64
import json

from jobagent_scraper import api


class Resp:
    def __init__(self, status=200, text='{"ok": true}'):
        self.status_code, self.text, self.ok = status, text, status < 400


def _capture(monkeypatch, resp=None):
    calls = []

    def fake_request(method, url, headers, data, timeout):
        calls.append({"method": method, "url": url, "headers": headers, "data": data})
        return resp or Resp()

    monkeypatch.setattr(api.requests, "request", fake_request)
    monkeypatch.setattr(api, "load_config", lambda: {"server": {"base_url": "https://dash.example.com/"}})
    monkeypatch.setenv("CF_ACCESS_CLIENT_ID", "id-123")
    monkeypatch.setenv("CF_ACCESS_CLIENT_SECRET", "secret-456")
    monkeypatch.setenv("INGEST_TOKEN", "tok-789")
    return calls


def test_request_targets_cloud_with_access_headers(monkeypatch, capsys):
    calls = _capture(monkeypatch)
    assert api.main(["request", "PATCH", "/api/jobs", "--json", '{"id": "1", "status": "ready"}']) == 0
    call = calls[0]
    assert call["method"] == "PATCH" and call["url"] == "https://dash.example.com/api/jobs"
    assert call["headers"]["CF-Access-Client-Id"] == "id-123"
    assert "x-ingest-token" not in call["headers"]  # only document uploads carry the ingest token
    assert json.loads(call["data"]) == {"id": "1", "status": "ready"}
    out = capsys.readouterr().out
    assert "secret-456" not in out and "id-123" not in out


def test_local_flag_skips_credentials(monkeypatch):
    calls = _capture(monkeypatch)
    assert api.main(["--local", "request", "GET", "/api/jobs?id=1"]) == 0
    assert calls[0]["url"] == "http://localhost:3000/api/jobs?id=1"
    assert calls[0]["headers"] == {}


def test_upload_sends_base64_and_ingest_token(monkeypatch, tmp_path, capsys):
    calls = _capture(monkeypatch)
    f = tmp_path / "Resume.pdf"
    f.write_bytes(b"%PDF-1.4 data")
    assert api.main(["upload", "job-1", str(f)]) == 0
    body = json.loads(calls[0]["data"])
    assert calls[0]["url"] == "https://dash.example.com/api/documents"
    assert calls[0]["headers"]["x-ingest-token"] == "tok-789"
    assert body == {"jobId": "job-1", "filename": "Resume.pdf", "dataBase64": base64.b64encode(b"%PDF-1.4 data").decode()}
    out = capsys.readouterr().out
    assert "Resume.pdf: uploaded" in out and "tok-789" not in out


def test_http_error_exits_nonzero(monkeypatch, capsys):
    _capture(monkeypatch, Resp(404, '{"error": "Job not found."}'))
    assert api.main(["request", "GET", "/api/jobs?id=missing"]) == 1
    assert "HTTP 404" in capsys.readouterr().err


def test_rescore_all_pages_until_done(monkeypatch, capsys):
    pages = iter([
        Resp(200, '{"ok": true, "total": 60, "rescored": 25, "nextOffset": 25}'),
        Resp(200, '{"ok": true, "total": 60, "rescored": 25, "nextOffset": 50}'),
        Resp(200, '{"ok": true, "total": 60, "rescored": 10, "nextOffset": null}'),
    ])
    Resp.json = lambda self: __import__("json").loads(self.text)
    Resp.raise_for_status = lambda self: None
    calls = _capture(monkeypatch)
    monkeypatch.setattr(api.requests, "request", lambda method, url, headers, data, timeout: (calls.append(data), next(pages))[1])
    assert api.main(["rescore-all"]) == 0
    assert [__import__("json").loads(c)["offset"] for c in calls] == [0, 25, 50]
    assert "rescored 60 of 60 jobs" in capsys.readouterr().out
