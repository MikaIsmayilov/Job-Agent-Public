// The dashboard's default inbox: jobs that pass the same hard rules prep-queue
// applies before tailoring, so the first screen is only jobs worth a click.
// Places, remote, seniority and work authorization come from data/profile.json.

import { freshnessBand } from "./freshness.ts";
import { sponsorshipRisk } from "./eligibility.ts";
import { PROFILE, placeMatches, type Profile } from "./profile.ts";

export type WorthApplyingJob = {
  status: string;
  location?: string;
  workMode?: string;
  datePosted?: string;
  sponsorship: string;
  sponsorshipNote?: string;
  experienceLevel?: string;
  screenedOut?: string;
  evidence?: Array<{ field: string; direct: boolean }>;
  /** Fit gaps from lib/matching.ts; a "Blocker:" entry means the full posting rules the candidate out. */
  gaps?: string[];
};

/** In one of the profile's places, or remote when remote is acceptable. No places means anywhere. */
export function isTargetLocation(location: string | undefined, workMode: string | undefined, profile: Profile = PROFILE): boolean {
  if (profile.places.length === 0) return true;
  const remote = workMode === "Remote" || (location ?? "").toLowerCase().includes("remote");
  return profile.places.some((place) => placeMatches(location, place)) || (profile.remoteOk && remote);
}

// A "Remote" work mode only counts when the source stated it (structured
// jobLocationType, ATS field) or the location says remote, not when it was
// guessed from the description text.
function remoteObserved(job: WorthApplyingJob): boolean {
  if ((job.location ?? "").toLowerCase().includes("remote")) return true;
  if (job.workMode !== "Remote") return false;
  return job.evidence?.find((item) => item.field === "workMode")?.direct ?? true;
}

// Experience levels worth a click at each target seniority ("unknown" always is).
const LEVELS: Record<Profile["seniority"], string[]> = { entry: ["entry"], mid: ["entry", "mid"], senior: ["mid", "senior"] };

export function worthApplying(job: WorthApplyingJob, nowMs: number, profile: Profile = PROFILE): boolean {
  const inPlace = profile.places.length === 0 || profile.places.some((place) => placeMatches(job.location, place)) || (profile.remoteOk && remoteObserved(job));
  return (
    (job.status === "new" || job.status === "shortlisted") &&
    !job.screenedOut &&
    inPlace &&
    (job.experienceLevel === undefined || job.experienceLevel === "unknown" || LEVELS[profile.seniority].includes(job.experienceLevel)) &&
    freshnessBand(job.datePosted, nowMs) !== "stale" &&
    sponsorshipRisk(job.sponsorship, job.sponsorshipNote, undefined, profile.workAuthorization)?.level !== "blocker" &&
    // The stored note is one sentence; scoring reads the whole posting and
    // records blockers the note missed.
    !(job.gaps ?? []).some((gap) => gap.startsWith("Blocker:"))
  );
}

/** One-line description of the "Worth applying" rules for tooltips. */
export function worthApplyingSummary(profile: Profile = PROFILE): string {
  const places = profile.places.map((place) => place.label).join(", ");
  const where = places ? `${places}${profile.remoteOk ? " or remote" : ""}` : "Any location";
  return `${where}, not stale, ${profile.seniority}-level fit, no work-authorization blocker, not screened out`;
}
