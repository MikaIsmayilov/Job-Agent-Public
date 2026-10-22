#!/usr/bin/env node
// Sanity-checks data/resume.json + data/profile.json after /onboard (or any
// hand edit): structure, regexes, evidence ids, and how each target role
// family scores against its own sample description. Exit code 1 on errors.
//
// Usage: node scripts/check-profile.mjs

import resume from "../data/resume.json" with { type: "json" };
import { buildRules, evaluateResumeFit } from "../lib/matching.ts";
import { needsOnboarding, PROFILE } from "../lib/profile.ts";

const errors = [];
const warnings = [];

if (needsOnboarding()) errors.push("data/profile.json has no displayName or role families yet: run /onboard.");
if (!resume.contact?.name) errors.push("data/resume.json contact.name is empty.");
if (!resume.contact?.email) warnings.push("data/resume.json contact.email is empty.");

const bulletIds = new Set(
  [...(resume.experience ?? []), ...(resume.projects ?? []), ...(resume.leadership ?? [])]
    .flatMap((entry) => entry.bullets ?? [])
    .map((bullet) => bullet.id),
);
const seen = new Set();
for (const entry of [...(resume.experience ?? []), ...(resume.projects ?? []), ...(resume.leadership ?? [])]) {
  for (const bullet of entry.bullets ?? []) {
    if (!bullet.id) errors.push(`A bullet under "${entry.org ?? entry.name}" has no id.`);
    else if (seen.has(bullet.id)) errors.push(`Duplicate bullet id ${bullet.id}.`);
    seen.add(bullet.id);
  }
}

const rules = buildRules(resume, PROFILE);
if (rules.evidence.length < 6) warnings.push(`Only ${rules.evidence.length} scored skills; 12 to 30 gives better ranking.`);
if (rules.gaps.length === 0) warnings.push("No gapRules: the dashboard cannot flag common requirements you lack.");
const skillLabels = new Set(rules.evidence.map((rule) => rule.label));
for (const skill of resume.skills ?? []) {
  if (!(skill.evidence ?? []).length) warnings.push(`Skill "${skill.label}" cites no bullet ids.`);
  for (const id of skill.evidence ?? []) if (!bulletIds.has(id)) errors.push(`Skill "${skill.label}" cites unknown bullet ${id}.`);
  for (const alias of skill.aliases ?? []) {
    if (alias.trim().length < 2) errors.push(`Skill "${skill.label}" has a too-short alias ${JSON.stringify(alias)}.`);
    if ([...alias].some((char) => char.charCodeAt(0) < 32)) errors.push(`Skill "${skill.label}" alias ${JSON.stringify(alias)} has a control character (write \\\\b in JSON, not \\b).`);
  }
}

const regexOk = (pattern, where) => {
  if (!pattern) return;
  try {
    new RegExp(pattern, "i");
  } catch (error) {
    errors.push(`${where}: invalid regex (${error.message}).`);
  }
};
regexOk(PROFILE.coveragePattern, "profile.coveragePattern");
for (const family of PROFILE.roleFamilies) {
  regexOk(family.titlePattern, `role family "${family.name}" titlePattern`);
  regexOk(family.descriptionPattern, `role family "${family.name}" descriptionPattern`);
  for (const label of family.boostSkills ?? []) {
    if (!skillLabels.has(label)) errors.push(`Role family "${family.name}" boosts on unknown skill label "${label}".`);
  }
}
if (PROFILE.workAuthorization.status === "unset") warnings.push("workAuthorization.status is unset: eligibility checks are off.");
if (PROFILE.places.length === 0) warnings.push("No places: every location counts as a match.");

console.log(`Profile: ${PROFILE.displayName || "(none)"} · ${PROFILE.seniority} level · ${PROFILE.workAuthorization.status}`);
console.log(`Places: ${PROFILE.places.map((place) => place.label).join(", ") || "anywhere"}${PROFILE.remoteOk ? " + remote" : ""}`);
console.log(`Resume: ${bulletIds.size} bullets, ${rules.evidence.length} skills, ${rules.gaps.length} gap rules\n`);
for (const family of PROFILE.roleFamilies) {
  const title = family.label || family.name;
  if (!family.probe) {
    console.log(`  ${title.padEnd(30)} (no probe description)`);
    continue;
  }
  const fit = evaluateResumeFit(family.probeTitle || title, family.probe, rules);
  const flag = fit.roleFamily !== family.name ? `  ← detected as "${fit.roleFamily}": check titlePattern/order` : "";
  console.log(`  ${title.padEnd(30)} ${String(fit.score).padStart(2)}  ${fit.matches.slice(0, 4).join(", ")}${flag}`);
}
for (const warning of warnings) console.log(`\nwarning: ${warning}`);
for (const error of errors) console.error(`\nERROR: ${error}`);
process.exit(errors.length ? 1 : 0);
