"use client";

import { useState, type FormEvent } from "react";
import { evaluateResumeFit } from "../../lib/matching.ts";
import { formatUsd, type FamilyBenchmark } from "../../lib/salary.ts";
import type { GapInsight } from "../../lib/gaps.ts";
import type { Job } from "./types.ts";
import { PROFILE } from "../../lib/profile.ts";

// Live role-fit scores: each direction is a representative job description run
// through the same evaluateResumeFit that scores every inbox posting.
const ROLE_DIRECTIONS = PROFILE.roleFamilies
  .filter((family) => family.probe)
  .map((family) => ({ title: family.label || family.name, blurb: family.blurb ?? "", probe: { heading: family.probeTitle || family.label || family.name, description: family.probe ?? "" } }))
  .map((direction) => ({ ...direction, score: evaluateResumeFit(direction.probe.heading, direction.probe.description).score }))
  .sort((a, b) => b.score - a.score);

function Backdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>{children}</div>;
}

export function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (job: Job, message: string) => void }) {
  const [mode, setMode] = useState<"url" | "text" | "screenshot">("url");
  const [value, setValue] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "screenshot" || !value.trim()) return;
    setImporting(true);
    setError("");
    try {
      const response = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, value: value.trim() }) });
      const data = (await response.json()) as { job?: Job; error?: string; deduplicated?: boolean };
      if (!response.ok || !data.job) throw new Error(data.error || "Import failed");
      onImported(data.job, data.deduplicated ? "Existing job refreshed from its source." : data.job.verificationStatus === "verified" ? "Job imported with structured source evidence." : "Job imported as unverified. Review every inferred field.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import this job.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Backdrop onClose={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <p className="eyebrow">ADD OPPORTUNITY</p>
        <h2 id="import-title">Import a job</h2>
        <p>We’ll extract the role details, show what is missing, and keep the source attached.</p>
        <div className="mode-tabs">
          <button className={mode === "url" ? "active" : ""} onClick={() => setMode("url")}>Website URL</button>
          <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>Paste text</button>
          <button className={mode === "screenshot" ? "active" : ""} onClick={() => setMode("screenshot")}>Screenshot</button>
        </div>
        <form onSubmit={submit}>
          {mode === "url" && <label>Job posting URL<input type="url" required value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://company.com/jobs/…" autoFocus /></label>}
          {mode === "text" && <label>Job description<textarea required value={value} onChange={(event) => setValue(event.target.value)} placeholder="Paste the complete job description here…" rows={9} autoFocus /></label>}
          {mode === "screenshot" && <div className="upload-zone"><span>▧</span><strong>Screenshot analysis is next</strong><p>The upload pipeline will use private object storage and vision extraction. URL and text import are ready now.</p></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal-note"><span>i</span><p><strong>Evidence first.</strong> Missing fields stay unknown. Text-derived suggestions are labeled inferred and cannot unlock tailoring.</p></div>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={importing || mode === "screenshot"}>{importing ? "Importing…" : "Import and analyze"}</button></div>
        </form>
      </section>
    </Backdrop>
  );
}

export function ProfileModal({ onClose, benchmarks, gaps }: { onClose: () => void; benchmarks: FamilyBenchmark[]; gaps: { pool: number; insights: GapInsight[] } }) {
  const suggestedAsk = benchmarks[0];
  return (
    <Backdrop onClose={onClose}>
      <section className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <p className="eyebrow">RÉSUMÉ FIT REVIEW</p><h2 id="profile-title">Your strongest role directions</h2><p>Computed live from data/resume.json by the same matching engine that scores every job in your inbox. Scores indicate résumé alignment, not hiring probability.</p>
        <div className="progress-track"><span /></div>
        <div className="role-fit-list">
          {ROLE_DIRECTIONS.length === 0 && <p>No profile yet. Open this folder in Claude Code and run <code>/onboard</code> to add your resume and targets.</p>}
          {ROLE_DIRECTIONS.map((direction) => (
            <div key={direction.title} className={direction.score < 75 ? "stretch" : undefined}>
              <span><strong>{direction.title}</strong><small>{direction.blurb}</small></span>
              <b>{direction.score}</b>
            </div>
          ))}
        </div>
        {benchmarks.length > 0 && (
          <div className="salary-panel">
            <h3>Salary benchmark <small>from {benchmarks.reduce((n, b) => n + b.count, 0)} scraped postings with pay data</small></h3>
            <table>
              <thead><tr><th>Role family</th><th>p25</th><th>Median</th><th>p75</th><th>n</th></tr></thead>
              <tbody>
                {benchmarks.map((bench) => (
                  <tr key={bench.family}><td>{bench.family}</td><td>{formatUsd(bench.p25)}</td><td><strong>{formatUsd(bench.median)}</strong></td><td>{formatUsd(bench.p75)}</td><td>{bench.count}</td></tr>
                ))}
              </tbody>
            </table>
            {suggestedAsk && <p className="salary-suggestion">Suggested ask when a form demands a number: <strong>{formatUsd(suggestedAsk.median)}–{formatUsd(suggestedAsk.p75)}</strong> ({suggestedAsk.family} median–p75). Keep <code>data/answers.yml</code> in this range.</p>}
          </div>
        )}
        {gaps.insights.length > 0 && (
          <div className="salary-panel gap-panel">
            <h3>Resume gap insights <small>what the market keeps asking for that resume.json can&apos;t ground yet · {gaps.pool} relevant postings</small></h3>
            <div className="gap-list">
              {gaps.insights.slice(0, 5).map((gap) => (
                <div className="gap-row" key={gap.label}>
                  <span className="gap-label"><strong>{gap.label}</strong><small>{gap.families.join(" · ")} — e.g. {gap.companies.join(", ")}</small></span>
                  <span className="gap-bar"><i style={{ width: `${Math.max(gap.share, 3)}%` }} /></span>
                  <b>{gap.count} jobs ({gap.share}%)</b>
                </div>
              ))}
            </div>
            <p className="salary-suggestion">Closing the top gap with a real project or course (then adding it to <code>data/resume.json</code> with evidence) raises fit scores across every posting that mentions it.</p>
          </div>
        )}
        <div className="modal-note"><span>i</span><p><strong>Grounded by design.</strong> Tailoring only rewrites facts that exist in data/resume.json, and every generated resume passes a grounding self-check before it is saved.</p></div>
        <div className="modal-actions"><button className="primary-button" onClick={onClose}>Close</button></div>
      </section>
    </Backdrop>
  );
}

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ["j / k", "Next / previous job"],
    ["s", "Shortlist (again to unshortlist)"],
    ["x", "Not interested (hides it for good; Undo in the toast)"],
    ["r", "Mark Ready to apply"],
    ["o", "Open the posting"],
    ["/", "Search"],
    ["Esc", "Close the panel or this dialog"],
    ["?", "Show these shortcuts"],
  ];
  return (
    <Backdrop onClose={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <p>They work anywhere except while typing in a field.</p>
        <dl className="shortcut-list">{rows.map(([key, label]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{label}</dd></div>)}</dl>
        <div className="modal-actions"><button className="primary-button" onClick={onClose}>Close</button></div>
      </section>
    </Backdrop>
  );
}
