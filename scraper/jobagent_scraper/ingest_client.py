"""Posts normalized postings to the app's bulk ingest endpoint."""

from __future__ import annotations

import time
from datetime import datetime, timezone

import requests

from .common import env_value
from .server_auth import access_headers

# The Worker stores each posting with several D1 queries; 100 per request ran
# into Cloudflare's limits and came back 503 (October 13: two Indeed batches and
# a Dentsu batch were lost). 25 fits comfortably, and transient failures retry.
BATCH_SIZE = 25
RETRY_DELAYS = (5, 20, 60)
_PRIVATE_KEYS = ("_source_site", "_direct_url")


def ingest_token() -> str:
    return env_value("INGEST_TOKEN")


def post_batches(base_url: str, source_site: str, postings: list[dict], dry_run: bool = False) -> dict:
    """Send postings (all one source_site) in batches. Returns aggregate summary."""
    summary = {"sent": 0, "created": 0, "refreshed": 0, "skipped": 0, "errors": []}
    if dry_run or not postings:
        summary["sent"] = len(postings)
        return summary

    token = ingest_token()
    if not token:
        summary["errors"].append("INGEST_TOKEN not found in environment or ../.env")
        return summary

    scraped_at = datetime.now(timezone.utc).isoformat()
    for start in range(0, len(postings), BATCH_SIZE):
        batch = postings[start : start + BATCH_SIZE]
        payload = {
            "source_site": source_site,
            "scraped_at": scraped_at,
            "jobs": [{key: value for key, value in posting.items() if key not in _PRIVATE_KEYS} for posting in batch],
        }
        try:
            result = _post_with_retry(base_url, payload, {"x-ingest-token": token, **access_headers(base_url)})
            summary["sent"] += len(batch)
            summary["created"] += result.get("created", 0)
            summary["refreshed"] += result.get("refreshed", 0)
            summary["skipped"] += len(result.get("skipped", []))
        except Exception as error:
            summary["errors"].append(f"batch {start // BATCH_SIZE}: {error}")
    return summary


def _retryable(error: Exception) -> bool:
    if isinstance(error, (requests.ConnectionError, requests.Timeout)):
        return True
    response = getattr(error, "response", None)
    return response is not None and (response.status_code >= 500 or response.status_code == 429)


def _post_with_retry(base_url: str, payload: dict, headers: dict) -> dict:
    """POST one batch; retry 5xx, 429, and network errors with growing pauses."""
    for attempt in range(len(RETRY_DELAYS) + 1):
        try:
            response = requests.post(f"{base_url.rstrip('/')}/api/jobs/ingest", json=payload, headers=headers, timeout=120)
            response.raise_for_status()
            return response.json()
        except Exception as error:
            if attempt == len(RETRY_DELAYS) or not _retryable(error):
                raise
            time.sleep(RETRY_DELAYS[attempt])
    raise AssertionError("unreachable")
