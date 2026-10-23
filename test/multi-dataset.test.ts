import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildServer} from '../src/server/main.js';
import {datasets,saveTarget} from '../src/server/store.js';
import {resolveDatasetSelections} from '../src/server/prepare-evaluation.js';
import {catalog} from '../src/core/datasets.js';
import {sourcePath} from '../src/core/raw.js';
import {writeReport} from '../src/core/report.js';
import {root,json} from '../src/core/files.js';
import {startMock} from '../scripts/mock-endpoint.js';
import type {Attempt,Case,RunRequest} from '../src/shared/types.js';
const base:RunRequest={datasets:[{datasetId:'wildjailbreak'},{datasetId:'jailbreakbench'}],repeat:2,concurrency:2,limitPerDataset:2};

test('Multi-Dataset requests validate every source, preserve independent directions, and reject ambiguous selectors',()=>{
 const resolved=resolveDatasetSelections({...base,datasets:[{datasetId:'wildjailbreak',phase:'input'},{datasetId:'beavertails',phase:'output'}]});
 assert.deepEqual(resolved.map(s=>[s.entry.id,s.selection.phase]),[['wildjailbreak','input'],['beavertails','output']]);
 for(const request of [
  {...base,datasets:[]}, {...base,datasets:null}, {...base,datasets:[null]},
  {...base,datasets:[{datasetId:'wildjailbreak'},{datasetId:'wildjailbreak'}]},
  {...base,datasets:[{datasetId:'wildjailbreak'},{datasetId:'missing'}]},
  {...base,datasets:[{datasetId:'wildjailbreak'},{datasetId:'jailbreakbench',config:'missing'}]},
  {...base,datasets:[{datasetId:'wildjailbreak'},{datasetId:'jailbreakbench',phase:'bad'}]},
  {...base,datasetId:'wildjailbreak'}, {...base,limit:1}, {...base,phase:'input'}, {...base,limitPerDataset:0},
  {...base,datasets:[{datasetId:'topic-control'}]},
 ]) assert.throws(()=>resolveDatasetSelections(request as RunRequest));
});

