"use client";

import { daysWaiting, FOLLOW_UP_DAYS, followUpDue } from "../../lib/pipeline.ts";
import { dueLabel } from "../../lib/actions.ts";
import { scoreTone, statusLabel, type Job, type PendingAction } from "./types.ts";

export type TableSort = { column: "applied" | "company" | "status" | "waiting" | "score"; dir: "asc" | "desc" };

const STATUS_ORDER: Record<string, number> = { ready: 0, interview: 1, applied: 2, rejected: 3 };

/** Ready jobs (not sent yet) stay pinned on top; everything else follows the chosen column. */
export function sortApplications(jobs: Job[], sort: TableSort, nowMs: number): Job[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const value = (job: Job): number | string => {
    switch (sort.column) {
      case "company": return job.company.toLowerCase();
      case "status": return STATUS_ORDER[job.status] ?? 9;
      case "waiting": return daysWaiting(job, nowMs) ?? -1;
      case "score": return job.score;
      default: return job.appliedAt ? Date.parse(job.appliedAt) : -Infinity;
    }
  };
  const compare = (a: Job, b: Job) => {
    const [va, vb] = [value(a), value(b)];
    return (va < vb ? -1 : va > vb ? 1 : 0) * sign || a.company.localeCompare(b.company);
  };
  const ready = jobs.filter((job) => job.status === "ready").sort((a, b) => b.score - a.score);
  return [...ready, ...jobs.filter((job) => job.status !== "ready").sort(compare)];
}

type Props = {
  rows: Job[];
  sort: TableSort;
  onSort: (sort: TableSort) => void;
  activeId?: string;
  onSelect: (id: string) => void;
  nowMs: number;
  today: string;
  pendingByJob: Map<string, PendingAction[]>;
  empty: React.ReactNode;
};

const COLUMNS: Array<{ key: TableSort["column"]; label: string; first: TableSort["dir"] }> = [
  { key: "company", label: "Application", first: "asc" },
  { key: "status", label: "Status", first: "asc" },
  { key: "applied", label: "Applied", first: "desc" },
  { key: "waiting", label: "Waiting", first: "desc" },
];

export default function ApplicationsTable({ rows, sort, onSort, activeId, onSelect, nowMs, today, pendingByJob, empty }: Props) {
  if (!rows.length) return <div className="job-list">{empty}</div>;
  const pendingIds = new Set(pendingByJob.keys());
  return (
    <div className="job-list apps-table-wrap">
      <table className="apps-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key} aria-sort={sort.column === column.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                <button onClick={() => onSort({ column: column.key, dir: sort.column === column.key ? (sort.dir === "asc" ? "desc" : "asc") : column.first })}>
                  {column.label}{sort.column === column.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
            ))}
            <th>Next step</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((job) => {
            const waiting = daysWaiting(job, nowMs);
            const next = (pendingByJob.get(job.id) ?? []).slice().sort((a, b) => ((a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1))[0];
            const nudge = followUpDue(job, nowMs, pendingIds);
            return (
              <tr key={job.id} className={job.id === activeId ? "selected" : ""} onClick={() => onSelect(job.id)} data-job-id={job.id}>
                <td>
                  <button className="row-link" onClick={(event) => { event.stopPropagation(); onSelect(job.id); }}>
                    <strong>{job.company}</strong>
                    <span>{job.title}</span>
                  </button>
                </td>
                <td><i className={`status status-${job.status}`}>{statusLabel[job.status]}</i></td>
                <td className="nowrap">{job.appliedAt ? new Date(job.appliedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Not sent"}</td>
                <td className="nowrap">{waiting === null ? "" : `${waiting}d`}</td>
                <td>
                  {next ? (
                    <span className={`next-cell ${next.dueDate && today && next.dueDate <= today ? "is-urgent" : ""}`}>{next.kind}: {today ? dueLabel(next.dueDate, today) : ""}</span>
                  ) : nudge ? (
                    <span className="next-cell nudge" title={`No reply in ${FOLLOW_UP_DAYS}+ days and nothing planned`}>Follow up?</span>
                  ) : job.status === "ready" ? (
                    <span className="next-cell">Submit</span>
                  ) : null}
                  <b className={`score score-mini ${scoreTone(job.score)}`}>{job.score}%</b>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
