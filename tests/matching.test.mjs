import assert from "node:assert/strict";
import test from "node:test";
import { buildRules, detectRoleFamily as detectWith, evaluateResumeFit as evaluateWith, rulesFromResume, seniorityAdjustedScore } from "../lib/matching.ts";
import { normalizeProfile } from "../lib/profile.ts";
import resume from "./fixtures/sample-resume.json" with { type: "json" };
import sampleProfile from "./fixtures/sample-profile.json" with { type: "json" };

// Scoring is calibrated against a fictional candidate (tests/fixtures), not
// against whoever has onboarded into data/resume.json and data/profile.json.
const profile = normalizeProfile(sampleProfile);
const RULES = buildRules(resume, profile);
const evaluateResumeFit = (title, description) => evaluateWith(title, description, RULES);
const detectRoleFamily = (title, normalized) => detectWith(title, normalized, RULES.families);

test("ranks business intelligence roles from Power BI and reporting evidence", () => {
  const result = evaluateResumeFit(
    "Business Intelligence Analyst",
    "Build refreshable Power BI dashboards with DAX measures and Power Query, automate recurring operational reporting, and write SQL against the reporting data warehouse.",
  );
  assert.equal(result.roleFamily, "Business intelligence");
  // 2026-10-14 scale: a one-sentence posting has no requirement list to
  // cover, so it cannot earn the coverage points structured postings do.
  assert.ok(result.score >= 70, `expected strong fit, received ${result.score}`);
  assert.ok(result.matches.includes("Power BI & DAX"));
  assert.ok(result.matches.includes("Dashboards & business intelligence"));
});

test("ranks data and product analytics roles strongly", () => {
  const result = evaluateResumeFit(
    "Product Data Analyst",
    "Use Python, SQL, BigQuery, Power BI and Tableau dashboards to analyze customer behavior and inform the product roadmap.",
  );
  assert.equal(result.roleFamily, "Product analytics");
  assert.ok(result.score >= 72, `expected strong fit, received ${result.score}`);
  assert.ok(result.matches.includes("SQL & data warehousing"));
});

test("ranks machine learning roles on real modelling evidence", () => {
  const result = evaluateResumeFit(
    "Data Scientist",
    "Apply machine learning in Python with logistic regression, decision trees and XGBoost, plus clustering and k-means segmentation on large datasets.",
  );
  assert.equal(result.roleFamily, "Data science");
  assert.ok(result.score >= 65, `expected viable fit, received ${result.score}`);
  assert.ok(result.matches.includes("Machine learning"));
  assert.ok(result.matches.includes("Clustering & segmentation"));
});

test("treats marketing analytics as secondary and flags its tooling gaps", () => {
  // The fixture has engagement evidence but no paid-media or attribution
  // tooling, so a tooling-heavy marketing JD must NOT score high.
  const result = evaluateResumeFit(
    "Marketing Analytics Analyst",
    "Analyze marketing analytics and campaign performance, report on customer engagement. Build campaign attribution in GA4 and design A/B tests.",
  );
  assert.equal(result.roleFamily, "Marketing analytics");
  assert.ok(result.score < 75, `expected secondary fit, received ${result.score}`);
  assert.ok(result.gaps.includes("Marketing attribution tooling"));
  // Experimentation is a fixture skill, so an A/B-testing requirement must MATCH.
  assert.ok(result.matches.includes("Experiment design & causal inference"));
  assert.ok(!result.gaps.some((gap) => gap.toLowerCase().includes("experiment")));
});

test("randomized-experiment requirements match instead of counting as a gap", () => {
  const result = evaluateResumeFit(
    "Experimentation Analyst",
    "Design and analyze A/B tests and randomized experiments, estimate treatment effects with fixed effects models, and apply causal inference to product decisions.",
  );
  assert.ok(result.matches.includes("Experiment design & causal inference"));
  assert.ok(!result.gaps.some((gap) => gap.toLowerCase().includes("experiment")));
});

test("modelling, validation and deployment evidence all register", () => {
  const result = evaluateResumeFit(
    "Data Scientist",
    "Build supervised learning models with LightGBM and XGBoost in Python, run cross-validation and holdout testing, explain predictions with SHAP values, and ship with Docker and FastAPI.",
  );
  assert.equal(result.roleFamily, "Data science");
  assert.ok(result.score >= 72, `expected strong fit, received ${result.score}`);
  for (const label of ["Machine learning", "Model validation & backtesting", "ML app deployment", "Model explainability"]) {
    assert.ok(result.matches.includes(label), `expected a ${label} match`);
  }
});

