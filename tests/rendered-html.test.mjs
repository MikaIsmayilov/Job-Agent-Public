import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the Job Agent product shell replaces the starter preview", async () => {
  // The dashboard is page.tsx plus its components (split 2026-10-14).
  const componentFiles = ["types.ts", "job-list.tsx", "job-detail.tsx", "chrome.tsx", "modals.tsx", "applications-table.tsx", "description.tsx", "theme.ts"];
  const [pageFile, layout, styles, packageJson, ...components] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    ...componentFiles.map((file) => readFile(new URL(`app/_components/${file}`, root), "utf8")),
  ]);
  const page = [pageFile, ...components].join("\n");

  assert.match(layout, /Job Agent — Personal Job Search Workspace/);
  assert.match(layout, /\/og\.png/);
  // 2026-10-14 overhaul: hard-rule default view, filter drawer, and themes.
  assert.match(page, /Worth applying/);
  assert.match(page, /worthApplying\(job, nowMs\)/);
  assert.match(page, /More filters/);
  assert.match(layout, /jobagent:theme/);
  assert.match(styles, /prefers-color-scheme: dark/);
  assert.match(styles, /data-theme="dark"/);
  assert.match(page, /Import a job/);
  assert.match(page, /RÉSUMÉ FIT REVIEW/);
  assert.match(styles, /\.inbox-grid/);
  assert.match(styles, /\.verification-card/);
  // grouped inbox + scrape-aware filters
  assert.match(page, /groupedJobs/);
  assert.match(page, /family-group/);
  assert.match(page, /api\/documents/);
  assert.match(page, /New in last 24h/);
  assert.match(page, /jobagent:lastVisit/);
  assert.match(page, /tailor-resume/);
  assert.match(styles, /\.family-group/);
  assert.match(styles, /\.new-badge/);
  assert.doesNotMatch(page, /Northstar AI|Metric Labs|Juniper Commerce|Harbor Retail Group|demoJobs/);
  assert.doesNotMatch(page + layout + packageJson, /codex-preview|react-loading-skeleton|SkeletonPreview/);
});

test("job import keeps evidence and persistence boundaries", async () => {
  const [route, storage, hosting] = await Promise.all([
    readFile(new URL("app/api/jobs/route.ts", root), "utf8"),
    readFile(new URL("db/jobs.ts", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
  ]);

  assert.match(route, /findJobPostingJsonLd/);
  assert.match(route, /safePublicUrl/);
  assert.match(route, /redirect: "manual"/);
  assert.match(route, /saveOrUpdateJob/);
  assert.match(route, /Paste the description instead/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS jobs/);
  assert.match(storage, /verification_status/);
  assert.match(storage, /content_hash/);
  assert.match(hosting, /"d1": "DB"/);
});
