// Shared dashboard types and display helpers.

import type { Breakdown } from "../../lib/pipeline.ts";

export type JobStatus = "new" | "shortlisted" | "ready" | "applied" | "interview" | "rejected";
export type VerificationStatus = "verified" | "unverified" | "expired";

export type FieldEvidence = {
  field: "title" | "company" | "location" | "workMode" | "salary" | "summary" | "datePosted" | "validThrough" | "sponsorship";
  value: string;
  origin: "json_ld" | "ats_api" | "page_text" | "user_text" | "user_edit" | "system";
  confidence: "high" | "medium" | "low";
  direct: boolean;
  evidence: string;
};

export type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: string;
  salary: string;
  postedAt: string;
  source: string;
  sourceUrl?: string;
  canonicalUrl?: string;
  sourceHttpStatus?: number;
  score: number;
  status: JobStatus;
  skills: string[];
  gaps: string[];
  summary: string;
  recordType: "imported";
  verificationStatus: VerificationStatus;
  sourceKind: "official_ats" | "aggregator" | "webpage" | "pasted_text";
  fetchedAt: string;
  firstSeenAt?: string;
  screenedOut?: string;
  statusChangedAt?: string;
  appliedAt?: string;
  verifiedAt?: string;
  datePosted?: string;
  validThrough?: string;
  contentHash: string;
  evidence: FieldEvidence[];
  jobType?: "fulltime" | "parttime" | "contract" | "internship";
  experienceLevel?: "entry" | "mid" | "senior" | "unknown";
  roleFamily: string;
  sourceSite?: string;
  tailoredPath?: string;
  tailoredAt?: string;
  tailoredChanges?: string;
  sponsorship: "offered" | "not_offered" | "likely" | "unknown";
  sponsorshipNote?: string;
  tags: string[];
  redFlags: string[];
};

export type PendingAction = { id: string; jobId: string; dueDate: string; title: string; kind: string };
export type Attachment = { id: string; filename: string; size: number };

export const sponsorshipLabel: Record<Job["sponsorship"], string> = {
  offered: "Sponsors visas",
  not_offered: "No sponsorship",
  likely: "Sponsor history",
  unknown: "Sponsorship unknown",
};

export const statusLabel: Record<JobStatus, string> = {
  new: "New match",
  shortlisted: "Shortlisted",
  ready: "Ready to apply",
  applied: "Applied",
  interview: "Interview",
  rejected: "Rejected",
};

/** Marking a job "not interested" reuses the screening field, so it never returns after a scrape. */
export const DISMISS_REASON = "Not interested (dismissed in dashboard)";

export function familyOf(job: Pick<Job, "roleFamily">) {
  return job.roleFamily || "Adjacent role";
}

export function scoreTone(score: number) {
  if (score >= 88) return "excellent";
  if (score >= 78) return "strong";
  return "fair";
}

export function verificationLabel(status: VerificationStatus) {
  if (status === "verified") return "Source verified";
  if (status === "expired") return "Expired";
  return "Needs review";
}

export function verificationDescription(job: Job) {
  if (job.verificationStatus === "expired") return "The source supplied a valid-through date that has passed.";
  if (job.verificationStatus === "verified") return `Structured job identity was found on ${job.source}. Rechecked ${formatDateTime(job.fetchedAt)}.`;
  if (job.sourceKind === "aggregator") return "Aggregator content is preserved, but employer-source confirmation is still required.";
  if (job.sourceKind === "pasted_text") return "Pasted text has no independently reachable source. Review every field against the original posting.";
  return "The page was reachable, but its identity fields were not supported by structured job data.";
}

export function formatDate(value?: string) {
  if (!value) return "Not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not provided" : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

export function relativeDate(value: string | undefined, nowMs: number) {
  if (!value || !nowMs) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.floor((nowMs - date.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

export function formatDateTime(value?: string) {
  if (!value) return "Not checked";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not checked" : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function fieldLabel(field: FieldEvidence["field"]) {
  return ({ title: "Title", company: "Company", location: "Location", workMode: "Work mode", salary: "Salary", summary: "Summary", datePosted: "Date posted", validThrough: "Valid through", sponsorship: "Visa sponsorship" } as const)[field];
}

export function formatBreakdown(rows: Breakdown): string {
  return rows.map((r) => `${r.key.replace("_", " ")} ${r.total}/${r.advanced}/${r.rejected}`).join(" · ");
}

export async function patchJob(body: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch("/api/jobs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return response.ok;
  } catch {
    return false;
  }
}