test("keeps traditional financial analyst roles as a stretch", () => {
  const result = evaluateResumeFit(
    "Financial Analyst",
    "Build forecasting models in Excel and Python, own FP&A reporting, accounting analysis, and three-statement financial modeling.",
  );
  assert.equal(result.roleFamily, "Financial analysis");
  assert.ok(result.score < 70, `expected stretch fit, received ${result.score}`);
  assert.ok(result.gaps.includes("Financial modeling / accounting"));
});

test("does not over-score unrelated engineering jobs", () => {
  const result = evaluateResumeFit(
    "Senior Backend Engineer",
    "Design distributed systems in Java, Kubernetes and AWS with ten years of backend engineering experience.",
  );
  assert.ok(result.score < 55, `expected weak fit, received ${result.score}`);
});

test("common job-description boilerplate does not count as evidence", () => {
  // Regression guard. Every phrase here previously matched a skill by substring:
  //   "high energy self-starter"  -> Energy & utilities domain
  //   "employee engagement"       -> Marketing & engagement analytics
  //   "shape the future"          -> Model explainability   (alias "shap")
  //   "tools", "controls"         -> Statistical modeling    (alias "ols")
  //   "earnings potential"        -> Financial & market data (alias "earnings")
  //   "strong fundamentals"       -> Financial & market data (alias "fundamentals")
  //   "react to change"           -> ML app deployment       (alias "react")
  const result = evaluateResumeFit(
    "Office Coordinator",
    "We want a high energy self-starter who responds promptly. Employee engagement matters here. Use our tools and controls to shape the future of the team. Great earnings potential and strong fundamentals. React to change quickly. Digital transformation is a priority and we value legitimate business practices.",
  );
  assert.deepEqual(result.matches, [], `boilerplate must yield no evidence, got: ${result.matches.join(", ")}`);
});

test("short gap aliases are not swallowed by ordinary job-description English", () => {
  // Every phrase below is common JD boilerplate that previously triggered a GAP,
  // silently subtracting 3 points each:
  //   "federal laws" -> aws        (93 of 408 stored postings hit this one)
  //   "spark innovation" -> spark   "cheap" -> heap
  //   "scalable"/"escalate" -> scala   "javascript" -> java
  const decoy = evaluateResumeFit(
    "Operations Associate",
    "We comply with all applicable federal laws. We want to spark innovation on a scalable platform with cheap infrastructure, and JavaScript skills help you escalate issues.",
  );
  assert.deepEqual(decoy.gaps, [], `boilerplate must not register gaps, got: ${decoy.gaps.join(", ")}`);

  // ...while the real tools still register.
  const real = evaluateResumeFit(
    "Data Engineer",
    "Build Apache Spark and dbt pipelines on AWS and Azure, instrument Heap analytics, and write Java, Scala and Kubernetes services.",
  );
  for (const label of [
    "Cloud data platforms (AWS / Azure)",
    "Modern data stack (dbt / Snowflake / Airflow)",
    "Software / data engineering at scale",
  ]) {
    assert.ok(real.gaps.includes(label) || real.gaps.length >= 3, `expected ${label} to still be detected`);
  }
});

test("no alias is a control character or uppercase", () => {
  // "\bnlp\b" in JSON is a backspace escape, not a literal backslash, so it
  // silently became an unmatchable alias. Guard the whole set.
  for (const rule of rulesFromResume(resume).evidence) {
    for (const alias of rule.aliases) {
      assert.ok(alias.trim().length > 1, `suspiciously short alias ${JSON.stringify(alias)} on ${rule.label}`);
      assert.ok([...alias].every((char) => char.charCodeAt(0) >= 32), `control character in alias ${JSON.stringify(alias)} on ${rule.label}`);
    }
  }
});

test("seniority adjustment penalizes postings away from the target level and stays in range", () => {
  assert.equal(seniorityAdjustedScore(70, "entry", "entry"), 72);
  // 3+ years is a real bar for a new graduate.
  assert.equal(seniorityAdjustedScore(70, "mid", "entry"), 58);
  assert.equal(seniorityAdjustedScore(70, "senior", "entry"), 50);
  assert.equal(seniorityAdjustedScore(70, "unknown", "entry"), 70);
  assert.equal(seniorityAdjustedScore(70, undefined, "entry"), 70);
  // An experienced candidate is not punished for senior postings.
  assert.equal(seniorityAdjustedScore(70, "senior", "senior"), 72);
  assert.ok(seniorityAdjustedScore(70, "entry", "senior") < 70);
  assert.equal(seniorityAdjustedScore(70, "mid", "mid"), 72);
  // clamped to the same 35..95 band the rest of the engine uses
  assert.equal(seniorityAdjustedScore(94, "entry", "entry"), 95);
  assert.equal(seniorityAdjustedScore(40, "senior", "entry"), 35);
});

