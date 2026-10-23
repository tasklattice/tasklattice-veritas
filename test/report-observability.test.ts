import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import type {Attempt,Case,Action} from '../src/shared/types.js';
import type {ActivityEvent} from '../src/shared/activity.js';
import {classificationMetrics,withClassification} from '../src/core/classification.js';
import {summarize} from '../src/core/report.js';
import {ActivityTracker} from '../src/core/activity.js';
import Provider from '../src/core/provider.js';
import {startMock} from '../scripts/mock-endpoint.js';
import {root,save,json,hash} from '../src/core/files.js';
import {importDataset} from '../src/core/datasets.js';
import {buildServer} from '../src/server/main.js';
import {datasets,saveTarget,deleteTarget} from '../src/server/store.js';
const sample=(id:string,expected:Action|null='allow',phase:'input'|'output'='input'):Case=>({id,expected,phase,dataset:'fixture',text:'Safe sample',prompt:'Safe input'});
const attempt=(c:Case,action:Action='allow',status:Attempt['status']='completed'):Attempt=>({schemaVersion:3,attemptId:randomUUID(),caseId:c.id,dataset:c.dataset,phase:c.phase,adapter:'f5-scan',contextMode:'text-only',contextOmitted:[],callId:null,startedAt:new Date().toISOString(),steps:[],status,action,latencyMs:1,totalHttpLatencyMs:1});

test('Detection metrics include transformations, exclude execution failures, and stay independent of scorers',()=>{
 const cs=[sample('tp','block'),sample('tp-transform','transform'),sample('fp'),sample('fn','block'),sample('tn'),sample('unknown',null)];
 const rs=[attempt(cs[0],'transform'),attempt(cs[1],'block'),attempt(cs[2],'block'),attempt(cs[3]),attempt(cs[4]),attempt(cs[5],'block'),attempt(cs[0],'block','error'),attempt(cs[2],'allow','skipped')];
 const m=classificationMetrics(rs,cs);assert.equal(m.precision,2/3);assert.equal(m.recall,2/3);assert.equal(m.f1,2/3);assert.equal(m.classification.support,5);assert.equal(m.classification.accuracy,3/5);
 const grades=new Map(rs.map(r=>[r.attemptId,{pass:false,score:0,reason:'Additional assertion failed'}]));
 const s=summarize(rs,cs,10,grades);assert.equal(s.accuracy,0);assert.equal(s.precision,m.precision);assert.equal(s.coverage,.6);
 const original={summary:{accuracy:.42},datasets:{fixture:{accuracy:.42}},groups:{'fixture/input':{accuracy:.42}}};const before=JSON.stringify(original);
 const projected=withClassification(original,{cases:cs},rs);assert.equal(JSON.stringify(original),before);assert.equal(projected.summary.accuracy,.42);assert.equal(projected.datasets.fixture.precision,2/3);
});

test('Undefined detection denominators are null; F1 is zero when positives are entirely missed',()=>{
 const safe=sample('safe'),unsafe=sample('unsafe','block');
 assert.equal(classificationMetrics([],[]).precision,null);const good=classificationMetrics([attempt(safe)],[safe]);assert.equal(good.precision,null);assert.equal(good.recall,null);assert.equal(good.f1,null);
 const missed=classificationMetrics([attempt(unsafe)],[unsafe]);assert.equal(missed.precision,null);assert.equal(missed.recall,0);assert.equal(missed.f1,0);
 const falseAlarm=classificationMetrics([attempt(safe,'transform')],[safe]);assert.equal(falseAlarm.precision,0);assert.equal(falseAlarm.recall,null);assert.equal(falseAlarm.f1,0);
});

test('Provider lifecycle distinguishes paired preparation, output, skipped outputs and errors, after saving evidence',async()=>{
 const mock=await startMock(),dir=mkdtempSync(join(tmpdir(),'activity-provider-'));const events:ActivityEvent[]=[];
 try{
  const p=new Provider({config:{target:{url:mock.url},evidencePath:join(dir,'attempts.jsonl')},onActivity:e=>{if(e.type==='attempt-finish')assert.ok(readFileSync(join(dir,'attempts.jsonl'),'utf8').includes(e.attempt.attemptId));events.push(e);}});
  await p.callApi('',{vars:{case:sample('output','allow','output')}});
  assert.deepEqual(events.map(e=>e.type),['attempt-start','step-start','step-start','attempt-finish']);
  const steps=events.filter(e=>e.type==='step-start');assert.deepEqual(steps.map(e=>[e.phase,e.preparation]),[['input',true],['output',false]]);
  events.length=0;await p.callApi('',{vars:{case:{...sample('skipped','block','output'),prompt:'[BLOCK]'}}});assert.equal(events.filter(e=>e.type==='step-start').length,1);assert.equal((events.at(-1) as any).attempt.status,'skipped');
  events.length=0;await p.callApi('',{vars:{case:{...sample('error'),text:'[ERROR]'}}});assert.equal((events.at(-1) as any).attempt.status,'error');
  const controller=new AbortController();controller.abort();events.length=0;await p.callApi('',{vars:{case:sample('cancel')}},{abortSignal:controller.signal});assert.equal((events.at(-1) as any).attempt.status,'error');
 }finally{await mock.close();rmSync(dir,{recursive:true,force:true});}
});

