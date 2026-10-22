import { deleteJob, getJob, listJobs, listJobsForRescore, rescoreJob, rescoreJobsBatch, saveOrUpdateJob, StoredJob, updateJobExperience, updateJobIdentity, updateJobScreening, updateJobStatus, updateJobTailoring } from "../../../db/jobs";
import { deleteDocumentsForJob } from "../../../db/documents";
import {
  applyUserEdits,
  buildJobRecord,
  EditableJobField,
  findJobPostingJsonLd,
  htmlToText,
  safePublicUrl,
  sha256,
  sourceMetadata,
  SourceKind,
  WORK_MODES,
} from "../../../lib/job-provenance";
import { evaluateResumeFit, seniorityAdjustedScore } from "../../../lib/matching";

export const runtime = "edge";

const ALLOWED_STATUSES = new Set(["new", "shortlisted", "ready", "applied", "interview", "rejected"]);
const MAX_REDIRECTS = 5;

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const job = await getJob(id);
      if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
      return Response.json({ jobs: [job] });
    }
    return Response.json({ jobs: await listJobs() });
  } catch (error) {
    return Response.json({ jobs: [], warning: message(error) });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { mode?: string; value?: string };
    const value = body.value?.trim();
    if (!value || (body.mode !== "url" && body.mode !== "text")) {
      return Response.json({ error: "Provide a job URL or job description." }, { status: 400 });
    }

    const fetchedAt = new Date().toISOString();
    let sourceUrl: string | undefined;
    let canonicalUrl: string | undefined;
    let sourceHttpStatus: number | undefined;
    let source = "Pasted description";
    let sourceKind: SourceKind = "pasted_text";
    let raw = value;
    let structured: Record<string, unknown> | null = null;

    if (body.mode === "url") {
      const url = safePublicUrl(value);
      if (!url) return Response.json({ error: "Enter a valid public HTTP or HTTPS URL." }, { status: 400 });
      sourceUrl = url.toString();
      const metadata = sourceMetadata(url.hostname);
      source = metadata.source;
      sourceKind = metadata.sourceKind;
      const fetched = await fetchJobPage(url);
      raw = fetched.text;
      structured = fetched.structured;
      canonicalUrl = fetched.canonicalUrl;
      sourceHttpStatus = fetched.httpStatus;
      const finalMetadata = sourceMetadata(new URL(canonicalUrl).hostname);
      source = finalMetadata.source;
      sourceKind = finalMetadata.sourceKind;
    }

    const contentHash = await sha256(raw);
    const titleForFit = typeof structured?.title === "string" ? structured.title : raw.split(/\n+/)[0] || "Unknown title";
    const fit = evaluateResumeFit(titleForFit, raw);
    const candidate = buildJobRecord({
      raw,
      source,
      sourceUrl,
      canonicalUrl,
      sourceHttpStatus,
      sourceKind,
      structured,
      fetchedAt,
      contentHash,
      fit,
    });
    const result = await saveOrUpdateJob(candidate, raw.slice(0, 80_000));
    return Response.json(result, { status: result.deduplicated ? 200 : 201 });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 422 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      status?: StoredJob["status"];
      tailoredPath?: string;
      tailoredAt?: string;
      tailoredChanges?: string;
      screenedOut?: string | null;
      fields?: Partial<Record<EditableJobField, string>>;
      experienceLevel?: string;
      rescore?: boolean;
      rescoreAll?: boolean;
      offset?: number;
      limit?: number;
    };

    // Résumé changed: recompute fit for every stored row. Identity, evidence,
    // status, and tailoring are left alone — only score/skills/gaps/family move.
    // One page per request (the Worker CPU limit rules out all rows at once).
    // Loop with nextOffset until it is null: `python -m jobagent_scraper.api rescore-all`.
    if (body.rescoreAll) {
      const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
      const limit = Math.min(50, Math.max(1, Math.floor(Number(body.limit) || 25)));
      const { total, rows } = await listJobsForRescore(offset, limit);
      const updates = rows.map((row) => {
        const fit = evaluateResumeFit(row.title, row.rawDescription);
        return {
          id: row.id,
          score: seniorityAdjustedScore(fit.score, row.experienceLevel),
          skills: fit.matches.length ? fit.matches : ["No direct résumé evidence detected"],
          gaps: fit.gaps.length ? fit.gaps : ["Review role-specific requirements"],
          roleFamily: fit.roleFamily ?? row.roleFamily,
        };
      });
      await rescoreJobsBatch(updates);
      const next = offset + rows.length;
      return Response.json({ ok: true, total, rescored: updates.length, nextOffset: rows.length && next < total ? next : null });
    }

    if (!body.id) return Response.json({ error: "A job ID is required." }, { status: 400 });

    if (body.rescore) {
      if (!(await rescoreOne(body.id))) return Response.json({ error: "Job not found." }, { status: 404 });
      return Response.json({ ok: true });
    }

    if (body.fields) {
      return await editJobFields(body.id, body.fields);
    }

    if (body.experienceLevel !== undefined) {
      if (!["entry", "mid", "senior", "unknown"].includes(body.experienceLevel)) {
        return Response.json({ error: "Experience level must be entry, mid, senior, or unknown." }, { status: 400 });
      }
      await updateJobExperience(body.id, body.experienceLevel as NonNullable<StoredJob["experienceLevel"]>);
      return Response.json({ ok: true });
    }

    if (body.screenedOut !== undefined) {
      const reason = typeof body.screenedOut === "string" ? body.screenedOut.trim().slice(0, 500) : "";
      await updateJobScreening(body.id, reason || null);
      return Response.json({ ok: true });
    }

    if (body.tailoredPath && body.tailoredAt) {
      if (body.status && !ALLOWED_STATUSES.has(body.status)) {
        return Response.json({ error: "Invalid job status update." }, { status: 400 });
      }
      await updateJobTailoring(body.id, body.tailoredPath, body.tailoredAt, body.status, body.tailoredChanges?.slice(0, 1000));
      return Response.json({ ok: true });
    }

    if (!body.status || !ALLOWED_STATUSES.has(body.status)) {
      return Response.json({ error: "Invalid job status update." }, { status: 400 });
    }
    await updateJobStatus(body.id, body.status);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { id?: string };
    if (!body.id) return Response.json({ error: "A job ID is required." }, { status: 400 });
    await deleteJob(body.id);
    await deleteDocumentsForJob(body.id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

/** Recompute one job's fit from its stored title + description. Returns false if absent. */
async function rescoreOne(id: string): Promise<boolean> {
  const stored = await getJob(id);
  if (!stored) return false;
  const fit = evaluateResumeFit(stored.title, stored.rawDescription ?? "");
  await rescoreJob(
    id,
    seniorityAdjustedScore(fit.score, stored.experienceLevel),
    fit.matches.length ? fit.matches : ["No direct résumé evidence detected"],
    fit.gaps.length ? fit.gaps : ["Review role-specific requirements"],
    fit.roleFamily ?? stored.roleFamily ?? "",
  );
  return true;
}

const EDITABLE_FIELDS: EditableJobField[] = ["title", "company", "location", "workMode"];

async function editJobFields(id: string, fields: Partial<Record<EditableJobField, string>>) {
  const edits: Partial<Record<EditableJobField, string>> = {};
  for (const field of EDITABLE_FIELDS) {
    const value = fields[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.trim()) {
      return Response.json({ error: `The ${field} field cannot be empty.` }, { status: 400 });
    }
    edits[field] = value.trim();
  }
  if (!Object.keys(edits).length) return Response.json({ error: "No editable fields were provided." }, { status: 400 });
  if (edits.workMode && !(WORK_MODES as readonly string[]).includes(edits.workMode)) {
    return Response.json({ error: "Work mode must be Remote, Hybrid, Onsite, or Unknown." }, { status: 400 });
  }

  const stored = await getJob(id);
  if (!stored) return Response.json({ error: "Job not found." }, { status: 404 });
  const { rawDescription, ...job } = stored;

  let updated = applyUserEdits(job, edits, new Date().toISOString());
  if (edits.title && rawDescription) {
    // The title feeds the matching engine, so a corrected title re-scores the job.
    const fit = evaluateResumeFit(updated.title, rawDescription);
    updated = {
      ...updated,
      score: fit.score,
      skills: fit.matches.length ? fit.matches : ["No direct résumé evidence detected"],
      gaps: fit.gaps.length ? fit.gaps : ["Review role-specific requirements"],
      roleFamily: fit.roleFamily ?? updated.roleFamily,
    };
  }
  await updateJobIdentity(updated);
  return Response.json({ ok: true, job: updated });
}

async function fetchJobPage(initialUrl: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    let currentUrl = initialUrl;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "JobAgent/0.2 personal job importer" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("The website returned an invalid redirect.");
        const redirected = safePublicUrl(new URL(location, currentUrl).toString());
        if (!redirected) throw new Error("The website redirected to a non-public address.");
        currentUrl = redirected;
        continue;
      }
      if (!response.ok) throw new Error(`The website returned ${response.status}. Paste the description instead.`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        throw new Error("This URL is not an HTML job page. Paste the description instead.");
      }
      const html = (await response.text()).slice(0, 1_000_000);
      const structured = findJobPostingJsonLd(html);
      const text = htmlToText(html);
      if (text.length < 120) throw new Error("The page did not expose enough job text. Paste the description instead.");
      return { text, structured, canonicalUrl: currentUrl.toString(), httpStatus: response.status };
    }
    throw new Error("The website redirected too many times.");
  } finally {
    clearTimeout(timeout);
  }
}

function message(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "The website took too long to respond. Paste the description instead.";
    return error.message;
  }
  return "Could not import this job.";
}