test('Report preserves per-Dataset denominators across errors, output skips, repeats and missing evidence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'veritas-report-'));
 try{
  const cases:Case[]=[{id:'a',dataset:'first',phase:'input',text:'Safe',expected:'allow'},{id:'b',dataset:'second',phase:'output',text:'Unsafe',expected:'block',prompt:'Safe'}];
  const attempt=(id:string,source:Case,status:Attempt['status'],action?:Attempt['action']):Attempt=>({schemaVersion:3,attemptId:id,caseId:source.id,dataset:source.dataset,phase:source.phase,adapter:'f5-scan',contextMode:'text-only',contextOmitted:[],callId:null,startedAt:'',steps:[],status,action,latencyMs:1});
  const records=[attempt('a1',cases[0],'completed','allow'),attempt('a2',cases[0],'error'),attempt('b1',cases[1],'completed','allow'),attempt('b2',cases[1],'skipped')];
  const report=writeReport(dir,{cases,repeat:3,target:{adapter:'f5-scan'},evidence:'synthetic-local-demo'},records);
  assert.equal(report.summary.plannedAttempts,6);assert.equal(report.summary.accuracy,.5);assert.equal(report.summary.missing,2);
  assert.equal(report.datasets.first.plannedAttempts,3);assert.equal(report.datasets.first.accuracy,1);assert.equal(report.datasets.first.errors,1);assert.equal(report.datasets.first.missing,1);
  assert.equal(report.datasets.second.accuracy,0);assert.equal(report.datasets.second.skipped,1);assert.equal(report.datasets.second.falseNegatives,1);
  assert.equal(report.groups['second/output'].plannedAttempts,3);
  assert.equal(Object.values(report.datasets).reduce((n,s)=>n+s.recordedAttempts,0),report.summary.recordedAttempts);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

const available=base.datasets!.every(s=>catalog().find(e=>e.id===s.datasetId)!.files.filter((f:any)=>f.default!==false).every((f:any)=>existsSync(sourcePath(s.datasetId,f.path))));
test('Two pinned source Datasets create one run with fair limits, complete provenance, dataset filters and CSV', {skip:!available},async()=>{
 const name='multi-test-'+randomUUID().slice(0,8),mock=await startMock(),{app,store}=await buildServer({ui:false}),headers={host:'localhost:38100'};let id='',selectionPath='';
 try{
  const endpoint=saveTarget({name,target:{adapter:'f5-scan',url:mock.f5Url}});
  const invalid=await app.inject({method:'POST',url:'/api/runs',headers,payload:{...base,datasets:[{datasetId:'wildjailbreak'},{datasetId:'jailbreakbench',split:'missing'}],endpointId:endpoint.id}});
  assert.equal(invalid.statusCode,400);assert.equal(mock.requests.length,0);
  const created=await app.inject({method:'POST',url:'/api/runs',headers,payload:{...base,endpointId:endpoint.id,evidence:'synthetic-local-demo'}});
  assert.equal(created.statusCode,202,created.body);id=created.json().id;
  const deadline=Date.now()+20000;while(Date.now()<deadline&&['preparing','running','scoring','queued'].includes(store.detail(id).run.status))await new Promise(r=>setTimeout(r,30));
  const {run,report}=store.detail(id);assert.equal(run.status,'completed');assert.deepEqual(run.datasetIds,['wildjailbreak','jailbreakbench']);assert.equal(run.datasetId,undefined);
  selectionPath=datasets().find(d=>d.id===run.selectionId)!.path;
  const snapshot=json(join(store.directory(id),'snapshot.json'));
  assert.equal(snapshot.cases.length,4);assert.equal(snapshot.manifest.limitPerDataset,2);
  assert.deepEqual(snapshot.manifest.sources.map((s:any)=>s.dataset),['wildjailbreak','jailbreakbench']);
  assert.ok(snapshot.manifest.sources.every((s:any)=>s.revision&&s.source&&s.license&&s.files.every((f:any)=>f.sha256)));
  assert.equal(report!.summary.completed,8);assert.equal(mock.requests.length,8);
  for(const datasetId of ['wildjailbreak','jailbreakbench']){
   assert.equal(snapshot.cases.filter((c:Case)=>c.dataset===datasetId).length,2);
   assert.equal(report!.datasets[datasetId].completed,4);
   const filtered=await app.inject({url:'/api/runs/'+id+'/attempts?dataset='+datasetId+'&limit=1',headers});
   assert.equal(filtered.json().total,4);assert.equal(filtered.json().datasetTotal,4);assert.equal(filtered.json().allTotal,8);assert.equal(filtered.json().items.length,1);assert.equal(filtered.json().items[0].dataset,datasetId);
   const unexpected=await app.inject({url:'/api/runs/'+id+'/attempts?dataset='+datasetId+'&filter=unexpected&limit=1',headers});
   assert.equal(unexpected.json().total,report!.datasets[datasetId].failed);assert.ok(unexpected.json().items.every((a:any)=>a.dataset===datasetId&&!a.grade.pass));
  }
  const empty=await app.inject({url:'/api/runs/'+id+'/attempts?dataset=missing',headers});assert.equal(empty.json().total,0);
  const csv=await app.inject({url:'/api/runs/'+id+'/files/results.csv',headers});assert.equal(csv.body.trim().split('\n').length,9);assert.match(csv.body,/"wildjailbreak"/);assert.match(csv.body,/"jailbreakbench"/);
  const cards=await app.inject({url:'/api/datasets',headers});assert.equal(cards.json().items.length,catalog().length);assert.ok(cards.json().items.every((c:any)=>c.source!=='local'));
 }finally{
  await app.close();await mock.close();if(id){rmSync(store.directory(id),{recursive:true,force:true});rmSync(join(root,'data/jobs',id+'.json'),{force:true});}
  if(selectionPath)rmSync(selectionPath,{recursive:true,force:true});rmSync(join(root,'data/targets',name+'.json'),{force:true});
 }
});