test('Activity tracker keeps concurrent checks and repeat ordinals, bounds history, and rejects late lifecycle events',()=>{
 const dir=mkdtempSync(join(tmpdir(),'activity-state-')),c=sample('c'),tracker=new ActivityTracker([c],30,join(dir,'activity.json'));
 try{
  const records=Array.from({length:25},()=>attempt(c));
  for(const r of records){tracker.event({type:'attempt-start',attemptId:r.attemptId,caseId:c.id,startedAt:r.startedAt});tracker.event({type:'step-start',attemptId:r.attemptId,phase:'input',preparation:false,startedAt:r.startedAt});}
  assert.equal(tracker.snapshot().active.length,25);assert.equal(tracker.snapshot().active[24].repeat,25);
  for(const r of records)tracker.event({type:'attempt-finish',attempt:r});
  const state=tracker.snapshot();assert.equal(state.finished,25);assert.equal(state.active.length,0);assert.equal(state.recent.length,20);assert.equal(state.recent[0].attemptId,records[24].attemptId);
  tracker.event({type:'attempt-finish',attempt:records[0]});assert.equal(tracker.snapshot().finished,25);
  tracker.phase('finished');tracker.event({type:'attempt-start',attemptId:'late',caseId:c.id,startedAt:c.text});assert.equal(tracker.snapshot().active.length,0);assert.equal(json(join(dir,'activity.json')).phase,'finished');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

const waitFor=async(check:()=>boolean)=>{const end=Date.now()+25000;while(!check()){if(Date.now()>end)throw new Error('Timed out waiting for test state');await new Promise(r=>setTimeout(r,20));}};
test('Activity API exposes in-flight SDK checks before completion; historical metrics and exports never rewrite evidence or send traffic',async()=>{
 let released=false,calls=0;const pending:(()=>void)[]=[];
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls++;if(!released)await new Promise<void>(resolve=>pending.push(resolve));res.setHeader('content-type','application/json');res.end(JSON.stringify({id:randomUUID(),redactedInput:body.input,result:{outcome:'cleared',response:body.input}}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const name='activity-test-'+randomUUID().slice(0,8),data=join(root,'data',name),source=join(root,'data',name+'.jsonl');
 const {app,store}=await buildServer({ui:false});const ids:string[]=[];let targetId='';const headers={host:'localhost:38100'};
 try{
  mkdirSync(join(root,'data'),{recursive:true});writeFileSync(source,[sample('safe'),sample('missed','block','output')].map(c=>JSON.stringify(c)).join('\n')+'\n');
  await importDataset({dataset:'veritas',file:source,out:data});const selection=datasets().find(d=>d.path===data)!;
  const t=saveTarget({name,target:{adapter:'f5-scan',url:`http://127.0.0.1:${(server.address() as AddressInfo).port}/backend/v1/scans`}});targetId=t.id;
  const req={datasetId:selection.id,targetId:t.id,repeat:2,concurrency:2};ids.push(store.enqueue(req).id);ids.push(store.enqueue(req).id);
  await waitFor(()=>calls===2);
  const response=await app.inject({url:'/api/runs/'+ids[0]+'/activity',headers});assert.equal(response.statusCode,200);const live=response.json();assert.equal(live.active.length,2);assert.equal(live.finished,0);assert.equal(live.started,2);assert.equal(live.total,4);assert.ok(live.active.every((a:any)=>a.samplePreview==='Safe sample'&&a.caseNumber>0&&a.repeat>0&&a.stage.startsWith('scanning-')));assert.ok(!response.body.includes('authorization'));
  const queued=store.activity(ids[1]);assert.equal(queued.runStatus,'queued');assert.equal(queued.queuePosition,1);assert.equal(queued.active.length,0);store.cancel(ids[1]);
  released=true;pending.splice(0).forEach(f=>f());await waitFor(()=>ids.every(id=>!['preparing','running','scoring','queued'].includes(store.detail(id).run.status)));
  const complete=store.activity(ids[0]);assert.equal(complete.finished,4);assert.equal(complete.active.length,0);assert.equal(complete.recent.length,4);assert.equal(calls,4);
  const dir=store.directory(ids[0]),saved=json(join(dir,'report.json'));
  // Simulate a report written before detection metrics existed, retaining its bound grades.
  for(const s of [saved.summary,...Object.values(saved.datasets),...Object.values(saved.groups)] as any[]){delete s.precision;delete s.recall;delete s.f1;delete s.classification;}
  save(join(dir,'report.json'),saved);writeFileSync(join(dir,'report.md'),'# Historical report\n');
  const files=['report.json','report.md','attempts.jsonl','grades.jsonl','snapshot.json'];const hashes=files.map(f=>hash(readFileSync(join(dir,f))));
  const view=store.detail(ids[0]).report!;assert.equal(view.summary.recall,0);assert.equal(view.summary.precision,null);assert.equal(view.summary.f1,0);assert.equal(view.summary.accuracy,.5);
  const exported=await app.inject({url:'/api/runs/'+ids[0]+'/files/report.json',headers});assert.equal(exported.json().summary.f1,0);
  const md=await app.inject({url:'/api/runs/'+ids[0]+'/files/report.md',headers});assert.match(md.body,/Detection metrics/);
  assert.deepEqual(files.map(f=>hash(readFileSync(join(dir,f)))),hashes);assert.equal(calls,4);
 }finally{released=true;pending.splice(0).forEach(f=>f());await app.close();await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});for(const id of ids){rmSync(store.directory(id),{recursive:true,force:true});rmSync(join(root,'data/jobs',id+'.json'),{force:true});rmSync(join(root,'data/job-targets',id+'.json'),{force:true});}if(targetId)deleteTarget(targetId);rmSync(data,{recursive:true,force:true});rmSync(source,{force:true});}
});
