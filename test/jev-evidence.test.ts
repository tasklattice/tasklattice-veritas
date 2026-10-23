import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse} from 'csv-parse/sync';
import type {Attempt} from '../src/shared/types.js';
import {parseEvaluationEvidence,jevDetection,jevSummary,type EvaluationEvidence} from '../src/shared/detection.js';
import {withEvaluationEvidence,detectionCsv} from '../src/core/guard-evidence.js';
const envelope=(verdict='unknown',enforcedAction:string|null='block'):EvaluationEvidence=>({schemaVersion:1,complete:true,protectionMode:'enforce',evaluations:[{evaluatorId:'typesafe-jev-jailbreak',capability:'jailbreak',model:'jev-1.13.0',verdict:verdict as any,enforcedAction:enforcedAction as any,questionRevision:'jailbreak-input.v3',thresholds:{lower:.1,upper:.9},probabilities:{jailbreak_attempt:.4,unsafe_pretext:.5}}]});
const attempt=(e?:unknown):Attempt=>({schemaVersion:3,attemptId:'a',caseId:'c',dataset:'fixture',phase:'input',adapter:'litellm-generic-guardrail',contextMode:'conversation',contextOmitted:[],callId:null,startedAt:'2026-10-22T04:00:00Z',status:'completed',action:'block',steps:[{phase:'input',request:{},startedAt:'now',latencyMs:1,response:{action:'BLOCKED',blocked_reason:'Jev probabilities fall within the configured uncertainty interval.'},...(e?{headers:{'x-guard-evaluation-evidence':JSON.stringify(e)}}:{})}]});
test('Explicit JEV verdicts, uncertainty enforcement, absent evidence and preemption are distinct',()=>{
 assert.equal(jevDetection(attempt(envelope('matched'))).status,'matched');
 assert.equal(jevDetection(attempt(envelope())).status,'uncertain-block');
 assert.equal(jevDetection(attempt(envelope('unknown',null))).status,'unknown');
 assert.equal(jevDetection(attempt(envelope('not_matched',null))).status,'not_matched');
 assert.equal(jevDetection(attempt(envelope('error',null))).status,'error');
 assert.equal(jevDetection(attempt({...envelope(),evaluations:[]})).status,'not_run');
 assert.equal(jevDetection(attempt({...envelope(),evaluations:[],complete:false})).status,'unavailable');
 assert.equal(jevDetection(attempt()).status,'unavailable','Never infer model verdict from blocked_reason');
 const r=attempt(envelope('matched'));r.phase='output';r.steps.push({phase:'output',request:{},startedAt:'now',latencyMs:1});
 assert.equal(jevDetection(r).status,'unavailable','Paired preparation is not the output verdict');
});
test('Malformed or unsupported evidence never becomes a match or execution error',()=>{
 for(const raw of ['not json',{schemaVersion:2}, {...envelope(),evaluations:[{...envelope().evaluations[0],probabilities:{unsafe_pretext:2}}]}, {...envelope(),evaluations:[{...envelope().evaluations[0],model:'<script>'}]}])assert.equal(parseEvaluationEvidence(raw),null);
 const r=attempt(envelope());r.status='error';const s=jevSummary([attempt(envelope('matched')),attempt(envelope()),attempt(),r]);
 assert.equal(s.completed,3);assert.equal(s.available,2);assert.equal(s.counts.matched,1);assert.equal(s.counts['uncertain-block'],1);assert.equal(s.counts.unavailable,1);
 assert.equal(Object.values(s.counts).reduce((a,b)=>a+b,0),3);
});
test('Historical telemetry enrichment and CSV exports do not modify original request evidence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jev-evidence-'));try{
  const original=[attempt()],raw=JSON.stringify(original);writeFileSync(join(dir,'attempts.jsonl'),raw);
  writeFileSync(join(dir,'evaluation-evidence.jsonl'),JSON.stringify({schemaVersion:1,attemptId:'a',phase:'input',evidence:{...envelope(),source:'guard-telemetry'}})+'\n');
  const enriched=withEvaluationEvidence(dir,original);assert.equal(JSON.stringify(original),raw);assert.equal(readFileSync(join(dir,'attempts.jsonl'),'utf8'),raw);
  assert.equal(jevDetection(enriched[0]).status,'uncertain-block');assert.equal(jevDetection(enriched[0]).evidence?.source,'guard-telemetry');
  const csv='"attempt_id","reason"\n"a","quoted, reason"\n';const exported=detectionCsv(csv,enriched),rows=parse(exported,{columns:true}) as Record<string,string>[];
  assert.equal(rows[0].jev_verdict,'uncertain-block');assert.equal(rows[0].reason,'quoted, reason');
  assert.equal(detectionCsv(exported,enriched),exported,'Appending evidence columns is idempotent');
  const authoritative=attempt(envelope('matched'));assert.equal(jevDetection(withEvaluationEvidence(dir,[authoritative])[0]).status,'matched');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('CSV evidence refresh preserves benchmark columns that follow evidence fields',()=>{
 const csv='"attempt_id","jev_verdict","jev_model","jev_question_revision","jev_probabilities","jev_evidence_source","test_purpose","sample_kind"\n"a","stale","old","old","[]","","jailbreak-detection","attack-prompt"\n';
 const result=detectionCsv(csv,[attempt(envelope('matched'))]),row=(parse(result,{columns:true}) as Record<string,string>[])[0];
 assert.equal(row.jev_verdict,'matched');assert.equal(row.test_purpose,'jailbreak-detection');assert.equal(row.sample_kind,'attack-prompt');
 assert.equal(detectionCsv(result,[attempt(envelope('matched'))]),result);
});

test('Content safety evidence is independent of jailbreak and preserves uncertainty',()=>{
 const e=envelope();e.evaluations[0]={...e.evaluations[0],evaluatorId:'typesafe-jev-content-safety',capability:'content_safety',questionRevision:'content-safety-input.v1',probabilities:{unsafe_content:.4}};
 assert.equal(jevDetection(attempt(e)).status,'uncertain-block');
 assert.equal(parseEvaluationEvidence(e)?.evaluations[0].capability,'content_safety');
 assert.equal(parseEvaluationEvidence({...e,evaluations:[{...e.evaluations[0],capability:'jailbreak'}]}),null);
 assert.equal(parseEvaluationEvidence({...e,evaluations:[{...e.evaluations[0],probabilities:{jailbreak_attempt:.9}}]}),null);
 const csv=detectionCsv('"attempt_id"\n"a"\n',[attempt(e)]);
 const row=(parse(csv,{columns:true}) as Record<string,string>[])[0];
 assert.equal(row.jev_question_revision,'content-safety-input.v1');
 assert.match(row.jev_probabilities,/unsafe_content/);
});
