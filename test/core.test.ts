import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Provider, {validateTarget} from '../src/core/provider.js';
import { score } from '../src/core/scoring.js';
import { normalize, importDataset, loadRows } from '../src/core/datasets.js';
import { summarize } from '../src/core/report.js';
import { runEvaluation, compareRuns, gateReport, loadReport, prepareRun } from '../src/core/service.js';
import { root, save, json, lines } from '../src/core/files.js';
import { startMock } from '../scripts/mock-endpoint.js';
import type { Attempt, Case, JsonObject } from '../src/shared/types.js';
const fixture = (patch: Partial<Case> = {}): Case => ({id:'test',dataset:'fixture',phase:'input',text:'Safe',expected:'allow',...patch});
const call = async (p: Provider, patch: Partial<Case>) => JSON.parse((await p.callApi('',{vars:{case:fixture(patch)}})).output) as Attempt;

test('LiteLLM paired output, input rejection, errors, PII removal and standalone', async()=>{
 const mock=await startMock();try{
  const p=new Provider({config:{target:{url:mock.url}}});
  const r=await call(p,{phase:'output',prompt:'Safe input',text:'[BLOCK]',expected:'block'});
  assert.equal(r.action,'block');assert.equal(r.steps.length,2);assert.equal(r.steps[0].request.litellm_call_id,r.steps[1].request.litellm_call_id);
  assert.equal(r.steps[1].request.guardrail_context.query,'Safe input');
  const skipped=await call(p,{phase:'output',prompt:'[BLOCK]',text:'Never sent'});assert.equal(skipped.status,'skipped');assert.equal(skipped.steps.length,1);
  for(const text of ['[ERROR]','[MALFORMED]','[UNKNOWN]','[NO_ROUTE]']){const e=await call(p,{text});assert.equal(e.status,'error');assert.equal(score(e,{expected:'block'}).pass,false);}
  const pii=await call(p,{text:'Email person@example.test'});assert.ok(score(pii,{expected:'transform',text:'Email person@example.test',pii:['person@example.test']}).pass);
  const single=await call(new Provider({config:{target:{url:mock.url,outputMode:'standalone'}}}),{phase:'output'});assert.equal(single.steps.length,1);assert.equal(single.callId,null);assert.equal(single.status,'completed');
 }finally{await mock.close();}
});
test('F5 response scan, independent context, Bearer credential scrubbing and strict outcome parsing',async()=>{
 const key='synthetic-fixture-key';process.env.VERITAS_TEST_KEY=key;const mock=await startMock({apiKey:key});const dir=mkdtempSync(join(tmpdir(),'veritas-f5-'));
 try{
  const p=new Provider({config:{target:{adapter:'f5-scan',url:mock.f5Url,apiKeyEnv:'VERITAS_TEST_KEY'},evidencePath:join(dir,'attempts.jsonl')}});
  const ids=new Set();
  for(const phase of ['input','output'] as const) for(const [text,expected] of [['safe','allow'],['[BLOCK]','block'],['person@example.test','transform']] as const){
   const r=await call(p,{phase,text,expected,prompt:'[BLOCK]',messages:[{role:'user',content:'History'}]});assert.equal(r.status,'completed');assert.equal(r.action,expected);assert.equal(r.steps.length,1);assert.equal(r.callId,null);assert.deepEqual(r.contextOmitted,['prompt','messages']);assert.equal(r.steps[0].request.scanDirection,phase==='input'?'request':'response');assert.equal(r.steps[0].request.flagOnly,false);ids.add(r.scanId);
  }assert.equal(ids.size,6);
  for(const text of ['[ERROR]','[NO_ROUTE]','[MALFORMED]','[UNKNOWN]','[FLAGGED]','[MISSING_TEXT]','[MISSING_ID]','[BAD_OUTPUT]']) assert.equal((await call(p,{phase:'output',text})).status,'error',text);
  const leak=await call(p,{phase:'output',text:'[LEAK_OUTPUT] person@example.test'});assert.equal(score(leak,{expected:'transform',pii:['person@example.test']}).pass,false);
  await call(p,{text:'[ECHO_CREDENTIAL]'});assert.ok(!readFileSync(join(dir,'attempts.jsonl'),'utf8').includes(key));assert.ok(mock.requests.every(r=>r.bearerPresent&&!r.apiKeyPresent&&r.authValid));
  const timeout=await call(new Provider({config:{target:{url:mock.f5Url,adapter:'f5-scan',apiKeyEnv:'VERITAS_TEST_KEY',timeoutMs:10}}}),{text:'[TIMEOUT]'});assert.equal(timeout.status,'error');assert.match(timeout.error!,/timeout/i);
 }finally{delete process.env.VERITAS_TEST_KEY;await mock.close();rmSync(dir,{recursive:true,force:true});}
});
test('Target validation prevents inline credentials, adapter confusion and unsupported F5 pairing',()=>{
 for(const patch of [{url:'file:///tmp/a'},{url:'http://u:secret@example.test'},{url:'http://example.test?key=secret'},{apiKey:'secret'},{headers:{}},{adapter:'f5-scan',outputMode:'paired'},{adapter:'f5-scan',flagOnly:true},{adapter:'typo'}]) assert.throws(()=>validateTarget({url:'http://example.test',...patch}));
 assert.equal(validateTarget({url:'http://example.test'}).outputMode,'paired');assert.equal(validateTarget({url:'http://example.test',adapter:'f5-scan'}).outputMode,'standalone');
});
test('Dataset semantics: source labels, explicit split policies and unknown expectations',()=>{
 const opts={phase:'both' as const,split:'train',config:'default'};
 assert.equal(normalize('wildjailbreak',{adversarial:'text',data_type:'adversarial_harmful',label:'1'},opts)[0].expected,'block');
 assert.equal(normalize('wildjailbreak',{adversarial:'text',data_type:'adversarial_benign',label:'0'},opts)[0].expected,'allow');
 assert.throws(()=>normalize('wildjailbreak',{adversarial:'text',data_type:'adversarial_benign',label:'1'},opts));
 const aegis=normalize('aegis',{id:1,prompt:'Input',response:'Output',prompt_label:'safe',response_label:'unsafe'},opts);assert.deepEqual(aegis.map(c=>c.expected),['allow','block']);assert.equal(aegis[1].prompt,'Input');
 const rows: [string,JsonObject,JsonObject,string|null][]=[['toxicchat',{user_input:'text',toxicity:1},{},'block'],['moderation',{prompt:'text',labels:{S:false,H:false,V:false,HR:false,SH:false,S3:false,H2:false,V2:false}},{},'allow'],['beavertails',{prompt:'Input',response:'Output',is_safe:false},{},'block'],['do-not-answer',{question:'text'},{},'block'],['harmbench',{Behavior:'text',FunctionalCategory:'contextual'},{},null],['jailbreakbench',{Goal:'text'},{split:'benign'},'allow'],['deepset',{text:'text',label:1},{},'block'],['gandalf',{text:'text'},{},'block'],['xstest',{prompt:'text',label:'safe'},{},'allow'],['or-bench',{prompt:'text'},{config:'or-bench-hard-1k'},'allow'],['pii',{source_text:'Contact Alice',privacy_mask:[{value:'Alice'}]},{},'transform'],['topic-control',{domain:'banking',conversation:[{role:'user',content:'text'}]},{domain:'banking'},null],['safety-prompts',{prompt:'text'},{field:'Insult'},null]];
 for(const [d,row,extra,expected] of rows)assert.equal(normalize(d,row,{...opts,...extra})[0].expected,expected,d);
});
test('Native loaders preserve Chinese across stream chunks, imports are immutable, review labels cannot silently misapply',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'veritas-data-'));try{const source=join(dir,'source.json');const text='测试中文'.repeat(30000);save(source,[{prompt:text,label:'safe'}]);const rows=[];for await(const row of loadRows(source))rows.push(row);assert.equal(rows[0].prompt,text);const out=join(dir,'data');await importDataset({dataset:'xstest',file:source,out,limit:0});assert.equal(lines<Case>(join(out,'cases.jsonl'))[0].text,text);await assert.rejects(importDataset({dataset:'xstest',file:source,out}));save(join(dir,'labels.json'),{absent:'allow'});await assert.rejects(importDataset({dataset:'xstest',file:source,out:join(dir,'bad'),labels:join(dir,'labels.json')}));}finally{rmSync(dir,{recursive:true,force:true});}
});
test('Reports separate accuracy from coverage and measure action instability',()=>{
 const c=fixture();const base={schemaVersion:3,caseId:c.id,dataset:c.dataset,phase:c.phase,steps:[],adapter:'f5-scan',contextMode:'text-only',contextOmitted:[],callId:null,startedAt:'',latencyMs:1} as const;
 const records=[{...base,attemptId:'a',status:'completed',action:'allow'},{...base,attemptId:'b',status:'completed',action:'block'},{...base,attemptId:'c',status:'error'}] as unknown as Attempt[];
 const s=summarize(records,[c],4);assert.equal(s.accuracy,.5);assert.equal(s.coverage,.5);assert.equal(s.missing,1);assert.equal(s.unstableRate,1);assert.equal(gateReport({summary:s}).pass,false);
});
test('Direct SDK: concurrency, repeat, baseline compatibility, replay and quality versus execution failures',async()=>{
 const mock=await startMock();const dir=mkdtempSync(join(tmpdir(),'veritas-sdk-'));try{
  const data=join(dir,'data');await importDataset({dataset:'veritas',file:join(root,'examples/endpoint-smoke.jsonl'),out:data,limit:0});
  for(const [adapter,url,calls] of [['f5-scan',mock.f5Url,12],['litellm-generic-guardrail',mock.url,18]] as const){
   const target=join(dir,adapter+'.json');save(target,{adapter,url});const options={data,target,repeat:2,concurrency:2,evidence:'synthetic-local-demo' as const};let progress=0;
   const a=await runEvaluation({...options,out:join(dir,adapter),onProgress:n=>progress=n});assert.equal(a.exitCode,0,JSON.stringify(a.gate));assert.equal(a.report.summary.completed,12);assert.equal(a.report.summary.httpCalls,calls);assert.equal(progress,12);assert.equal(a.report.summary.unstableRate,0);
   const before=mock.requests.length;assert.equal(loadReport(a.directory).summary.passed,12);assert.equal(mock.requests.length,before);
   const b=await runEvaluation({...options,out:join(dir,adapter+'-next'),baseline:a.directory});assert.equal(compareRuns(a.directory,b.directory).accuracyDrop,0);
   assert.throws(()=>prepareRun({...options,repeat:1,out:'unused',baseline:a.directory}),/Incompatible/);
  }
  const source=join(dir,'bad.jsonl');writeFileSync(source,JSON.stringify(fixture({text:'Safe',expected:'block'}))+'\n');await importDataset({dataset:'veritas',file:source,out:join(dir,'bad-data')});
  const t=join(dir,'f5-scan.json');const mismatch=await runEvaluation({data:join(dir,'bad-data'),target:t,out:join(dir,'quality')});assert.equal(mismatch.exitCode,1);
  writeFileSync(source,JSON.stringify(fixture({text:'[ERROR]',expected:'block'}))+'\n');await importDataset({dataset:'veritas',file:source,out:join(dir,'error-data')});const error=await runEvaluation({data:join(dir,'error-data'),target:t,out:join(dir,'error')});assert.equal(error.exitCode,2);assert.equal(error.report.summary.errors,1);
  writeFileSync(source,Array.from({length:4},(_,i)=>JSON.stringify(fixture({id:String(i),text:'[SLOW]'}))).join('\n')+'\n');await importDataset({dataset:'veritas',file:source,out:join(dir,'slow-data')});assert.equal((await runEvaluation({data:join(dir,'slow-data'),target:t,out:join(dir,'slow'),concurrency:2})).exitCode,0);assert.ok(mock.maxInFlight>=2);
 }finally{await mock.close();rmSync(dir,{recursive:true,force:true});}
});
