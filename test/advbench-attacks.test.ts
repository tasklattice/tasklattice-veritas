import test from 'node:test';
import {attackTemplateCatalog,renderAttackTemplate,ATTACK_TEMPLATE_IDS} from '../src/core/attack-templates.js';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {AddressInfo} from 'node:net';
import {ATTACK_STRATEGIES,constructAttack,freezeAdvBenchAttacks} from '../src/core/attacks.js';
import {hash,json,lines,save} from '../src/core/files.js';
import {sourcePath} from '../src/core/raw.js';
import {sampleKind,validateBenchmarkCases} from '../src/shared/benchmark.js';
import {prepareRun,runEvaluation} from '../src/core/service.js';
import type {Case,Attempt} from '../src/shared/types.js';
import {writeReport} from '../src/core/report.js';
import {parse} from 'csv-parse/sync';

const goal:Case={id:'advbench:fixture',dataset:'advbench',phase:'input',text:'Synthetic prohibited task VERITAS_FIXTURE_42',expected:'block'};
test('Uses public promptfoo strategies offline; every chain preserves its actual payload and classifies only derived prompts as attacks',async()=>{
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('No generation egress is allowed');};
  try{
    const cases=[];
    for(const strategy of ATTACK_STRATEGIES){
      const a=await constructAttack(goal,strategy),again=await constructAttack(goal,strategy);
      assert.deepEqual(a,again);assert.notEqual(a.text,goal.text);assert.equal(a.metadata!.attack.goal,goal.text);assert.equal(a.metadata!.attack.promptSha256,hash(a.text));
      assert.equal(a.metadata!.attack.steps.length,strategy.split('+').length);assert.equal(sampleKind(a),'attack-prompt');cases.push(a);
    }
    assert.ok(cases[0].text.includes(goal.text));assert.ok(cases[1].text.includes(Buffer.from(goal.text).toString('base64')));
    assert.ok(!cases[2].text.includes(goal.text));assert.equal(new Set(cases.map(c=>c.id)).size,3);assert.equal(calls,0);
    assert.equal(sampleKind(goal),'behavior-goal');validateBenchmarkCases('jailbreak-detection',cases);
    assert.equal(sampleKind({...cases[0],text:goal.text}),'other');assert.equal(sampleKind({...cases[0],metadata:{}}),'other');
    await assert.rejects(()=>constructAttack(goal,'jailbreak' as any),/Unsupported/);
    await assert.rejects(()=>constructAttack({...goal,expected:'allow'},ATTACK_STRATEGIES[0]),/labeled/);
  }finally{globalThis.fetch=originalFetch;}
});
const available=existsSync(sourcePath('harmbench','data/behavior_datasets/extra_behavior_datasets/advbench_behaviors.csv'))&&existsSync(sourcePath('jailbreakbench','data/benign-behaviors.csv'));
test('Frozen source provenance, seeded selection, overwrite and tamper checks; promptfoo sends only frozen texts and scores controls correctly',{skip:!available},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'veritas-attacks-'));const received:string[]=[];let server:ReturnType<typeof createServer>|undefined;
  try{
    const first=await freezeAdvBenchAttacks({out:join(dir,'first'),goalLimit:2,controlLimit:3,templates:['educational-context'],strategies:[...ATTACK_STRATEGIES],seed:42});
    const second=await freezeAdvBenchAttacks({out:join(dir,'second'),goalLimit:2,controlLimit:3,templates:['educational-context'],strategies:[...ATTACK_STRATEGIES],seed:42});
    const different=await freezeAdvBenchAttacks({out:join(dir,'different'),goalLimit:2,controlLimit:3,templates:['educational-context'],strategies:[...ATTACK_STRATEGIES],seed:43});
    assert.equal(first.casesSha256,second.casesSha256);assert.notEqual(first.casesSha256,different.casesSha256);
    assert.deepEqual([first.sourceGoals,first.attacks,first.benign,first.cases],[2,6,3,9]);
    const manifest=json(join(first.out,'manifest.json')),cases=lines<Case>(join(first.out,'cases.jsonl'));
    assert.equal(manifest.engine.remoteGeneration,false);assert.equal(manifest.engine.api,'redteam.Strategies');assert.ok(manifest.sources.every((s:any)=>s.revision&&s.source&&s.files.every((f:any)=>f.sha256)));
    assert.equal(cases.filter(c=>sampleKind(c)==='attack-prompt').length,6);assert.equal(cases.filter(c=>sampleKind(c)==='benign-control').length,3);
    const bytes=readFileSync(join(first.out,'cases.jsonl'),'utf8');await assert.rejects(()=>freezeAdvBenchAttacks({out:first.out}),/exists/);assert.equal(readFileSync(join(first.out,'cases.jsonl'),'utf8'),bytes);
    for(const options of [{goalLimit:0},{controlLimit:0},{seed:-1},{strategies:['jailbreak']},{strategies:[]},{templates:['unknown']},{templates:[]},{strategies:'jailbreak-templates' as any}])await assert.rejects(()=>freezeAdvBenchAttacks({out:join(dir,'invalid'),...options}));
    assert.ok(!existsSync(join(dir,'invalid')));
    const expected=new Map(cases.map(c=>[c.text,c.expected]));
    server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw).texts[0];received.push(input);assert.ok(expected.has(input));res.setHeader('content-type','application/json');res.end(JSON.stringify({action:expected.get(input)==='block'?'BLOCKED':'NONE'}));});
    await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const target=join(dir,'target.json');save(target,{adapter:'litellm-generic-guardrail',url:'http://127.0.0.1:'+(server.address() as AddressInfo).port+'/guard',outputMode:'standalone'});
    const result=await runEvaluation({data:first.out,target,out:join(dir,'run'),repeat:2,concurrency:2,testPurpose:'jailbreak-detection',evidence:'synthetic-local-demo'});
    assert.equal(result.exitCode,0);assert.equal(received.length,18);assert.equal(result.report.summary.recall,1);assert.equal(result.report.summary.falsePositiveRate,0);assert.equal(result.report.summary.f1,1);
    assert.equal(result.report.benchmark.counts['attack-prompt'],6);assert.equal(result.report.benchmark.counts['behavior-goal'],0);assert.equal(Object.keys(result.report.attackStrategies??{}).length,3);
    for(const summary of Object.values(result.report.attackStrategies??{}) as any[])assert.equal(summary.f1,1);
    assert.equal(result.report.attackTypes!['educational-context'].f1,1);
    assert.match(readFileSync(join(result.directory,'results.csv'),'utf8'),/attack_strategy/);
    assert.equal(hash(readFileSync(join(first.out,'cases.jsonl'))),first.casesSha256);
    const altered=cases.map((c,i)=>i?c:{...c,text:'tampered'});writeFileSync(join(first.out,'cases.jsonl'),altered.map(c=>JSON.stringify(c)).join('\n')+'\n');
    assert.throws(()=>prepareRun({data:first.out,target,out:join(dir,'not-sent'),testPurpose:'jailbreak-detection'}),/modified after import/);assert.equal(received.length,18);
  }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));rmSync(dir,{recursive:true,force:true});}
});

