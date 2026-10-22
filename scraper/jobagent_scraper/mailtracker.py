"""Post-application tracking: read recent Gmail via IMAP and update job statuses.

Conservative by design:
- Only jobs already in `applied` or `interview` status are ever updated.
- Transitions: applied→interview, applied→rejected, interview→rejected. Nothing else.
- A message must look application-related AND match exactly one tracked job's
  company; ambiguous matches are reported, never acted on.
- Credentials (Gmail app password) come from .env; without them the command
  reports how to enable the feature and exits cleanly.
"""

from __future__ import annotations

from .server_auth import access_headers

import email
import email.header
import hashlib
import imaplib
import re
from datetime import datetime, timedelta, timezone

import requests

from .common import env_value
from .runs_client import report_run

IMAP_HOST = "imap.gmail.com"
MAX_MESSAGES = 200
# The cloud cron (worker/mail.ts) runs every 3 hours. While its last success is
# newer than this, the local launchd check stands down; when the cloud stops
# reporting (Workers Paid lapsed, secrets missing, outage) it takes over.
CLOUD_FRESH_MINUTES = 200

REJECTION_PATTERNS = re.compile(
    r"unfortunately|not (?:to |be )?mov(?:e|ing) forward|unable to move forward|other (?:qualified )?candidates|not selected"
    r"|will not be progressing|decided to (?:pursue|proceed with) other|position has been filled"
    r"|no longer under consideration|pursue other applicants|regret to inform"
    # Decision wordings the tracker used to miss.
    r"|position (?:has been|was|is) (?:closed|cancell?ed|filled)|did not select you"
    r"|not (?:be )?taking your application further|did not see a fit|unable to consider you"
    # "decided not to move forward", "won't be moving to the next stage".
    r"|(?:won['’]?t|will not) be moving (?:on )?to the next (?:stage|step|round)",
    re.IGNORECASE,
)
INTERVIEW_PATTERNS = re.compile(
    # Only phrases that imply a CONCRETE invitation. Bare "next step(s)" is
    # confirmation boilerplate ("if we move forward we'll discuss next steps")
    # and once caused a false applied->interview promotion.
    r"schedule (?:a|your|an) (?:call|interview|conversation|chat|phone screen)"
    r"|invite you to (?:an? )?interview|interview invitation|phone screen"
    r"|next step is to (?:complete|schedule)|advance(?:d)? to the next (?:step|round)"
    r"|moving you (?:forward )?to the next (?:step|round)"
    r"|(?:your|any) availability|book a time|hiring manager would like"
    # "You're invited to participate in our screening process".
    r"|invited to (?:participate in )?(?:our |an? |the )?(?:screening|assessment|interview)",
    re.IGNORECASE,
)
CONFIRMATION_PATTERNS = re.compile(
    r"application (?:was |has been )?received|thank you for applying|we (?:have )?received your application"
    r"|your application to|successfully submitted",
    re.IGNORECASE,
)
APPLICATION_CONTEXT = re.compile(
    r"your application|applying|application for|thank(?:s| you) for your interest|position|role|candidate|screening process",
    re.IGNORECASE,
)

STOPWORDS = {"the", "inc", "llc", "corp", "corporation", "company", "co", "us", "usa", "group", "labs", "technologies"}


def classify(subject: str, body: str) -> str | None:
    """'rejected' | 'interview' | 'confirmation' | None for one message."""
    # Plain-text bodies hard-wrap mid-phrase ("not move\r\nforward").
    text = re.sub(r"\s+", " ", f"{subject}\n{body}".replace("&nbsp;", " "))
    if not APPLICATION_CONTEXT.search(text):
        return None
    if REJECTION_PATTERNS.search(text):
        return "rejected"
    if INTERVIEW_PATTERNS.search(text):
        return "interview"
    if CONFIRMATION_PATTERNS.search(text):
        return "confirmation"
    return None


def company_tokens(company: str) -> list[str]:
    tokens = [t for t in re.findall(r"[a-z0-9]+", company.lower()) if len(t) >= 3 and t not in STOPWORDS]
    return tokens[:2]


ROLE_MENTION = re.compile(r"(?:for|to|in) the\s+(.{3,80}?)\s+(?:role|position|opportunity)\b", re.IGNORECASE)
# "joining us as a Financial Analyst I." Case-sensitive so
# "as a valued candidate" or "as a result" never reads as a title.
AS_ROLE = re.compile(r"\b[Aa]s an?\s+([A-Z][A-Za-z0-9&/\- ]{2,79}?)(?:\s+(?:role|position))?\s*[.,;!]")

