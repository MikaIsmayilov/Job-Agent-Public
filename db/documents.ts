import { env } from "cloudflare:workers";
import type { DocumentUpload } from "../lib/documents";

export type StoredDocumentMeta = {
  id: string;
  jobId: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
};

type DocumentRow = {
  id: string;
  job_id: string;
  filename: string;
  content_type: string;
  size: number;
  created_at: string;
  data_base64?: string;
};

function database() {
  if (!env.DB) throw new Error("Document storage is not available.");
  return env.DB;
}

async function ensureDocumentSchema() {
  await database()
    .prepare(`CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      data_base64 TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`)
    .run();
  await database().prepare("CREATE INDEX IF NOT EXISTS documents_job_idx ON documents(job_id)").run();
}

export async function saveDocument(upload: DocumentUpload): Promise<StoredDocumentMeta> {
  await ensureDocumentSchema();
  const db = database();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const size = Math.floor(upload.dataBase64.length * 0.75);
  // One row per (job, filename): re-tailoring replaces the previous version.
  await db.prepare("DELETE FROM documents WHERE job_id = ? AND filename = ?").bind(upload.jobId, upload.filename).run();
  await db
    .prepare("INSERT INTO documents (id, job_id, filename, content_type, size, data_base64, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, upload.jobId, upload.filename, upload.contentType, size, upload.dataBase64, createdAt)
    .run();
  return { id, jobId: upload.jobId, filename: upload.filename, contentType: upload.contentType, size, createdAt };
}

export async function deleteDocumentsForJob(jobId: string) {
  await ensureDocumentSchema();
  await database().prepare("DELETE FROM documents WHERE job_id = ?").bind(jobId).run();
}

export async function listDocuments(jobId: string): Promise<StoredDocumentMeta[]> {
  await ensureDocumentSchema();
  const result = await database()
    .prepare("SELECT id, job_id, filename, content_type, size, created_at FROM documents WHERE job_id = ? ORDER BY filename")
    .bind(jobId)
    .all<DocumentRow>();
  return result.results.map(metaFromRow);
}

export async function getDocument(id: string): Promise<(StoredDocumentMeta & { dataBase64: string }) | null> {
  await ensureDocumentSchema();
  const result = await database()
    .prepare("SELECT id, job_id, filename, content_type, size, created_at, data_base64 FROM documents WHERE id = ? LIMIT 1")
    .bind(id)
    .all<DocumentRow>();
  const row = result.results[0];
  return row ? { ...metaFromRow(row), dataBase64: row.data_base64 ?? "" } : null;
}

function metaFromRow(row: DocumentRow): StoredDocumentMeta {
  return {
    id: row.id,
    jobId: row.job_id,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    createdAt: row.created_at,
  };
}
