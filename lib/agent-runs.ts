// Background runs (the scheduled scrape and mail check) report here so the
// dashboard can show when each last ran and which recruiter replies the mail
// tracker could not match to a single application.

export type RunKind = "scrape" | "mail";
export type RunSummary = Record<string, number>;
export type RunRecord = { kind: RunKind; finishedAt: string; ok: boolean; summary: RunSummary };
export type ReviewKind = "rejected" | "interview";
export type ReviewReason = "ambiguous" | "role_mismatch";
export type MailReview = { id: string; kind: ReviewKind; reason: ReviewReason; subject: string; sender: string; candidateIds: string[]; createdAt: string };
export type RunReport = { kind: RunKind; ok: boolean; summary: RunSummary; reviews: Omit<MailReview, "createdAt">[] };

// The scrape runs daily and mail every 3 hours; allow for a sleeping laptop.
export const STALE_HOURS: Record<RunKind, number> = { scrape: 30, mail: 8 };

const KINDS = new Set<RunKind>(["scrape", "mail"]);
const REVIEW_KINDS = new Set<ReviewKind>(["rejected", "interview"]);
const REASONS = new Set<ReviewReason>(["ambiguous", "role_mismatch"]);

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function validateRunReport(body: unknown): RunReport {
  if (!body || typeof body !== "object") throw new Error("Provide a run report.");
  const raw = body as Record<string, unknown>;
  if (!KINDS.has(raw.kind as RunKind)) throw new Error("Run kind must be scrape or mail.");
  const summary: RunSummary = {};
  if (raw.summary && typeof raw.summary === "object") {
    for (const [key, value] of Object.entries(raw.summary as Record<string, unknown>).slice(0, 20)) {
      if (typeof value === "number" && Number.isFinite(value)) summary[key.slice(0, 40)] = value;
    }
  }
  const reviews = (Array.isArray(raw.reviews) ? raw.reviews : []).slice(0, 50).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, unknown>;
    const id = text(r.id, 100);
    const candidateIds = (Array.isArray(r.candidateIds) ? r.candidateIds : []).filter((c): c is string => typeof c === "string" && c.length > 0).slice(0, 10);
    if (!id || !REVIEW_KINDS.has(r.kind as ReviewKind) || !REASONS.has(r.reason as ReviewReason) || !candidateIds.length) return [];
    return [{ id, kind: r.kind as ReviewKind, reason: r.reason as ReviewReason, subject: text(r.subject, 200), sender: text(r.sender, 200), candidateIds }];
  });
  return { kind: raw.kind as RunKind, ok: raw.ok !== false, summary, reviews };
}

/** "3h ago" style age plus whether the run is overdue. Missing runs are stale. */
export function runAge(finishedAt: string | undefined, kind: RunKind, nowMs: number): { label: string; stale: boolean } {
  const at = finishedAt ? Date.parse(finishedAt) : NaN;
  if (Number.isNaN(at)) return { label: "never", stale: true };
  const minutes = Math.max(0, Math.round((nowMs - at) / 60_000));
  const label = minutes < 60 ? `${minutes}m ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`;
  return { label, stale: minutes > STALE_HOURS[kind] * 60 };
}
