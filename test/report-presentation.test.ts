import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildServer} from '../src/server/main.js';
import {root,hash} from '../src/core/files.js';
import {decisionResult,outcomeSegments,reportAttention} from '../web/report-model.js';

const grade={pass:false,score:0,reason:'Test mismatch'};
test('Report labels distinguish decision mismatches, unknown scoring and transport failures',()=>{
  assert.equal(decisionResult({status:'completed',expected:'allow',action:'block',grade}).label,'False positive');
  assert.equal(decisionResult({status:'completed',expected:'block',action:'transform',grade}).label,'Missed block');
  assert.equal(decisionResult({status:'completed',expected:'transform',action:'transform',grade}).label,'Transformation mismatch');
  assert.equal(decisionResult({status:'completed',expected:null,action:'allow',grade}).label,'Expectation needs review');
  assert.equal(decisionResult({status:'completed',expected:'block',action:'allow'}).label,'Unscored');
  assert.equal(decisionResult({status:'error',expected:'block',grade}).label,'Execution error');
  assert.equal(decisionResult({status:'skipped',expected:'block',grade}).label,'Skipped');
});

test('Report outcomes keep noncompleted checks separate and never call an incomplete test fully matched',()=>{
  const summary={passed:4,failed:2,errors:1,skipped:1,missing:2,completed:6,plannedAttempts:10};
  assert.deepEqual(outcomeSegments(summary).map(s=>s.value),[4,2,1,1,2]);
  assert.equal(outcomeSegments(summary).reduce((n,s)=>n+(s.value??0),0),summary.plannedAttempts);
  assert.equal(reportAttention({status:'completed'},summary).tone,'danger');
  assert.equal(reportAttention({status:'running'},summary).label,'Testing in progress');
  assert.equal(reportAttention({status:'cancelled'},{passed:4,completed:4}).label,'Test incomplete');
  assert.equal(reportAttention({status:'completed'},{completed:0}).label,'No completed checks');
  assert.equal(reportAttention({status:'completed'},{passed:4,completed:4}).label,'All completed checks matched');
  assert.equal(outcomeSegments({passed:0,failed:1}).find(s=>s.key==='errors')!.value,null);
});

test('Report preview API uses bounded Unicode from the frozen sample, with scoped counts and historical grading intact',async()=>{
  const name='preview-test-'+randomUUID(),id=Buffer.from(name).toString('base64url'),dir=join(root,'runs',name),{app}=await buildServer({ui:false}),headers={host:'localhost:38100'};
  const text='😀'.repeat(321)+' saved text';
  const cases=[{id:'unexpected',dataset:'source-a',phase:'input',text,expected:'block'},{id:'matched',dataset:'source-b',phase:'input',text:'Frozen original 中文',expected:'allow'},{id:'error',dataset:'source-a',phase:'input',text:'Transport failure',expected:'block'},{id:'skipped',dataset:'source-a',phase:'output',text:'Skipped response',expected:'block'}];
  const snapshot={schemaVersion:3,scorerHash:hash(readFileSync(join(root,'src/core/scoring.ts'))),createdAt:new Date().toISOString(),target:{adapter:'f5-scan',url:'http://127.0.0.1:1/unused'},cases,repeat:1,concurrency:1};
  const records=cases.map((c,i)=>({attemptId:'attempt-'+c.id,caseId:c.id,dataset:c.dataset,phase:c.phase,status:i===2?'error':i===3?'skipped':'completed',action:i<2?'allow':undefined,steps:[],latencyMs:1}));
  try{
    mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'snapshot.json'),JSON.stringify(snapshot));writeFileSync(join(dir,'attempts.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
    const page=(await app.inject({url:'/api/runs/'+id+'/attempts?filter=unexpected&limit=1&dataset=source-a',headers})).json();
    assert.equal(page.total,1);assert.equal(page.allTotal,4);assert.equal(page.datasetTotal,3);assert.equal(page.unexpected,1);assert.equal(page.errors,1);assert.equal(page.skipped,1);
    assert.equal(page.items[0].samplePreview,'😀'.repeat(320));assert.equal(page.items[0].sampleTruncated,true);assert.equal(page.items[0].grade.pass,false);assert.equal(page.items[0].expected,'block');
    const second=(await app.inject({url:'/api/runs/'+id+'/attempts?filter=unexpected&limit=1&offset=1',headers})).json();assert.equal(second.total,1);assert.equal(second.items.length,0);
    const detail=(await app.inject({url:'/api/runs/'+id+'/attempts/attempt-unexpected',headers})).json();assert.equal(detail.sample.text,text);
    const matched=(await app.inject({url:'/api/runs/'+id+'/attempts?dataset=source-b',headers})).json();assert.equal(matched.items[0].samplePreview,'Frozen original 中文');assert.equal(matched.items[0].sampleTruncated,false);assert.equal(matched.unexpected,0);assert.equal(matched.errors,0);assert.equal(matched.skipped,0);
    writeFileSync(join(dir,'snapshot.json'),JSON.stringify({...snapshot,scorerHash:'historical-implementation'}));
    const historical=(await app.inject({url:'/api/runs/'+id+'/attempts?filter=unexpected',headers})).json();assert.equal(historical.total,0);
    const historicalDetail=(await app.inject({url:'/api/runs/'+id+'/attempts/attempt-unexpected',headers})).json();assert.equal(historicalDetail.attempt.grade,undefined);assert.equal(historicalDetail.attempt.samplePreview,'😀'.repeat(320));
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
