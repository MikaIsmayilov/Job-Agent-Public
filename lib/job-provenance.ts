export type JobStatus = "new" | "shortlisted" | "ready" | "applied";
export type VerificationStatus = "verified" | "unverified" | "expired";
export type SourceKind = "official_ats" | "aggregator" | "webpage" | "pasted_text";
export type EvidenceOrigin = "json_ld" | "ats_api" | "page_text" | "user_text" | "user_edit" | "system";
export type JobType = "fulltime" | "parttime" | "contract" | "internship";
export type ExperienceLevel = "entry" | "mid" | "senior" | "unknown";
export type SponsorshipStance = "offered" | "not_offered" | "likely" | "unknown";
export type EvidenceConfidence = "high" | "medium" | "low";

export type FieldEvidence = {
  field: "title" | "company" | "location" | "workMode" | "salary" | "summary" | "datePosted" | "validThrough" | "sponsorship";
  value: string;
  origin: EvidenceOrigin;
  confidence: EvidenceConfidence;
  direct: boolean;
  evidence: string;
};

export type JobRecord = {
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
  sourceKind: SourceKind;
  fetchedAt: string;
  verifiedAt?: string;
  datePosted?: string;
  validThrough?: string;
  contentHash: string;
  evidence: FieldEvidence[];
  jobType?: JobType;
  experienceLevel?: ExperienceLevel;
  roleFamily: string;
  sourceSite?: string;
  tailoredPath?: string;
  tailoredAt?: string;
  tailoredChanges?: string;
  sponsorship: SponsorshipStance;
  sponsorshipNote?: string;
  tags: string[];
  redFlags: string[];
  /** Set from the row's created_at on read; when the job was FIRST ingested (dedup refreshes never change it). */
  firstSeenAt?: string;
  /** Prep-queue full-JD screening verdict (quoted reason). Set once, survives refreshes; screened jobs never re-enter the queue pool. */
  screenedOut?: string;
  /** When the status last changed via an explicit status update (NOT dedup refreshes) — powers stale-application follow-ups. */
  statusChangedAt?: string;
  /** Set once, the first time the job reaches applied; never moves. Anchors time-to-response analytics. */
  appliedAt?: string;
};

type ResumeFit = { score: number; matches: string[]; gaps: string[]; roleFamily?: string };

export type EditableJobField = "title" | "company" | "location" | "workMode";

export const WORK_MODES = ["Remote", "Hybrid", "Onsite", "Unknown"] as const;

/** Same caps buildJobRecord applies when a record is first created. */
export const EDITABLE_FIELD_LIMITS: Record<EditableJobField, number> = {
  title: 180,
  company: 140,
  location: 180,
  workMode: 20,
};

const EDITABLE_FIELDS = Object.keys(EDITABLE_FIELD_LIMITS) as EditableJobField[];

/**
 * Manual corrections from the dashboard. Each edited field gets a direct
 * `user_edit` evidence entry — an explicit human statement outranking whatever
 * the importer inferred, and the marker preserveUserEdits looks for later.
 */
export function applyUserEdits(job: JobRecord, edits: Partial<Record<EditableJobField, string>>, editedAt: string): JobRecord {
  const next = { ...job, evidence: [...job.evidence] };
  for (const field of EDITABLE_FIELDS) {
    const value = edits[field]?.trim();
    if (!value) continue;
    const clipped = value.slice(0, EDITABLE_FIELD_LIMITS[field]);
    next[field] = clipped;
    replaceEvidence(next.evidence, {
      field,
      value: clipped,
      origin: "user_edit",
      direct: true,
      confidence: "high",
      evidence: `Corrected manually in the dashboard on ${editedAt.slice(0, 10)}`,
    });
  }
  return next;
}

export function userEditedFields(job: JobRecord): EditableJobField[] {
  return EDITABLE_FIELDS.filter((field) => job.evidence.some((item) => item.field === field && item.origin === "user_edit"));
}

/**
 * Dedup refreshes rebuild the record from freshly scraped text, which would
 * silently undo manual corrections — carry the edited values and their
 * evidence over from the stored row instead.
 */
export function preserveUserEdits(incoming: JobRecord, existing: JobRecord): JobRecord {
  const fields = userEditedFields(existing);
  if (!fields.length) return incoming;
  const next = { ...incoming, evidence: [...incoming.evidence] };
  for (const field of fields) {
    next[field] = existing[field];
    const kept = existing.evidence.find((item) => item.field === field && item.origin === "user_edit");
    if (kept) replaceEvidence(next.evidence, kept);
  }
  return next;
}

