"use client";

import { freshnessBand, postingAgeDays } from "../../lib/freshness.ts";
import type { View } from "../../lib/job-filters.ts";
import { formatDate, formatDateTime, relativeDate, scoreTone, sponsorshipLabel, statusLabel, verificationLabel, type Job } from "./types.ts";

export const PAGE_SIZE = 25;

export type JobGroup = { family: string; jobs: Job[] };
export type GroupState = { open: Record<string, boolean>; shown: Record<string, number> };

const groupKey = (view: View, family: string) => `${view}:${family}`;

// Inbox opens only its top group; pipeline views open everything.
export function isGroupOpen(state: GroupState, view: View, family: string, index: number) {
  return state.open[groupKey(view, family)] ?? (view !== "inbox" || index === 0);
}

export function shownIn(state: GroupState, view: View, family: string) {
  return state.shown[groupKey(view, family)] ?? PAGE_SIZE;
}

/** Rows actually on screen, in order: what j/k step through. */
export function visibleJobs(groups: JobGroup[], view: View, state: GroupState): Job[] {
  return groups.flatMap((group, index) => (isGroupOpen(state, view, group.family, index) ? group.jobs.slice(0, shownIn(state, view, group.family)) : []));
}

type Props = {
  groups: JobGroup[];
  view: View;
  showApplied: boolean;
  activeId?: string;
  nowMs: number;
  lastVisit: string;
  state: GroupState;
  onState: (next: GroupState) => void;
  onSelect: (id: string) => void;
  empty: React.ReactNode;
};

export default function JobList({ groups, view, showApplied, activeId, nowMs, lastVisit, state, onState, onSelect, empty }: Props) {
  if (!groups.length) return <div className="job-list" role="list">{empty}</div>;
  return (
    <div className="job-list" role="list">
      {groups.map(({ family, jobs }, index) => {
        const key = groupKey(view, family);
        const open = isGroupOpen(state, view, family, index);
        const shown = shownIn(state, view, family);
        return (
          <details
            className="family-group"
            key={key}
            open={open}
            onToggle={(event) => {
              const isOpen = (event.currentTarget as HTMLDetailsElement).open;
              if (isOpen !== open) onState({ ...state, open: { ...state.open, [key]: isOpen } });
            }}
          >
            <summary><strong>{family}</strong><em>{jobs.length}</em></summary>
            {jobs.slice(0, shown).map((job) => (
              <JobRow key={job.id} job={job} active={job.id === activeId} showApplied={showApplied} nowMs={nowMs} lastVisit={lastVisit} onSelect={onSelect} />
            ))}
            {jobs.length > shown && (
              <button className="show-more" onClick={() => onState({ ...state, shown: { ...state.shown, [key]: shown + PAGE_SIZE } })}>
                Show {Math.min(PAGE_SIZE, jobs.length - shown)} more · {jobs.length - shown} hidden
              </button>
            )}
          </details>
        );
      })}
    </div>
  );
}

function JobRow({ job, active, showApplied, nowMs, lastVisit, onSelect }: { job: Job; active: boolean; showApplied: boolean; nowMs: number; lastVisit: string; onSelect: (id: string) => void }) {
  // "New" means first DISCOVERED, not re-scraped: dedup refreshes bump fetchedAt
  // on every scrape, so these checks use firstSeenAt (the insert timestamp).
  const isNew = Boolean(lastVisit && job.firstSeenAt && job.firstSeenAt > lastVisit);
  const foundToday = Boolean(job.firstSeenAt && nowMs && new Date(job.firstSeenAt).toDateString() === new Date(nowMs).toDateString());
  const stale = nowMs > 0 && freshnessBand(job.datePosted, nowMs) === "stale";
  return (
    <button className={`job-row ${active ? "selected" : ""}`} onClick={() => onSelect(job.id)} role="listitem" data-job-id={job.id} aria-current={active ? "true" : undefined}>
      <span className={`company-logo logo-${job.company.length % 4}`}>{job.company.slice(0, 1)}</span>
      <span className="job-main">
        <strong>
          {job.title}
          {isNew && <i className="new-badge">new</i>}
          {job.redFlags.length > 0 && <i className="flag-badge" title={job.redFlags.join(", ")}>⚠ {job.redFlags.length}</i>}
          {job.screenedOut && <i className="screened-badge" title={job.screenedOut}>{job.screenedOut.startsWith("Not interested") ? "not interested" : "screened out"}</i>}
        </strong>
        <small>{job.company} · {job.location}</small>
        <span className="job-meta">
          {job.workMode !== "Unknown" && <i>{job.workMode}</i>}
          {job.jobType && job.jobType !== "fulltime" && <i>{job.jobType === "parttime" ? "Part-time" : job.jobType === "internship" ? "Internship" : "Contract"}</i>}
          {(job.experienceLevel === "mid" || job.experienceLevel === "senior") && <i>{job.experienceLevel} level</i>}
          {job.tags.includes("startup") && <i className="startup-chip">Startup</i>}
          {job.tags.includes("fortune500") && <i className="f500-chip">F500</i>}
          {job.sponsorship !== "unknown" && <i className={`sponsorship-chip sponsorship-${job.sponsorship}`}>{sponsorshipLabel[job.sponsorship]}</i>}
          {stale && <i className="stale-chip" title="Posted over 30 days ago; most entry-level roles fill sooner">Stale · {postingAgeDays(job.datePosted, nowMs)}d</i>}
          {job.verificationStatus !== "verified" && <i className={`verification-label verification-${job.verificationStatus}`}>{verificationLabel(job.verificationStatus)}</i>}
        </span>
      </span>
      <span className="job-end">
        <b className={`score ${scoreTone(job.score)}`}>{job.score}%</b>
        <small>
          {job.appliedAt && showApplied ? (
            <span title="Date and time applied">Applied {formatDateTime(job.appliedAt)}</span>
          ) : job.datePosted ? (
            relativeDate(job.datePosted, nowMs) || formatDate(job.datePosted)
          ) : (
            <span title="No posting date from the source; this is when the scraper first found it">seen {relativeDate(job.firstSeenAt || job.fetchedAt, nowMs) || formatDate(job.firstSeenAt || job.fetchedAt)}</span>
          )}
        </small>
        {(job.status !== "new" || foundToday) && <i className={`status status-${job.status}`}>{statusLabel[job.status]}</i>}
      </span>
    </button>
  );
}
