import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAction, dueLabel } from '../lib/actions.ts';
const valid = { jobId: 'existing-job', title: 'Complete assessment', kind: 'Assessment', dueDate: '2026-10-01', url: 'https://example.com/assessment', notes: '' };
test('actions validate real calendar deadlines and reject unsafe links', () => {
 assert.deepEqual(validateAction(valid), valid);
 for (const changes of [{dueDate:'2026-02-30'}, {dueDate:'tomorrow'}, {url:'javascript:alert(1)'}, {url:'https://user:pass@example.com'}, {kind:'invalid'}, {jobId:''}, {title:' '}, {notes:15}]) assert.throws(() => validateAction({...valid,...changes}));
 assert.equal(validateAction({...valid,dueDate:'',url:''}).dueDate,'');
});
test('deadline labels distinguish today from overdue without UTC rollover', () => {
 assert.equal(dueLabel('2026-09-25','2026-09-25'),'Due today');
 assert.equal(dueLabel('2026-09-24','2026-09-25'),'Overdue');
 assert.equal(dueLabel('','2026-09-25'),'No deadline');
 assert.equal(dueLabel('2027-01-15','2026-09-25'),'Due Jan 15, 2027');
});

test('stored actions survive edits, completion and reopening without touching jobs', async () => {
 const { DatabaseSync } = await import('node:sqlite');
 const { readFile } = await import('node:fs/promises');
 const { stripTypeScriptTypes } = await import('node:module');
 const sqlite = new DatabaseSync(':memory:');
 sqlite.exec("CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT); INSERT INTO jobs VALUES ('existing-job', 'applied');");
 const adapter = { prepare(sql) {
   let args = [];
   return { bind(...values) { args = values; return this; }, async run() { const r = sqlite.prepare(sql).run(...args); return {meta:{changes:r.changes}}; }, async all() { return {results:sqlite.prepare(sql).all(...args)}; } };
 }};
 globalThis.__actionTestDB = adapter;
 try {
   const source = (await readFile(new URL('../db/actions.ts', import.meta.url),'utf8')).replace('import { env } from "cloudflare:workers";', 'const env = { DB: globalThis.__actionTestDB };');
   const storage = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
   await storage.saveAction(valid);
   const [first] = await storage.listActions();
   assert.equal(first.completed,false);
   assert.equal(await storage.saveAction({...valid,title:'Updated assessment'},first.id),true);
   assert.equal((await storage.listActions())[0].title,'Updated assessment');
   assert.equal(await storage.completeAction(first.id,true),true);
   assert.equal((await storage.listActions())[0].completed,true);
   await storage.completeAction(first.id,false);
   assert.equal((await storage.listActions())[0].completed,false);
   assert.equal(await storage.completeAction('missing',true),false);
   assert.equal(sqlite.prepare('SELECT status FROM jobs').get().status,'applied');
 } finally { delete globalThis.__actionTestDB; sqlite.close(); }
});
