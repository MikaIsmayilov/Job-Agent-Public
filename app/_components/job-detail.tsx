"use client";

// Rendered with key={job.id}, so edit, posting, and action-form state reset
// whenever a different job is opened.

import { useState, type FormEvent } from "react";
import { sponsorshipRisk } from "../../lib/eligibility.ts";
import { formatUsd, midpoint, parseAnnualSalary, type FamilyBenchmark } from "../../lib/salary.ts";
import { summarySegments } from "../../lib/markdown-lite.ts";
import { dueLabel } from "../../lib/actions.ts";
import { Description, RichText } from "./description.tsx";
import {
  familyOf, fieldLabel, formatDate, formatDateTime, scoreTone, sponsorshipLabel, verificationDescription, verificationLabel,
  type Attachment, type FieldEvidence, type Job, type JobStatus, type PendingAction,
} from "./types.ts";

const ACTION_PRESETS: Record<string, string> = {
  Assessment: "Complete the online assessment",
  Interview: "Interview",
  "Follow-up": "Follow up on my application",
  Documents: "Send requested documents",
  Other: "",
};

type Props = {
  job: Job;
  attachments: Attachment[];
  benchmarks: FamilyBenchmark[];
  actions: PendingAction[];
  today: string;
  onStatus: (status: JobStatus) => void;
  onDismiss: () => void;
  onRestore: () => void;
  onRemove: () => void;
  onSaved: (job: Job, message: string) => void;
  onNotice: (message: string) => void;
  onActionAdded: () => void;
  onBack: () => void;
  sheetOpen: boolean;
};

function EvidenceFlag({ item }: { item?: FieldEvidence }) {
  if (!item) return null;
  return <span className={`evidence-flag ${item.direct ? "direct" : "inferred"}`}>{item.direct ? "observed" : "inferred"}</span>;
}

