import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaultScorer,protectionScorer,validateScorer} from '../src/shared/scorer.js';
import {runEvaluation,loadReport,compareRuns} from '../src/core/service.js';
import {rescoreRun,selectedScoring,scoringHistory,activeScoringId} from '../src/core/scoring-revisions.js';
import {readEvidence,gradeEvidenceSummary,savedGrades} from '../src/core/grading.js';
import {root,save,json,hash,lines} from '../src/core/files.js';
import {startMock} from '../scripts/mock-endpoint.js';
import {buildServer} from '../src/server/main.js';
import type {Case,SavedGrade} from '../src/shared/types.js';

test('Scoring configurations accept data-only rules and reject executable assertions and ambiguous matrices',()=>{
  assert.deepEqual(validateScorer(),defaultScorer());
  assert.deepEqual(validateScorer(protectionScorer()).acceptedActions.block,['block','transform']);
  for(const value of [{...defaultScorer(),provider:'http://example.test'},{...defaultScorer(),schemaVersion:2},{...defaultScorer(),checkPii:'yes'},
    {...defaultScorer(),acceptedActions:{allow:[],block:['block'],transform:['transform']}},
    {...defaultScorer(),assertions:[{type:'javascript',value:'process.env',scope:'all'}]},
    {...defaultScorer(),assertions:[{type:'contains',value:'',scope:'all'}]},
    {...defaultScorer(),assertions:[{type:'is-json',value:'file:///tmp/secret',scope:'all'}]}]) assert.throws(()=>validateScorer(value));
});