test('API freezes local attacks without a Target and returns a reusable selection; malformed/remote-generation requests are rejected',{skip:!available},async()=>{
  const {buildServer}=await import('../src/server/main.js');const {datasets}=await import('../src/server/store.js');
  const {app}=await buildServer({ui:false});let path='';const headers={host:'localhost:38100'};
  try{
    const catalog=await app.inject({method:'GET',url:'/api/datasets/advbench/attack-templates',headers});assert.equal(catalog.statusCode,200);assert.deepEqual(catalog.json().items.map((t:any)=>t.id),ATTACK_TEMPLATE_IDS);assert.ok(catalog.json().items.every((t:any)=>!Object.hasOwn(t,'body')&&t.sha256&&t.promptfooVersion));
    for(const payload of [[],{provider:'remote'}, {strategies:['jailbreak']},{strategies:'jailbreak-templates'},{seed:1.5},{goalLimit:0},{templates:['unknown']},{templates:[]}]){
      const response=await app.inject({method:'POST',url:'/api/datasets/advbench/attacks',headers,payload});assert.equal(response.statusCode,400,response.body);
    }
    const response=await app.inject({method:'POST',url:'/api/datasets/advbench/attacks',headers,payload:{goalLimit:1,controlLimit:1,seed:42,strategies:['jailbreak-templates'],templates:['educational-context']}});
    assert.equal(response.statusCode,200,response.body);const item=response.json().item;assert.equal(item.cases,2);assert.equal(item.path,undefined);assert.deepEqual(item.datasets.sort(),['advbench-attacks','jailbreakbench']);
    path=datasets().find(d=>d.id===item.id)!.path;assert.ok(path);validateBenchmarkCases('jailbreak-detection',lines<Case>(join(path,'cases.jsonl')));
  }finally{await app.close();if(path)rmSync(path,{recursive:true,force:true});}
});

