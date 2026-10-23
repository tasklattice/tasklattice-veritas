import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Provider from '../src/core/provider.js';
import {withExecutionEvidence,executionEvidenceHash,recordsForScoring} from '../src/core/execution-evidence.js';
import {hash,save,lines} from '../src/core/files.js';
import {runEvaluation} from '../src/core/service.js';
import {rescoreRun,selectedScoring} from '../src/core/scoring-revisions.js';
import {defaultScorer} from '../src/shared/scorer.js';
import {startMock} from '../scripts/mock-endpoint.js';
import {RunStore} from '../src/server/store.js';
import type {Attempt,Case} from '../src/shared/types.js';
const failure={status:'error' as const,failClosed:true,errorTypes:['http_5xx']};
const envelope=(execution:any)=>({schemaVersion:1,complete:true,protectionMode:'enforce',evaluations:[],execution});
const row=(r:Attempt)=>({schemaVersion:1,attemptId:r.attemptId,phase:r.phase,eventId:'event-1',requestId:'endpoint:veritas-'+r.attemptId,responseHash:hash(JSON.stringify(r.steps[0].response)),execution:failure});

test('Both adapters keep model unknown blocks separate from HTTP-200 runtime errors',async()=>{
 const original=globalThis.fetch;
 try{
  for(const adapter of ['f5-scan','litellm-generic-guardrail'] as const)for(const phase of ['input','output'] as const)for(const status of ['error','complete'] as const){
   globalThis.fetch=async()=>new Response(JSON.stringify(adapter==='f5-scan'?{id:'scan',redactedInput:'',result:{outcome:'blocked',response:''}}:{action:'BLOCKED',blocked_reason:'Any free-form reason'}),{status:200,headers:{'x-guard-evaluation-evidence':JSON.stringify(envelope({...failure,status,failClosed:status==='error'}))}});
   const p=new Provider({config:{target:{url:'http://guard.test/check',adapter,outputMode:'standalone'}}});
   const r=JSON.parse((await p.callApi('',{vars:{case:{id:'fixture',dataset:'fixture',phase,text:'ordinary',expected:'allow'}}})).output) as Attempt;
   assert.equal(r.steps[0].httpStatus,200);assert.equal(r.steps[0].action,'block');assert.equal(r.status,status==='error'?'error':'completed');
   if(status==='error')assert.match(r.error!,/Guard execution error.*http_5xx/);
  }
 }finally{globalThis.fetch=original;}
});

test('Verified legacy execution evidence is bound to the attempt and cannot replace a captured structured result',()=>{
 const dir=mkdtempSync(join(tmpdir(),'execution-evidence-'));
 const r:Attempt={schemaVersion:3,attemptId:'a',caseId:'c',dataset:'fixture',phase:'input',adapter:'litellm-generic-guardrail',contextMode:'conversation',contextOmitted:[],callId:null,startedAt:'now',status:'completed',action:'block',steps:[{phase:'input',request:{},startedAt:'now',latencyMs:1,response:{action:'BLOCKED'}}]};
 try{
  const original=JSON.stringify(r),file=join(dir,'execution-evidence.jsonl');writeFileSync(file,JSON.stringify(row(r))+'\n');const digest=executionEvidenceHash(dir)!;
  assert.equal(withExecutionEvidence(dir,[r])[0].status,'error');assert.equal(JSON.stringify(r),original);
  assert.equal(recordsForScoring(dir,[r],{})[0].status,'completed');assert.equal(recordsForScoring(dir,[r],{executionEvidenceHash:null})[0].status,'completed');
  const authoritative=structuredClone(r);authoritative.steps[0].headers={'x-guard-evaluation-evidence':JSON.stringify(envelope({status:'complete',failClosed:false,errorTypes:[]}))};
  assert.equal(withExecutionEvidence(dir,[authoritative])[0].status,'completed');
  writeFileSync(file,JSON.stringify({...row(r),requestId:'different'})+'\n');assert.throws(()=>withExecutionEvidence(dir,[r]),/mismatched/);
  assert.throws(()=>recordsForScoring(dir,[r],{executionEvidenceHash:digest}),/modified/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('promptfoo offline re-scoring excludes verified execution errors, preserves original assessments and adds zero traffic',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'execution-offline-')),data=join(dir,'data'),out=join(dir,'run'),target=join(dir,'target.json');mkdirSync(data);
 const mock=await startMock();let closed=false;
 try{
  writeFileSync(join(data,'cases.jsonl'),JSON.stringify({id:'normal',dataset:'fixture',phase:'input',text:'[BLOCK]',expected:'allow'})+'\n');save(target,{url:mock.url,adapter:'litellm-generic-guardrail'});
  const original=await runEvaluation({data,target,out});assert.equal(original.report.summary.failed,1);assert.equal(original.report.summary.errors,0);
  const files=['snapshot.json','attempts.jsonl','grades.jsonl','grading.json','report.json','results.csv'];const before=Object.fromEntries(files.map(f=>[f,hash(readFileSync(join(out,f)))]));
  const record=lines<Attempt>(join(out,'attempts.jsonl'))[0];writeFileSync(join(out,'execution-evidence.jsonl'),JSON.stringify(row(record))+'\n');await mock.close();closed=true;
  const fetch=globalThis.fetch;let traffic=0;globalThis.fetch=async()=>{traffic++;throw Error('Offline grading must not call a Target')};
  try{
   const revision=await rescoreRun(out,defaultScorer());assert.equal(traffic,0);assert.equal(revision.report.summary.errors,1);assert.equal(revision.report.summary.failed,0);assert.equal(revision.report.summary.scored,0);assert.equal(revision.report.summary.falsePositives,0);assert.equal(revision.report.summary.classification.support,0);
   assert.equal(revision.report.summary.unstableCases,0);assert.equal(revision.exitCode,2);
   const store=new RunStore();store.directory=()=>out;
   assert.equal(store.evidence('fixture')[0].status,'error');assert.equal(store.evidence('fixture','original')[0].status,'completed');
   store.list=()=>[{id:'fixture',status:'completed'} as any,{id:'baseline',status:'completed'} as any];
   assert.equal(store.detail('fixture').report!.summary.precision,null);
   const comparison=store.compare('fixture','baseline',{baselineScoring:revision.id});
   assert.equal(comparison.metrics.find(m=>m.name==='Precision')!.candidate,null);
   assert.equal(comparison.metrics.find(m=>m.name==='F1 score')!.candidate,null);
   assert.equal(comparison.counts['not-comparable'],1);
   assert.equal(selectedScoring(out,'original').report!.summary.failed,1);
   for(const f of files)assert.equal(hash(readFileSync(join(out,f))),before[f],f);
   const bytes=readFileSync(join(out,'execution-evidence.jsonl'));writeFileSync(join(out,'execution-evidence.jsonl'),bytes+'\n');assert.throws(()=>selectedScoring(out,revision.id),/modified/);
  }finally{globalThis.fetch=fetch;}
 }finally{if(!closed)await mock.close();rmSync(dir,{recursive:true,force:true});}
});
