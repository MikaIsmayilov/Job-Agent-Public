import { env } from "cloudflare:workers";
import type { ApplicationAction } from "../lib/actions.ts";
async function database() {
  if (!env.DB) throw new Error("Action storage is not available.");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS application_actions (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, due_date TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  return env.DB;
}
export async function listActions(): Promise<ApplicationAction[]> {
  const db = await database();
  const result = await db.prepare(`SELECT id, job_id AS jobId, title, kind, due_date AS dueDate, url, notes, completed, created_at AS createdAt FROM application_actions ORDER BY completed, CASE WHEN due_date = '' THEN 1 ELSE 0 END, due_date, created_at DESC`).all<Omit<ApplicationAction, "completed"> & { completed: number }>();
  return result.results.map(row => ({ ...row, completed: Boolean(row.completed) }));
}
export async function saveAction(action: Omit<ApplicationAction, "id" | "createdAt" | "completed">, id?: string) {
  const db = await database(), now = new Date().toISOString();
  if (id) {
    const result = await db.prepare("UPDATE application_actions SET job_id=?, title=?, kind=?, due_date=?, url=?, notes=?, updated_at=? WHERE id=?").bind(action.jobId, action.title, action.kind, action.dueDate, action.url, action.notes, now, id).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }
  await db.prepare("INSERT INTO application_actions (id, job_id, title, kind, due_date, url, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), action.jobId, action.title, action.kind, action.dueDate, action.url, action.notes, now, now).run();
  return true;
}
export async function completeAction(id: string, completed: boolean) {
  const db = await database();
  const result = await db.prepare("UPDATE application_actions SET completed=?, updated_at=? WHERE id=?").bind(completed ? 1 : 0, new Date().toISOString(), id).run();
  return Number(result.meta?.changes ?? 0) > 0;
}
