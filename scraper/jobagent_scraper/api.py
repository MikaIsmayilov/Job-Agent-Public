"""Authenticated command-line client for the dashboard API, used by the skills.

The dashboard at config.yml server.base_url (local by default, or a Cloudflare
deployment) is the system of record. Skills call this module
instead of curl so the Cloudflare Access credentials and ingest token are read
from the environment or .env here and never appear in commands or output.

    python -m jobagent_scraper.api request GET "/api/jobs?id=<id>"
    python -m jobagent_scraper.api request PATCH /api/jobs --json '{"id": "...", "screenedOut": "..."}'
    python -m jobagent_scraper.api request PATCH /api/jobs --json-file body.json
    python -m jobagent_scraper.api upload <job-id> Resume.docx Resume.pdf REPORT.md
    python -m jobagent_scraper.api rescore-all        # recompute every job's fit, page by page

Add --local (before the subcommand) to target http://localhost:3000 instead.
Exit status is non-zero when any request fails.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

import requests

from .common import env_value, load_config
from .server_auth import access_headers

LOCAL_BASE = "http://localhost:3000"
TIMEOUT = 60


def base_url(local: bool = False) -> str:
    return LOCAL_BASE if local else load_config()["server"]["base_url"].rstrip("/")


def call(method: str, path: str, body: object = None, local: bool = False, extra_headers: dict | None = None) -> requests.Response:
    base = base_url(local)
    headers = {**access_headers(base), **(extra_headers or {})}
    if body is not None:
        headers["content-type"] = "application/json"
    return requests.request(method.upper(), base + "/" + path.lstrip("/"), headers=headers,
                            data=None if body is None else json.dumps(body), timeout=TIMEOUT)


def get_json(path: str, local: bool = False) -> dict:
    resp = call("GET", path, local=local)
    resp.raise_for_status()
    return resp.json()


def upload_document(job_id: str, file_path: Path, local: bool = False) -> requests.Response:
    token = env_value("INGEST_TOKEN")
    if not token:
        raise ValueError("Set INGEST_TOKEN (environment or .env) to upload documents")
    body = {"jobId": job_id, "filename": file_path.name, "dataBase64": base64.b64encode(file_path.read_bytes()).decode()}
    return call("POST", "/api/documents", body, local=local, extra_headers={"x-ingest-token": token})


def rescore_all(local: bool = False, page: int = 25) -> tuple[int, int]:
    """Page through PATCH {rescoreAll, offset, limit} until the server says done."""
    offset, done, total = 0, 0, 0
    while True:
        resp = call("PATCH", "/api/jobs", {"rescoreAll": True, "offset": offset, "limit": page}, local=local)
        resp.raise_for_status()
        data = resp.json()
        done += data.get("rescored", 0)
        total = data.get("total", total)
        if data.get("nextOffset") is None:
            return done, total
        offset = data["nextOffset"]


def _report(resp: requests.Response) -> bool:
    if resp.ok:
        print(resp.text)
        return True
    print(f"HTTP {resp.status_code}: {resp.text[:500]}", file=sys.stderr)
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jobagent_scraper.api", description=__doc__.split("\n\n")[0])
    parser.add_argument("--local", action="store_true", help="target the local dev server instead of server.base_url")
    sub = parser.add_subparsers(dest="command", required=True)
    req = sub.add_parser("request", help="send one JSON API request and print the response body")
    req.add_argument("method", choices=["GET", "POST", "PATCH", "DELETE", "get", "post", "patch", "delete"])
    req.add_argument("path", help='e.g. "/api/jobs?id=<id>"')
    body = req.add_mutually_exclusive_group()
    body.add_argument("--json", help="JSON request body")
    body.add_argument("--json-file", type=Path, help="file containing the JSON request body")
    up = sub.add_parser("upload", help="upload files as downloadable documents on a job")
    up.add_argument("job_id")
    up.add_argument("files", nargs="+", type=Path)
    sub.add_parser("rescore-all", help="recompute every job's fit score, one page per request")
    args = parser.parse_args(argv)

    try:
        if args.command == "rescore-all":
            done, total = rescore_all(local=args.local)
            print(f"rescored {done} of {total} jobs")
            return 0 if done == total else 1
        if args.command == "request":
            payload = json.loads(args.json) if args.json else json.loads(args.json_file.read_text()) if args.json_file else None
            return 0 if _report(call(args.method, args.path, payload, local=args.local)) else 1
        ok = True
        for f in args.files:
            resp = upload_document(args.job_id, f, local=args.local)
            print(f"{f.name}: {'uploaded' if resp.ok else f'FAILED HTTP {resp.status_code} {resp.text[:200]}'}")
            ok = ok and resp.ok
        return 0 if ok else 1
    except (ValueError, OSError, requests.RequestException) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
