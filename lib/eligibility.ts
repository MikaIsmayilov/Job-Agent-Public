// Work-authorization risk for a posting, given the candidate's status in
// data/profile.json (workAuthorization). Advisory only: it never deletes a job,
// it makes the user decide with the posting's words in front of them. A
// "blocker" also caps the fit score and hides the job from "Worth applying".

import { PROFILE, type Country, type WorkAuthStatus } from "./profile.ts";

export type SponsorshipRisk = { level: "blocker" | "warning"; message: string } | null;
/** country defaults to US so older callers and fixtures keep the US rules. */
export type WorkAuth = { status: WorkAuthStatus; holdsClearance: boolean; country?: Country };

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

// Canada. Citizenship alone (some federal, defence and clearance roles).
const CA_CITIZENSHIP_ONLY = /\bcanadian citizens? (?:only|required)|must be an? canadian citizen(?! or)|canadian citizenship (?:is )?required/i;
// Citizen-or-PR as a hard requirement: rules out every temporary permit.
const CA_PR_OR_CITIZEN = /(?:must be|open (?:only )?to|restricted to|limited to|only)\s+(?:an?\s+)?canadian citizens? or (?:an?\s+)?permanent residents?|canadian citizens? (?:or|and) permanent residents? (?:only|are eligible)|(?:must|required to) (?:hold|have) (?:canadian )?(?:citizenship|permanent residen(?:ce|cy))/i;
// Federal public service boilerplate: a ranking preference, not a bar.
const CA_PREFERENCE = /preference (?:will be |is )?given to canadian citizens/i;
// "Must be legally entitled to work in Canada": fine with any permit held now,
// usually means no LMIA for someone who has none.
const CA_AUTHORIZED = /(?:entitled|eligible|authori[sz]ed|able) to work in canada/i;

export function sponsorshipRisk(sponsorship: string, note?: string, description?: string, auth: WorkAuth = PROFILE.workAuthorization): SponsorshipRisk {
  const text = `${note ?? ""}\n${description ?? ""}`;
  const { status } = auth;
  if (status === "unset") return null;

  if (CLEARANCE.test(text) && !auth.holdsClearance) {
    return { level: "blocker", message: "Posting requires an active security clearance, and your profile says you do not hold one." };
  }
  if (auth.country === "CA") return canadaRisk(sponsorship, text, status);

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

function canadaRisk(sponsorship: string, text: string, status: WorkAuthStatus): SponsorshipRisk {
  if (status !== "citizen" && CA_CITIZENSHIP_ONLY.test(text)) {
    return { level: "blocker", message: "Posting requires Canadian citizenship." };
  }
  if (status === "citizen" || status === "permanent_resident") return null;

  // Temporary status from here on: an open work permit, or needing an employer-backed permit.
  if (CA_PR_OR_CITIZEN.test(text) || OPT_EXCLUDED.test(text)) {
    return { level: "blocker", message: "Posting is open only to Canadian citizens or permanent residents." };
  }
  if (CA_PREFERENCE.test(text)) {
    return { level: "warning", message: "Posting gives preference to Canadian citizens and permanent residents. Temporary residents can apply but rank lower." };
  }
  if (status === "open_work_permit") {
    return sponsorship === "not_offered"
      ? { level: "warning", message: "Posting says no sponsorship. Your open work permit needs none now, but the employer will not support an LMIA or permit renewal later; check your permit's expiry." }
      : null;
  }

  // needs_sponsorship
  if (sponsorship === "not_offered") {
    return { level: "blocker", message: "Posting does not offer sponsorship (LMIA or work permit support), and your profile says you need it." };
  }
  if (CA_AUTHORIZED.test(text) && sponsorship !== "offered") {
    return { level: "warning", message: "Posting asks for current eligibility to work in Canada and does not mention LMIA or permit support. Confirm before applying." };
  }
  return null;
}
