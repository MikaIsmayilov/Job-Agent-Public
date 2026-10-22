import { buildJobRecord, safePublicUrl, sha256 } from "./job-provenance.ts";
import type { ExperienceLevel, JobRecord, JobType, SourceKind, SponsorshipStance } from "./job-provenance.ts";
import { evaluateResumeFit, seniorityAdjustedScore } from "./matching.ts";

export const MAX_BATCH_SIZE = 200;
export const MIN_DESCRIPTION_LENGTH = 120;

export type IngestSourceSite =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workday"
  | "workable"
  | "recruitee"
  | "phenom"
  | "icims"
  | "successfactors"
  | "eightfold"
  | "company_site"
  | "amazon"
  | "linkedin"
  | "indeed"
  | "glassdoor"
  | "google"
  | "zip_recruiter"
  | "themuse"
  | "remotive"
  | "workingnomads";

export const SITE_TO_KIND: Record<IngestSourceSite, { source: string; sourceKind: SourceKind }> = {
  greenhouse: { source: "Greenhouse", sourceKind: "official_ats" },
  lever: { source: "Lever", sourceKind: "official_ats" },
  ashby: { source: "Ashby", sourceKind: "official_ats" },
  smartrecruiters: { source: "SmartRecruiters", sourceKind: "official_ats" },
  workday: { source: "Workday", sourceKind: "official_ats" },
  workable: { source: "Workable", sourceKind: "official_ats" },
  recruitee: { source: "Recruitee", sourceKind: "official_ats" },
  phenom: { source: "Company careers site (Phenom)", sourceKind: "official_ats" },
  icims: { source: "Company careers site (iCIMS)", sourceKind: "official_ats" },
  successfactors: { source: "Company careers site (SuccessFactors)", sourceKind: "official_ats" },
  eightfold: { source: "Company careers site (Eightfold)", sourceKind: "official_ats" },
  company_site: { source: "Company careers site", sourceKind: "official_ats" },
  amazon: { source: "Amazon Jobs", sourceKind: "official_ats" },
  linkedin: { source: "LinkedIn", sourceKind: "aggregator" },
  indeed: { source: "Indeed", sourceKind: "aggregator" },
  glassdoor: { source: "Glassdoor", sourceKind: "aggregator" },
  google: { source: "Google Jobs", sourceKind: "aggregator" },
  zip_recruiter: { source: "ZipRecruiter", sourceKind: "aggregator" },
  themuse: { source: "The Muse", sourceKind: "aggregator" },
  remotive: { source: "Remotive", sourceKind: "aggregator" },
  workingnomads: { source: "Working Nomads", sourceKind: "aggregator" },
};

const JOB_TYPES = new Set<string>(["fulltime", "parttime", "contract", "internship"]);
const EXPERIENCE_LEVELS = new Set<string>(["entry", "mid", "senior", "unknown"]);

export type IngestJob = {
  title: string;
  company: string;
  location?: string;
  description: string;
  url: string;
  date_posted?: string;
  valid_through?: string;
  salary?: string;
  work_mode?: string;
  job_type?: JobType;
  experience_level?: ExperienceLevel;
  structured?: Record<string, unknown>;
  sponsorship_hint?: SponsorshipStance;
  sponsorship_note?: string;
  company_tags?: string[];
};

export type IngestPayload = {
  source_site: IngestSourceSite;
  scraped_at?: string;
  jobs: IngestJob[];
};

export type PayloadIssue = { index: number | null; reason: string };

export function validateIngestPayload(body: unknown): { payload?: IngestPayload; issues: PayloadIssue[] } {
  const issues: PayloadIssue[] = [];
  if (!body || typeof body !== "object") return { issues: [{ index: null, reason: "Body must be a JSON object." }] };
  const data = body as Record<string, unknown>;
  const site = typeof data.source_site === "string" ? data.source_site : "";
  if (!(site in SITE_TO_KIND)) {
    return { issues: [{ index: null, reason: `Unknown source_site "${site}".` }] };
  }
  if (!Array.isArray(data.jobs) || data.jobs.length === 0) {
    return { issues: [{ index: null, reason: "jobs must be a non-empty array." }] };
  }
  if (data.jobs.length > MAX_BATCH_SIZE) {
    return { issues: [{ index: null, reason: `Batch exceeds ${MAX_BATCH_SIZE} jobs.` }] };
  }

  const jobs: IngestJob[] = [];
  data.jobs.forEach((item, index) => {
    const issue = validateJob(item);
    if (issue) issues.push({ index, reason: issue });
    else jobs.push(normalizeJob(item as Record<string, unknown>));
  });

  return {
    payload: {
      source_site: site as IngestSourceSite,
      scraped_at: typeof data.scraped_at === "string" ? data.scraped_at : undefined,
      jobs,
    },
    issues,
  };
}