export default function JobDetail({ job, attachments, benchmarks, actions, today, onStatus, onDismiss, onRestore, onRemove, onSaved, onNotice, onActionAdded, onBack, sheetOpen }: Props) {
  const [copied, setCopied] = useState("");
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState({ title: job.title, company: job.company, location: job.location, workMode: job.workMode });
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState<{ state: "idle" | "loading" | "open" | "error"; raw: string }>({ state: "idle", raw: "" });
  const [actionForm, setActionForm] = useState(false);
  const [draft, setDraft] = useState({ kind: "Assessment", title: ACTION_PRESETS.Assessment, dueDate: "", url: "" });
  const [savingAction, setSavingAction] = useState(false);

  const evidenceFor = (field: FieldEvidence["field"]) => job.evidence.find((item) => item.field === field);
  const risk = sponsorshipRisk(job.sponsorship, job.sponsorshipNote);
  const dismissed = Boolean(job.screenedOut);
  // Source-verified OR user-validated: marking a job "Ready to apply" is the
  // user's explicit validation of the posting.
  const canGenerate = job.verificationStatus === "verified" || job.status === "ready";
  const gateHint = job.verificationStatus === "verified" ? "Source verified" : job.status === "ready" ? "You validated this job (Ready to apply)" : "Verify the source, or mark the job Ready to apply to validate it yourself";

  function copy(button: string, command: string, message: string) {
    navigator.clipboard?.writeText(command).catch(() => undefined);
    onNotice(message);
    setCopied(button);
    window.setTimeout(() => setCopied((current) => (current === button ? "" : current)), 2200);
  }

  async function saveEdits() {
    const changed: Record<string, string> = {};
    (["title", "company", "location", "workMode"] as const).forEach((field) => {
      const value = fields[field].trim();
      if (value && value !== job[field]) changed[field] = value;
    });
    if (!Object.keys(changed).length) return setEditing(false);
    setSaving(true);
    try {
      const response = await fetch("/api/jobs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: job.id, fields: changed }) });
      const data = (await response.json()) as { job?: Job; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error || "Could not save the changes.");
      setEditing(false);
      onSaved(data.job, "Job details updated. Manual corrections are kept when scrapes refresh this job.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save the changes.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePosting() {
    if (posting.state === "open") return setPosting({ ...posting, state: "idle" });
    if (posting.raw) return setPosting({ ...posting, state: "open" });
    setPosting({ state: "loading", raw: "" });
    try {
      const response = await fetch(`/api/jobs?id=${encodeURIComponent(job.id)}`);
      const data = (await response.json()) as { jobs?: Array<{ rawDescription?: string }> };
      const raw = data.jobs?.[0]?.rawDescription?.trim();
      setPosting(raw ? { state: "open", raw } : { state: "error", raw: "" });
    } catch {
      setPosting({ state: "error", raw: "" });
    }
  }

  async function addAction(event: FormEvent) {
    event.preventDefault();
    setSavingAction(true);
    try {
      const response = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job.id, kind: draft.kind, title: draft.title, dueDate: draft.dueDate, url: draft.url, notes: "" }) });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save the action.");
      setActionForm(false);
      setDraft({ kind: "Assessment", title: ACTION_PRESETS.Assessment, dueDate: "", url: "" });
      onActionAdded();
      onNotice(`Added "${draft.title}" for ${job.company}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save the action.");
    } finally {
      setSavingAction(false);
    }
  }

  const range = parseAnnualSalary(job.salary);
  const bench = benchmarks.find((b) => b.family === familyOf(job));

  return (
    <aside className={`job-detail ${sheetOpen ? "sheet-open" : ""}`} aria-label={`${job.title} at ${job.company}`}>
      <button className="detail-back" onClick={onBack}>‹ Back to list</button>
      <div className="detail-head">
        <span className={`company-logo large logo-${job.company.length % 4}`}>{job.company.slice(0, 1)}</span>
        <div><span>{job.company}</span><h3>{job.title}</h3><p>{job.location} · {job.workMode}</p></div>
        <span className="detail-head-actions">
          <button aria-label="Edit job details" title="Correct the title, company, location, or work mode" onClick={() => setEditing(true)}>✎</button>
          <button aria-label="Delete this job" title="Delete from the database (use Not interested to just hide it)" onClick={onRemove}>✕</button>
        </span>
      </div>

      {/* Everything you act on sits here, pinned while the rest scrolls. */}
      <div className="detail-actionbar">
        <div className="actionbar-row">
          <select aria-label="Application status" value={job.status} onChange={(event) => onStatus(event.target.value as JobStatus)}>
            <option value="new">New match</option>
            <option value="shortlisted">Shortlisted</option>
            <option value="ready">Ready to apply</option>
            <option value="applied">Applied</option>
            <option value="interview">Interview</option>
            <option value="rejected">Rejected</option>
          </select>
          {job.sourceUrl && <a className="secondary-button apply-link" href={job.sourceUrl} target="_blank" rel="noreferrer">Apply ↗</a>}
          {dismissed
            ? <button className="secondary-button" onClick={onRestore} title={job.screenedOut}>Restore</button>
            : <button className="secondary-button" onClick={onDismiss} title="Hide this job for good (keyboard: x)">Not interested</button>}
        </div>
        <div className="actionbar-row">
          <button className="primary-button" disabled={!canGenerate} title={canGenerate ? gateHint : `${gateHint}.`} onClick={() => copy("tailor", `/tailor-resume ${job.id}`, `Copied "/tailor-resume ${job.id}". Run it in Claude Code from the project folder to generate a grounded tailored resume.`)}>
            {copied === "tailor" ? "Copied ✓" : canGenerate ? "Tailor resume →" : "Validate before tailoring"}
          </button>
          <button className="secondary-button" disabled={!canGenerate} title={canGenerate ? `Copy the /cover-letter command. ${gateHint}` : `Cover letters need a validated job description. ${gateHint}.`} onClick={() => copy("cover", `/cover-letter ${job.id}`, `Copied "/cover-letter ${job.id}". Run it in Claude Code to generate a grounded 260 to 340 word cover letter.`)}>
            {copied === "cover" ? "Copied ✓" : "Cover letter"}
          </button>
          <button className="secondary-button" disabled={!job.sourceUrl} title={job.sourceUrl ? "Copy the /fill-application command; it pre-fills the form and you review and submit" : "No application URL stored for this job"} onClick={() => copy("fill", `/fill-application ${job.id}`, `Copied "/fill-application ${job.id}". Run it in Claude Code to pre-fill the application form (you review and click Submit).`)}>
            {copied === "fill" ? "Copied ✓" : "Auto-fill"}
          </button>
        </div>
      </div>

      {risk && <p className={`eligibility-banner eligibility-${risk.level}`} role="note">{risk.message}</p>}
      {dismissed && <p className="eligibility-banner eligibility-muted" role="note">Hidden from Worth applying: {job.screenedOut}</p>}

      {editing && (
        <div className="edit-job-card">
          <label>Job title<input value={fields.title} onChange={(event) => setFields({ ...fields, title: event.target.value })} maxLength={180} autoFocus /></label>
          <label>Company<input value={fields.company} onChange={(event) => setFields({ ...fields, company: event.target.value })} maxLength={140} /></label>
          <label>Location<input value={fields.location} onChange={(event) => setFields({ ...fields, location: event.target.value })} maxLength={180} /></label>
          <label>Work mode<select value={fields.workMode} onChange={(event) => setFields({ ...fields, workMode: event.target.value })}>
            <option value="Remote">Remote</option>
            <option value="Hybrid">Hybrid</option>
            <option value="Onsite">Onsite</option>
            <option value="Unknown">Unknown</option>
          </select></label>
          <p>Corrections are saved as observed evidence and survive scrape refreshes. Editing the title re-scores the match.</p>
          <div className="edit-job-actions">
            <button className="secondary-button" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            <button className="primary-button" onClick={saveEdits} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      )}

      <div className={`verification-card verification-${job.verificationStatus}`}>
        <div><strong>{verificationLabel(job.verificationStatus)}</strong><p>{verificationDescription(job)}</p></div>
        {job.sourceUrl && <a href={job.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}
      </div>

      <div className="match-card">
        <div className={`score-ring ${scoreTone(job.score)}`} style={{ "--score": `${job.score * 3.6}deg` } as React.CSSProperties}>
          <span><strong>{job.score}</strong><small>%</small></span>
        </div>
        <div><strong>{job.score >= 88 ? "Excellent match" : job.score >= 78 ? "Strong match" : "Promising match"}</strong><p>Based on your current profile</p></div>
      </div>

      {(["ready", "applied", "interview"].includes(job.status) || actions.length > 0) && (
        <div className="detail-section">
          <div className="section-title"><h4>Next steps</h4>{!actionForm && <button className="link-button" onClick={() => setActionForm(true)}>+ Add</button>}</div>
          {actions.length > 0 && (
            <ul className="next-steps">
              {actions.map((action) => (
                <li key={action.id}><span>{action.kind} · {action.title}</span><em className={action.dueDate && today && action.dueDate <= today ? "is-urgent" : ""}>{today ? dueLabel(action.dueDate, today) : ""}</em></li>
              ))}
            </ul>
          )}
          {!actions.length && !actionForm && <p className="section-hint">Nothing planned. Add an assessment, interview, or follow-up when one comes in.</p>}
          {actionForm && (
            <form className="inline-action-form" onSubmit={addAction}>
              <select aria-label="Action type" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value, title: ACTION_PRESETS[event.target.value] || draft.title })}>
                {Object.keys(ACTION_PRESETS).map((kind) => <option key={kind}>{kind}</option>)}
              </select>
              <input aria-label="What needs doing" required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="What needs doing?" />
              <input aria-label="Deadline" type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} />
              <input aria-label="Link" type="url" maxLength={2000} value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="Link (optional)" />
              <div className="edit-job-actions">
                <button type="button" className="secondary-button" onClick={() => setActionForm(false)} disabled={savingAction}>Cancel</button>
                <button className="primary-button" disabled={savingAction}>{savingAction ? "Saving…" : "Save"}</button>
              </div>
            </form>
          )}
        </div>
      )}

      {(job.tailoredPath || attachments.length > 0) && (
        <div className="detail-section tailored-info">
          <h4>{job.tailoredPath ? "Tailored resume" : "Generated documents"}</h4>
          {attachments.length ? (
            <div className="attachment-list">
              {attachments.map((attachment) => (
                <a key={attachment.id} href={`/api/documents?id=${attachment.id}`} className="attachment-link">⬇ {attachment.filename} <small>{Math.max(1, Math.round(attachment.size / 1024))} KB</small></a>
              ))}
            </div>
          ) : (
            <p>{job.tailoredPath}</p>
          )}
          {job.tailoredPath && (
            <>
              <p className="tailored-changes"><strong>What changed vs. your base resume:</strong> {job.tailoredChanges || "Not recorded for this tailoring. Open REPORT.md above for the full change log."}</p>
              <p className="tailored-meta"><small>Generated {formatDateTime(job.tailoredAt)}</small></p>
            </>
          )}
        </div>
      )}

      <div className="detail-section">
        <div className="section-title"><h4>Why it fits</h4><span>{job.skills.length} matches</span></div>
        <div className="chip-list">{job.skills.map((skill) => <span className="skill-chip" key={skill}>✓ {skill}</span>)}</div>
      </div>

      <div className="detail-section">
        <div className="section-title"><h4>Evidence gaps</h4><span>{job.gaps.length}</span></div>
        <div className="chip-list">{job.gaps.map((gap) => <span className="gap-chip" key={gap}>? {gap}</span>)}</div>
      </div>

      {job.redFlags.length > 0 && (
        <div className="detail-section">
          <div className="section-title"><h4>Legitimacy warnings</h4><span>{job.redFlags.length}</span></div>
          <div className="chip-list">{job.redFlags.map((flag) => <span className="flag-chip" key={flag}>⚠ {flag}</span>)}</div>
        </div>
      )}

      <div className="detail-section role-summary">
        <div className="section-title"><h4>Role snapshot</h4><button className="link-button" onClick={togglePosting}>{posting.state === "open" ? "Hide full posting" : posting.state === "loading" ? "Loading…" : "Read full posting"}</button></div>
        {posting.state === "open" ? <Description raw={posting.raw} /> : <p><RichText segments={summarySegments(job.summary)} />{job.summary.length >= 360 ? "…" : ""}</p>}
        {posting.state === "error" && <p className="section-hint">The full posting text is not stored for this job. Use Open source above.</p>}
        <dl>
          <div><dt>Compensation</dt><dd>{job.salary} <EvidenceFlag item={evidenceFor("salary")} />{bench && (range
            ? (() => { const delta = Math.round(((midpoint(range) - bench.median) / bench.median) * 100); return <small className="salary-benchmark">{delta >= 0 ? `${delta}% above` : `${Math.abs(delta)}% below`} the {formatUsd(bench.median)} market median ({bench.family}, n={bench.count})</small>; })()
            : <small className="salary-benchmark">market median {formatUsd(bench.median)} ({bench.family}, n={bench.count})</small>)}</dd></div>
          <div><dt>Date posted</dt><dd>{formatDate(job.datePosted)}</dd></div>
          <div><dt>Last checked</dt><dd>{formatDateTime(job.fetchedAt)}</dd></div>
          <div><dt>Valid through</dt><dd>{formatDate(job.validThrough)}</dd></div>
          <div className="snapshot-wide"><dt>Visa sponsorship</dt><dd>{sponsorshipLabel[job.sponsorship]} <EvidenceFlag item={evidenceFor("sponsorship")} />{job.sponsorshipNote && <small className="sponsorship-note">{job.sponsorshipNote}</small>}</dd></div>
        </dl>
      </div>

      <details className="evidence-panel">
        <summary>View field evidence</summary>
        <div className="evidence-list">
          {job.evidence.map((item) => <div key={item.field}><span><strong>{fieldLabel(item.field)}</strong><small>{item.direct ? "Observed" : "Inferred"} · {item.confidence} confidence</small></span><p>{item.evidence}</p></div>)}
        </div>
      </details>
    </aside>
  );
}