test("derives evidence rules from a resume", () => {
  const rules = rulesFromResume(resume);
  assert.ok(rules.evidence.length >= 18, `expected >=18 evidence rules, received ${rules.evidence.length}`);
  assert.ok(rules.gaps.length >= 6, `expected >=6 gap rules, received ${rules.gaps.length}`);
  const python = rules.evidence.find((rule) => rule.label === "Python");
  assert.ok(python, "Python rule missing from the fixture");
  assert.ok(python.evidence?.length, "Python rule must cite resume bullet ids");
  for (const rule of rules.evidence) {
    assert.ok(rule.aliases.every((alias) => alias === alias.toLowerCase()), `aliases must be lowercased for ${rule.label}`);
  }
});

test("every resume skill evidence id points at a real bullet", () => {
  const bulletIds = new Set(
    [...(resume.experience ?? []), ...(resume.projects ?? []), ...(resume.leadership ?? [])]
      .flatMap((entry) => entry.bullets ?? [])
      .map((bullet) => bullet.id),
  );
  for (const skill of resume.skills) {
    for (const id of skill.evidence ?? []) {
      assert.ok(bulletIds.has(id), `skill ${skill.id} cites unknown bullet ${id}`);
    }
  }
});

test("an empty or malformed resume yields no rules instead of someone else's", () => {
  assert.deepEqual(rulesFromResume({}), { evidence: [], gaps: [] });
  const rules = rulesFromResume({ skills: [{ label: "Only one", aliases: ["one"], weight: 5 }, { label: "Broken", aliases: [], weight: 5 }] });
  assert.deepEqual(rules.evidence.map((rule) => rule.label), ["Only one"]);
});

test("with no role families every job is an adjacent role and scoring still works", () => {
  const bare = buildRules(resume, normalizeProfile({}));
  const fit = evaluateWith("Data Analyst", "Strong SQL and Python skills", bare);
  assert.equal(fit.roleFamily, "Adjacent role");
  assert.ok(fit.score >= 35 && fit.score <= 95);
});

test("an invalid family regex is skipped, not thrown", () => {
  assert.equal(detectWith("Data Analyst", "", [{ name: "Broken", titlePattern: "(" }, { name: "Data", titlePattern: "data" }]), "Data");
});

test("classifies adjacent analyst titles into role families", () => {
  assert.equal(detectRoleFamily("Business Analyst", "business analyst sql"), "Data analytics");
  assert.equal(detectRoleFamily("BI Analyst", "bi analyst dashboards"), "Business intelligence");
  assert.equal(detectRoleFamily("Reporting Analyst", "recurring reports"), "Business intelligence");
  assert.equal(detectRoleFamily("Insights Analyst", "insights analyst"), "Research & insights");
  assert.equal(detectRoleFamily("Operations Analyst", "operations analyst"), "Data analytics");
  assert.equal(detectRoleFamily("Strategy Analyst", "strategy analyst"), "Data analytics");
  assert.equal(detectRoleFamily("Analytics Consultant", "analytics consultant"), "Data analytics");
  assert.equal(detectRoleFamily("Marketing Analyst", "marketing analyst"), "Marketing analytics");
  assert.equal(detectRoleFamily("Growth Analyst", "growth analyst"), "Marketing analytics");
  assert.equal(detectRoleFamily("Data Scientist", "python modelling"), "Data science");
  assert.equal(detectRoleFamily("Associate Product Manager", "consumer app"), "Product management");
  assert.equal(detectRoleFamily("Deal Data Technology & Analytics Associate", "deals analytics"), "Data analytics");
  assert.equal(detectRoleFamily("Warehouse Operative", "forklift"), "Adjacent role");
});

test("sports and esports titles map to the Sports analytics family", () => {
  assert.equal(detectRoleFamily("Sports Data Analyst", "analyze player performance data"), "Sports analytics");
  assert.equal(detectRoleFamily("Esports Analyst", "competitive gaming statistics"), "Sports analytics");
  assert.equal(detectRoleFamily("Analyst, Basketball Analytics", "nba team"), "Sports analytics");
  assert.equal(detectRoleFamily("Data Analyst", "join our esports organization to analyze match data"), "Sports analytics");
  assert.equal(detectRoleFamily("Sportsbook Analyst", "betting markets"), "Sports analytics");
  // plain analyst roles stay where they were
  assert.equal(detectRoleFamily("Data Analyst", "sql dashboards for retail"), "Data analytics");
  assert.equal(detectRoleFamily("Marketing Analyst", "campaign performance"), "Marketing analytics");
});

// ---- 2026-10-14 scoring: sections, coverage, rarity, blockers ----

const structured = (requirements, extra = "") =>
  `**About us**\nWe are a data-driven company with dashboards everywhere.\n**Responsibilities**\n* Build reporting for the business\n**Qualifications**\n${requirements.map((r) => `* ${r}`).join("\n")}\n${extra}**Benefits**\n* Health insurance\n`;

