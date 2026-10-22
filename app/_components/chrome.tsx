"use client";

// Sidebar and the list toolbar (search, sort, filters drawer).

import type { RefObject } from "react";
import { activeFilterCount, type AppsLayout, type Filters, type Scope, type SortKey, type View } from "../../lib/job-filters.ts";
import type { JobStatus } from "./types.ts";
import { needsOnboarding, PROFILE } from "../../lib/profile.ts";
import { worthApplyingSummary } from "../../lib/worth-applying.ts";

const DOTS = ["purple", "green", "blue", "amber"];
const FAMILY_LINKS: Array<[string, string, string]> = PROFILE.roleFamilies.map((family, index) => [family.name, family.label || family.name, family.color || DOTS[index % DOTS.length]]);

type SidebarProps = {
  view: View;
  status: string;
  family: string;
  counts: { inbox: number; applications: number; ready: number; applied: number; interview: number; documents: number };
  onGo: (view: View, status?: "all" | JobStatus) => void;
  onFamily: (family: string) => void;
  onProfile: () => void;
};

export function Sidebar({ view, status, family, counts, onGo, onFamily, onProfile }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand" aria-label="Job Agent home">
        <span className="brand-mark">J</span>
        <span>Job Agent</span>
      </div>
      <nav className="primary-nav" aria-label="Primary navigation">
        <button className={`nav-item ${view === "inbox" ? "active" : ""}`} onClick={() => onGo("inbox")}><span>⌕</span> Job inbox <em>{counts.inbox}</em></button>
        <button className={`nav-item ${view === "applications" && !["ready", "applied", "interview"].includes(status) ? "active" : ""}`} onClick={() => onGo("applications")}><span>✓</span> Applications <em>{counts.applications}</em></button>
        {([["ready", "Ready to apply", counts.ready], ["applied", "Applied", counts.applied], ["interview", "Interview", counts.interview]] as const).map(([key, label, count]) => (
          <button key={key} className={`nav-item nav-subitem ${view === "applications" && status === key ? "active" : ""}`} onClick={() => onGo("applications", key)}>{label} <em>{count}</em></button>
        ))}
        <button className={`nav-item ${view === "documents" ? "active" : ""}`} onClick={() => onGo("documents")}><span>◫</span> Documents <em>{counts.documents}</em></button>
      </nav>
      <div className="sidebar-section">
        <p>ROLE FAMILIES</p>
        {FAMILY_LINKS.map(([value, label, dot]) => (
          <button key={value} className={`profile-link ${family === value ? "active" : ""}`} onClick={() => onFamily(family === value ? "all" : value)}><i className={`profile-dot ${dot}`} /> {label}</button>
        ))}
        <button className="profile-link muted" onClick={() => onFamily("all")}>⟲ All role families</button>
      </div>
      <button className="profile-card" onClick={onProfile}>
        <span className="avatar">{PROFILE.initials}</span>
        <span><strong>{PROFILE.displayName ? `${PROFILE.displayName.split(/\s+/)[0]}'s profile` : "Set up your profile"}</strong><small>{needsOnboarding() ? "Run /onboard in Claude Code" : "Resume stored · live fit scores"}</small></span>
        <b>›</b>
      </button>
    </aside>
  );
}

type ToolbarProps = {
  view: View;
  scope: Scope;
  onScope: (scope: Scope) => void;
  worthCount: number;
  allCount: number;
  filters: Filters;
  onFilters: (patch: Partial<Filters>) => void;
  onClear: () => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  layout: AppsLayout;
  onLayout: (layout: AppsLayout) => void;
  drawerOpen: boolean;
  onDrawer: (open: boolean) => void;
  families: string[];
  shown: number;
  searchRef: RefObject<HTMLInputElement | null>;
  onShortcuts: () => void;
};