function replaceEvidence(evidence: FieldEvidence[], entry: FieldEvidence) {
  const index = evidence.findIndex((item) => item.field === entry.field);
  if (index >= 0) evidence[index] = entry;
  else evidence.push(entry);
}

type BuildJobInput = {
  raw: string;
  source: string;
  sourceUrl?: string;
  canonicalUrl?: string;
  sourceHttpStatus?: number;
  sourceKind: SourceKind;
  structured?: Record<string, unknown> | null;
  structuredOrigin?: EvidenceOrigin;
  fetchedAt: string;
  contentHash: string;
  fit: ResumeFit;
  jobType?: JobType;
  experienceLevel?: ExperienceLevel;
  sourceSite?: string;
  sponsorshipHint?: SponsorshipStance;
  sponsorshipNote?: string;
  tags?: string[];
};

// One shared qualifier set — every "…sponsorship" pattern must accept the same
// modifiers. Divergence here once let "will not provide immigration
// sponsorship" slip past detection and read "is not able to provide visa
// sponsorship" as an offer,
// so the modifiers are now written once and substituted into every pattern.
const SPONSOR_VERB = "(?:provide |offer |support |grant |extend )?";
const SPONSOR_KIND = "(?:visa |work |working |immigration |employment |h-?1b )?";
const sponsorPattern = (body: string): RegExp =>
  new RegExp(body.replace(/VERB/g, SPONSOR_VERB).replace(/KIND/g, SPONSOR_KIND));

const NEGATIVE_SPONSORSHIP: RegExp[] = [
  sponsorPattern("unable to VERBKINDsponsor"),
  sponsorPattern("cannot VERBKINDsponsor"),
  sponsorPattern("(?:will|can|is|are|do(?:es)?) ?not (?:be )?(?:able|willing|in a position) to VERBKINDsponsor"),
  sponsorPattern("(?:will|can) ?not (?:be able to )?VERBKINDsponsor"),
  sponsorPattern("not (?:currently )?(?:able|available|eligible|willing) (?:to|for) VERBKINDsponsor"),
  sponsorPattern("do(?:es)? not (?:currently |now )?(?:provide|offer|support) KINDsponsor"),
  sponsorPattern("KINDsponsorship (?:is )?not (?:currently )?(?:available|offered|provided)"),
  sponsorPattern("no KINDsponsorship"),
  sponsorPattern("without (?:the need for |need of )?(?:visa |employer )?sponsorship"),
  sponsorPattern("not offer KINDsponsorship"),
  /u\.?s\.? citizens? (?:or (?:lawful )?permanent residents? )?only/,
  /citizenship (?:is )?required/,
  /must be an? (?:u\.?s\.?|united states) citizen/,
];

const POSITIVE_SPONSORSHIP: RegExp[] = [
  /sponsorship (?:is )?(?:available|offered|provided|possible)/,
  /(?:will|can|do|does) (?:provide |offer )?sponsor/,
  /provides? (?:visa|h-?1b|immigration) sponsorship/,
  /h-?1b (?:visa )?sponsorship/,
  /open to (?:visa )?sponsorship/,
  /we sponsor/,
];

const RED_FLAG_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "Commission-only pay", pattern: /commission[- ]only|100% commission|straight commission|uncapped commission structure with no base/ },
  { label: "Unpaid role", pattern: /unpaid (?:position|role|internship)|no compensation|volunteer basis/ },
  { label: "MLM-style language", pattern: /multi[- ]level marketing|\bmlm\b|network marketing|be your own boss|unlimited earning potential/ },
  { label: "Pay-to-work request", pattern: /training fee|starter kit|pay for (?:your own )?(?:equipment|training|background check)|upfront (?:fee|investment)/ },
  { label: "Get-rich promises", pattern: /earn up to \$\d[\d,]*.{0,24}(?:week|day)\b|make money fast|guaranteed income/ },
  { label: "Door-to-door canvassing", pattern: /door[- ]to[- ]door|\bcanvassing\b/ },
];

/** Deterministic legitimacy screen: phrases that correlate with junk postings. */
export function detectRedFlags(text: string): string[] {
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  return RED_FLAG_RULES.filter((rule) => rule.pattern.test(lower)).map((rule) => rule.label);
}

/**
 * Negative patterns win: for a visa candidate a false "sponsors" is worse than
 * a false "does not". Returns the stance plus the sentence that proves it.
 */
