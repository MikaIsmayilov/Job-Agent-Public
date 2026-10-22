// Application-pipeline analytics: what happened to the applications actually
// sent. Counts, response rate, time-to-response, and splits by role family and
// score band — the evidence for where morning effort converts.
//
// Interviews alone are too rare to learn from early on, so "advanced" also
// counts jobs with an assessment or interview
// action, and the outcome splits only use applications old enough to have
// heard back, so last week's sends don't read as silence.

export type PipelineJobLike = {
  id?: string;
  status: string;
  score: number;
  roleFamily?: string;
  company: string;
  appliedAt?: string;
  statusChangedAt?: string;
  datePosted?: string;
  sponsorship?: string;
  sourceKind?: string;
};

export type Breakdown = Array<{ key: string; total: number; advanced: number; rejected: number }>;

/** Applications younger than this are excluded from the outcome breakdowns. */
export const MATURE_DAYS = 14;

export type PipelineStats = {
  total: number;
  awaiting: number;
  interviews: number;
  rejected: number;
  /** Percent of applications with any response (interview or rejection), 0-100. */
  responseRate: number;
  /** Mean days from appliedAt to the responding status change; null until measurable. */
  avgDaysToResponse: number | null;
  byFamily: Array<{ family: string; total: number; interviews: number; rejected: number }>;
  byScoreBand: Array<{ band: string; total: number; interviews: number; rejected: number }>;
  /** Applications with an interview status or an assessment/interview action. */
  advanced: number;
  /** Applications at least MATURE_DAYS old; the population for the splits below. */
  mature: number;
  byPostingAge: Breakdown;
  bySponsorship: Breakdown;
  bySource: Breakdown;
};

function postingAgeAtApply(job: PipelineJobLike): string {
  const posted = job.datePosted ? Date.parse(job.datePosted) : NaN;
  const applied = job.appliedAt ? Date.parse(job.appliedAt) : NaN;
  if (Number.isNaN(posted) || Number.isNaN(applied)) return "undated";
  const days = (applied - posted) / 86_400_000;
  if (days <= 7) return "0-7d";
  if (days <= 30) return "8-30d";
  return "30d+";
}

function breakdown(jobs: PipelineJobLike[], key: (job: PipelineJobLike) => string, isAdvanced: (job: PipelineJobLike) => boolean): Breakdown {
  const map = new Map<string, { total: number; advanced: number; rejected: number }>();
  for (const job of jobs) {
    const entry = map.get(key(job)) ?? { total: 0, advanced: 0, rejected: 0 };
    entry.total += 1;
    if (isAdvanced(job)) entry.advanced += 1;
    else if (job.status === "rejected") entry.rejected += 1;
    map.set(key(job), entry);
  }
  return [...map.entries()].map(([k, entry]) => ({ key: k, ...entry })).sort((a, b) => b.total - a.total);
}

const APPLICATION_STATUSES = new Set(["applied", "interview", "rejected"]);

function scoreBand(score: number): string {
  if (score >= 80) return "80+";
  if (score >= 65) return "65-79";
  if (score >= 50) return "50-64";
  return "<50";
}

export function analyzePipeline(
  jobs: PipelineJobLike[],
  options: { advancedIds?: Set<string>; nowMs?: number } = {},
): PipelineStats {
  const apps = jobs.filter((job) => APPLICATION_STATUSES.has(job.status));
  const interviews = apps.filter((job) => job.status === "interview");
  const rejected = apps.filter((job) => job.status === "rejected");
  const responded = interviews.length + rejected.length;

  const responseDays: number[] = [];
  for (const job of [...interviews, ...rejected]) {
    if (!job.appliedAt || !job.statusChangedAt) continue;
    const days = (new Date(job.statusChangedAt).getTime() - new Date(job.appliedAt).getTime()) / 86_400_000;
    if (days >= 0) responseDays.push(days);
  }

  const familyMap = new Map<string, { total: number; interviews: number; rejected: number }>();
  const bandMap = new Map<string, { total: number; interviews: number; rejected: number }>();
  for (const job of apps) {
    for (const [map, key] of [
      [familyMap, job.roleFamily || "Other"],
      [bandMap, scoreBand(job.score)],
    ] as const) {
      const entry = map.get(key) ?? { total: 0, interviews: 0, rejected: 0 };
      entry.total += 1;
      if (job.status === "interview") entry.interviews += 1;
      if (job.status === "rejected") entry.rejected += 1;
      map.set(key, entry);
    }
  }

  const isAdvanced = (job: PipelineJobLike) => job.status === "interview" || Boolean(job.id && options.advancedIds?.has(job.id));
  const nowMs = options.nowMs ?? Date.now();
  const mature = apps.filter((job) => job.appliedAt && nowMs - Date.parse(job.appliedAt) >= MATURE_DAYS * 86_400_000);

  const bandOrder = ["80+", "65-79", "50-64", "<50"];
  return {
    total: apps.length,
    awaiting: apps.length - responded,
    interviews: interviews.length,
    rejected: rejected.length,
    responseRate: apps.length ? Math.round((responded / apps.length) * 100) : 0,
    avgDaysToResponse: responseDays.length
      ? Math.round((responseDays.reduce((a, b) => a + b, 0) / responseDays.length) * 10) / 10
      : null,
    byFamily: [...familyMap.entries()]
      .map(([family, entry]) => ({ family, ...entry }))
      .sort((a, b) => b.total - a.total),
    byScoreBand: bandOrder
      .filter((band) => bandMap.has(band))
      .map((band) => ({ band, ...bandMap.get(band)! })),
    advanced: apps.filter(isAdvanced).length,
    mature: mature.length,
    byPostingAge: breakdown(mature, postingAgeAtApply, isAdvanced),
    bySponsorship: breakdown(mature, (job) => job.sponsorship || "unknown", isAdvanced),
    bySource: breakdown(mature, (job) => job.sourceKind || "unknown", isAdvanced),
  };
}

/**
 * Sort comparator by when the application was sent (appliedAt, set once when
 * a job first reaches "applied"). Jobs never applied to sort last either way.
 */
export function byAppliedAt<T extends { appliedAt?: string }>(direction: "newest" | "oldest") {
  const time = (job: T) => (job.appliedAt ? Date.parse(job.appliedAt) : NaN);
  return (a: T, b: T) => {
    const [ta, tb] = [time(a), time(b)];
    if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) ? (Number.isNaN(tb) ? 0 : 1) : -1;
    return direction === "newest" ? tb - ta : ta - tb;
  };
}

/** Days the employer has been silent: only for "applied" (no reply yet) with a known send time. */
export function daysWaiting(job: { status: string; appliedAt?: string }, nowMs: number): number | null {
  if (job.status !== "applied" || !job.appliedAt) return null;
  const sent = Date.parse(job.appliedAt);
  return Number.isNaN(sent) ? null : Math.max(0, Math.floor((nowMs - sent) / 86_400_000));
}

export const FOLLOW_UP_DAYS = 10;

/** A nudge is due after FOLLOW_UP_DAYS of silence, unless an action is already planned for the job. */
export function followUpDue(job: { id: string; status: string; appliedAt?: string }, nowMs: number, jobIdsWithPendingAction: Set<string>): boolean {
  const days = daysWaiting(job, nowMs);
  return days !== null && days >= FOLLOW_UP_DAYS && !jobIdsWithPendingAction.has(job.id);
}
