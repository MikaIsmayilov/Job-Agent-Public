import { env } from "cloudflare:workers";
import type { MailReview, RunKind, RunRecord, RunReport } from "../lib/agent-runs.ts";

async function database() {
  if (!env.DB) throw new Error("Run storage is not available.");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, finished_at TEXT NOT NULL, ok INTEGER NOT NULL, summary TEXT NOT NULL DEFAULT '{}')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mail_reviews (id TEXT PRIMARY KEY, kind TEXT NOT NULL, reason TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', sender TEXT NOT NULL DEFAULT '', candidate_ids TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT)`),
  ]);
  return env.DB;
}

export async function recordRun(report: RunReport) {
  const db = await database();
  const now = new Date().toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare("INSERT INTO agent_runs (id, kind, finished_at, ok, summary) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), report.kind, now, report.ok ? 1 : 0, JSON.stringify(report.summary)),
    db.prepare("DELETE FROM agent_runs WHERE finished_at < ?").bind(monthAgo),
    // A reply seen again on a later run keeps its first record, so a review
    // the user already resolved stays resolved.
    ...report.reviews.map((r) =>
      db.prepare("INSERT OR IGNORE INTO mail_reviews (id, kind, reason, subject, sender, candidate_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(r.id, r.kind, r.reason, r.subject, r.sender, JSON.stringify(r.candidateIds), now),
    ),
  ]);
}

export async function runStatus(): Promise<{ last: Partial<Record<RunKind, RunRecord>>; lastCloudMail: string | null; reviews: MailReview[] }> {
  const db = await database();
  // .first() is not in this project's D1 typings, so the latest row per kind comes from one .all().
  const runs = await db.prepare(`SELECT r.kind, r.finished_at AS finishedAt, r.ok, r.summary FROM agent_runs r JOIN (SELECT kind, MAX(finished_at) AS latest FROM agent_runs GROUP BY kind) m ON r.kind = m.kind AND r.finished_at = m.latest`).all<{ kind: RunKind; finishedAt: string; ok: number; summary: string }>();
  const last: Partial<Record<RunKind, RunRecord>> = {};
  for (const row of runs.results) last[row.kind] = { kind: row.kind, finishedAt: row.finishedAt, ok: Boolean(row.ok), summary: JSON.parse(row.summary || "{}") };
  // The local launchd mail check stands down while the cloud cron is reporting.
  const cloud = await db.prepare("SELECT MAX(finished_at) AS at FROM agent_runs WHERE kind = 'mail' AND ok = 1 AND json_extract(summary, '$.cloud') = 1").all<{ at: string | null }>();
  const open = await db.prepare("SELECT id, kind, reason, subject, sender, candidate_ids AS candidateIds, created_at AS createdAt FROM mail_reviews WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 50").all<Omit<MailReview, "candidateIds"> & { candidateIds: string }>();
  return { last, lastCloudMail: cloud.results[0]?.at ?? null, reviews: open.results.map((r) => ({ ...r, candidateIds: JSON.parse(r.candidateIds) as string[] })) };
}

export async function resolveReview(id: string, resolution: string) {
  const db = await database();
  const result = await db.prepare("UPDATE mail_reviews SET resolved_at = ?, resolution = ? WHERE id = ? AND resolved_at IS NULL").bind(new Date().toISOString(), resolution.slice(0, 100), id).run();
  return Number(result.meta?.changes ?? 0) > 0;
}
