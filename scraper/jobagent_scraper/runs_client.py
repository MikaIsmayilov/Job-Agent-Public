"""Reports each scheduled run (scrape, mail check) to the dashboard's /api/runs.

The dashboard shows when each last ran, and lists recruiter replies the mail
tracker could not tie to one application. Reporting never fails a run.
"""

from __future__ import annotations

import requests

from .common import env_value
from .server_auth import access_headers


def report_run(base_url: str, kind: str, ok: bool, summary: dict, log, reviews: list[dict] | None = None) -> bool:
    token = env_value("INGEST_TOKEN")
    if not token:
        log(f"[{kind}] run not reported: INGEST_TOKEN is not set")
        return False
    body = {"kind": kind, "ok": ok, "summary": summary, "reviews": reviews or []}
    try:
        response = requests.post(f"{base_url.rstrip('/')}/api/runs", json=body,
                                 headers={"x-ingest-token": token, **access_headers(base_url)}, timeout=60)
        response.raise_for_status()
        return True
    except Exception as error:
        log(f"[{kind}] run not reported: {error}")
        return False