export function detectSponsorship(text: string): { stance: SponsorshipStance; snippet?: string } {
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  for (const pattern of NEGATIVE_SPONSORSHIP) {
    const match = lower.match(pattern);
    if (match) return { stance: "not_offered", snippet: match[0] };
  }
  for (const pattern of POSITIVE_SPONSORSHIP) {
    const match = lower.match(pattern);
    if (match) return { stance: "offered", snippet: match[0] };
  }
  return { stance: "unknown" };
}

export function buildJobRecord(input: BuildJobInput): JobRecord {
  const { raw, structured, sourceKind, fetchedAt } = input;
  const structuredOrigin: EvidenceOrigin = input.structuredOrigin ?? "json_ld";
  const origin: EvidenceOrigin = sourceKind === "pasted_text" ? "user_text" : "page_text";
  const evidence: FieldEvidence[] = [];
  const clean = raw.replace(/\s+/g, " ").trim();

  const structuredTitle = stringField(structured?.title);
  const inferredTitle = titleFromText(raw);
  const title = structuredTitle || inferredTitle || "Unknown title";
  evidence.push(fieldEvidence("title", title, structuredTitle ? structuredOrigin : origin, Boolean(structuredTitle), structuredTitle ? "$.title" : inferredTitle || "No supporting text found"));

  const structuredCompany = organizationName(structured?.hiringOrganization);
  const inferredCompany = companyFromText(raw);
  const company = structuredCompany || inferredCompany || "Unknown company";
  evidence.push(fieldEvidence("company", company, structuredCompany ? structuredOrigin : origin, Boolean(structuredCompany), structuredCompany ? "$.hiringOrganization.name" : inferredCompany || "No supporting text found"));

  const structuredLocation = locationName(structured?.jobLocation);
  const inferredLocation = findLocation(raw);
  const remoteFromStructured = stringOrArray(structured?.jobLocationType).some((item) => item.toUpperCase().includes("TELECOMMUTE"));
  const location = structuredLocation || inferredLocation || (remoteFromStructured ? "Remote" : "Unknown location");
  evidence.push(fieldEvidence("location", location, structuredLocation || remoteFromStructured ? structuredOrigin : origin, Boolean(structuredLocation || remoteFromStructured), structuredLocation ? "$.jobLocation.address" : remoteFromStructured ? "$.jobLocationType" : inferredLocation || "No supporting text found"));

  const lower = clean.toLowerCase();
  const inferredWorkMode = /\bremote\b|work from home|distributed/.test(lower)
    ? "Remote"
    : /\bhybrid\b/.test(lower)
      ? "Hybrid"
      : /\bon-?site\b|\bin[- ]office\b|office-based/.test(lower)
        ? "Onsite"
        : "Unknown";
  // Workday bodies carry their own authoritative "Remote Type" field; the
  // structured jobLocationType TELECOMMUTE flag is set generically even for
  // onsite roles (onsite jobs were being tagged Remote).
  const remoteTypeMatch = clean.match(/remote type\s*[:\-]?\s*(on-?site|hybrid|remote)/i);
  const workModeFromRemoteType = remoteTypeMatch
    ? remoteTypeMatch[1].toLowerCase().replace("-", "").startsWith("on")
      ? "Onsite"
      : remoteTypeMatch[1].toLowerCase() === "hybrid"
        ? "Hybrid"
        : "Remote"
    : null;
  const workMode = workModeFromRemoteType ?? (remoteFromStructured ? "Remote" : inferredWorkMode);
  evidence.push(fieldEvidence(
    "workMode",
    workMode,
    workModeFromRemoteType ? origin : remoteFromStructured ? structuredOrigin : origin,
    Boolean(workModeFromRemoteType) || remoteFromStructured,
    workModeFromRemoteType ? remoteTypeMatch![0] : remoteFromStructured ? "$.jobLocationType" : inferredWorkMode === "Unknown" ? "No supporting text found" : snippetFor(raw, inferredWorkMode),
  ));

  const structuredSalary = salaryFromStructured(structured?.baseSalary);
  const inferredSalary = salaryFromText(clean);
  const salary = structuredSalary || inferredSalary || "Not listed";
  evidence.push(fieldEvidence("salary", salary, structuredSalary ? structuredOrigin : origin, Boolean(structuredSalary), structuredSalary ? "$.baseSalary" : inferredSalary ? snippetFor(raw, inferredSalary) : "No supporting text found"));

  const structuredDescription = descriptionField(structured?.description);
  const inferredSummary = firstUsefulSentence(clean);
  const summary = stripTags(structuredDescription || inferredSummary || "No reliable summary was found. Open the source and review the complete description.").slice(0, 360);
  evidence.push(fieldEvidence("summary", summary, structuredDescription ? structuredOrigin : origin, Boolean(structuredDescription), structuredDescription ? "$.description" : inferredSummary || "No supporting text found"));

  const datePosted = isoDate(stringField(structured?.datePosted));
  if (datePosted) evidence.push(fieldEvidence("datePosted", datePosted, structuredOrigin, true, "$.datePosted"));
  const validThrough = isoDate(stringField(structured?.validThrough));
  if (validThrough) evidence.push(fieldEvidence("validThrough", validThrough, structuredOrigin, true, "$.validThrough"));

  const detected = detectSponsorship(clean);
  let sponsorship: SponsorshipStance = detected.stance;
  let sponsorshipNote: string | undefined;
  if (detected.stance !== "unknown" && detected.snippet) {
    sponsorshipNote = `Stated in posting: "…${snippetFor(clean, detected.snippet).trim()}…"`;
    evidence.push(fieldEvidence("sponsorship", detected.stance, origin, true, snippetFor(clean, detected.snippet)));
  } else if (input.sponsorshipHint && input.sponsorshipHint !== "unknown") {
    sponsorship = input.sponsorshipHint;
    sponsorshipNote = input.sponsorshipNote;
    evidence.push(fieldEvidence("sponsorship", input.sponsorshipHint, "system", false, input.sponsorshipNote ?? "Company-level history, not stated in this posting"));
  }

  const expired = Boolean(validThrough && new Date(validThrough).getTime() < new Date(fetchedAt).getTime());
  const hasStructuredIdentity = Boolean(structuredTitle && structuredCompany);
  const verificationStatus: VerificationStatus = expired
    ? "expired"
    : hasStructuredIdentity && sourceKind === "official_ats"
      ? "verified"
      : "unverified";

  return {
    id: crypto.randomUUID(),
    title: title.slice(0, 180),
    company: company.slice(0, 140),
    location: location.slice(0, 180),
    workMode,
    salary: salary.slice(0, 100),
    postedAt: datePosted || "Date not provided",
    source: input.source,
    sourceUrl: input.sourceUrl,
    canonicalUrl: input.canonicalUrl || input.sourceUrl,
    sourceHttpStatus: input.sourceHttpStatus,
    score: input.fit.score,
    status: "new",
    skills: input.fit.matches.length ? input.fit.matches : ["No direct résumé evidence detected"],
    gaps: input.fit.gaps.length ? input.fit.gaps : ["Review role-specific requirements"],
    summary,
    recordType: "imported",
    verificationStatus,
    sourceKind,
    fetchedAt,
    verifiedAt: verificationStatus === "verified" ? fetchedAt : undefined,
    datePosted,
    validThrough,
    contentHash: input.contentHash,
    evidence,
    jobType: input.jobType ?? inferJobType(`${title} ${lower}`.toLowerCase()),
    experienceLevel: input.experienceLevel,
    roleFamily: input.fit.roleFamily ?? "",
    sourceSite: input.sourceSite,
    sponsorship,
    sponsorshipNote,
    tags: input.tags ?? [],
    redFlags: detectRedFlags(clean),
  };
}