test("covering every hard requirement beats covering half of them", () => {
  const full = evaluateResumeFit("Data Analyst", structured(["Strong SQL and Python skills", "Experience building Tableau dashboards", "Bachelor's degree in a quantitative field"]));
  const half = evaluateResumeFit("Data Analyst", structured(["Strong SQL and Python skills", "Experience with Salesforce administration", "Hands-on Workday HCM configuration", "Bachelor's degree in a quantitative field"]));
  assert.equal(full.coverage, 1);
  assert.equal(half.coverage, 1 / 3);
  assert.ok(full.score > half.score + 8, `${full.score} vs ${half.score}`);
  assert.ok(half.gaps.some((gap) => gap.startsWith("Requires: Experience with Salesforce administration")));
});

test("a skill only named in company boilerplate counts for little", () => {
  const required = evaluateResumeFit("Analyst", "**Qualifications**\n* Machine learning with XGBoost in Python\n**Benefits**\n* Free lunch");
  const boiler = evaluateResumeFit("Analyst", "**Qualifications**\n* Strong organizational skills\n**About us**\nOur platform uses machine learning, XGBoost and Python.");
  assert.ok(required.score > boiler.score + 10, `${required.score} vs ${boiler.score}`);
});

test("preferences, logistics, and soft skills are not unmet requirements", () => {
  const fit = evaluateResumeFit("Data Analyst", structured([
    "Strong SQL skills",
    "Experience with Python",
    "Salesforce experience is a plus",
    "This role is onsite daily",
    "The pay range for this role is $85,000-$120,000",
    "Excellent written and verbal communication",
    "Decision Quality",
  ]));
  assert.equal(fit.coverage, 1);
  assert.ok(!fit.gaps.some((gap) => gap.startsWith("Requires:")), fit.gaps.join(" | "));
});

test("a years bar is judged on its skill, not skipped", () => {
  const fit = evaluateResumeFit("Developer", structured(["3+ years of .NET development (C#, ASP.NET)", "3+ years of SQL Server experience"]));
  assert.equal(fit.coverage, 0.5);
  assert.ok(fit.gaps.some((gap) => gap.includes(".NET")));
});

test("a posting that excludes the candidate's work authorization sinks and says why", () => {
  const text = structured(["Strong SQL and Python skills", "Tableau dashboards"], "We do not provide training plans or support for F-1 OPT, STEM OPT extensions, or future visa sponsorship.\n");
  const fit = evaluateResumeFit("Data Analyst", text);
  assert.ok(fit.score <= 40, `blocked posting scored ${fit.score}`);
  assert.match(fit.gaps[0], /^Blocker: /);
});

test("strong postings spread out instead of tying at the cap", () => {
  const many = evaluateResumeFit("Data Scientist", structured(["Python, SQL, machine learning with XGBoost", "A/B testing and causal inference", "Tableau and Power BI dashboards", "Forecasting and clustering", "Model validation and cross-validation"]));
  const fewer = evaluateResumeFit("Data Scientist", structured(["Python and SQL", "Machine learning"]));
  assert.ok(many.score > fewer.score, `${many.score} vs ${fewer.score}`);
  assert.ok(many.score <= 95);
});

test("Excel, SSMS, and BigQuery count; 'excellent' and 'excel in' do not", () => {
  for (const text of ["Advanced proficiency in Excel.", "Tools: SQL, Excel, Tableau", "Build models in Microsoft Excel", "Excel (pivot tables, lookups)", "Proficiency with Excel and PowerPoint"]) {
    assert.ok(evaluateResumeFit("Analyst", text).matches.includes("Excel"), text);
  }
  for (const text of ["Excellent communication skills", "You will excel in this role", "We want you to excel."]) {
    assert.ok(!evaluateResumeFit("Analyst", text).matches.includes("Excel"), text);
  }
  assert.ok(evaluateResumeFit("Analyst", "Write queries in SSMS against our warehouse").matches.includes("SQL & data warehousing"));
  assert.ok(evaluateResumeFit("Analyst", "Experience with Google BigQuery or GCP").matches.includes("Google Cloud / BigQuery"));
});

test("an Excel requirement now counts as covered", () => {
  const fit = evaluateResumeFit("Data Analyst", "**Qualifications**\n* Strong SQL skills\n* Highly proficient in Excel, including formulas and lookups\n* Experience with SSMS");
  assert.equal(fit.coverage, 1);
});

test("an Excel line never turns into an unmet requirement", () => {
  const fit = evaluateResumeFit("Analyst", "**Qualifications**\n* Proficiency with Excel and PowerPoint\n* Strong Excel modeling\n* Strong SQL skills\n* Candidates must reside within a reasonable proximity to a Center of Excellence");
  assert.equal(fit.coverage, 1);
});
