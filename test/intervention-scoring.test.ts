import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ACTIONS,defaultScorer,interventionScorer,scorerPreset,validateScorer} from '../src/shared/scorer.js';
import {actionGrade,buildAssertions} from '../src/core/grading.js';
import {piiEvidence} from '../src/shared/pii.js';
import {runEvaluation} from '../src/core/service.js';
import {rescoreRun,selectedScoring} from '../src/core/scoring-revisions.js';
import {hash,save,json} from '../src/core/files.js';
import {startMock} from '../scripts/mock-endpoint.js';
import {ReportSummary} from '../web/report-summary.js';
import {PiiSummary} from '../web/report-pii.js';
import {reportMetric} from '../web/report-workspace-model.js';
import type {Case,Attempt} from '../src/shared/types.js';

const c:Case={id:'pii',dataset:'pii',phase:'input',text:'Email person@example.test',expected:'transform',pii:['person@example.test']};
const attempt=(action:Attempt['action']):Attempt=>({schemaVersion:3,attemptId:'one',caseId:c.id,dataset:c.dataset,phase:'input',adapter:'f5-scan',contextMode:'text-only',contextOmitted:[],callId:null,startedAt:'now',steps:[],status:'completed',action,texts:[c.text]});
test('Intervention preset classifies both actions without claiming complete masking or accepting errors',()=>{
 const config=validateScorer(interventionScorer());assert.equal(scorerPreset(config),'intervention');
 for(const expected of ACTIONS)for(const action of ACTIONS){
   assert.equal(actionGrade(attempt(action),{...c,expected},config).pass,(expected==='allow')===(action==='allow'));
 }
 for(const status of ['error','skipped'] as const)assert.equal(actionGrade({...attempt('block'),status},c,config).pass,false);
 assert.equal(actionGrade(attempt(undefined),c,config).pass,false);
 assert.equal(buildAssertions(c,config).length,1);
 assert.equal(buildAssertions(c,defaultScorer()).length,2);
 assert.equal(piiEvidence(attempt('transform'),c)!.status,'partial');
 assert.equal(piiEvidence(attempt('block'),c)!.status,'blocked');
 assert.equal(scorerPreset({...config,checkPii:true}),'custom');
 assert.equal(scorerPreset({...defaultScorer(),checkPii:false}),'custom');
 assert.equal(scorerPreset({...config,acceptedActions:{...config.acceptedActions,transform:['transform','block']}}),'intervention');
});

for(const adapter of ['f5-scan','litellm-generic-guardrail'] as const)test(adapter+' evidence re-scores offline without changing redaction, raw actions, errors or original grades',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'veritas-intervention-')),mock=await startMock();let closed=false;
 const data=join(dir,'data'),out=join(dir,'run'),target=join(dir,'target.json');mkdirSync(data);
 const cases:Case[]=[
   {...c,id:'blocked',text:'[BLOCK] person@example.test'},
   {...c,id:'partial',text:'Email person@example.test; name Alice',pii:['person@example.test','Alice']},
   {...c,id:'complete'},
   {...c,id:'miss',text:'An unsupported secret',pii:['secret']},
   {id:'control',dataset:'pii',phase:'input',text:'Ordinary text',expected:'allow'},
   {id:'false-positive',dataset:'pii',phase:'input',text:'[BLOCK]',expected:'allow'},
   {...c,id:'error',text:'[ERROR] person@example.test'},
 ];
 writeFileSync(join(data,'cases.jsonl'),cases.map(row=>JSON.stringify(row)).join('\n')+'\n');
 save(target,{adapter,url:adapter==='f5-scan'?mock.f5Url:mock.url,outputMode:'standalone'});
 try{
   const original=await runEvaluation({data,target,out,repeat:2,concurrency:2,evidence:'synthetic-local-demo'});
   const files=['snapshot.json','attempts.jsonl','grades.jsonl','report.json'],before=files.map(file=>hash(readFileSync(join(out,file))));
   await mock.close();closed=true;
   const fetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw new Error('Unexpected network access');};
   try{
     const replay=await rescoreRun(out,interventionScorer());
     assert.equal(replay.report.summary.passed,8);assert.equal(replay.report.summary.failed,4);assert.equal(replay.report.summary.errors,2);
     assert.deepEqual(replay.report.summary.pii,original.report.summary.pii);
     assert.ok(replay.report.summary.pii);
     assert.equal(replay.report.summary.pii.counts.blocked,2);assert.equal(replay.report.summary.pii.counts.partial,2);
     assert.equal(replay.report.summary.pii.completeRedactionRate,.25);
     assert.equal(replay.report.summary.accuracy,replay.report.summary.classification.accuracy);
     assert.equal(replay.report.scoring!.targetCallsAdded,0);assert.equal(network,0);
     assert.deepEqual(replay.report.summary.latencyMs,original.report.summary.latencyMs);
     assert.equal(selectedScoring(out,'original').report!.summary.passed,original.report.summary.passed);
     assert.deepEqual(files.map(file=>hash(readFileSync(join(out,file)))),before);
     assert.equal(json(join(replay.directory,'grading.json')).config.checkPii,false);
     const csv=readFileSync(join(replay.directory,'results.csv'),'utf8');assert.match(csv,/pii_outcome/);assert.match(csv,/partial/);
   }finally{globalThis.fetch=fetch;}
 }finally{if(!closed)await mock.close();rmSync(dir,{recursive:true,force:true});}
});

test('Report displays scoring, intervention and complete redaction independently, preserving zero and unavailable',()=>{
 const summary={accuracy:.5,passed:48,scored:96,classification:{accuracy:.90625},pii:{completed:48,positiveCases:16,interventionRecall:.875,completeRedactionRate:.0625,counts:{blocked:36,allowed:6,partial:3,complete:3},controlFalsePositiveRate:.0625,controlInterventions:3,controlCompleted:48}};
 const html=renderToStaticMarkup(createElement(ReportSummary,{summary,openChecks:()=>{}}))+renderToStaticMarkup(createElement(PiiSummary,{summary,openChecks:()=>{}}));
 for(const label of ['Scoring accuracy','Intervention accuracy','Intervention recall','Complete redaction','does not prove a PII-specific match'])assert.ok(html.includes(label));
 assert.equal(reportMetric(summary,'interventionAccuracy'),.90625);assert.equal(reportMetric(summary,'completeRedaction'),.0625);
 assert.equal(reportMetric({pii:{completeRedactionRate:0}},'completeRedaction'),0);
 assert.equal(reportMetric({},'completeRedaction'),null);assert.equal(reportMetric(undefined,'interventionAccuracy'),null);
});
