"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { benchmarkSalaries } from "../lib/salary.ts";
import { aggregateResumeGaps } from "../lib/gaps.ts";
import { analyzePipeline, byAppliedAt } from "../lib/pipeline.ts";
import { byFreshnessThenScore } from "../lib/freshness.ts";
import { sponsorshipRisk } from "../lib/eligibility.ts";
import { worthApplying } from "../lib/worth-applying.ts";
import { dueLabel } from "../lib/actions.ts";
import {
  activeFilterCount, DEFAULT_FILTERS, defaultSort, fromSearch, matchesFilters, toSearch,
  type AppsLayout, type Filters, type Scope, type SortKey, type View,
} from "../lib/job-filters.ts";
import ActionTracker from "./action-tracker";
import AgentStatus, { type RunStatus } from "./_components/agent-status.tsx";
import type { MailReview } from "../lib/agent-runs.ts";
import ApplicationsTable, { sortApplications, type TableSort } from "./_components/applications-table.tsx";
import { Sidebar, Toolbar } from "./_components/chrome.tsx";
import JobDetail from "./_components/job-detail.tsx";
import JobList, { visibleJobs, type GroupState, type JobGroup } from "./_components/job-list.tsx";
import { ImportModal, ProfileModal, ShortcutsModal } from "./_components/modals.tsx";
import { themeStore } from "./_components/theme.ts";
import { DISMISS_REASON, familyOf, formatBreakdown, patchJob, type Attachment, type Job, type JobStatus, type PendingAction } from "./_components/types.ts";

type Notice = { text: string; undo?: () => void };

