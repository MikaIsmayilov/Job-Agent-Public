import { env } from "cloudflare:workers";
import { FieldEvidence, JobRecord, preserveUserEdits } from "../lib/job-provenance";

export type StoredJob = JobRecord;

type JobRow = {
  id: string;
  title: string;
  company: string;
  location: string;
  work_mode: string;
  salary: string;
  posted_at: string;
  source: string;
  source_url: string | null;
  canonical_url: string | null;
  source_http_status: number | null;
  score: number;
  status: StoredJob["status"];
  skills_json: string;
  gaps_json: string;
  summary: string;
  record_type: StoredJob["recordType"];
  verification_status: StoredJob["verificationStatus"];
  source_kind: StoredJob["sourceKind"];
  fetched_at: string;
  verified_at: string | null;
  date_posted: string | null;
  valid_through: string | null;
  content_hash: string;
  evidence_json: string;
  job_type: string | null;
  experience_level: string | null;
  role_family: string;
  source_site: string | null;
  tailored_path: string | null;
  tailored_at: string | null;
  tailored_changes: string | null;
  screened_out: string | null;
  status_changed_at: string | null;
  applied_at: string | null;
  sponsorship: string;
  sponsorship_note: string | null;
  tags_json: string;
  red_flags_json: string;
  created_at: string;
};