test('promptfoo re-scores immutable evidence offline, preserves original errors/latency/repeats, and versions native text assertions',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'veritas-rescore-')),mock=await startMock({apiKey:'fixture-key'});let closed=false;
  const data=join(dir,'data'),out=join(dir,'run'),target=join(dir,'target.json');mkdirSync(data);
  const cases:Case[]=[
    {id:'protect',dataset:'fixture',phase:'input',text:'Contact person@example.test',expected:'block'},
    {id:'leak',dataset:'fixture',phase:'output',text:'[LEAK_OUTPUT] person@example.test',expected:'transform',pii:['person@example.test']},
    {id:'safe',dataset:'fixture',phase:'input',text:'Safe',expected:'allow'},
    {id:'error',dataset:'fixture',phase:'input',text:'[ERROR]',expected:'block'},
  ];
  writeFileSync(join(data,'cases.jsonl'),cases.map(c=>JSON.stringify(c)).join('\n')+'\n');
  process.env.VERITAS_RESCORE_FIXTURE_KEY='fixture-key';save(target,{url:mock.f5Url,adapter:'f5-scan',apiKeyEnv:'VERITAS_RESCORE_FIXTURE_KEY'});
  try{
    const first=await runEvaluation({data,target,out,repeat:2,concurrency:2,evidence:'synthetic-local-demo'});assert.equal(first.exitCode,2);assert.equal(first.report.summary.passed,2);
    assert.equal(first.report.summary.failed,4);assert.equal(first.report.summary.errors,2);assert.equal(lines<SavedGrade>(join(out,'grades.jsonl')).length,8);
    const configured=await runEvaluation({data,target,out:join(dir,'configured'),scorer:protectionScorer(),repeat:2,concurrency:2,evidence:'synthetic-local-demo'});
    assert.equal(configured.report.summary.passed,4);assert.deepEqual(json(join(configured.directory,'snapshot.json')).scorerConfig,protectionScorer());
    const nativeConfig=json(join(configured.directory,'promptfooconfig.json'));assert.deepEqual(nativeConfig.tests[0].vars.scorer,protectionScorer());assert.match(nativeConfig.tests[0].assert[0].value,/action-assertion.ts$/);
    const immutable=['snapshot.json','attempts.jsonl','grades.jsonl','report.json','results.csv','gate.json','promptfoo-results.json'].map(file=>[file,hash(readFileSync(join(out,file)))]);
    const before=mock.requests.length;await mock.close();closed=true;delete process.env.VERITAS_RESCORE_FIXTURE_KEY;
    const fetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw new Error('Offline scoring attempted network access');};
    try{
      const relaxed=await rescoreRun(out,protectionScorer());assert.equal(relaxed.report.summary.passed,4);assert.equal(relaxed.report.summary.failed,2);assert.equal(relaxed.report.summary.falseNegativeRate,0);
      assert.equal(relaxed.report.summary.errors,2);assert.equal(relaxed.report.summary.completed,6);assert.equal(relaxed.report.summary.coverage,first.report.summary.coverage);
      assert.equal(relaxed.report.datasets.fixture.passed,relaxed.report.summary.passed);assert.equal(relaxed.report.groups['fixture/input'].passed,4);assert.equal(relaxed.report.datasets.fixture.falseNegativeRate,0);
      assert.deepEqual(relaxed.report.summary.latencyMs,first.report.summary.latencyMs);assert.equal(relaxed.report.summary.httpCalls,8);assert.equal(relaxed.report.scoring!.targetCallsAdded,0);
      const noPii=await rescoreRun(out,{...protectionScorer(),name:'Protection without PII check',checkPii:false});assert.equal(noPii.report.summary.passed,6);
      const text=await rescoreRun(out,{...protectionScorer(),name:'Require clean transformed text',checkPii:false,assertions:[{type:'not-contains',value:'person@example.test',scope:'transformed'}]});
      assert.equal(text.report.summary.passed,4);const grades=lines<SavedGrade>(join(text.directory,'grades.jsonl'));
      assert.equal(grades.find(g=>g.caseId==='leak')!.grade.actionPass,true);assert.ok(grades.find(g=>g.caseId==='leak')!.grade.components!.some(c=>!c.pass&&c.name==='Text check 1'));
      assert.equal(selectedScoring(out,'original').report!.summary.passed,2);assert.equal(loadReport(out).summary.passed,2);
      assert.equal(activeScoringId(out),text.id);assert.equal(scoringHistory(out).length,4);assert.equal(selectedScoring(out,relaxed.id).report!.summary.passed,4);
      assert.equal(network,0);assert.equal(mock.requests.length,before);
      for(const[file,digest]of immutable)assert.equal(hash(readFileSync(join(out,file))),digest,file);
      assert.match(readFileSync(join(text.directory,'results.csv'),'utf8'),/scoring_id/);assert.ok(readFileSync(join(text.directory,'results.csv'),'utf8').includes(text.id));
      assert.throws(()=>compareRuns(out,out,'original',relaxed.id),/scoring rules/);
      const stable=activeScoringId(out);await assert.rejects(rescoreRun(out,{...defaultScorer(),assertions:[{type:'javascript',value:'bad',scope:'all'}]}));assert.equal(activeScoringId(out),stable);
      const terminal=readFileSync(join(out,'execution.json'));rmSync(join(out,'execution.json'));await assert.rejects(rescoreRun(out,defaultScorer()),/finish/);writeFileSync(join(out,'execution.json'),terminal);
      const controller=new AbortController();controller.abort();await assert.rejects(rescoreRun(out,defaultScorer(),{signal:controller.signal}));assert.equal(activeScoringId(out),stable);
      assert.ok(!readdirSync(join(out,'scorings')).some(v=>v.startsWith('.pending')));
      const evidence=readFileSync(join(out,'attempts.jsonl'));writeFileSync(join(out,'attempts.jsonl'),Buffer.concat([evidence,Buffer.from('\n')]));
      assert.throws(()=>selectedScoring(out,text.id),/modified/);writeFileSync(join(out,'attempts.jsonl'),evidence);
      const saved=readFileSync(join(text.directory,'grades.jsonl'));writeFileSync(join(text.directory,'grades.jsonl'),saved.toString().replace('"pass":true','"pass":false'));
      assert.throws(()=>selectedScoring(out,text.id),/modified/);writeFileSync(join(text.directory,'grades.jsonl'),saved);
    }finally{globalThis.fetch=fetch;}
  }finally{delete process.env.VERITAS_RESCORE_FIXTURE_KEY;if(!closed)await mock.close();rmSync(dir,{recursive:true,force:true});}
});

test('Offline grading preserves paired-output skips and supports native JSON/equals checks without a Target',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'veritas-replay-skipped-')),mock=await startMock();let closed=false;
  try{
    const data=join(dir,'data'),target=join(dir,'target.json'),out=join(dir,'run');mkdirSync(data);
    const rows=[{id:'skipped',dataset:'fixture',phase:'output',prompt:'[BLOCK]',text:'Never scanned',expected:'allow'},
      {id:'json',dataset:'fixture',phase:'input',text:'{"email":"person@example.test"}',expected:'transform'}];
    writeFileSync(join(data,'cases.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');save(target,{url:mock.url,adapter:'litellm-generic-guardrail'});
    const original=await runEvaluation({data,target,out});assert.equal(original.report.summary.skipped,1);await mock.close();closed=true;
    const config={...defaultScorer(),name:'JSON returned text',assertions:[{type:'is-json' as const,scope:'all' as const},{type:'equals' as const,value:'{"email":"[EMAIL]"}',scope:'all' as const}]};
    const result=await rescoreRun(out,config);assert.equal(result.report.summary.skipped,1);assert.equal(result.report.summary.completed,1);assert.equal(result.report.summary.passed,1);assert.equal(result.report.summary.coverage,.5);
    assert.equal(selectedScoring(out,result.id).saved!.grades.size,2);
  }finally{if(!closed)await mock.close();rmSync(dir,{recursive:true,force:true});}
});

