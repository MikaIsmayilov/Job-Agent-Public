import resumeJson from "../data/resume.json" with { type: "json" };
import rarityJson from "../data/skill-rarity.json" with { type: "json" };
import { requirementItems, splitSections, type SectionKind } from "./jd-sections.ts";
import { sponsorshipRisk } from "./eligibility.ts";
import { PROFILE, type Profile, type RoleFamily } from "./profile.ts";

export type EvidenceRule = {
  label: string;
  aliases: string[];
  weight: number;
  evidence?: string[];
};

export type GapRule = {
  label: string;
  aliases: string[];
};

export type ResumeData = {
  skills?: Array<{ id?: string; label?: string; aliases?: string[]; weight?: number; evidence?: string[] }>;
  gapRules?: Array<{ label?: string; aliases?: string[] }>;
};

export function rulesFromResume(resume: ResumeData): { evidence: EvidenceRule[]; gaps: GapRule[] } {
  const evidence = (resume.skills ?? [])
    .filter(
      (skill): skill is { label: string; aliases: string[]; weight: number; evidence?: string[] } =>
        typeof skill.label === "string" &&
        Array.isArray(skill.aliases) &&
        skill.aliases.length > 0 &&
        skill.aliases.every((alias) => typeof alias === "string") &&
        typeof skill.weight === "number" &&
        skill.weight > 0,
    )
    .map((skill) => ({
      label: skill.label,
      aliases: skill.aliases.map((alias) => alias.toLowerCase()),
      weight: skill.weight,
      evidence: skill.evidence,
    }));
  const gaps = (resume.gapRules ?? [])
    .filter(
      (rule): rule is { label: string; aliases: string[] } =>
        typeof rule.label === "string" && Array.isArray(rule.aliases) && rule.aliases.every((alias) => typeof alias === "string"),
    )
    .map((rule) => ({ label: rule.label, aliases: rule.aliases.map((alias) => alias.toLowerCase()) }));

  return { evidence, gaps };
}

export type ScoringRules = {
  evidence: EvidenceRule[];
  gaps: GapRule[];
  families: RoleFamily[];
  coverage: RegExp | null;
  profile: Profile;
};

function safeRegex(pattern: string | undefined): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

/** Everything evaluateResumeFit needs: skills and gaps from resume.json, targets from profile.json. */
export function buildRules(resume: ResumeData, profile: Profile): ScoringRules {
  return { ...rulesFromResume(resume), families: profile.roleFamilies, coverage: safeRegex(profile.coveragePattern), profile };
}

const ACTIVE_RULES = buildRules(resumeJson as ResumeData, PROFILE);

export type ResumeFit = {
  score: number;
  matches: string[];
  gaps: string[];
  roleFamily: string;
  /** Share of the posting's hard requirement items the resume covers; null when it lists too few to judge. */
  coverage: number | null;
};

/** Substring matching on lowercased text; aliases are written to avoid false hits (see tests). */
export function aliasMatches(text: string, aliases: string[]): boolean {
  return aliases.some((alias) => text.includes(alias));
}

// How much a skill counts depends on where the posting mentions it.
const SECTION_FACTOR: Record<SectionKind, number> = { required: 1, duties: 0.85, unknown: 0.75, preferred: 0.6, boilerplate: 0.15 };

// Skills most postings mention ("stakeholder", "dashboard") carry less signal
// than rare, specific ones. Shares come from data/skill-rarity.json
// (scripts/skill-rarity.mjs); a skill without data counts in full.
const RARITY: Record<string, number> = (rarityJson as { share?: Record<string, number> }).share ?? {};
export function rarityFactor(label: string, shares: Record<string, number> = RARITY): number {
  const share = shares[label];
  return share === undefined ? 1 : Math.max(0.45, Math.min(1, 1.15 - share));
}

