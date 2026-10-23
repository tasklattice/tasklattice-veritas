import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import type {Case,Attempt,Grade,JsonObject} from '../src/shared/types.js';
import {sampleCases} from '../src/core/sampling.js';
import {compareEvidence,type ComparisonEvidence} from '../src/core/comparison.js';
import {validateSampling,isActiveRun} from '../src/shared/testing.js';
import {root,save,json,hash} from '../src/core/files.js';
import {runEvaluation,prepareRun} from '../src/core/service.js';
import {importDataset} from '../src/core/datasets.js';
import {buildServer} from '../src/server/main.js';
import {RunStore,datasets,saveTarget,updateTarget,deleteTarget} from '../src/server/store.js';
import {startMock} from '../scripts/mock-endpoint.js';
import {rescoreRun} from '../src/core/scoring-revisions.js';
import {defaultScorer,protectionScorer} from '../src/shared/scorer.js';
import {initialTestingDraft,buildTestingRequest} from '../web/testing-model.js';
import {buildDatasetCards} from '../src/server/dataset-cards.js';
import {catalog} from '../src/core/datasets.js';
const sample=(id:string,expected:Case['expected']='allow'):Case=>({id,dataset:'fixture',phase:'input',text:'Safe '+id,expected});
const fixture=(cases:Case[],actions:Record<string,string[]>,patch:JsonObject={}):ComparisonEvidence=>{
 const records:Attempt[]=[],grades=new Map<string,Grade>();
 for(const c of cases)for(const value of actions[c.id]??[]){const action=value==='error'?undefined:value as Attempt['action'];const r:Attempt={schemaVersion:3,attemptId:randomUUID(),caseId:c.id,dataset:c.dataset,phase:c.phase,adapter:'f5-scan',contextMode:'text-only',contextOmitted:[],callId:null,startedAt:new Date().toISOString(),steps:[],status:value==='error'?'error':'completed',action};records.push(r);grades.set(r.attemptId,{pass:action===c.expected,score:action===c.expected?1:0,reason:'Fixture action match'});}
 return {snapshot:{schemaVersion:3,cases,repeat:2,concurrency:2,target:{adapter:'f5-scan',outputMode:'standalone'},engine:{version:'fixture'},providerHash:'same',evidence:'endpoint',...patch},records,grades,scorerHash:'rules-v1',report:{summary:{coverage:1,accuracy:.5,precision:.5,recall:.5,f1:.5,latencyMs:{p95:20}}}};
};
const wait=async(check:()=>boolean,ms=25000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw new Error('Timed out waiting for test state');await new Promise(resolve=>setTimeout(resolve,15));}};

test('Seeded samples are deterministic, order independent, selected across the complete pool and stratified by labels',()=>{
 const cs=Array.from({length:100},(_,i)=>sample(String(i),i<80?'allow':i<95?'block':'transform'));
 const a=sampleCases(cs,20,{method:'random',seed:42}),b=sampleCases([...cs].reverse(),20,{method:'random',seed:42});
 assert.deepEqual(a.selection.caseIds,b.selection.caseIds);assert.notDeepEqual(a.selection.caseIds,sampleCases(cs,20,{method:'random',seed:43}).selection.caseIds);assert.ok(a.cases.some(c=>Number(c.id)>=20));assert.equal(new Set(a.selection.caseIds).size,20);
 const s=sampleCases(cs,20,{method:'stratified',seed:42});assert.deepEqual(s.selection.selectedLabels,{allow:16,block:3,transform:1,unlabeled:0});assert.equal(s.selection.population,100);assert.deepEqual(s.selection.caseIds,sampleCases([...cs].reverse(),20,{method:'stratified',seed:42}).selection.caseIds);
 assert.throws(()=>sampleCases(cs,2,{method:'stratified',seed:42}),/at least 3/);assert.equal(sampleCases(cs,200,{method:'stratified',seed:42}).cases.length,100);
 assert.deepEqual(sampleCases(cs,3).selection.caseIds,['0','1','2']);assert.deepEqual(sampleCases([],5,{method:'stratified',seed:0}).cases,[]);
 assert.throws(()=>sampleCases([...cs,sample('unknown',null)],20,{method:'random',seed:1}),/reviewed/);
 const excluded=sampleCases([...cs,sample('unknown',null)],20,{method:'stratified',seed:1},true);assert.equal(excluded.selection.excludedUnlabeled,1);assert.equal(excluded.selection.selectedLabels.unlabeled,0);
 for(const value of [{method:'random'},{method:'random',seed:-1},{method:'stratified',seed:1.5},{method:'random',seed:4294967296},{method:'source-order',seed:1},{method:'bad'}])assert.throws(()=>validateSampling(value));
});