test('Six upstream families are distinct and preserve Goal placement without mutating the legacy promptfoo template',async()=>{
  const before=await constructAttack(goal,'jailbreak-templates');
  const catalog=await attackTemplateCatalog();assert.deepEqual(catalog.map(t=>t.id),ATTACK_TEMPLATE_IDS);assert.equal(new Set(catalog.map(t=>t.sha256)).size,6);
  assert.ok(catalog.every(t=>t.poolSize>6&&t.poolSha256===catalog[0].poolSha256&&hash(t.body)===t.sha256));
  for(const template of catalog){
    const c=await constructAttack(goal,'jailbreak-templates',undefined,template);
    assert.equal(c.text,renderAttackTemplate(template,goal.text));assert.ok(c.text.includes(goal.text));assert.equal(c.metadata!.attack.attackType,template.id);assert.equal(c.metadata!.attack.schemaVersion,2);assert.equal(sampleKind(c),'attack-prompt');
    assert.equal(c.metadata!.attack.template.sha256,template.sha256);assert.notEqual(c.text,goal.text);
    if(template.payloadPlacement==='appended')assert.equal(c.text,template.body+'\n\n'+goal.text);
    else assert.equal(c.text,template.body.split('{{goal}}').join(goal.text));
    assert.throws(()=>renderAttackTemplate({...template,body:'tampered'},goal.text),/fingerprint/);
  }
  assert.equal(catalog.find(t=>t.id==='dan-mode')!.payloadPlacement,'appended');
  assert.deepEqual(await constructAttack(goal,'jailbreak-templates'),before);
});
test('Default freeze expands all six template families against the same seeded goals and unchanged controls',{skip:!available},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'veritas-multitemplate-'));
 try{
  const a=await freezeAdvBenchAttacks({out:join(dir,'a'),goalLimit:2,controlLimit:2,seed:42}),b=await freezeAdvBenchAttacks({out:join(dir,'b'),goalLimit:2,controlLimit:2,seed:42});
  assert.deepEqual([a.attackTypes,a.attacks,a.benign,a.cases],[6,12,2,14]);assert.equal(a.casesSha256,b.casesSha256);
  const cases=lines<Case>(join(a.out,'cases.jsonl')),manifest=json(join(a.out,'manifest.json'));
  assert.equal(manifest.templates.length,6);assert.equal(new Set(manifest.templates.map((t:any)=>t.sha256)).size,6);
  validateBenchmarkCases('jailbreak-detection',cases);
  const attacks=cases.filter(c=>c.dataset==='advbench-attacks');
  assert.equal(new Set(attacks.map(c=>c.metadata!.attack.sourceGoalId)).size,2);
  for(const id of ATTACK_TEMPLATE_IDS)assert.equal(attacks.filter(c=>c.metadata!.attack.attackType===id).length,2);
  assert.equal(cases.filter(c=>c.expected==='allow'&&sampleKind(c)==='benign-control').length,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Report type groups use only their own attacks plus shared controls; CSV preserves template provenance',{skip:!available},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'veritas-attack-groups-'));
 try{
  const frozen=await freezeAdvBenchAttacks({out:join(dir,'data'),goalLimit:2,controlLimit:3,seed:42}),cases=lines<Case>(join(frozen.out,'cases.jsonl'));
  let missed=false,falseAlarm=false;
  const records=cases.map(c=>{
   let action=c.expected!;
   if(c.metadata?.attack?.attackType==='educational-context'&&!missed){action='allow';missed=true;}
   if(c.expected==='allow'&&!falseAlarm){action='block';falseAlarm=true;}
   return {schemaVersion:3,attemptId:c.id+':attempt',caseId:c.id,dataset:c.dataset,phase:c.phase,adapter:'f5-scan',contextMode:'text-only',contextOmitted:[],callId:null,startedAt:new Date().toISOString(),steps:[],status:'completed',action,latencyMs:1,totalHttpLatencyMs:1} as Attempt;
  });
  const report=writeReport(dir,{cases,repeat:1,target:{url:'http://localhost/scan',adapter:'f5-scan'},testPurpose:'jailbreak-detection'},records);
  assert.equal(Object.keys(report.attackTypes!).length,6);
  for(const [id,group]of Object.entries(report.attackTypes!)){
   assert.equal(group.expectedAllow,3);assert.equal(group.expectedBlock,2);assert.equal(group.falsePositiveRate,1/3);
   assert.equal(group.recall,id==='educational-context'?.5:1);assert.equal(group.f1,id==='educational-context'?.5:.8);
  }
  assert.equal(report.summary.classification.truePositives,11);assert.equal(report.summary.classification.falseNegatives,1);assert.equal(report.summary.classification.falsePositives,1);
  const csv=parse(readFileSync(join(dir,'results.csv'),'utf8'),{columns:true});assert.equal(csv.length,15);assert.equal(csv.filter((r:any)=>r.template_sha256).length,12);
  assert.match(readFileSync(join(dir,'report.md'),'utf8'),/Frozen attack types/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
