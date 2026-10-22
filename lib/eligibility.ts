// Work-authorization risk for a posting, given the candidate's status in
// data/profile.json (workAuthorization). Advisory only: it never deletes a job,
// it makes the user decide with the posting's words in front of them. A
// "blocker" also caps the fit score and hides the job from "Worth applying".

import { PROFILE, type WorkAuthStatus } from "./profile.ts";

export type SponsorshipRisk = { level: "blocker" | "warning"; message: string } | null;
export type WorkAuth = { status: WorkAuthStatus; holdsClearance: boolean };

// An active or existing clearance. Only someone who holds one qualifies.
// "Employee Polygraph Protection" is the federal rights poster, not a requirement.
const CLEARANCE = /\b(?:ts\/sci|top secret|secret) clearance|\bactive (?:security )?clearance|security clearance (?:is )?required|\bpolygraph\b(?! protection)/i;
// Citizenship, or clearance eligibility (which also requires citizenship).
const CITIZENSHIP_ONLY = /\bu\.?\s?s\.? citizens? (?:only|required)|must be a u\.?\s?s\.? citizen|(?:requires?|obtain|maintain|eligib\w* for) (?:an? )?(?:active )?(?:security|secret|top secret) clearance|citizenship is required/i;
// Postings that name OPT/F-1 only to exclude it ("not able to sponsor visas,
// including CPT/OPT"; "will not sponsor ... F-1 student"; "CPT and OPT are
// considered restricted forms of work authorization").
const OPT_EXCLUDED = /\b(?:not|unable)\b[^.]{0,100}\b(?:c?pt\/opt|opt|f-?1)\b|\bopt (?:are|is) considered restricted|permanent,? unrestricted\b.{0,25}?work authori/i;
const OPT_FRIENDLY = /\b(?:stem )?opt\b|e-?verify|f-?1 students?/i;

export function sponsorshipRisk(sponsorship: string, note?: string, description?: string, auth: WorkAuth = PROFILE.workAuthorization): SponsorshipRisk {
  const text = `${note ?? ""}\n${description ?? ""}`;
  const { status } = auth;
  if (status === "unset") return null;

  if (CLEARANCE.test(text) && !auth.holdsClearance) {
    return { level: "blocker", message: "Posting requires an active security clearance, and your profile says you do not hold one." };
  }
  if (status !== "citizen" && CITIZENSHIP_ONLY.test(text)) {
    return { level: "blocker", message: "Posting requires U.S. citizenship or clearance eligibility." };
  }
  if (status === "citizen" || status === "permanent_resident") return null;

  if (status === "opt") {
    if (OPT_EXCLUDED.test(text)) {
      return { level: "blocker", message: "Posting explicitly excludes OPT/F-1 or requires permanent work authorization." };
    }
    if (sponsorship !== "not_offered") return null;
    return OPT_FRIENDLY.test(text)
      ? { level: "warning", message: "Posting says no visa sponsorship but mentions OPT or E-Verify. OPT may still qualify; confirm before applying." }
      : { level: "warning", message: "Posting says no visa sponsorship and does not mention OPT or E-Verify. Confirm the employer accepts OPT (and E-Verify for STEM OPT) before applying." };
  }

  // needs_sponsorship: any "no sponsorship" or "permanent authorization" language rules it out.
  if (sponsorship === "not_offered" || OPT_EXCLUDED.test(text)) {
    return { level: "blocker", message: "Posting does not offer visa sponsorship, and your profile says you need it." };
  }
  return null;
}