LEGAL_SUFFIXES = {"the", "inc", "llc", "corp", "corporation", "company", "co", "ltd", "llp", "plc"}
# Dropped as an extra alias when enough name remains: "NorthStar Group" mails say
# "NorthStar"; "Hum Group" keeps only its full name (one short word is too weak).
GROUP_SUFFIXES = {"group", "holdings"}


def _norm(text: str) -> str:
    """Lowercase words separated by single spaces, padded so ' x ' is a word-boundary test."""
    text = text.lower().replace("&", " and ").replace("'", "").replace("’", "")
    return " " + " ".join(re.findall(r"[a-z0-9]+", text)) + " "


def company_names(company: str) -> list[str]:
    """Normalized names a company goes by: 'John Calloway / Maplelife' -> ['john calloway', 'maplelife']."""
    names = []
    for alias in re.split(r"[/(),|]", company):
        words = [w for w in _norm(alias).split() if w not in LEGAL_SUFFIXES]
        if words and len("".join(words)) >= 3:
            names.append(" ".join(words))
        if len(words) > 1 and words[-1] in GROUP_SUFFIXES and len("".join(words[:-1])) >= 4:
            names.append(" ".join(words[:-1]))
    return names


def title_variants(title: str) -> list[str]:
    """Normalized ways an email may name a tracked title.

    'Customer Success Analyst/Associate' -> the full title, 'customer success
    analyst' and 'customer success associate' (a reply may name only one).
    """
    full = _norm(title)
    if not full.strip():
        return []
    derived = []
    parts = [p for p in title.split("/") if p.strip()]
    if len(parts) > 1:
        base = _norm(parts[0]).split()
        derived.append(_norm(parts[0]))
        for part in parts[1:]:
            words = _norm(part).split()
            derived.append(_norm(" ".join(base[:-1] + words)) if len(words) == 1 else _norm(part))
    # A derived variant needs two words: "Associate" alone would match anything.
    return list(dict.fromkeys([full] + [v for v in derived if len(v.split()) >= 2]))


def match_jobs(jobs: list[dict], sender: str, subject: str, body: str) -> list[dict]:
    """Tracked jobs this message is about, narrowed as far as the evidence allows.

    The full company name must appear as whole words (or squashed into the
    sender address, e.g. gbw@... 'GrayBrothersWhitman'). Single-token
    substring matching made two-word names match common sign-offs and short
    names like 'Man' match words such as 'human' (2026-10-12 audit). Header matches beat
    body-only mentions, and the role title picks among one company's jobs.
    """
    head = _norm(sender + " " + subject)
    text = _norm(subject + " " + body[:4000])
    sender_compact = re.sub(r"[^a-z0-9]", "", sender.lower())

    tiers: dict[int, list[dict]] = {2: [], 1: []}
    for job in jobs:
        names = company_names(job.get("company", ""))
        if any(f" {n} " in head or n.replace(" ", "") in sender_compact for n in names):
            tiers[2].append(job)
        elif any(f" {n} " in text for n in names):
            tiers[1].append(job)
    candidates = tiers[2] or tiers[1]
    if len(candidates) <= 1:
        return candidates

    titled = [j for j in candidates if any(v in text for v in title_variants(j.get("title", "")))]
    # 'Data Scientist' is inside 'Data Scientist, Pricing Models'; when both
    # appear, the longer (more specific) title is the one the email names.
    titled = [j for j in titled if not any(
        o is not j and _norm(j["title"]) in _norm(o["title"]) and _norm(o["title"]) != _norm(j["title"]) for o in titled
    )]
    return titled or candidates


def _text(data: bytes, charset: str | None) -> str:
    """Bytes to text; a charset Python does not know (e.g. "unknown-8bit")
    falls back to UTF-8 instead of failing the whole run."""
    try:
        return data.decode(charset or "utf-8", "replace")
    except LookupError:
        return data.decode("utf-8", "replace")


def _decode(value) -> str:
    if value is None:
        return ""
    parts = email.header.decode_header(value)
    out = ""
    for text, charset in parts:
        out += _text(text, charset) if isinstance(text, bytes) else text
    return out


ENTITIES = {"nbsp": " ", "amp": "&", "quot": '"', "apos": "'", "rsquo": "’", "lsquo": "‘", "ldquo": "“", "rdquo": "”", "lt": "<", "gt": ">"}


def html_to_text(html: str) -> str:
    """Visible text of an HTML part. Kept in step with lib/mail-message.ts."""
    html = re.sub(r"<(style|script|head)\b.*?</\1\s*>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), text)
    text = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), text)
    return re.sub(r"&([a-zA-Z]+);", lambda m: ENTITIES.get(m.group(1).lower(), m.group(0)), text)