function inferJobType(text: string): JobType | undefined {
  // "… Intern jobs" is LinkedIn's related-searches footer, not this posting:
  // a full-time analyst role came in as an internship because the page dump
  // ended with "Product Management Intern jobs".
  if (/\bintern(ship)?s?\b(?! jobs\b)|\bco-?ops?\b(?! jobs\b)/.test(text)) return "internship";
  if (/\bcontract(or)?\b|fixed[- ]term|\btemporary\b|\btemp\b/.test(text)) return "contract";
  if (/part[- ]?time/.test(text)) return "parttime";
  if (/full[- ]?time/.test(text)) return "fulltime";
  return undefined;
}

export function sourceMetadata(hostname: string): { source: string; sourceKind: SourceKind } {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (host === "greenhouse.io" || host.endsWith(".greenhouse.io") || host === "greenhouse.com" || host.endsWith(".greenhouse.com")) return { source: "Greenhouse", sourceKind: "official_ats" };
  if (host === "lever.co" || host.endsWith(".lever.co")) return { source: "Lever", sourceKind: "official_ats" };
  if (host === "ashbyhq.com" || host.endsWith(".ashbyhq.com")) return { source: "Ashby", sourceKind: "official_ats" };
  if (host === "workdayjobs.com" || host.endsWith(".workdayjobs.com") || host === "myworkdayjobs.com" || host.endsWith(".myworkdayjobs.com")) return { source: "Workday", sourceKind: "official_ats" };
  if (["linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com"].some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return { source: host, sourceKind: "aggregator" };
  }
  return { source: host, sourceKind: "webpage" };
}

