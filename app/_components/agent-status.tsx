"use client";

// One line saying when the scheduled scrape and mail check last ran, plus a
// card for recruiter replies the mail tracker could not tie to one application.

import { runAge, type MailReview, type RunKind, type RunRecord } from "../../lib/agent-runs.ts";
import type { Job, JobStatus } from "./types.ts";

export type RunStatus = { last: Partial<Record<RunKind, RunRecord>>; reviews: MailReview[] };

type Props = {
  status: RunStatus | null;
  nowMs: number;
  jobs: Job[];
  onResolve: (review: MailReview, job: Job | null, status: JobStatus | null) => void;
};

const LABEL: Record<RunKind, string> = { scrape: "Last scrape", mail: "Mail checked" };

export default function AgentStatus({ status, nowMs, jobs, onResolve }: Props) {
  if (!status || !nowMs) return null;
  const byId = new Map(jobs.map((job) => [job.id, job]));
  return (
    <>
      <p className="agent-status">
        {(["scrape", "mail"] as const).map((kind) => {
          const run = status.last[kind];
          const age = runAge(run?.finishedAt, kind, nowMs);
          const failed = run && !run.ok;
          const detail = kind === "scrape" && run ? ` · ${run.summary.created ?? 0} new` : "";
          return (
            <span key={kind} className={age.stale || failed ? "stale" : ""} title={failed ? "The last run reported errors; see scraper/out/scrape.log" : age.stale ? "Overdue: check the launchd schedule (README, Automation)" : undefined}>
              {LABEL[kind]} {age.label}{detail}{failed ? " (errors)" : ""}
            </span>
          );
        })}
      </p>
      {status.reviews.length > 0 && (
        <section className="mail-reviews" aria-label="Replies to review">
          <h3>{status.reviews.length === 1 ? "1 reply needs you" : `${status.reviews.length} replies need you`}</h3>
          {status.reviews.map((review) => {
            const candidates = review.candidateIds.map((id) => byId.get(id)).filter((job): job is Job => Boolean(job));
            const next: JobStatus = review.kind === "interview" ? "interview" : "rejected";
            return (
              <div key={review.id} className="mail-review">
                <p>
                  <strong>{review.kind === "interview" ? "Interview reply" : "Rejection"}</strong>
                  {review.reason === "role_mismatch" ? " that names a different role than the one tracked" : " that matches more than one application"}
                  <br /><span className="mail-review-subject">{review.subject}</span> <small>{review.sender}</small>
                </p>
                <div className="mail-review-actions">
                  {candidates.map((job) => (
                    <button key={job.id} onClick={() => onResolve(review, job, next)} disabled={job.status === next}>
                      {job.status === next ? `${job.title} (already ${next})` : `Mark ${job.title} ${next}`}
                    </button>
                  ))}
                  <button className="ghost" onClick={() => onResolve(review, null, null)}>None of these</button>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}