def _body_text(msg) -> str:
    """Plain-text part plus the HTML part's text: LinkedIn puts the decision
    ("Unfortunately...") only in the HTML part."""
    plain, html = "", ""
    parts = msg.walk() if msg.is_multipart() else [msg]
    for part in parts:
        kind = part.get_content_type()
        if kind not in ("text/plain", "text/html") or part.get_filename():
            continue
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        text = _text(payload, part.get_content_charset())
        if kind == "text/plain" and not plain:
            plain = text
        elif kind == "text/html" and not html:
            html = html_to_text(text)
    return "\n".join(t for t in (plain, html) if t)


def names_other_role(job: dict, subject: str, body: str) -> str | None:
    """The role an email names when it is clearly not this job's title, else None.

    A rejection naming 'Supply Chain Operations Lead' when the tracked job at
    that company is 'Procurement Analyst' must not reject the wrong
    application on a company-only match.
    """
    text = re.sub(r"\s+", " ", f"{subject} {body}".replace("&nbsp;", " "))
    titles = title_variants(job.get("title", ""))
    if not titles or any(t in _norm(text) for t in titles):
        return None
    mentioned = ROLE_MENTION.findall(text) + AS_ROLE.findall(text)
    if not mentioned or any(_norm(m) in t or t in _norm(m) for m in mentioned for t in titles):
        return None
    return mentioned[0]


def review_id(kind: str, sender: str, subject: str) -> str:
    """Stable id for one reply, so re-scanning the same mail never re-opens a resolved review."""
    return hashlib.sha1(f"{kind}|{sender.strip().lower()}|{subject.strip().lower()}".encode()).hexdigest()[:20]


def evaluate_messages(messages: list[dict], tracked: list[dict]) -> tuple[dict, list]:
    updates, notes, _ = evaluate_messages_with_reviews(messages, tracked)
    return updates, notes


def evaluate_messages_with_reviews(messages: list[dict], tracked: list[dict]) -> tuple[dict, list, list]:
    """Pure classification pass shared by every mail source (IMAP, MCP, ...).

    `messages` items need `sender`, `subject`, `body` (missing keys default to
    ""). Returns (updates, notes) exactly like the old inline loop in
    run_mail: updates maps job id -> (job, new_status); notes are
    human-readable strings (ambiguous matches, confirmations).
    """
    updates: dict[str, tuple[dict, str]] = {}
    notes: list[str] = []
    reviews: list[dict] = []
    for msg in messages:
        sender = msg.get("sender") or ""
        subject = msg.get("subject") or ""
        body = msg.get("body") or ""
        kind = classify(subject, body)
        if not kind:
            continue
        matches = match_jobs(tracked, sender, subject, body)
        if not matches:
            continue
        if len(matches) > 1 and kind != "confirmation":
            notes.append(f"AMBIGUOUS {kind}: '{subject[:60]}' matches {len(matches)} jobs — review manually")
            reviews.append({"id": review_id(kind, sender, subject), "kind": kind, "reason": "ambiguous", "subject": subject[:200],
                            "sender": sender[:200], "candidateIds": [j["id"] for j in matches]})
            continue
        job = matches[0]
        other_role = names_other_role(job, subject, body) if kind != "confirmation" else None
        if other_role:
            notes.append(f"ROLE MISMATCH {kind}: {job['company']} email names '{other_role[:50]}', tracked '{job['title'][:50]}' — review manually")
            reviews.append({"id": review_id(kind, sender, subject), "kind": kind, "reason": "role_mismatch", "subject": subject[:200],
                            "sender": sender[:200], "candidateIds": [job["id"]]})
            continue
        if kind == "confirmation":
            notes.append(f"confirmation received: {job['company']} — {job['title'][:50]}")
        elif kind == "interview" and job["status"] == "applied":
            updates[job["id"]] = (job, "interview")
        elif kind == "rejected" and job["status"] in ("applied", "interview"):
            updates[job["id"]] = (job, "rejected")
    return updates, notes, reviews


def apply_updates(base: str, updates: dict, notes: list, dry_run: bool, log) -> None:
    """Shared apply+log tail: PATCH each update, log everything, print the summary line."""
    for job, new_status in updates.values():
        log(f"[mail] {'would set' if dry_run else 'setting'} {new_status.upper()}: {job['title'][:50]} @ {job['company']}")
        if not dry_run:
            resp = requests.patch(f"{base}/api/jobs", headers=access_headers(base), json={"id": job["id"], "status": new_status}, timeout=60)
            if not resp.ok:
                log(f"[mail] FAILED ({resp.status_code}) to set {new_status}: {job['title'][:50]} @ {job['company']}")
    for note in notes:
        log(f"[mail] {note}")
    log(f"[mail] done — {len(updates)} status update(s), {len(notes)} note(s)")