const STAGE_LABELS: Record<string, string> = {
  ready: "Ready to apply · documents prepared",
  applied: "Applied",
  interview: "Interview",
  rejected: "Rejected",
};

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [urlReady, setUrlReady] = useState(false);
  const [lastVisit, setLastVisit] = useState("");
  const [dayAgo, setDayAgo] = useState("");
  const [nowMs, setNowMs] = useState(0);

  // Everything below round-trips through the URL (lib/job-filters.ts).
  const [view, setView] = useState<View>("inbox");
  const [scope, setScope] = useState<Scope>("worth");
  const [sortBy, setSortBy] = useState<SortKey>("fresh");
  const [layout, setLayout] = useState<AppsLayout>("table");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [groupState, setGroupState] = useState<GroupState>({ open: {}, shown: {} });
  const [tableSort, setTableSort] = useState<TableSort>({ column: "applied", dir: "desc" });
  const [advancedIds, setAdvancedIds] = useState<Set<string>>(new Set());
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [attachmentState, setAttachmentState] = useState<{ jobId: string; items: Attachment[] }>({ jobId: "", items: [] });
  const [modal, setModal] = useState<"" | "import" | "profile" | "shortcuts">("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.server);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastPushedView = useRef<View>("inbox");

  const say = useCallback((text: string, undo?: () => void) => setNotice({ text, undo }), []);

  const applyUrl = useCallback((search: string) => {
    const state = fromSearch(search);
    setView(state.view);
    setScope(state.scope);
    setSortBy(state.sort);
    setLayout(state.layout);
    setFilters(state.filters);
    setSelectedId(state.job);
    lastPushedView.current = state.view;
  }, []);

  useEffect(() => {
    let previousVisit = "";
    try {
      previousVisit = window.localStorage.getItem("jobagent:lastVisit") ?? "";
      window.localStorage.setItem("jobagent:lastVisit", new Date().toISOString());
    } catch {}
    fetch("/api/jobs")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { jobs: Job[]; warning?: string }) => {
        applyUrl(window.location.search);
        setUrlReady(true);
        setJobs(data.jobs);
        setLastVisit(previousVisit);
        setNowMs(Date.now());
        setDayAgo(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
        if (data.warning) setNotice({ text: data.warning });
      })
      .catch(() => setNotice({ text: "The job store could not be loaded." }))
      .finally(() => setLoadingJobs(false));

    // Scheduled scrapes land while the dashboard sits open; refresh quietly.
    const refresh = window.setInterval(() => {
      fetch("/api/jobs")
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data: { jobs: Job[] }) => setJobs(data.jobs))
        .catch(() => undefined);
    }, 5 * 60 * 1000);
    const onPop = () => applyUrl(window.location.search);
    window.addEventListener("popstate", onPop);
    return () => {
      window.clearInterval(refresh);
      window.removeEventListener("popstate", onPop);
    };
  }, [applyUrl]);

  // Keep the URL in step: a view change is a new history entry (Back returns
  // to it); filters, sort, and selection just replace the current one.
  useEffect(() => {
    if (!urlReady) return;
    const search = toSearch({ view, scope, sort: sortBy, job: selectedId, layout, filters });
    if (search === window.location.search) return;
    const url = `${window.location.pathname}${search}`;
    if (view !== lastPushedView.current) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    lastPushedView.current = view;
  }, [urlReady, view, scope, sortBy, selectedId, layout, filters]);

  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const loadRuns = useCallback(() => {
    fetch("/api/runs")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: RunStatus) => setRunStatus(d))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    loadRuns();
    const timer = window.setInterval(loadRuns, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [loadRuns]);

  const loadActions = useCallback(() => {
    fetch("/api/actions")
      .then((r) => (r.ok ? r.json() : { actions: [] }))
      .then((d: { actions?: Array<{ id: string; jobId?: string; kind: string; dueDate?: string; title?: string; completed?: boolean }> }) => {
        const actions = d.actions ?? [];
        // Assessment/interview actions mean the application advanced past the
        // resume screen, even while its status is still "applied".
        setAdvancedIds(new Set(actions.filter((a) => a.jobId && (a.kind === "Assessment" || a.kind === "Interview")).map((a) => a.jobId!)));
        setPendingActions(actions.filter((a) => !a.completed).map((a) => ({ id: a.id, jobId: a.jobId ?? "", dueDate: a.dueDate ?? "", title: a.title ?? "", kind: a.kind })));
      })
      .catch(() => undefined);
  }, []);
  useEffect(loadActions, [loadActions, view]);

  const worthJobs = useMemo(() => (nowMs ? jobs.filter((job) => worthApplying(job, nowMs)) : []), [jobs, nowMs]);

  const filteredJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (view === "applications" && !["ready", "applied", "interview", "rejected"].includes(job.status)) return false;
        if (view === "documents" && !job.tailoredPath) return false;
        if (view === "inbox" && scope === "worth" && nowMs && !worthApplying(job, nowMs)) return false;
        return matchesFilters(job, filters, dayAgo);
      }),
    [jobs, view, scope, nowMs, filters, dayAgo],
  );

  const groupedJobs = useMemo<JobGroup[]>(() => {
    const byScore = (a: Job, b: Job) => b.score - a.score || (b.fetchedAt > a.fetchedAt ? 1 : -1);
    const byNewest = (a: Job, b: Job) => (b.fetchedAt > a.fetchedAt ? 1 : -1);
    // nowMs is 0 until mount; until then freshness is unknowable, so rank by score.
    const comparator =
      sortBy === "appliedNewest" ? byAppliedAt<Job>("newest")
      : sortBy === "appliedOldest" ? byAppliedAt<Job>("oldest")
      : sortBy === "newest" ? byNewest
      : sortBy === "fresh" && nowMs ? byFreshnessThenScore<Job>(nowMs)
      : byScore;
    if (view === "applications") {
      // Sorting by date applied reads as one timeline of everything sent,
      // whatever its outcome; Ready jobs (not yet sent) stay on top.
      if (sortBy === "appliedNewest" || sortBy === "appliedOldest") {
        const ready = filteredJobs.filter((job) => job.status === "ready").sort(byScore);
        const sent = filteredJobs.filter((job) => job.status !== "ready").sort(comparator);
        return [
          ...(ready.length ? [{ family: STAGE_LABELS.ready, jobs: ready }] : []),
          ...(sent.length ? [{ family: `Sent, ${sortBy === "appliedNewest" ? "newest" : "oldest"} first`, jobs: sent }] : []),
        ];
      }
      return Object.entries(STAGE_LABELS)
        .map(([status, label]) => ({ family: label, jobs: filteredJobs.filter((job) => job.status === status).sort(comparator) }))
        .filter((group) => group.jobs.length);
    }
    const groups = new Map<string, Job[]>();
    for (const job of filteredJobs) {
      const family = familyOf(job);
      if (!groups.has(family)) groups.set(family, []);
      groups.get(family)!.push(job);
    }
    for (const list of groups.values()) list.sort(comparator);
    // Groups are ranked by their best job, so the strongest family leads.
    return [...groups.keys()]
      .sort((a, b) => {
        const [topA, topB] = [groups.get(a)![0], groups.get(b)![0]];
        return sortBy === "newest" ? (topB.fetchedAt > topA.fetchedAt ? 1 : -1) : comparator(topA, topB);
      })
      .map((family) => ({ family, jobs: groups.get(family)! }));
  }, [filteredJobs, sortBy, view, nowMs]);

  const tableMode = view === "applications" && layout === "table";
  const tableRows = useMemo(() => (tableMode ? sortApplications(filteredJobs, tableSort, nowMs) : []), [tableMode, filteredJobs, tableSort, nowMs]);
  // What j/k step through: exactly the rows on screen, in on-screen order.
  const navigable = useMemo(() => (tableMode ? tableRows : visibleJobs(groupedJobs, view, groupState)), [tableMode, tableRows, groupedJobs, view, groupState]);

  // An explicit click wins (so a job stays open after its status changes);
  // otherwise show the first job actually on screen.
  const activeJob = (selectedId && jobs.find((job) => job.id === selectedId)) || navigable[0];
  const activeId = activeJob?.id;

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    fetch(`/api/documents?job=${activeId}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { documents: Attachment[] }) => {
        if (!cancelled) setAttachmentState({ jobId: activeId, items: data.documents });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const salaryBenchmarks = useMemo(() => benchmarkSalaries(jobs), [jobs]);
  const gapInsights = useMemo(() => aggregateResumeGaps(jobs), [jobs]);
  const pipeline = useMemo(() => analyzePipeline(jobs, { advancedIds, nowMs: nowMs || undefined }), [jobs, advancedIds, nowMs]);
  const pendingByJob = useMemo(() => {
    const map = new Map<string, PendingAction[]>();
    for (const action of pendingActions) map.set(action.jobId, [...(map.get(action.jobId) ?? []), action]);
    return map;
  }, [pendingActions]);
  const families = useMemo(() => [...new Set(jobs.map(familyOf))].sort(), [jobs]);

  const todayIso = nowMs ? new Date(nowMs - new Date(nowMs).getTimezoneOffset() * 60_000).toISOString().slice(0, 10) : "";
  const nextAction = [...pendingActions].sort((a, b) => ((a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1))[0];
  const newWorthCount = dayAgo ? worthJobs.filter((job) => job.firstSeenAt && job.firstSeenAt > dayAgo).length : 0;
  const count = (status: JobStatus) => jobs.filter((job) => job.status === status).length;
  const viewTitle = view === "applications" ? "Applications" : view === "documents" ? "Tailored documents" : scope === "worth" ? "Worth applying" : "All jobs";

  const patchFilters = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  function goTo(next: View, options: { scope?: Scope; status?: "all" | JobStatus; newOnly?: boolean } = {}) {
    setView(next);
    patchFilters({ status: options.status ?? "all", newOnly: options.newOnly ?? false });
    if (options.scope) setScope(options.scope);
    // Each view opens in the order it is read in.
    if (next !== view) setSortBy(defaultSort(next));
    setSelectedId("");
  }

  const updateLocal = (id: string, patch: Partial<Job>) => setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));

  async function changeStatus(job: Job, status: JobStatus) {
    if (status === job.status) return;
    const risk = status === "ready" ? sponsorshipRisk(job.sponsorship, job.sponsorshipNote) : null;
    if (risk && !window.confirm(`${risk.message}\n\nMark "${job.title}" ready to apply anyway?`)) return;
    const previous = job.status;
    updateLocal(job.id, { status });
    if (!(await patchJob({ id: job.id, status }))) {
      updateLocal(job.id, { status: previous });
      say(`Could not save the status for ${job.title}. Nothing changed.`);
    }
  }

  async function resolveReview(review: MailReview, job: Job | null, status: JobStatus | null) {
    if (job && status) await changeStatus(job, status);
    setRunStatus((current) => (current ? { ...current, reviews: current.reviews.filter((r) => r.id !== review.id) } : current));
    const ok = await fetch("/api/runs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewId: review.id, resolution: job ? `${status}:${job.id}` : "dismissed" }) })
      .then((r) => r.ok)
      .catch(() => false);
    if (!ok) { say("Could not save that review. It will show again on reload."); loadRuns(); }
  }

  // After hiding a job, the next row is opened so triage keeps flowing.
  function neighbourOf(id: string) {
    const index = navigable.findIndex((job) => job.id === id);
    return navigable[index + 1] ?? navigable[index - 1];
  }

  async function dismiss(job: Job) {
    const next = neighbourOf(job.id);
    updateLocal(job.id, { screenedOut: DISMISS_REASON });
    if (selectedId === job.id || !selectedId) setSelectedId(next?.id ?? "");
    if (!(await patchJob({ id: job.id, screenedOut: DISMISS_REASON }))) {
      updateLocal(job.id, { screenedOut: job.screenedOut });
      return say(`Could not hide ${job.title}. Nothing changed.`);
    }
    say(`Hidden: ${job.title} at ${job.company}.`, () => restore(job, true));
  }

  async function restore(job: Job, reselect = false) {
    updateLocal(job.id, { screenedOut: undefined });
    if (reselect) setSelectedId(job.id);
    if (!(await patchJob({ id: job.id, screenedOut: null }))) {
      updateLocal(job.id, { screenedOut: job.screenedOut ?? DISMISS_REASON });
      return say(`Could not restore ${job.title}.`);
    }
    say(`Restored ${job.title}.`);
  }

  async function removeJob(job: Job) {
    if (!window.confirm(`Delete "${job.title}" at ${job.company} from the database? Use "Not interested" to just hide it.`)) return;
    setJobs((current) => current.filter((item) => item.id !== job.id));
    setSelectedId("");
    await fetch("/api/jobs", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: job.id }) }).catch(() => undefined);
  }

  function select(id: string) {
    setSelectedId(id);
    window.requestAnimationFrame(() => document.querySelector(`[data-job-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  // Keyboard triage. Ignored while typing or with modifier keys held.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)));
      if (event.key === "Escape") {
        if (modal) setModal("");
        else if (typing) target?.blur();
        else if (selectedId) setSelectedId("");
        return;
      }
      if (typing || modal) return;
      const index = activeId ? navigable.findIndex((job) => job.id === activeId) : -1;
      const job = activeJob;
      switch (event.key) {
        case "j":
        case "k": {
          const step = event.key === "j" ? 1 : -1;
          const next = navigable[index < 0 ? 0 : Math.min(navigable.length - 1, Math.max(0, index + step))];
          if (next) select(next.id);
          break;
        }
        case "/":
          event.preventDefault();
          searchRef.current?.focus();
          break;
        case "?":
          setModal("shortcuts");
          break;
        case "s":
          if (!job) break;
          if (job.status === "new") void changeStatus(job, "shortlisted");
          else if (job.status === "shortlisted") void changeStatus(job, "new");
          else say(`${job.title} is already ${job.status}; shortlisting is for new matches.`);
          break;
        case "x":
          if (job && !job.screenedOut) void dismiss(job);
          break;
        case "r":
          if (job) void changeStatus(job, "ready");
          break;
        case "o":
          if (job?.sourceUrl) window.open(job.sourceUrl, "_blank", "noopener,noreferrer");
          break;
        default:
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const emptyState = (
    <div className="empty-state">
      <strong>{loadingJobs ? "Checking your job store…" : jobs.length ? "No jobs match this view" : "No real postings yet"}</strong>
      <span>{loadingJobs ? "" : jobs.length ? "Try another filter." : "Import an employer or ATS URL, or run `pnpm scrape`. Synthetic jobs will never appear here."}</span>
      {!loadingJobs && jobs.length > 0 && (activeFilterCount(filters) > 0 || filters.query || (view === "inbox" && scope === "worth")) && (
        <button className="secondary-button" onClick={() => { clearFilters(); if (view === "inbox") setScope("all"); }}>Show all jobs</button>
      )}
    </div>
  );

  return (
    <main className="app-shell">
      <Sidebar
        view={view}
        status={filters.status}
        family={filters.family}
        counts={{ inbox: scope === "worth" ? worthJobs.length : jobs.length, applications: jobs.filter((job) => ["ready", "applied", "interview", "rejected"].includes(job.status)).length, ready: count("ready"), applied: count("applied"), interview: count("interview"), documents: jobs.filter((job) => job.tailoredPath).length }}
        onGo={(next, status) => goTo(next, { status })}
        onFamily={(family) => patchFilters({ family })}
        onProfile={() => setModal("profile")}
      />

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{nowMs ? new Date(nowMs).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase() : " "}</p>
            <h1>{viewTitle}</h1>
          </div>
          <div className="top-actions">
            <button className="theme-toggle" onClick={() => themeStore.set(theme === "system" ? "light" : theme === "light" ? "dark" : "system")} title="Theme: follows your system until you pick one" aria-label={`Theme: ${theme}. Click to change.`}>
              {theme === "dark" ? "☾ Dark" : theme === "light" ? "☀ Light" : "◐ Auto"}
            </button>
            <button className="secondary-button" onClick={() => setModal("profile")}>Role fit</button>
            <button className="primary-button" onClick={() => setModal("import")}>＋ Import a job</button>
          </div>
        </header>

        {notice && (
          <div className="notice" role="status">
            <span>{notice.text}</span>
            <span className="notice-actions">
              {notice.undo && <button className="notice-undo" onClick={() => { notice.undo?.(); setNotice(null); }}>Undo</button>}
              <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
            </span>
          </div>
        )}

        <AgentStatus status={runStatus} nowMs={nowMs} jobs={jobs} onResolve={resolveReview} />

        <nav className="today-strip" aria-label="Shortcuts">
          <button className={`today-stat ${view === "inbox" && scope === "worth" && !filters.newOnly ? "active" : ""}`} onClick={() => goTo("inbox", { scope: "worth" })}>
            <strong>{worthJobs.length}</strong><span>Worth applying</span>
          </button>
          <button className={`today-stat ${view === "inbox" && filters.newOnly ? "active" : ""}`} onClick={() => goTo("inbox", { scope: "worth", newOnly: true })}>
            <strong>{newWorthCount}</strong><span>New in last 24h</span>
          </button>
          <button className={`today-stat ${view === "applications" && filters.status === "ready" ? "active" : ""}`} onClick={() => goTo("applications", { status: "ready" })}>
            <strong>{count("ready")}</strong><span>Ready to apply</span>
          </button>
          <button className={`today-stat ${view === "applications" && filters.status === "applied" ? "active" : ""}`} onClick={() => goTo("applications", { status: "applied" })}>
            <strong>{count("applied")}</strong><span>Awaiting a reply</span>
          </button>
          <button className={`today-stat ${nextAction && todayIso && nextAction.dueDate && nextAction.dueDate <= todayIso ? "urgent" : ""} ${view === "applications" && filters.status === "all" ? "active" : ""}`} onClick={() => goTo("applications")}>
            <strong>{pendingActions.length}</strong>
            <span title={nextAction?.title}>{nextAction ? `Next: ${todayIso ? dueLabel(nextAction.dueDate, todayIso) : ""}` : "No pending actions"}</span>
          </button>
        </nav>

        <section className="inbox-panel">
          <Toolbar
            view={view}
            scope={scope}
            onScope={(next) => { setScope(next); setSelectedId(""); }}
            worthCount={worthJobs.length}
            allCount={jobs.length}
            filters={filters}
            onFilters={patchFilters}
            onClear={clearFilters}
            sort={sortBy}
            onSort={setSortBy}
            layout={layout}
            onLayout={setLayout}
            drawerOpen={drawerOpen}
            onDrawer={setDrawerOpen}
            families={families}
            shown={filteredJobs.length}
            searchRef={searchRef}
            onShortcuts={() => setModal("shortcuts")}
          />

          {view === "applications" && pipeline.total > 0 && (
            <div className="pipeline-strip">
              <div><strong>{pipeline.total}</strong><small>applications</small></div>
              <div><strong>{pipeline.awaiting}</strong><small>awaiting response</small></div>
              <div><strong>{pipeline.interviews}</strong><small>interviews</small></div>
              <div><strong>{pipeline.rejected}</strong><small>rejected</small></div>
              <div><strong>{pipeline.responseRate}%</strong><small>response rate</small></div>
              <div><strong>{pipeline.avgDaysToResponse ?? "–"}</strong><small>avg days to response</small></div>
              {pipeline.mature > 0 && (
                <details className="pipeline-details">
                  <summary>Breakdowns · {pipeline.advanced} advanced (assessment or interview)</summary>
                  <p>
                    By role family: {pipeline.byFamily.map((f) => `${f.family} ${f.total}${f.interviews ? ` (${f.interviews} int.)` : ""}`).join(" · ")}
                    {pipeline.byScoreBand.length > 1 && <> &nbsp;|&nbsp; score {pipeline.byScoreBand.map((b) => `${b.band}: ${b.total}`).join(" · ")}</>}
                    <br />Outcomes for the {pipeline.mature} applications sent 14+ days ago, as sent / advanced / rejected:
                    <br />posting age at apply {formatBreakdown(pipeline.byPostingAge)} &nbsp;|&nbsp; sponsorship {formatBreakdown(pipeline.bySponsorship)} &nbsp;|&nbsp; source {formatBreakdown(pipeline.bySource)}
                  </p>
                </details>
              )}
            </div>
          )}
          {view === "applications" && <ActionTracker jobs={jobs} onChange={loadActions} />}

          <div className="inbox-grid">
            {tableMode ? (
              <ApplicationsTable rows={tableRows} sort={tableSort} onSort={setTableSort} activeId={activeId} onSelect={select} nowMs={nowMs} today={todayIso} pendingByJob={pendingByJob} empty={emptyState} />
            ) : (
              <JobList groups={groupedJobs} view={view} showApplied={view === "applications" || sortBy === "appliedNewest" || sortBy === "appliedOldest"} activeId={activeId} nowMs={nowMs} lastVisit={lastVisit} state={groupState} onState={setGroupState} onSelect={select} empty={emptyState} />
            )}
            {activeJob && (
              <JobDetail
                key={activeJob.id}
                job={activeJob}
                attachments={attachmentState.jobId === activeJob.id ? attachmentState.items : []}
                benchmarks={salaryBenchmarks}
                actions={pendingByJob.get(activeJob.id) ?? []}
                today={todayIso}
                onStatus={(status) => changeStatus(activeJob, status)}
                onDismiss={() => dismiss(activeJob)}
                onRestore={() => restore(activeJob)}
                onRemove={() => removeJob(activeJob)}
                onSaved={(saved, message) => { setJobs((current) => current.map((job) => (job.id === saved.id ? { ...job, ...saved } : job))); say(message); }}
                onNotice={say}
                onActionAdded={loadActions}
                onBack={() => setSelectedId("")}
                sheetOpen={Boolean(selectedId)}
              />
            )}
          </div>
        </section>
      </section>

      {modal === "import" && (
        <ImportModal
          onClose={() => setModal("")}
          onImported={(job, message) => {
            setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
            setSelectedId(job.id);
            setModal("");
            say(message);
          }}
        />
      )}
      {modal === "profile" && <ProfileModal onClose={() => setModal("")} benchmarks={salaryBenchmarks} gaps={gapInsights} />}
      {modal === "shortcuts" && <ShortcutsModal onClose={() => setModal("")} />}
    </main>
  );
}