test('Baseline comparison identifies stable new failures and fixes without pairing repeats by arrival order',()=>{
 const cs=['regression','fix','same','failed','unstable','error','missing'].map(id=>sample(id));
 const a=fixture(cs,{regression:['allow','allow'],fix:['block','block'],same:['allow','allow'],failed:['block','block'],unstable:['allow','allow'],error:['allow','allow'],missing:['allow','allow']});
 const b=fixture(cs,{regression:['block','block'],fix:['allow','allow'],same:['allow','allow'],failed:['block','block'],unstable:['allow','block'],error:['allow','error'],missing:['allow']});b.records.reverse();
 const before=JSON.stringify([a.snapshot,b.snapshot,a.records,b.records]);const r=compareEvidence(a,b);
 assert.deepEqual(r.counts,{'new-failure':1,fixed:1,'still-failing':1,unchanged:1,unstable:1,'not-comparable':2});assert.equal(r.aggregateComparable,false);assert.ok(r.metrics.every(m=>m.delta===null));assert.equal(JSON.stringify([a.snapshot,b.snapshot,a.records,b.records]),before);
 const good=compareEvidence(fixture(cs.slice(0,2),{regression:['allow','allow'],fix:['block','block']}),fixture(cs.slice(0,2),{regression:['block','block'],fix:['allow','allow']}));assert.equal(good.aggregateComparable,true);assert.equal(good.metrics[0].delta,0);
 const changed=fixture(cs,{regression:['allow','allow']});changed.scorerHash='different';assert.ok(compareEvidence(a,changed).issues.some(i=>i.includes('Scoring')));assert.equal(compareEvidence(a,changed).counts['new-failure'],0);
 const labels=fixture(cs.map(c=>c.id==='regression'?{...c,expected:'block'}:c),{});assert.equal(compareEvidence(a,labels).rows.find(r=>r.caseId==='regression')!.change,'not-comparable');
 const incomplete=fixture([sample('new')],{new:['allow','allow']});assert.equal(compareEvidence(a,incomplete).aggregateComparable,false);
 const noGrades={...a,grades:undefined};assert.equal(compareEvidence(noGrades,a).counts['new-failure'],0);
});

test('Testing UI serializes sampling only for limited scope and rejects invalid seeds',()=>{
 const cards=buildDatasetCards(catalog(),[]).map(c=>({...c,rawAvailable:true}));const t={id:'fixture',name:'Fixture',credentialAvailable:true,target:{adapter:'f5-scan' as const,outputMode:'standalone' as const,url:'http://127.0.0.1:1/backend/v1/scans'}};
 const draft={...initialTestingDraft({datasetId:'aegis',targetId:t.id}),scope:'limited' as const,samplingMethod:'stratified' as const,seed:'0',limit:'12'};
 assert.deepEqual(buildTestingRequest(draft,cards,[t],catalog()).sampling,{method:'stratified',seed:0});assert.equal(buildTestingRequest({...draft,scope:'full',seed:'bad'},cards,[t],catalog()).sampling,undefined);
 for(const seed of ['', '1.5','-1','4294967296','bad'])assert.throws(()=>buildTestingRequest({...draft,seed},cards,[t],catalog()));
});