test('Report API selects one scoring version consistently for summary, filters, individual checks and exports',async()=>{
  const name='scoring-api-'+randomUUID(),out=join(root,'runs',name),id=Buffer.from(name).toString('base64url'),dir=mkdtempSync(join(tmpdir(),'veritas-score-api-'));
  const data=join(dir,'data'),target=join(dir,'target.json'),mock=await startMock(),{app,store}=await buildServer({ui:false}),headers={host:'localhost:38100'};let closed=false;
  try{
    mkdirSync(data);writeFileSync(join(data,'cases.jsonl'),JSON.stringify({id:'a',dataset:'fixture',phase:'input',text:'person@example.test',expected:'block'})+'\n');save(target,{url:mock.f5Url,adapter:'f5-scan'});
    const original=await runEvaluation({data,target,out});assert.equal(original.exitCode,1);const digest=hash(readFileSync(join(out,'attempts.jsonl')));await mock.close();closed=true;
    const result=await app.inject({method:'POST',url:'/api/runs/'+id+'/rescore',headers,payload:{scorer:protectionScorer()}});assert.equal(result.statusCode,200,result.body);const version=result.json().id;
    const detail=(await app.inject({url:'/api/runs/'+id,headers})).json();assert.equal(detail.scoring.selectedId,version);assert.equal(detail.report.summary.accuracy,1);assert.equal(detail.run.gate.pass,true);assert.equal(detail.scoring.versions.length,2);
    const old=(await app.inject({url:'/api/runs/'+id+'?scoring=original',headers})).json();assert.equal(old.report.summary.accuracy,0);assert.equal(old.run.gate.pass,false);
    const path='/api/runs/'+id+'/attempts?filter=unexpected&scoring=';
    assert.equal((await app.inject({url:path+version,headers})).json().total,0);const originalPage=(await app.inject({url:path+'original',headers})).json();assert.equal(originalPage.total,1);
    const check=originalPage.items[0].attemptId;assert.equal((await app.inject({url:'/api/runs/'+id+'/attempts/'+check+'?scoring='+version,headers})).json().attempt.grade.pass,true);
    const csv=await app.inject({url:'/api/runs/'+id+'/files/results.csv?scoring='+version,headers});assert.ok(csv.body.includes(version));assert.ok(!csv.body.includes('"false"'));
    const config=(await app.inject({url:'/api/runs/'+id+'/files/scorer.json?scoring='+version,headers})).json();assert.deepEqual(config,protectionScorer());
    assert.equal((await app.inject({url:'/api/runs/'+id+'?scoring=s-00000000-0000-0000-0000-000000000000',headers})).statusCode,404);
    assert.equal((await app.inject({method:'POST',url:'/api/runs/'+id+'/rescore',headers,payload:{scorer:{...defaultScorer(),provider:'remote'}}})).statusCode,400);
    const pending=store.rescore(id,defaultScorer());assert.throws(()=>store.remove(id),/re-scoring/);await assert.rejects(store.rescore(id,defaultScorer()),/Wait/);await pending;
    assert.equal(hash(readFileSync(join(out,'attempts.jsonl'))),digest);
  }finally{await app.close();if(!closed)await mock.close();rmSync(out,{recursive:true,force:true});rmSync(dir,{recursive:true,force:true});}
});


test('SDK grade projection preserves grading and attempt identity without duplicating large raw evidence',()=>{
 const text='x'.repeat(1_000_000), gradingResult={pass:true,score:1,reason:'Matched',componentResults:[{pass:true,score:1,reason:'Matched',assertion:{metric:'Action match'}}]};
 const stats={successes:1,failures:0,errors:0};
 const native={version:3,stats,results:[{vars:{case:{id:'case-1',text,metadata:{text}},attempt:{attemptId:'attempt-1',text}},response:{output:text,metadata:{attemptId:'attempt-1'}},gradingResult,success:true}]};
 const compact=gradeEvidenceSummary(native);
 assert.deepEqual(compact.stats,stats);assert.strictEqual(compact.results[0].gradingResult,gradingResult);
 assert.ok(JSON.stringify(compact).length<1500);assert.equal(native.results[0].vars.case.text,text);
 const records=[{attemptId:'attempt-1',caseId:'case-1',status:'completed',action:'allow'}] as any;
 assert.deepEqual(savedGrades(compact,records),savedGrades(native,records));
});
