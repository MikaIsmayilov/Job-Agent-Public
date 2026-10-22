// Post-application mail tracking rules, ported from
// scraper/jobagent_scraper/mailtracker.py so the cloud cron and the local
// launchd check decide identically. Both test suites run the shared cases in
// tests/fixtures/mail-cases.json; change the two files together.
//
// Conservative by design: only applied -> interview, applied -> rejected and
// interview -> rejected; a reply that matches several applications, or names
// a different role, becomes a review instead of a status change.

import type { MailReview } from "./agent-runs.ts";

export type MailMessage = { sender?: string; subject?: string; body?: string };
export type TrackedJob = { id: string; company: string; title: string; status: string };
export type MailKind = "rejected" | "interview" | "confirmation";
export type MailUpdate = { job: TrackedJob; status: "interview" | "rejected" };
export type MailEvaluation = { updates: Map<string, MailUpdate>; notes: string[]; reviews: Omit<MailReview, "createdAt">[] };

const REJECTION_PATTERNS = new RegExp(
  "unfortunately|not (?:to |be )?mov(?:e|ing) forward|unable to move forward|other (?:qualified )?candidates|not selected" +
    "|will not be progressing|decided to (?:pursue|proceed with) other|position has been filled" +
    "|no longer under consideration|pursue other applicants|regret to inform" +
    "|position (?:has been|was|is) (?:closed|cancell?ed|filled)|did not select you" +
    "|not (?:be )?taking your application further|did not see a fit|unable to consider you" +
    "|(?:won['’]?t|will not) be moving (?:on )?to the next (?:stage|step|round)",
  "i",
);
// Only phrases that imply a concrete invitation; bare "next steps" is confirmation boilerplate.
const INTERVIEW_PATTERNS = new RegExp(
  "schedule (?:a|your|an) (?:call|interview|conversation|chat|phone screen)" +
    "|invite you to (?:an? )?interview|interview invitation|phone screen" +
    "|next step is to (?:complete|schedule)|advance(?:d)? to the next (?:step|round)" +
    "|moving you (?:forward )?to the next (?:step|round)" +
    "|(?:your|any) availability|book a time|hiring manager would like" +
    "|invited to (?:participate in )?(?:our |an? |the )?(?:screening|assessment|interview)",
  "i",
);
const CONFIRMATION_PATTERNS = /application (?:was |has been )?received|thank you for applying|we (?:have )?received your application|your application to|successfully submitted/i;
const APPLICATION_CONTEXT = /your application|applying|application for|thank(?:s| you) for your interest|position|role|candidate|screening process/i;
const ROLE_MENTION = /(?:for|to|in) the\s+(.{3,80}?)\s+(?:role|position|opportunity)\b/gi;
// "joining us as a Financial Analyst I." Case-sensitive so
// "as a valued candidate" or "as a result" never reads as a title.
const AS_ROLE = /\b[Aa]s an?\s+([A-Z][A-Za-z0-9&/\- ]{2,79}?)(?:\s+(?:role|position))?\s*[.,;!]/g;
const LEGAL_SUFFIXES = new Set(["the", "inc", "llc", "corp", "corporation", "company", "co", "ltd", "llp", "plc"]);
// Dropped as an extra alias when enough name remains: "NorthStar Group" mails say "NorthStar"; "Hum Group" keeps its full name.
const GROUP_SUFFIXES = new Set(["group", "holdings"]);

function flatten(subject: string, body: string, sep: string): string {
  // Plain-text bodies hard-wrap mid-phrase ("not move\r\nforward").
  return `${subject}${sep}${body}`.replaceAll("&nbsp;", " ").replace(/\s+/g, " ");
}

export function classify(subject: string, body: string): MailKind | null {
  const text = flatten(subject, body, "\n");
  if (!APPLICATION_CONTEXT.test(text)) return null;
  if (REJECTION_PATTERNS.test(text)) return "rejected";
  if (INTERVIEW_PATTERNS.test(text)) return "interview";
  if (CONFIRMATION_PATTERNS.test(text)) return "confirmation";
  return null;
}

/** Lowercase words separated by single spaces, padded so " x " is a word-boundary test. */
function norm(text: string): string {
  const cleaned = text.toLowerCase().replaceAll("&", " and ").replaceAll("'", "").replaceAll("’", "");
  return ` ${(cleaned.match(/[a-z0-9]+/g) ?? []).join(" ")} `;
}

/** Normalized names a company goes by: "John Calloway / Maplelife" -> ["john calloway", "maplelife"]. */
export function companyNames(company: string): string[] {
  const names: string[] = [];
  for (const alias of company.split(/[/(),|]/)) {
    const words = norm(alias).split(" ").filter((w) => w && !LEGAL_SUFFIXES.has(w));
    if (words.length && words.join("").length >= 3) names.push(words.join(" "));
    if (words.length > 1 && GROUP_SUFFIXES.has(words[words.length - 1]) && words.slice(0, -1).join("").length >= 4) {
      names.push(words.slice(0, -1).join(" "));
    }
  }
  return names;
}