test('Frozen selection IDs identify the checks actually executed after explicit unreviewed-label exclusion',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'veritas-selected-'));try{
  const file=join(dir,'cases.jsonl'),data=join(dir,'dataset'),target=join(dir,'target.json');
  writeFileSync(file,[sample('reviewed'),sample('unreviewed',null)].map(c=>JSON.stringify(c)).join('\n')+'\n');await importDataset({dataset:'veritas',file,out:data});save(target,{adapter:'f5-scan',url:'http://127.0.0.1:1/backend/v1/scans'});
  const manifest=json(join(data,'manifest.json'));save(join(data,'manifest.json'),{...manifest,selection:{method:'source-order',caseIds:['reviewed','unreviewed']}});
  const plan=prepareRun({data,target,out:join(dir,'run'),skipUnlabeled:true});assert.deepEqual(plan.snapshot.selection!.caseIds,['reviewed']);assert.equal(plan.snapshot.skippedUnlabeled,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Report ID is returned before preparation; progress, cancellation, restart state and frozen Target survive asynchronous work',async()=>{
 const name='evolution-'+randomUUID().slice(0,8),data=join(root,'data',name),source=join(root,'data',name+'.jsonl');mkdirSync(join(root,'data'),{recursive:true});writeFileSync(source,[sample('one'),sample('two')].map(c=>JSON.stringify({...c,dataset:'wildjailbreak'})).join('\n')+'\n');
 await importDataset({dataset:'veritas',file:source,out:data});const mock=await startMock(),target=saveTarget({name,target:{adapter:'f5-scan',url:mock.f5Url}});
 let release!:()=>void,entered=false;const held=new Promise<void>(r=>release=r);
 const store=new RunStore(async(_req,options)=>{entered=true;options?.onProgress?.({dataset:'wildjailbreak',datasetIndex:1,datasets:1,filesCompleted:0,filesTotal:1,scannedRows:250,convertedCases:200,selectedCases:0,message:'Converting source records'});await Promise.race([held,new Promise<void>((_,reject)=>options?.signal?.addEventListener('abort',()=>reject(new Error('Cancelled')),{once:true}))]);return data;});
 const ids:string[]=[];
 try{
  const request={datasets:[{datasetId:'wildjailbreak'}],targetId:target.id,limitPerDataset:2,repeat:2,concurrency:2,evidence:'synthetic-local-demo' as const};
  const first=await store.start(request);ids.push(first.id);assert.equal(entered,false);assert.ok(store.detail(first.id).configuration);await wait(()=>entered);
  assert.equal(store.detail(first.id).run.status,'preparing');assert.equal(store.activity(first.id).stage!.preparation!.scannedRows,250);assert.equal(mock.requests.length,0);
  assert.equal(new RunStore().detail(first.id).run.status,'interrupted');
  ids.push((await store.start(request)).id);store.cancel(ids[1]);
  updateTarget(target.id,{name,target:{adapter:'f5-scan',url:'http://127.0.0.1:1/backend/v1/scans'}});
  release();await wait(()=>ids.every(id=>!isActiveRun(store.detail(id).run.status)));
  assert.equal(store.detail(first.id).run.status,'completed');assert.equal(store.detail(ids[1]).run.status,'cancelled');assert.equal(mock.requests.length,4);assert.equal(json(join(store.directory(first.id),'snapshot.json')).target.url,mock.f5Url);
  const history=store.detail(first.id).run.stageHistory!;assert.deepEqual(history.map(s=>s.stage),['preparing','running','scoring','reporting','finished']);assert.equal(history.find(s=>s.stage==='running')!.completed,4);assert.equal(history.find(s=>s.stage==='scoring')!.completed,4);assert.equal(history.find(s=>s.stage==='reporting')!.completed,1);
 }finally{store.close();await mock.close();for(const id of ids){rmSync(store.directory(id),{recursive:true,force:true});for(const dir of ['jobs','job-targets','job-requests'])rmSync(join(root,'data',dir,id+'.json'),{force:true});}deleteTarget(target.id);rmSync(data,{recursive:true,force:true});rmSync(source,{force:true});}
});

test('Preparation cancellation or source errors remain inspectable Reports and never send Target traffic',async()=>{
 const mock=await startMock(),name='prep-failure-'+randomUUID().slice(0,8),target=saveTarget({name,target:{adapter:'f5-scan',url:mock.f5Url}}),stores:RunStore[]=[],ids:{store:RunStore;id:string}[]=[];
 try{
  const failing=new RunStore(async()=>{throw new Error('Pinned source is unavailable');});stores.push(failing);
  const req={datasets:[{datasetId:'aegis'}],targetId:target.id,repeat:1,concurrency:1};const fail=await failing.start(req);ids.push({store:failing,id:fail.id});await wait(()=>!isActiveRun(failing.detail(fail.id).run.status));assert.match(failing.detail(fail.id).run.error!,/Pinned source/);assert.equal(failing.detail(fail.id).configuration!.caseCount,null);
  const cancelling=new RunStore(async(_r,options)=>{await new Promise((_,reject)=>options?.signal?.addEventListener('abort',()=>reject(new Error('Cancelled')),{once:true}));return 'unreachable';});stores.push(cancelling);const c=await cancelling.start(req);ids.push({store:cancelling,id:c.id});await wait(()=>cancelling.detail(c.id).run.status==='preparing');cancelling.cancel(c.id);await wait(()=>!isActiveRun(cancelling.detail(c.id).run.status));assert.equal(cancelling.detail(c.id).run.status,'cancelled');assert.equal(mock.requests.length,0);
 }finally{stores.forEach(s=>s.close());await mock.close();for(const {store,id} of ids){rmSync(store.directory(id),{recursive:true,force:true});for(const dir of ['jobs','job-targets','job-requests'])rmSync(join(root,'data',dir,id+'.json'),{force:true});}deleteTarget(target.id);}
});