export function safePublicUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.port && !['80', '443'].includes(url.port)) return null;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1" || hostname.endsWith(".local") ||
      /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || /^fc/i.test(hostname) || /^fd/i.test(hostname) || /^fe[89ab]/i.test(hostname)
    ) return null;
    return url;
  } catch {
    return null;
  }
}

export function findJobPostingJsonLd(html: string): Record<string, unknown> | null {
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const parsed: unknown = JSON.parse(decodeEntities(match[1]));
      const candidates: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (candidate && typeof candidate === "object" && "@graph" in candidate) {
          const graph = (candidate as { "@graph"?: unknown })["@graph"];
          if (Array.isArray(graph)) candidates.push(...graph);
        }
        if (candidate && typeof candidate === "object") {
          const types = stringOrArray((candidate as { "@type"?: unknown })["@type"]);
          if (types.includes("JobPosting")) return candidate as Record<string, unknown>;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function fieldEvidence(field: FieldEvidence["field"], value: string, origin: EvidenceOrigin, direct: boolean, evidence: string): FieldEvidence {
  return { field, value, origin, direct, confidence: direct ? "high" : evidence === "No supporting text found" ? "low" : "medium", evidence: stripTags(evidence).replace(/\s+/g, " ").slice(0, 220) };
}

function titleFromText(text: string) {
  return text.split(/\n+/).map((line) => line.trim()).find((line) => line.length > 3 && line.length < 100);
}

function companyFromText(text: string) {
  return text.match(/(?:company|about us|organization)\s*[:–-]\s*([^\n|]{2,80})/i)?.[1]?.trim();
}

function findLocation(text: string) {
  return text.match(/(?:location|based in)\s*[:–-]\s*([^\n|•]{2,80})/i)?.[1]?.trim();
}

function salaryFromText(text: string) {
  return text.match(/(?:€|£|\$|₺)\s?\d[\d,.]*(?:\s?[kK])?(?:\s*[–-]\s*(?:€|£|\$|₺)?\s?\d[\d,.]*(?:\s?[kK])?)?/)?.[0]?.replace(/[.,]+$/, "");
}

function salaryFromStructured(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  const currency = stringField(data.currency);
  const amount = data.value;
  if (typeof amount === "string" || typeof amount === "number") return [currency, amount].filter(Boolean).join(" ");
  if (!amount || typeof amount !== "object") return undefined;
  const details = amount as Record<string, unknown>;
  const min = numberOrString(details.minValue);
  const max = numberOrString(details.maxValue);
  const exact = numberOrString(details.value);
  const range = min && max ? `${min}–${max}` : exact || min || max;
  return range ? [currency, range, stringField(details.unitText)].filter(Boolean).join(" ") : undefined;
}

function firstUsefulSentence(text: string) {
  return text.split(/(?<=[.!?])\s+/).find((sentence) => sentence.length >= 70 && sentence.length <= 360);
}

function organizationName(value: unknown) {
  return value && typeof value === "object" ? stringField((value as Record<string, unknown>).name) : "";
}

function locationName(value: unknown): string | undefined {
  const item = Array.isArray(value) ? value[0] : value;
  if (!item || typeof item !== "object") return undefined;
  const address = (item as Record<string, unknown>).address;
  if (!address || typeof address !== "object") return undefined;
  const data = address as Record<string, unknown>;
  return [data.addressLocality, data.addressRegion, countryName(data.addressCountry)].map(stringField).filter(Boolean).join(", ") || undefined;
}

function countryName(value: unknown): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>).name : value;
}

function descriptionField(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrString(value: unknown) {
  return typeof value === "number" || typeof value === "string" ? String(value) : "";
}

function stringOrArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : typeof value === "string" ? [value] : [];
}

function isoDate(value: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function snippetFor(text: string, needle: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  const index = clean.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return clean.slice(0, 180);
  return clean.slice(Math.max(0, index - 70), Math.min(clean.length, index + needle.length + 90));
}

function stripTags(value: string) {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}
