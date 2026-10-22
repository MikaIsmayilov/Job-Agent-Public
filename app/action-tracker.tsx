"use client";
import { useEffect, useState, type FormEvent } from "react";
import { actionKinds, dueLabel, type ApplicationAction } from "../lib/actions.ts";
type Job = { id: string; company: string; title: string; status: string };
const blank = { jobId: "", title: "", kind: "Assessment", dueDate: "", url: "", notes: "" };
export default function ActionTracker({ jobs, onChange }: { jobs: Job[]; onChange?: () => void }) {
  const [actions, setActions] = useState<ApplicationAction[]>([]), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [form, setForm] = useState(false);
  const [editing, setEditing] = useState<string | undefined>(), [draft, setDraft] = useState(blank), [history, setHistory] = useState(false);
  const [today, setToday] = useState("");
  useEffect(() => {
    const tick = () => { const d = new Date(); setToday(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`); };
    tick(); const timer = setInterval(tick, 60000); return () => clearInterval(timer);
  }, []);
  async function load() { try { const r = await fetch("/api/actions"); const d = await r.json(); if (!r.ok) throw new Error(d.error); setActions(d.actions); setLoaded(true); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not load actions."); } }
  useEffect(() => {
    let cancelled = false;
    fetch("/api/actions").then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then(d => { if (!cancelled) { setActions(d.actions); setLoaded(true); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load actions."); });
    return () => { cancelled = true; };
  }, []);
  async function save(body: object, method: string) {
    setBusy(true); setError("");
    try { const r = await fetch("/api/actions", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setActions(d.actions); onChange?.(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save action."); return false; } finally { setBusy(false); }
  }
  async function submit(e: FormEvent) { e.preventDefault(); if (await save({ ...draft, id: editing }, editing ? "PATCH" : "POST")) { setForm(false); setDraft(blank); setEditing(undefined); } }
  const pending = actions.filter(a => !a.completed), completed = actions.filter(a => a.completed);
  const assessmentCount = pending.filter(a => a.kind === "Assessment").length;
  const overdue = pending.filter(a => a.dueDate && today && a.dueDate < today).length;
  const dueToday = pending.filter(a => a.dueDate && a.dueDate === today).length;
  const options = jobs.filter(j => ["applied", "interview", "ready"].includes(j.status) || j.id === draft.jobId).sort((a,b) => a.company.localeCompare(b.company));
  // Nothing pending: one line instead of a full panel.
  if (loaded && !pending.length && !form && !history && !error) return <section className="action-tracker compact" aria-labelledby="action-heading">
    <p className="action-compact"><strong id="action-heading">No pending actions.</strong> <span>Add assessments, interviews, and follow-ups from a job&apos;s panel or here.</span>
      <button onClick={() => { setDraft(blank); setEditing(undefined); setForm(true); }}>+ Add action</button>
      {completed.length > 0 && <button onClick={() => setHistory(true)}>Completed ({completed.length})</button>}</p>
  </section>;
  return <section className="action-tracker" aria-labelledby="action-heading">
    <header className="action-header"><div><h2 id="action-heading">Your next moves <span>{loaded ? pending.length : "…"}</span></h2><p>Assessments, interviews, and follow-ups that need your attention.</p></div><button className="action-primary" disabled={busy || !loaded} onClick={() => { setDraft(blank); setEditing(undefined); setForm(true); }}>+ Add action</button></header>
    {error && <div className="action-error" role="alert">{error} {!loaded && <button onClick={load}>Retry</button>}</div>}
    {loaded && <div className="action-summary"><strong>{assessmentCount} pending assessment{assessmentCount === 1 ? "" : "s"}</strong><span className={overdue ? "action-overdue" : ""}>{overdue} overdue</span><span>{dueToday} due today</span><button aria-expanded={history} onClick={() => setHistory(!history)}>{history ? "Show pending" : `Completed (${completed.length})`}</button></div>}
    {form && <form className="action-form" onSubmit={submit}>
      <h3>{editing ? "Edit action" : "Add an action"}</h3>
      <label>Application<select required value={draft.jobId} onChange={e => setDraft({...draft, jobId:e.target.value})}><option value="">Choose an application</option>{options.map(j => <option key={j.id} value={j.id}>{j.company} · {j.title}</option>)}</select></label>
      <label>Type<select value={draft.kind} onChange={e => setDraft({...draft, kind:e.target.value})}>{actionKinds.map(k => <option key={k}>{k}</option>)}</select></label>
      <label>What needs doing?<input autoFocus required maxLength={200} placeholder="Complete the online assessment" value={draft.title} onChange={e => setDraft({...draft,title:e.target.value})}/></label>
      <label>Deadline (optional)<input type="date" value={draft.dueDate} onChange={e => setDraft({...draft,dueDate:e.target.value})}/></label>
      <label>Link (optional)<input type="url" maxLength={2000} placeholder="https://" value={draft.url} onChange={e => setDraft({...draft,url:e.target.value})}/></label>
      <label>Notes (optional)<textarea maxLength={4000} rows={2} value={draft.notes} onChange={e => setDraft({...draft,notes:e.target.value})}/></label>
      <div className="action-form-buttons"><button type="submit" className="action-primary" disabled={busy}>{busy ? "Saving…" : "Save action"}</button><button type="button" disabled={busy} onClick={() => setForm(false)}>Cancel</button></div>
    </form>}
    {!loaded && !error && <p className="action-empty" role="status">Loading actions…</p>}
    {loaded && <div className="action-list">{(history ? completed : pending).map(a => { const j = jobs.find(j => j.id === a.jobId); return <article className={`action-item ${a.completed ? "is-complete" : ""}`} key={a.id}>
      <div className="action-item-body"><small>{a.kind} · {j?.company || "Application no longer in tracker"}</small><h3>{a.title}</h3><p>{j?.title}</p>{a.notes && <p className="action-notes">{a.notes}</p>}</div>
      <div className="action-item-controls"><span className={`action-deadline ${!a.completed && a.dueDate && a.dueDate <= today ? "is-urgent" : ""}`}>{a.completed ? "Completed" : dueLabel(a.dueDate, today)}</span>{a.url && <a href={a.url} target="_blank" rel="noreferrer">Open link ↗</a>}<button disabled={busy} onClick={() => {setEditing(a.id);setDraft({jobId:a.jobId,title:a.title,kind:a.kind,dueDate:a.dueDate,url:a.url,notes:a.notes});setForm(true);}}>Edit</button><button disabled={busy} className="action-done" onClick={() => save({id:a.id,completed:!a.completed},"PATCH")}>{a.completed ? "Reopen" : "Mark complete"}</button></div>
    </article>; })}{!(history ? completed : pending).length && <p className="action-empty">{history ? "No completed actions yet." : "No pending actions recorded. Add an assessment or follow-up when it arrives."}</p>}</div>}
  </section>;
}