/** Normalized ways an email may name a title: "Customer Success Analyst/Associate" also as "customer success analyst" and "customer success associate". */
export function titleVariants(title: string): string[] {
  const full = norm(title);
  if (!full.trim()) return [];
  const derived: string[] = [];
  const parts = title.split("/").filter((p) => p.trim());
  if (parts.length > 1) {
    const base = norm(parts[0]).trim().split(" ");
    derived.push(norm(parts[0]));
    for (const part of parts.slice(1)) {
      const words = norm(part).trim().split(" ").filter(Boolean);
      derived.push(words.length === 1 ? norm([...base.slice(0, -1), ...words].join(" ")) : norm(part));
    }
  }
  // A derived variant needs two words: "Associate" alone would match anything.
  return [...new Set([full, ...derived.filter((v) => v.trim().split(" ").length >= 2)])];
}

/**
 * Tracked jobs this message is about. The full company name must appear as
 * whole words (or squashed into the sender address); header matches beat
 * body-only mentions, and the role title picks among one company's jobs.
 */
export function matchJobs(jobs: TrackedJob[], sender: string, subject: string, body: string): TrackedJob[] {
  const head = norm(`${sender} ${subject}`);
  const text = norm(`${subject} ${body.slice(0, 4000)}`);
  const senderCompact = sender.toLowerCase().replace(/[^a-z0-9]/g, "");

  const header: TrackedJob[] = [];
  const bodyOnly: TrackedJob[] = [];
  for (const job of jobs) {
    const names = companyNames(job.company ?? "");
    if (names.some((n) => head.includes(` ${n} `) || senderCompact.includes(n.replaceAll(" ", "")))) header.push(job);
    else if (names.some((n) => text.includes(` ${n} `))) bodyOnly.push(job);
  }
  const candidates = header.length ? header : bodyOnly;
  if (candidates.length <= 1) return candidates;

  let titled = candidates.filter((j) => titleVariants(j.title ?? "").some((v) => text.includes(v)));
  // "Data Scientist" is inside "Data Scientist, Pricing Models"; the longer title is the one the email names.
  titled = titled.filter((j) => !titled.some((o) => o !== j && norm(o.title).includes(norm(j.title)) && norm(o.title) !== norm(j.title)));
  return titled.length ? titled : candidates;
}

/** The role an email names when it is clearly not this job's title, else null. */
export function namesOtherRole(job: TrackedJob, subject: string, body: string): string | null {
  const text = flatten(subject, body, " ");
  const titles = titleVariants(job.title ?? "");
  if (!titles.length || titles.some((t) => norm(text).includes(t))) return null;
  const mentioned = [...text.matchAll(ROLE_MENTION), ...text.matchAll(AS_ROLE)].map((m) => m[1]);
  if (!mentioned.length || mentioned.some((m) => titles.some((t) => t.includes(norm(m)) || norm(m).includes(t)))) return null;
  return mentioned[0];
}

/** Stable id for one reply (same as the Python tracker), so a resolved review stays resolved. */
export async function reviewId(kind: string, sender: string, subject: string): Promise<string> {
  const data = new TextEncoder().encode(`${kind}|${sender.trim().toLowerCase()}|${subject.trim().toLowerCase()}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
}

export async function evaluateMessages(messages: MailMessage[], tracked: TrackedJob[]): Promise<MailEvaluation> {
  const updates = new Map<string, MailUpdate>();
  const notes: string[] = [];
  const reviews: MailEvaluation["reviews"] = [];
  for (const msg of messages) {
    const sender = msg.sender ?? "";
    const subject = msg.subject ?? "";
    const body = msg.body ?? "";
    const kind = classify(subject, body);
    if (!kind) continue;
    const matches = matchJobs(tracked, sender, subject, body);
    if (!matches.length) continue;
    if (matches.length > 1 && kind !== "confirmation") {
      notes.push(`AMBIGUOUS ${kind}: '${subject.slice(0, 60)}' matches ${matches.length} jobs, review manually`);
      reviews.push({ id: await reviewId(kind, sender, subject), kind, reason: "ambiguous", subject: subject.slice(0, 200), sender: sender.slice(0, 200), candidateIds: matches.map((j) => j.id) });
      continue;
    }
    const job = matches[0];
    const otherRole = kind !== "confirmation" ? namesOtherRole(job, subject, body) : null;
    if (otherRole && kind !== "confirmation") {
      notes.push(`ROLE MISMATCH ${kind}: ${job.company} email names '${otherRole.slice(0, 50)}', tracked '${job.title.slice(0, 50)}', review manually`);
      reviews.push({ id: await reviewId(kind, sender, subject), kind, reason: "role_mismatch", subject: subject.slice(0, 200), sender: sender.slice(0, 200), candidateIds: [job.id] });
      continue;
    }
    if (kind === "confirmation") notes.push(`confirmation received: ${job.company}, ${job.title.slice(0, 50)}`);
    else if (kind === "interview" && job.status === "applied") updates.set(job.id, { job, status: "interview" });
    else if (kind === "rejected" && (job.status === "applied" || job.status === "interview")) updates.set(job.id, { job, status: "rejected" });
  }
  return { updates, notes, reviews };
}
