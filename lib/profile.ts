// The job seeker's targets and constraints, written by /onboard into
// data/profile.json. Facts about the person live in data/resume.json; this file
// holds what they are looking for: role families, seniority, places and work
// authorization. Scoring, eligibility and the dashboard all read it from here.

import profileJson from "../data/profile.json" with { type: "json" };

export type Seniority = "entry" | "mid" | "senior";

/** The country being searched; it picks which work-authorization statuses and eligibility rules apply. */
export type Country = "US" | "CA";

/**
 * Work authorization in the country being searched. citizen and
 * permanent_resident (US green card, Canadian PR) need nothing from the
 * employer. opt (US only) is F-1 OPT or STEM OPT: no sponsorship now, but
 * citizenship-only and OPT-excluded postings are out. open_work_permit (Canada
 * only) is an open work permit such as a PGWP or spousal permit: no employer
 * support now, but citizen-or-PR-only postings are out. needs_sponsorship means
 * the employer must sponsor now (H-1B in the US, an LMIA-backed or
 * employer-specific permit in Canada), so "no sponsorship" postings are out too.
 */
export type WorkAuthStatus = "citizen" | "permanent_resident" | "opt" | "open_work_permit" | "needs_sponsorship" | "unset";

const STATUSES: Record<Country, WorkAuthStatus[]> = {
  US: ["citizen", "permanent_resident", "opt", "needs_sponsorship"],
  CA: ["citizen", "permanent_resident", "open_work_permit", "needs_sponsorship"],
};

export type RoleFamily = {
  /** Stored on each job and shown in filters, e.g. "Data analytics". */
  name: string;
  /** Short sidebar label, e.g. "Data Analyst". */
  label?: string;
  /** Case-insensitive regex tested against the job title. */
  titlePattern: string;
  /** Optional regex: a generic title ("Analyst") also joins this family when the description matches. */
  descriptionPattern?: string;
  /** Skill labels from resume.json; the strong boost applies when every one of them matched. */
  boostSkills?: string[];
  strongBoost?: number;
  baseBoost?: number;
  /** A gap to flag whenever a posting lands in this family (a known stretch). */
  impliedGap?: string;
  /** One-line summary, plus a representative job title and description, for the profile panel. */
  blurb?: string;
  probeTitle?: string;
  probe?: string;
  /** Sidebar dot color: purple, green, blue or amber. */
  color?: string;
};

export type Place = { label: string; match: string[] };

export type Profile = {
  displayName: string;
  initials: string;
  device: "macos" | "windows" | "linux" | "";
  country: Country;
  seniority: Seniority;
  roleFamilies: RoleFamily[];
  /** Regex of field language the resume grounds broadly, counted as a covered requirement line. */
  coveragePattern: string;
  places: Place[];
  remoteOk: boolean;
  /** country mirrors the profile's country so eligibility checks need only this object. */
  workAuthorization: { status: WorkAuthStatus; holdsClearance: boolean; country: Country };
};

type RawProfile = Partial<Omit<Profile, "workAuthorization" | "country">> & { country?: string; workAuthorization?: Partial<Profile["workAuthorization"]> };

export function normalizeProfile(raw: RawProfile): Profile {
  const seniority = raw.seniority === "mid" || raw.seniority === "senior" ? raw.seniority : "entry";
  const country: Country = String(raw.country ?? "").toUpperCase() === "CA" ? "CA" : "US";
  const status = raw.workAuthorization?.status;
  const name = (raw.displayName ?? "").trim();
  return {
    displayName: name,
    initials: (raw.initials ?? "").trim() || name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase() || "?",
    device: raw.device ?? "",
    country,
    seniority,
    roleFamilies: (raw.roleFamilies ?? []).filter((family) => family && typeof family.name === "string" && typeof family.titlePattern === "string" && family.titlePattern),
    coveragePattern: raw.coveragePattern ?? "",
    places: (raw.places ?? []).filter((place) => place && Array.isArray(place.match) && place.match.length > 0),
    remoteOk: raw.remoteOk ?? true,
    workAuthorization: {
      // A status from the other country (opt in Canada, open_work_permit in the US) is unset, not guessed.
      status: status && STATUSES[country].includes(status) ? status : "unset",
      holdsClearance: raw.workAuthorization?.holdsClearance === true,
      country,
    },
  };
}

export const PROFILE: Profile = normalizeProfile(profileJson as RawProfile);

/** True until /onboard has filled in the profile. */
export function needsOnboarding(profile: Profile = PROFILE): boolean {
  return !profile.displayName || profile.roleFamilies.length === 0;
}

export function placeMatches(location: string | undefined, place: Place): boolean {
  const loc = (location ?? "").toLowerCase();
  return place.match.some((needle) => loc.includes(needle.toLowerCase()));
}
