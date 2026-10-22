import { env } from "cloudflare:workers";
import { saveOrUpdateJob } from "../../../../db/jobs";
import { buildIngestRecord, PayloadIssue, validateIngestPayload } from "../../../../lib/ingest";

export const runtime = "edge";

export async function POST(request: Request) {
  const token = env.INGEST_TOKEN;
  if (!token || request.headers.get("x-ingest-token") !== token) {
    return Response.json({ error: "Invalid or missing ingest token." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const { payload, issues } = validateIngestPayload(body);
  if (!payload) return Response.json({ error: issues[0]?.reason ?? "Invalid payload." }, { status: 400 });

  const fetchedAt = payload.scraped_at ?? new Date().toISOString();
  const skipped: PayloadIssue[] = [...issues];
  let created = 0;
  let refreshed = 0;

  for (const [index, job] of payload.jobs.entries()) {
    try {
      const record = await buildIngestRecord(payload.source_site, job, fetchedAt);
      const result = await saveOrUpdateJob(record, job.description.slice(0, 80_000));
      if (result.deduplicated) refreshed += 1;
      else created += 1;
    } catch (error) {
      skipped.push({ index, reason: error instanceof Error ? error.message : "Failed to store job." });
    }
  }

  return Response.json({
    received: payload.jobs.length + issues.length,
    created,
    refreshed,
    skipped,
  });
}