// Requirement lines that say nothing about tools or domain: degrees, soft
// skills, eligibility, office basics. They neither help nor hurt coverage.
// (Excel left this list on 2026-10-14 when it became a resume skill.)
const NEUTRAL_ITEM = /\b(?:degree|bachelor|master'?s|b\.?s\.?\/b\.?a|ba\/bs|bs\/ba|mba|gpa|graduat|communicat|interpersonal|team|collaborat|detail|organiz|self[- ]?(?:starter|motivated|directed)|proactive|curious|curiosity|problem[- ]solv|critical thinking|written|verbal|fast[- ]paced|independent|multi-?task|prioritiz|time management|deadline|work authori|authorized to work|eligible to work|legally|sponsorship|travel|lift|pounds|background check|drug|microsoft office|ms office|powerpoint|google (?:sheets|workspace)|attention|ownership|passion|enthusias|mindset|learn|adapt|integrity|english|analytical|analytic skills|quantitative|numerical|math|logical|judgment|initiative|professional|customer service|ethic|reliab|flexib|positive attitude|presentation skills|commitment|data analyst or similar|or similar role|similar role|related role|related field|equivalent experience)/i;
// Lines in a requirements list that are not requirements: preferences,
// logistics, pay, process notes, list lead-ins, and bare competency labels.
const NOT_A_REQUIREMENT = /prefer|a plus|is a plus|nice to have|bonus|desired|desirable|pay range|salary|\$\s?\d|interview|resume is required|hiring decision|reside|proximity|commut|cent(?:er|re) of excellence|not sure you meet|we encourage you|if you believe|divers|differences|inclusi|equal|compensation|this range|we are committed|we believe|we are dedicated|does not directly hire|we help candidates|our values|celebrate|overtime|on-?site|in[- ]office|schedule|shift|hybrid|remote|relocat|benefit|equal opportunit|accommodat|\bf-1\b|\bopt\b|visa|citizen|eligib|minimum qualifications are required|high school|diploma|polic(?:y|ies)/i;
export function evaluateResumeFit(title: string, description: string, rules: ScoringRules = ACTIVE_RULES): ResumeFit {
  const normalized = `${title} ${description}`.toLowerCase();
  const sections = splitSections(description);
  const sectionTexts = sections.map((section) => ({ kind: section.kind, text: section.lines.join("\n").toLowerCase() }));
  // A skill named in the title counts as required.
  const placeOf = (aliases: string[]): SectionKind | null => {
    if (aliasMatches(title.toLowerCase(), aliases)) return "required";
    let best: SectionKind | null = null;
    for (const { kind, text } of sectionTexts) {
      if (aliasMatches(text, aliases) && (best === null || SECTION_FACTOR[kind] > SECTION_FACTOR[best])) best = kind;
    }
    return best ?? (aliasMatches(normalized, aliases) ? "unknown" : null);
  };
  // With no recognizable sections at all there is nothing to discount by.
  const unstructured = sections.every((section) => section.kind === "unknown");
  const factorOf = (place: SectionKind) => (unstructured ? 0.9 : SECTION_FACTOR[place]);

  const matched = rules.evidence
    .map((rule) => ({ rule, place: placeOf(rule.aliases) }))
    .filter((item): item is { rule: EvidenceRule; place: SectionKind } => item.place !== null)
    .map(({ rule, place }) => ({ rule, points: rule.weight * factorOf(place) * rarityFactor(rule.label) }))
    .sort((a, b) => b.points - a.points);
  const evidencePoints = matched.reduce((total, item) => total + item.points, 0);

  // Requirement coverage: which hard requirement lines the resume can back.
  let covered = 0;
  const unmet: string[] = [];
  for (const item of requirementItems(sections)) {
    const lower = item.toLowerCase();
    if (item.endsWith(":") || item.split(/\s+/).length < 3 || NOT_A_REQUIREMENT.test(item)) continue;
    if (rules.evidence.some((rule) => aliasMatches(lower, rule.aliases)) || rules.coverage?.test(item)) covered += 1;
    // "3+ years of .NET" is judged on the .NET: the years bar itself is
    // already scored through the posting's experience level.
    else if (!NEUTRAL_ITEM.test(item)) unmet.push(item);
  }
  const judged = covered + unmet.length;
  const coverage = judged >= 2 ? covered / judged : null;

  const gapPenalty = rules.gaps.reduce((total, rule) => {
    const place = placeOf(rule.aliases);
    return place === null ? total : total + (place === "preferred" || place === "boilerplate" ? 1 : 3);
  }, 0);
  const detectedGaps = rules.gaps.filter((rule) => aliasMatches(normalized, rule.aliases)).map((rule) => rule.label);
  const family = detectFamily(title, normalized, rules.families);
  const roleFamily = family?.name ?? OTHER_FAMILY;
  const roleBoost = familyBoost(family, matched.map((item) => item.rule.label));

  if (family?.impliedGap && !detectedGaps.includes(family.impliedGap)) detectedGaps.push(family.impliedGap);
  // Work authorization (profile.json) can rule a posting out entirely.
  const risk = sponsorshipRisk("unknown", "", description, rules.profile.workAuthorization);
  const blocked = risk?.level === "blocker";

  // Diminishing returns: the 8th matched skill adds far less than the 2nd,
  // so strong postings spread out instead of piling up at the cap.
  const evidence = 46 * (1 - Math.exp(-evidencePoints / 20));
  const coverageTerm = coverage === null ? 4 : 22 * coverage - 6;
  const raw = 28 + evidence + coverageTerm + 0.8 * roleBoost - gapPenalty - (blocked ? 25 : 0);
  // A posting the candidate cannot qualify for always sinks, however well it matches.
  const score = Math.max(35, Math.min(blocked ? 40 : 95, Math.round(raw)));

  const shortUnmet = unmet.slice(0, 3).map((item) => `Requires: ${item.length > 90 ? `${item.slice(0, 87)}…` : item}`);
  return {
    score,
    matches: matched.slice(0, 6).map((item) => item.rule.label),
    gaps: [...(blocked && risk ? [`Blocker: ${risk.message}`] : []), ...detectedGaps, ...shortUnmet].slice(0, 5),
    roleFamily,
    coverage,
  };
}

/**
 * The score ranks fit at the profile's target seniority, so a posting a level
 * above (or, for senior candidates, below) is a worse fit even when its
 * keywords align. Shared by ingest-time scoring and the rescore action so both
 * produce the same number.
 */
const SENIORITY_ADJUSTMENT: Record<Profile["seniority"], Record<string, number>> = {
  entry: { entry: 2, mid: -12, senior: -20 },
  mid: { entry: -4, mid: 2, senior: -10 },
  senior: { entry: -12, mid: -2, senior: 2 },
};

export function seniorityAdjustedScore(score: number, experienceLevel?: string, target: Profile["seniority"] = PROFILE.seniority): number {
  const adjustment = SENIORITY_ADJUSTMENT[target][experienceLevel ?? ""] ?? 0;
  return Math.max(35, Math.min(95, score + adjustment));
}

/** Jobs that match none of the profile's role families. */
export const OTHER_FAMILY = "Adjacent role";

function detectFamily(title: string, normalized: string, families: RoleFamily[]): RoleFamily | null {
  const heading = title.toLowerCase();
  for (const family of families) {
    if (safeRegex(family.titlePattern)?.test(heading)) return family;
    const described = safeRegex(family.descriptionPattern);
    if (described && /\banalyst\b|analytics|\bassociate\b|specialist/.test(heading) && described.test(normalized)) return family;
  }
  return null;
}

/** First matching family in profile order (put specific families before generic ones). */
export function detectRoleFamily(title: string, normalized: string, families: RoleFamily[] = ACTIVE_RULES.families): string {
  return detectFamily(title, normalized, families)?.name ?? OTHER_FAMILY;
}

function familyBoost(family: RoleFamily | null, matches: string[]): number {
  if (!family) return 2;
  const needed = family.boostSkills ?? [];
  const strong = needed.length > 0 && needed.every((label) => matches.includes(label));
  return strong ? family.strongBoost ?? 12 : family.baseBoost ?? 6;
}