def cloud_checked_recently(cfg: dict, log, now: datetime | None = None) -> bool:
    """True when the cloud mail cron succeeded within CLOUD_FRESH_MINUTES. Any doubt means False (run locally)."""
    base = cfg["server"]["base_url"].rstrip("/")
    try:
        response = requests.get(f"{base}/api/runs", headers=access_headers(base), timeout=30)
        response.raise_for_status()
        at = response.json().get("lastCloudMail")
    except Exception as error:
        log(f"[mail] could not read cloud run status ({error.__class__.__name__}); checking locally")
        return False
    if not at:
        return False
    finished = datetime.fromisoformat(at.replace("Z", "+00:00"))
    minutes = ((now or datetime.now(timezone.utc)) - finished).total_seconds() / 60
    if minutes < CLOUD_FRESH_MINUTES:
        log(f"[mail] skipped: the cloud checked mail {round(minutes)}m ago")
        return True
    log(f"[mail] cloud last checked mail {round(minutes)}m ago; checking locally")
    return False


def fetch_tracked_jobs(base: str) -> list[dict]:
    all_jobs = requests.get(f"{base}/api/jobs", headers=access_headers(base), timeout=60).json().get("jobs", [])
    return [j for j in all_jobs if j.get("status") in ("applied", "interview")]


def _fetch_messages(address: str, password: str, days: int, tracked_count: int, log) -> list[dict]:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%d-%b-%Y")
    mail = imaplib.IMAP4_SSL(IMAP_HOST)
    try:
        mail.login(address, password)
        mail.select("INBOX", readonly=True)
        _, data = mail.search(None, f'(SINCE "{since}")')
        ids = data[0].split()[-MAX_MESSAGES:]
        log(f"[mail] scanning {len(ids)} messages since {since} against {tracked_count} tracked jobs")

        messages = []
        for msg_id in ids:
            _, msg_data = mail.fetch(msg_id, "(BODY.PEEK[])")
            if not msg_data or not msg_data[0]:
                continue
            msg = email.message_from_bytes(msg_data[0][1])
            messages.append({
                "sender": _decode(msg.get("From")),
                "subject": _decode(msg.get("Subject")),
                "body": _body_text(msg),
            })
    finally:
        try:
            mail.logout()
        except Exception:
            pass
    return messages


def run_mail(cfg: dict, days: int, dry_run: bool, log) -> None:
    address = env_value("GMAIL_ADDRESS")
    password = env_value("GMAIL_APP_PASSWORD")
    if not (address and password):
        log("[mail] skipped — set GMAIL_ADDRESS and GMAIL_APP_PASSWORD in .env to enable")
        log("[mail]   (Google account -> Security -> 2-Step Verification -> App passwords)")
        return

    base = cfg["server"]["base_url"].rstrip("/")
    tracked = fetch_tracked_jobs(base)
    if not tracked:
        log("[mail] no applied/interview jobs to track yet")
        if not dry_run:
            report_run(base, "mail", True, {"scanned": 0, "tracked": 0}, log)
        return

    try:
        messages = _fetch_messages(address, password, days, len(tracked), log)
    except Exception:
        if not dry_run:
            report_run(base, "mail", False, {"tracked": len(tracked)}, log)
        raise
    _evaluate_and_report(base, messages, tracked, dry_run, log)


def _evaluate_and_report(base: str, messages: list[dict], tracked: list[dict], dry_run: bool, log) -> None:
    updates, notes, reviews = evaluate_messages_with_reviews(messages, tracked)
    apply_updates(base, updates, notes, dry_run, log)
    if not dry_run:
        summary = {"scanned": len(messages), "tracked": len(tracked), "updates": len(updates), "reviews": len(reviews)}
        report_run(base, "mail", True, summary, log, reviews)


def run_mail_from_messages(cfg: dict, messages: list[dict], dry_run: bool, log) -> None:
    """Same conservative pipeline as run_mail, but for pre-fetched messages.

    Used by the `/mail-check` skill: Claude fetches messages via the Gmail MCP
    connector (no IMAP app password needed) and hands them here as plain
    dicts (`sender`, `subject`, `body`) so classification, company matching,
    and the update/PATCH logic stay identical and single-sourced with the
    IMAP path above.
    """
    base = cfg["server"]["base_url"].rstrip("/")
    tracked = fetch_tracked_jobs(base)
    if not tracked:
        log("[mail] no applied/interview jobs to track yet")
        return
    log(f"[mail] scanning {len(messages)} messages against {len(tracked)} tracked jobs")
    _evaluate_and_report(base, messages, tracked, dry_run, log)