test('Comparison API pins scoring versions, filters cases before pagination, and keeps artifacts unchanged with zero traffic',async()=>{
 const name='compare-'+randomUUID().slice(0,8),dir=join(root,'runs',name),data=join(dir,'inputs');mkdirSync(dir,{recursive:true});const file=join(dir,'cases.jsonl');
 writeFileSync(file,[sample('one'),sample('two','block')].map(c=>JSON.stringify(c)).join('\n')+'\n');await importDataset({dataset:'veritas',file,out:data});
 const mock=await startMock(),target=join(dir,'target.json');save(target,{adapter:'f5-scan',url:mock.f5Url});const {app,store}=await buildServer({ui:false}),headers={host:'localhost:38100'};
 try{
  const a=await runEvaluation({data,target,out:join(dir,'baseline'),repeat:2}),b=await runEvaluation({data,target,out:join(dir,'candidate'),repeat:2});
  const baseline=store.list().find(r=>r.name===name+'/baseline')!,candidate=store.list().find(r=>r.name===name+'/candidate')!;
  await mock.close();const before=mock.requests.length,files=['snapshot.json','attempts.jsonl','report.json','grades.jsonl'];const hashes=files.map(f=>hash(readFileSync(join(b.directory,f))));
  const result=await app.inject({url:`/api/runs/${candidate.id}/compare?baseline=${baseline.id}&filter=still-failing&limit=1`,headers});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().counts['still-failing'],1);assert.equal(result.json().total,1);assert.equal(result.json().items.length,1);assert.equal(result.json().items[0].baseline.length,2);
  assert.equal((await app.inject({url:`/api/runs/${candidate.id}/compare?baseline=${baseline.id}&filter=fixed`,headers})).json().total,0);
  assert.equal((await app.inject({url:`/api/runs/${candidate.id}/compare?baseline=${baseline.id}&offset=-1`,headers})).statusCode,400);
  assert.equal((await app.inject({url:`/api/runs/${candidate.id}/compare?baseline=${candidate.id}`,headers})).statusCode,400);
  const revision=await rescoreRun(b.directory,protectionScorer());const mismatch=await app.inject({url:`/api/runs/${candidate.id}/compare?baseline=${baseline.id}&scoring=${revision.id}`,headers});assert.ok(mismatch.json().issues.some((s:string)=>s.includes('Scoring')));
  const original=await app.inject({url:`/api/runs/${candidate.id}/compare?baseline=${baseline.id}&scoring=original`,headers});assert.deepEqual(original.json().issues,[]);assert.equal(mock.requests.length,before);assert.deepEqual(files.map(f=>hash(readFileSync(join(b.directory,f)))),hashes);
 }finally{await app.close();await mock.close();rmSync(dir,{recursive:true,force:true});}
});

test('Real source preparation samples across the full pinned scope and freezes selected IDs and label quotas',async t=>{
 const {sourcePath}=await import('../src/core/raw.js');const {prepareEvaluationDataset}=await import('../src/server/prepare-evaluation.js');
 if(!existsSync(sourcePath('wildjailbreak','eval/eval.tsv'))){t.skip('Pinned WildJailbreak archive is not installed');return;}
 const paths:string[]=[];try{
  for(const seed of [42,42,43])paths.push(await prepareEvaluationDataset({datasets:[{datasetId:'wildjailbreak',phase:'input'}],limitPerDataset:12,sampling:{method:'stratified',seed},repeat:2,concurrency:2}));
  const manifests=paths.map(p=>json(join(p,'manifest.json')));assert.deepEqual(manifests[0].selection.caseIds,manifests[1].selection.caseIds);assert.notDeepEqual(manifests[0].selection.caseIds,manifests[2].selection.caseIds);
  const selection=manifests[0].sources[0].selection;assert.ok(selection.population>12);assert.equal(selection.selected,12);assert.ok(selection.selectedLabels.allow>0);assert.ok(selection.selectedLabels.block>0);assert.equal(manifests[0].files[0].limitReached,false);assert.equal(manifests[0].selection.seed,42);
 }finally{for(const p of paths)rmSync(p,{recursive:true,force:true});}
});