export function Toolbar({ searchRef, ...props }: ToolbarProps) {
  const { view, scope, filters: f, onFilters, sort } = props;
  const active = activeFilterCount(f);
  const pick = (key: keyof Filters) => (event: React.ChangeEvent<HTMLSelectElement>) => onFilters({ [key]: event.target.value } as Partial<Filters>);
  const tableMode = view === "applications" && props.layout === "table";
  return (
    <>
      <div className="panel-toolbar">
        {view === "inbox" && (
          <div className="scope-toggle" role="group" aria-label="Which jobs to show">
            <button className={scope === "worth" ? "active" : ""} onClick={() => props.onScope("worth")} title={worthApplyingSummary()}>Worth applying<em>{props.worthCount}</em></button>
            <button className={scope === "all" ? "active" : ""} onClick={() => props.onScope("all")}>All jobs<em>{props.allCount}</em></button>
          </div>
        )}
        {view === "applications" && (
          <div className="scope-toggle" role="group" aria-label="Layout">
            <button className={props.layout === "table" ? "active" : ""} onClick={() => props.onLayout("table")}>Table</button>
            <button className={props.layout === "list" ? "active" : ""} onClick={() => props.onLayout("list")}>Cards</button>
          </div>
        )}
        <label className="search-box"><span>⌕</span><input ref={searchRef} value={f.query} onChange={(event) => onFilters({ query: event.target.value })} placeholder="Search title, company, skill  ( / )" aria-label="Search jobs" /></label>
        {!tableMode && (
          <select aria-label="Sort jobs" value={sort} onChange={(event) => props.onSort(event.target.value as SortKey)}>
            <option value="fresh">Freshest strong matches</option>
            <option value="score">Highest score first</option>
            <option value="newest">Newest first</option>
            <option value="appliedNewest">Applied: newest first</option>
            <option value="appliedOldest">Applied: oldest first</option>
          </select>
        )}
        <button className={`filters-button ${active ? "has-active" : ""}`} aria-expanded={props.drawerOpen} onClick={() => props.onDrawer(!props.drawerOpen)}>
          More filters{active > 0 && <em>{active}</em>}
        </button>
        {(active > 0 || f.query) && <button className="clear-button" onClick={props.onClear}>Clear</button>}
        <span className="toolbar-count">{props.shown} shown</span>
        <button className="kbd-hint" onClick={props.onShortcuts} title="Keyboard shortcuts" aria-label="Keyboard shortcuts">?</button>
      </div>
      {props.drawerOpen && (
        <div className="filter-drawer">
          <select aria-label="Filter by status" value={f.status} onChange={pick("status")}>
            <option value="all">Any status</option>
            <option value="new">New matches</option>
            <option value="shortlisted">Shortlisted</option>
            <option value="ready">Ready</option>
            <option value="applied">Applied</option>
            <option value="interview">Interview</option>
            <option value="rejected">Rejected</option>
          </select>
          <select aria-label="Filter by role family" value={f.family} onChange={pick("family")}>
            <option value="all">Any role family</option>
            {props.families.map((family) => <option key={family} value={family}>{family}</option>)}
          </select>
          <select aria-label="Filter by work mode" value={f.workMode} onChange={pick("workMode")}>
            <option value="all">Any work mode</option>
            <option value="Remote">Remote</option>
            <option value="Hybrid">Hybrid</option>
            <option value="Onsite">Onsite</option>
            <option value="Unknown">Unspecified</option>
          </select>
          <select aria-label="Filter by location" value={f.location} onChange={pick("location")}>
            <option value="all">All locations</option>
            {PROFILE.places.length > 0 && <option value="target">{PROFILE.places.map((place) => place.label).join(" / ")}{PROFILE.remoteOk ? " or Remote" : ""}</option>}
            {PROFILE.places.map((place, index) => <option key={place.label} value={`place:${index}`}>{place.label}</option>)}
            <option value="remote">Remote</option>
          </select>
          <select aria-label="Filter by job type" value={f.jobType} onChange={pick("jobType")}>
            <option value="all">Any job type</option>
            <option value="fulltime">Full-time</option>
            <option value="parttime">Part-time</option>
            <option value="internship">Internship</option>
            <option value="contract">Contract</option>
            <option value="unset">Unspecified</option>
          </select>
          <select aria-label="Filter by experience level" value={f.experience} onChange={pick("experience")}>
            <option value="all">Any experience</option>
            <option value="entry">Entry level</option>
            <option value="mid">Mid level</option>
            <option value="senior">Senior (3+ yrs)</option>
            <option value="unknown">Unspecified</option>
          </select>
          <select aria-label="Filter by source kind" value={f.source} onChange={pick("source")}>
            <option value="all">Any source</option>
            <option value="official_ats">Company ATS</option>
            <option value="aggregator">Job boards</option>
            <option value="webpage">Web pages</option>
            <option value="pasted_text">Pasted text</option>
          </select>
          <select aria-label="Filter by sponsorship" value={f.sponsorship} onChange={pick("sponsorship")}>
            <option value="all">Any sponsorship</option>
            <option value="friendly">Sponsor-friendly</option>
            <option value="offered">Sponsors (stated)</option>
            <option value="likely">Sponsor history</option>
            <option value="not_offered">No sponsorship</option>
            <option value="unknown">Unstated</option>
          </select>
          <select aria-label="Filter by company kind" value={f.companyTag} onChange={pick("companyTag")}>
            <option value="all">All companies</option>
            <option value="startup">Startups only</option>
            <option value="fortune500">Fortune 500 only</option>
          </select>
          <label className="check-filter"><input type="checkbox" checked={f.salaryOnly} onChange={(event) => onFilters({ salaryOnly: event.target.checked })} /> Salary listed</label>
          <label className="check-filter"><input type="checkbox" checked={f.newOnly} onChange={(event) => onFilters({ newOnly: event.target.checked })} /> Found in last 24h</label>
          <label className="score-filter" aria-label="Minimum score">
            <span>Score ≥ {f.minScore || "any"}</span>
            <input type="range" min={0} max={95} step={5} value={f.minScore} onChange={(event) => onFilters({ minScore: Number(event.target.value) })} />
          </label>
        </div>
      )}
    </>
  );
}