function validateJob(item: unknown): string | null {
  if (!item || typeof item !== "object") return "Job must be an object.";
  const job = item as Record<string, unknown>;
  if (typeof job.title !== "string" || !job.title.trim()) return "Missing title.";
  if (typeof job.company !== "string" || !job.company.trim()) return "Missing company.";
  if (typeof job.description !== "string" || job.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    return `Description shorter than ${MIN_DESCRIPTION_LENGTH} characters.`;
  }
  if (typeof job.url !== "string" || !safePublicUrl(job.url)) return "Missing or unsafe URL.";
  return null;
}

function normalizeJob(job: Record<string, unknown>): IngestJob {
  const jobType = typeof job.job_type === "string" && JOB_TYPES.has(job.job_type) ? (job.job_type as JobType) : undefined;
  const experience = typeof job.experience_level === "string" && EXPERIENCE_LEVELS.has(job.experience_level)
    ? (job.experience_level as ExperienceLevel)
    : undefined;
  return {
    title: (job.title as string).trim().slice(0, 180),
    company: (job.company as string).trim().slice(0, 140),
    location: typeof job.location === "string" ? job.location.trim() : undefined,
    description: (job.description as string).trim(),
    url: job.url as string,
    date_posted: typeof job.date_posted === "string" ? job.date_posted : undefined,
    valid_through: typeof job.valid_through === "string" ? job.valid_through : undefined,
    salary: typeof job.salary === "string" ? job.salary : undefined,
    work_mode: typeof job.work_mode === "string" ? job.work_mode : undefined,
    job_type: jobType,
    experience_level: experience,
    structured: job.structured && typeof job.structured === "object" ? (job.structured as Record<string, unknown>) : undefined,
    sponsorship_hint:
      typeof job.sponsorship_hint === "string" && ["offered", "not_offered", "likely", "unknown"].includes(job.sponsorship_hint)
        ? (job.sponsorship_hint as SponsorshipStance)
        : undefined,
    sponsorship_note: typeof job.sponsorship_note === "string" ? job.sponsorship_note.slice(0, 300) : undefined,
    company_tags: Array.isArray(job.company_tags)
      ? job.company_tags.filter((tag): tag is string => typeof tag === "string").slice(0, 8)
      : undefined,
  };
}

/**
 * ATS payloads arrive pre-parsed, so rebuild the JSON-LD JobPosting shape that
 * buildJobRecord treats as structured (direct) evidence. Aggregator rows pass
 * structured: undefined and stay heuristic, which keeps them "unverified".
 */
export function synthesizeStructured(job: IngestJob): Record<string, unknown> {
  const [locality, region] = (job.location ?? "").split(",").map((part) => part.trim());
  return {
    "@type": "JobPosting",
    title: job.title,
    hiringOrganization: { name: job.company },
    ...(job.location
      ? { jobLocation: { address: { addressLocality: locality || job.location, addressRegion: region || "" } } }
      : {}),
    ...(job.work_mode?.toLowerCase() === "remote" ? { jobLocationType: "TELECOMMUTE" } : {}),
    ...(job.date_posted ? { datePosted: job.date_posted } : {}),
    ...(job.valid_through ? { validThrough: job.valid_through } : {}),
    ...(job.salary ? { baseSalary: job.salary } : {}),
    description: job.description,
  };
}

export async function buildIngestRecord(site: IngestSourceSite, job: IngestJob, fetchedAt: string): Promise<JobRecord> {
  const { source, sourceKind } = SITE_TO_KIND[site];
  const contentHash = await sha256(`${job.url}\n${job.description}`);
  const baseFit = evaluateResumeFit(job.title, job.description);
  const fit = { ...baseFit, score: seniorityAdjustedScore(baseFit.score, job.experience_level) };
  // Synthesize structured data for every site: title/company come straight from
  // the source API, and the "verified" badge is still gated on official_ats.
  const structured = job.structured ?? synthesizeStructured(job);
  return buildJobRecord({
    raw: job.description,
    source,
    sourceUrl: job.url,
    canonicalUrl: job.url,
    sourceKind,
    structured,
    structuredOrigin: "ats_api",
    fetchedAt,
    contentHash,
    fit,
    jobType: job.job_type,
    experienceLevel: job.experience_level,
    sourceSite: site,
    sponsorshipHint: job.sponsorship_hint,
    sponsorshipNote: job.sponsorship_note,
    tags: job.company_tags,
  });
}