const PROVENANCE_COLUMNS: Array<[string, string]> = [
  ["canonical_url", "TEXT"],
  ["source_http_status", "INTEGER"],
  ["record_type", "TEXT NOT NULL DEFAULT 'imported'"],
  ["verification_status", "TEXT NOT NULL DEFAULT 'unverified'"],
  ["source_kind", "TEXT NOT NULL DEFAULT 'webpage'"],
  ["fetched_at", "TEXT NOT NULL DEFAULT ''"],
  ["verified_at", "TEXT"],
  ["date_posted", "TEXT"],
  ["valid_through", "TEXT"],
  ["content_hash", "TEXT NOT NULL DEFAULT ''"],
  ["evidence_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["job_type", "TEXT"],
  ["experience_level", "TEXT"],
  ["role_family", "TEXT NOT NULL DEFAULT ''"],
  ["source_site", "TEXT"],
  ["tailored_path", "TEXT"],
  ["tailored_at", "TEXT"],
  ["tailored_changes", "TEXT"],
  ["screened_out", "TEXT"],
  ["status_changed_at", "TEXT"],
  ["applied_at", "TEXT"],
  ["sponsorship", "TEXT NOT NULL DEFAULT 'unknown'"],
  ["sponsorship_note", "TEXT"],
  ["tags_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["red_flags_json", "TEXT NOT NULL DEFAULT '[]'"],
];

function database() {
  if (!env.DB) throw new Error("Job storage is not available.");
  return env.DB;
}

export async function ensureJobSchema() {
  const db = database();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT NOT NULL,
      work_mode TEXT NOT NULL,
      salary TEXT NOT NULL,
      posted_at TEXT NOT NULL,
      source TEXT NOT NULL,
      source_url TEXT,
      canonical_url TEXT,
      source_http_status INTEGER,
      score INTEGER NOT NULL,
      status TEXT NOT NULL,
      skills_json TEXT NOT NULL,
      gaps_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      raw_description TEXT NOT NULL,
      record_type TEXT NOT NULL DEFAULT 'imported',
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      source_kind TEXT NOT NULL DEFAULT 'webpage',
      fetched_at TEXT NOT NULL DEFAULT '',
      verified_at TEXT,
      date_posted TEXT,
      valid_through TEXT,
      content_hash TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      job_type TEXT,
      experience_level TEXT,
      role_family TEXT NOT NULL DEFAULT '',
      source_site TEXT,
      tailored_path TEXT,
      tailored_at TEXT,
      tailored_changes TEXT,
      screened_out TEXT,
      status_changed_at TEXT,
      applied_at TEXT,
      sponsorship TEXT NOT NULL DEFAULT 'unknown',
      sponsorship_note TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      red_flags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
  ]);

  const columns = await db.prepare("PRAGMA table_info(jobs)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  for (const [name, definition] of PROVENANCE_COLUMNS) {
    if (!existing.has(name)) await db.prepare(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`).run();
  }

  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs(created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS jobs_canonical_url_idx ON jobs(canonical_url)"),
    db.prepare("CREATE INDEX IF NOT EXISTS jobs_content_hash_idx ON jobs(content_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS jobs_verification_idx ON jobs(verification_status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS jobs_role_family_idx ON jobs(role_family)"),
  ]);
}

export async function listJobs(): Promise<StoredJob[]> {
  await ensureJobSchema();
  // 2500, not 1000: the inbox crossed 1000 rows in Aug 2026 and the old cap
  // silently hid the oldest rows from the dashboard, prune, and bulk sweeps.
  const result = await database().prepare(`${selectFields()} FROM jobs ORDER BY created_at DESC LIMIT 2500`).all<JobRow>();
  return result.results.map(fromRow);
}

/** Applications the mail check can move: id, company, title and status only. */
export async function listTrackedJobs(): Promise<Array<{ id: string; company: string; title: string; status: string }>> {
  await ensureJobSchema();
  const result = await database()
    .prepare("SELECT id, company, title, status FROM jobs WHERE status IN ('applied', 'interview')")
    .all<{ id: string; company: string; title: string; status: string }>();
  return result.results;
}

export async function getJob(id: string): Promise<(StoredJob & { rawDescription?: string }) | null> {
  await ensureJobSchema();
  const result = await database()
    .prepare(`${selectFields()}, raw_description FROM jobs WHERE id = ? LIMIT 1`)
    .bind(id)
    .all<JobRow & { raw_description: string }>();
  if (!result.results[0]) return null;
  return { ...fromRow(result.results[0]), rawDescription: result.results[0].raw_description };
}

export async function saveOrUpdateJob(job: StoredJob, rawDescription: string): Promise<{ job: StoredJob; deduplicated: boolean }> {
  await ensureJobSchema();
  const db = database();
  const duplicate = await findDuplicate(job.canonicalUrl, job.contentHash);
  const now = new Date().toISOString();

  if (duplicate) {
    // A weaker re-import (e.g. pasting the URL of an ATS-verified job, where
    // the page fetch finds no JSON-LD) must never downgrade a verified row:
    // keep the verified identity, evidence, and full JD; refresh the rest.
    const downgrade = duplicate.verificationStatus === "verified" && job.verificationStatus !== "verified";
    let effectiveRaw = rawDescription;
    let base = job;
    if (downgrade) {
      const existing = await getJob(duplicate.id);
      if (existing?.rawDescription) effectiveRaw = existing.rawDescription;
      base = {
        ...job,
        title: duplicate.title,
        company: duplicate.company,
        location: duplicate.location,
        recordType: duplicate.recordType,
        verificationStatus: duplicate.verificationStatus,
        verifiedAt: duplicate.verifiedAt,
        sourceKind: duplicate.sourceKind,
        evidence: duplicate.evidence,
        contentHash: duplicate.contentHash,
        datePosted: job.datePosted ?? duplicate.datePosted,
        validThrough: job.validThrough ?? duplicate.validThrough,
      };
    }
    const refreshed = {
      ...preserveUserEdits(base, duplicate),
      id: duplicate.id,
      status: duplicate.status,
      tailoredPath: job.tailoredPath ?? duplicate.tailoredPath,
      tailoredAt: job.tailoredAt ?? duplicate.tailoredAt,
      tailoredChanges: job.tailoredChanges ?? duplicate.tailoredChanges,
      // A queue-screening verdict is durable — daily refreshes must not clear it.
      screenedOut: job.screenedOut ?? duplicate.screenedOut,
      statusChangedAt: job.statusChangedAt ?? duplicate.statusChangedAt,
      appliedAt: job.appliedAt ?? duplicate.appliedAt,
    };
    await db.prepare(`UPDATE jobs SET
      title = ?, company = ?, location = ?, work_mode = ?, salary = ?, posted_at = ?, source = ?, source_url = ?,
      canonical_url = ?, source_http_status = ?, score = ?, status = ?, skills_json = ?, gaps_json = ?, summary = ?, raw_description = ?,
      record_type = ?, verification_status = ?, source_kind = ?, fetched_at = ?, verified_at = ?, date_posted = ?,
      valid_through = ?, content_hash = ?, evidence_json = ?, job_type = ?, experience_level = ?, role_family = ?,
      source_site = ?, tailored_path = ?, tailored_at = ?, tailored_changes = ?, screened_out = ?, status_changed_at = ?, applied_at = ?, sponsorship = ?, sponsorship_note = ?, tags_json = ?,
      red_flags_json = ?, updated_at = ? WHERE id = ?`)
      .bind(...jobBindings(refreshed, effectiveRaw), now, refreshed.id)
      .run();
    return { job: refreshed, deduplicated: true };
  }

  await db.prepare(`INSERT INTO jobs (
    id, title, company, location, work_mode, salary, posted_at, source, source_url, canonical_url,
    source_http_status, score, status, skills_json, gaps_json, summary, raw_description, record_type,
    verification_status, source_kind, fetched_at, verified_at, date_posted, valid_through, content_hash,
    evidence_json, job_type, experience_level, role_family, source_site, tailored_path, tailored_at, tailored_changes,
    screened_out, status_changed_at, applied_at, sponsorship, sponsorship_note, tags_json, red_flags_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(job.id, ...jobBindings(job, rawDescription), now, now)
    .run();
  return { job, deduplicated: false };
}

export async function updateJobTailoring(id: string, tailoredPath: string, tailoredAt: string, status?: StoredJob["status"], tailoredChanges?: string) {
  await ensureJobSchema();
  const now = new Date().toISOString();
  if (status) {
    await database()
      .prepare("UPDATE jobs SET tailored_path = ?, tailored_at = ?, tailored_changes = ?, status = ?, updated_at = ? WHERE id = ?")
      .bind(tailoredPath, tailoredAt, tailoredChanges ?? null, status, now, id)
      .run();
    return;
  }
  await database()
    .prepare("UPDATE jobs SET tailored_path = ?, tailored_at = ?, tailored_changes = ?, updated_at = ? WHERE id = ?")
    .bind(tailoredPath, tailoredAt, tailoredChanges ?? null, now, id)
    .run();
}

export async function updateJobIdentity(job: StoredJob) {
  await ensureJobSchema();
  await database()
    .prepare("UPDATE jobs SET title = ?, company = ?, location = ?, work_mode = ?, score = ?, skills_json = ?, gaps_json = ?, role_family = ?, evidence_json = ?, updated_at = ? WHERE id = ?")
    .bind(job.title, job.company, job.location, job.workMode, job.score, JSON.stringify(job.skills), JSON.stringify(job.gaps), job.roleFamily ?? "", JSON.stringify(job.evidence), new Date().toISOString(), job.id)
    .run();
}

/**
 * Refresh only the derived fit fields, leaving identity, evidence, status, and
 * tailoring untouched. Used after data/resume.json changes: stored scores are
 * computed at ingest time, so without this they keep reflecting the old résumé.
 */
export async function rescoreJob(id: string, score: number, skills: string[], gaps: string[], roleFamily: string) {
  await ensureJobSchema();
  await database()
    .prepare("UPDATE jobs SET score = ?, skills_json = ?, gaps_json = ?, role_family = ?, updated_at = ? WHERE id = ?")
    .bind(score, JSON.stringify(skills), JSON.stringify(gaps), roleFamily, new Date().toISOString(), id)
    .run();
}

/**
 * One page of what a rescore needs, in a single query. A full rescore cannot
 * run in one Worker request: a per-job loop hits the ~1,000 D1 query cap
 * after about 125 jobs, and scoring a thousand at once exceeds the CPU limit
 * (error 1102). Callers page through with offset/limit instead.
 */
export async function listJobsForRescore(offset: number, limit: number): Promise<{ total: number; rows: Array<{ id: string; title: string; rawDescription: string; experienceLevel?: string; roleFamily: string }> }> {
  await ensureJobSchema();
  const db = database();
  const count = (await db.prepare("SELECT COUNT(*) AS n FROM jobs").all<{ n: number }>()).results?.[0];
  const result = await db
    .prepare("SELECT id, title, raw_description, experience_level, role_family FROM jobs ORDER BY id LIMIT ? OFFSET ?")
    .bind(limit, offset)
    .all<{ id: string; title: string; raw_description: string | null; experience_level: string | null; role_family: string | null }>();
  return {
    total: count?.n ?? 0,
    rows: (result.results ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      rawDescription: row.raw_description ?? "",
      experienceLevel: row.experience_level ?? undefined,
      roleFamily: row.role_family ?? "",
    })),
  };
}

/** Writes many fit updates in batches of 100 statements (one round trip per batch). */
export async function rescoreJobsBatch(updates: Array<{ id: string; score: number; skills: string[]; gaps: string[]; roleFamily: string }>) {
  const db = database();
  const now = new Date().toISOString();
  for (let start = 0; start < updates.length; start += 100) {
    await db.batch(
      updates.slice(start, start + 100).map((update) =>
        db
          .prepare("UPDATE jobs SET score = ?, skills_json = ?, gaps_json = ?, role_family = ?, updated_at = ? WHERE id = ?")
          .bind(update.score, JSON.stringify(update.skills), JSON.stringify(update.gaps), update.roleFamily, now, update.id),
      ),
    );
  }
}

export async function updateJobExperience(id: string, level: NonNullable<StoredJob["experienceLevel"]>) {
  await ensureJobSchema();
  await database().prepare("UPDATE jobs SET experience_level = ?, updated_at = ? WHERE id = ?").bind(level, new Date().toISOString(), id).run();
}

export async function updateJobScreening(id: string, reason: string | null) {
  await ensureJobSchema();
  await database().prepare("UPDATE jobs SET screened_out = ?, updated_at = ? WHERE id = ?").bind(reason, new Date().toISOString(), id).run();
}

export async function updateJobStatus(id: string, status: StoredJob["status"]) {
  await ensureJobSchema();
  const now = new Date().toISOString();
  // applied_at is set once, the first time the job reaches applied, and never
  // moves after that — it anchors time-to-response analytics.
  await database()
    .prepare("UPDATE jobs SET status = ?, status_changed_at = ?, applied_at = CASE WHEN ? = 'applied' THEN COALESCE(applied_at, ?) ELSE applied_at END, updated_at = ? WHERE id = ?")
    .bind(status, now, status, now, now, id)
    .run();
}

export async function deleteJob(id: string) {
  await ensureJobSchema();
  await database().prepare("DELETE FROM jobs WHERE id = ?").bind(id).run();
}

async function findDuplicate(canonicalUrl: string | undefined, contentHash: string) {
  const db = database();
  const result = canonicalUrl
    ? await db.prepare(`${selectFields()} FROM jobs WHERE canonical_url = ? OR content_hash = ? ORDER BY updated_at DESC LIMIT 1`).bind(canonicalUrl, contentHash).all<JobRow>()
    : await db.prepare(`${selectFields()} FROM jobs WHERE content_hash = ? ORDER BY updated_at DESC LIMIT 1`).bind(contentHash).all<JobRow>();
  return result.results[0] ? fromRow(result.results[0]) : null;
}

function selectFields() {
  return `SELECT id, title, company, location, work_mode, salary, posted_at, source, source_url, canonical_url,
    source_http_status, score, status, skills_json, gaps_json, summary, record_type, verification_status,
    source_kind, fetched_at, verified_at, date_posted, valid_through, content_hash, evidence_json,
    job_type, experience_level, role_family, source_site, tailored_path, tailored_at, tailored_changes,
    screened_out, status_changed_at, applied_at, sponsorship, sponsorship_note, tags_json, red_flags_json, created_at`;
}

function jobBindings(job: StoredJob, rawDescription: string) {
  return [
    job.title, job.company, job.location, job.workMode, job.salary, job.postedAt, job.source, job.sourceUrl ?? null,
    job.canonicalUrl ?? null, job.sourceHttpStatus ?? null, job.score, job.status, JSON.stringify(job.skills),
    JSON.stringify(job.gaps), job.summary, rawDescription, job.recordType, job.verificationStatus, job.sourceKind,
    job.fetchedAt, job.verifiedAt ?? null, job.datePosted ?? null, job.validThrough ?? null, job.contentHash,
    JSON.stringify(job.evidence), job.jobType ?? null, job.experienceLevel ?? null, job.roleFamily ?? "",
    job.sourceSite ?? null, job.tailoredPath ?? null, job.tailoredAt ?? null, job.tailoredChanges ?? null,
    job.screenedOut ?? null, job.statusChangedAt ?? null, job.appliedAt ?? null, job.sponsorship ?? "unknown", job.sponsorshipNote ?? null, JSON.stringify(job.tags ?? []),
    JSON.stringify(job.redFlags ?? []),
  ];
}

function fromRow(row: JobRow): StoredJob {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    workMode: row.work_mode,
    salary: row.salary,
    postedAt: row.posted_at,
    source: row.source,
    sourceUrl: row.source_url ?? undefined,
    canonicalUrl: row.canonical_url ?? undefined,
    sourceHttpStatus: row.source_http_status ?? undefined,
    score: row.score,
    status: row.status,
    skills: safeStringArray(row.skills_json),
    gaps: safeStringArray(row.gaps_json),
    summary: row.summary,
    recordType: row.record_type || "imported",
    verificationStatus: row.verification_status || "unverified",
    sourceKind: row.source_kind || "webpage",
    fetchedAt: row.fetched_at,
    verifiedAt: row.verified_at ?? undefined,
    datePosted: row.date_posted ?? undefined,
    validThrough: row.valid_through ?? undefined,
    contentHash: row.content_hash,
    evidence: safeEvidence(row.evidence_json),
    jobType: (row.job_type as StoredJob["jobType"]) ?? undefined,
    experienceLevel: (row.experience_level as StoredJob["experienceLevel"]) ?? undefined,
    roleFamily: row.role_family || "",
    sourceSite: row.source_site ?? undefined,
    tailoredPath: row.tailored_path ?? undefined,
    tailoredAt: row.tailored_at ?? undefined,
    tailoredChanges: row.tailored_changes ?? undefined,
    screenedOut: row.screened_out ?? undefined,
    statusChangedAt: row.status_changed_at ?? undefined,
    appliedAt: row.applied_at ?? undefined,
    sponsorship: (row.sponsorship as StoredJob["sponsorship"]) || "unknown",
    sponsorshipNote: row.sponsorship_note ?? undefined,
    tags: safeStringArray(row.tags_json || "[]"),
    redFlags: safeStringArray(row.red_flags_json || "[]"),
    // created_at is written once at insert and never changed by dedup
    // refreshes, so it is the honest "first seen" timestamp.
    firstSeenAt: row.created_at || undefined,
  };
}

function safeStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function safeEvidence(value: string): FieldEvidence[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as FieldEvidence[] : [];
  } catch {
    return [];
  }
}
