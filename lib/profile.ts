// The job seeker's targets and constraints, written by /onboard into
// data/profile.json. Facts about the person live in data/resume.json; this file
// holds what they are looking for: role families, seniority, places and work
// authorization. Scoring, eligibility and the dashboard all read it from here.

import profileJson from "../data/profile.json" with { type: "json" };

export type Seniority = "entry" | "mid" | "senior";

/**
 * Work authorization in the country being searched (US by default):
 * citizen and permanent_resident need nothing from the employer; opt is F-1
 * OPT or STEM OPT (no sponsorship now, but citizenship-only and OPT-excluded
 * postings are out); needs_sponsorship means the employer must sponsor a visa
 * now (H-1B or similar), so "no sponsorship" postings are out too.
 */
export type WorkAuthStatus = "citizen" | "permanent_resident" | "opt" | "needs_sponsorship" | "unset";

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
  seniority: Seniority;
  roleFamilies: RoleFamily[];
  /** Regex of field language the resume grounds broadly, counted as a covered requirement line. */
  coveragePattern: string;
  places: Place[];
  remoteOk: boolean;
  workAuthorization: { status: WorkAuthStatus; holdsClearance: boolean };
};

type RawProfile = Partial<Omit<Profile, "workAuthorization">> & { workAuthorization?: Partial<Profile["workAuthorization"]> };

export function normalizeProfile(raw: RawProfile): Profile {
  const seniority = raw.seniority === "mid" || raw.seniority === "senior" ? raw.seniority : "entry";
  const status = raw.workAuthorization?.status;
  const name = (raw.displayName ?? "").trim();
  return {
    displayName: name,
    initials: (raw.initials ?? "").trim() || name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase() || "?",
    device: raw.device ?? "",
    seniority,
    roleFamilies: (raw.roleFamilies ?? []).filter((family) => family && typeof family.name === "string" && typeof family.titlePattern === "string" && family.titlePattern),
    coveragePattern: raw.coveragePattern ?? "",
    places: (raw.places ?? []).filter((place) => place && Array.isArray(place.match) && place.match.length > 0),
    remoteOk: raw.remoteOk ?? true,
    workAuthorization: {
      status: status === "citizen" || status === "permanent_resident" || status === "opt" || status === "needs_sponsorship" ? status : "unset",
      holdsClearance: raw.workAuthorization?.holdsClearance === true,
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
