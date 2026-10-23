import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {catalog, loadRows, normalize, importDataset} from '../src/core/datasets.js';
import {benchmarkScope, sampleKind, validateBenchmarkCases, validatePurpose} from '../src/shared/benchmark.js';
import {resolveDatasetSelections} from '../src/server/prepare-evaluation.js';
import {prepareRun, runEvaluation, compatibleSnapshots} from '../src/core/service.js';
import {withClassification} from '../src/core/classification.js';
import {buildDatasetCards} from '../src/server/dataset-cards.js';
import {initialTestingDraft, testingSelections, defaultDatasetOptions} from '../web/testing-model.js';
import {buildRowIndex, readRowPage} from '../src/server/dataset-viewer.js';
import {sourcePath} from '../src/core/raw.js';
import {json, root, hash, save} from '../src/core/files.js';
import {buildServer} from '../src/server/main.js';
import {saveTarget, deleteTarget, datasets} from '../src/server/store.js';
import {isActiveRun} from '../src/shared/testing.js';
import {startMock} from '../scripts/mock-endpoint.js';
import type {Case, RunRequest} from '../src/shared/types.js';
const options = {phase:'input' as const, config:'PAIR/black_box/vicuna-13b-v1.5', split:'attacks'};
const attack = () => normalize('jailbreakbench-attacks', {index:0, goal:'Goal is not the request', prompt:'[BLOCK] synthetic attack attempt', response:'Response is not the request', category:'fixture', jailbroken:false}, options)[0];
const benign = () => normalize('jailbreakbench', {Goal:'Safe control', Index:1}, {...options, config:'behaviors',split:'benign'})[0];
const goal = () => normalize('jailbreakbench', {Goal:'Behavior goal', Index:2}, {...options,config:'behaviors',split:'harmful'})[0];

test('Artifact conversion sends only submitted prompts, including failed attacks, and never falls back to goals or responses', () => {
  const c=attack(); assert.equal(c.text,'[BLOCK] synthetic attack attempt');assert.equal(c.expected,'block');assert.equal(c.prompt,undefined);
  assert.equal(c.metadata?.upstreamJailbroken,false);assert.equal(c.metadata?.method,'PAIR');assert.equal(c.metadata?.attackedModel,'vicuna-13b-v1.5');
  for(const prompt of [undefined,null,'','  ','REDACTED']) assert.equal(normalize('jailbreakbench-attacks',{prompt,goal:'Goal',response:'Response',jailbroken:true},options).length,0);
  assert.equal(sampleKind(goal()),'behavior-goal');assert.equal(sampleKind(benign()),'benign-control');
  assert.throws(()=>validateBenchmarkCases('jailbreak-detection',[goal()]),/behavior goals/);
  assert.throws(()=>validateBenchmarkCases('jailbreak-detection',[benign()]),/at least one attack/);
  assert.throws(()=>validateBenchmarkCases('jailbreak-detection',[{...attack(),phase:'output'}]),/behavior goals/);
  assert.throws(()=>validateBenchmarkCases('jailbreak-detection',[{...goal(),dataset:'advbench'}]),/behavior goals/);
  assert.throws(()=>validatePurpose(null));assert.throws(()=>validatePurpose('not-a-purpose'));
  validateBenchmarkCases('jailbreak-detection',[attack(),benign()]);validateBenchmarkCases(undefined,[goal()]);
});

test('Nested upstream artifacts are browsable with pagination and imported with missing-prompt counts', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'veritas-artifact-')),file=join(dir,'artifact.json');
  try {
    writeFileSync(file,JSON.stringify({parameters:{method:'PAIR'},jailbreaks:[{index:0,prompt:'[BLOCK] fixture',jailbroken:false},{index:1,prompt:null,goal:'not a fallback'},{index:2,prompt:'Second attack',jailbroken:true}]}));
    const rows=[];for await(const row of loadRows(file))rows.push(row);assert.equal(rows.length,3);
    await importDataset({dataset:'jailbreakbench-attacks',file,out:join(dir,'cases'),...options,limit:0});
    const manifest=json(join(dir,'cases/manifest.json'));assert.equal(manifest.counts.cases,2);assert.equal(manifest.counts.rowsWithoutSelectedContent,1);
    const db=join(dir,'index.sqlite');await buildRowIndex(db,[file]);const page=readRowPage(db,{offset:'1',limit:'1'});assert.equal(page.total,3);assert.equal(page.items.length,1);assert.equal(page.items[0].index,1);assert.ok(page.columns.some(c=>c.name==='prompt'));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('UI and server source checks reject behavior goals for jailbreak focus but preserve content-safety testing',()=>{
  const request:RunRequest={testPurpose:'jailbreak-detection',datasets:[{datasetId:'jailbreakbench'}],repeat:1,concurrency:2};
  assert.throws(()=>resolveDatasetSelections(request),/behavior goals/);
  assert.throws(()=>resolveDatasetSelections({...request,datasets:[{datasetId:'harmbench'}]}),/no supported jailbreak/);
  assert.throws(()=>resolveDatasetSelections({...request,datasets:[{datasetId:'jailbreakbench-attacks',phase:'output'}]}),/input prompts/);
  assert.equal(resolveDatasetSelections({...request,testPurpose:'endpoint-decisions'}).length,1);
  assert.equal(resolveDatasetSelections({...request,datasets:[{datasetId:'jailbreakbench-attacks'},{datasetId:'jailbreakbench',split:'benign'}]}).length,2);
  const entries=catalog(),cards=buildDatasetCards(entries,[]).map(c=>({...c,rawAvailable:true}));
  const draft={...initialTestingDraft(),testPurpose:'jailbreak-detection' as const,datasetIds:['jailbreakbench']};
  assert.throws(()=>testingSelections(draft,cards,entries),/behavior goals/);
  assert.equal(testingSelections({...draft,datasetIds:['jailbreakbench-attacks','jailbreakbench'],options:{jailbreakbench:{...defaultDatasetOptions(),sourceSpec:'1'}}},cards,entries)[1].split,'benign');
});

test('CLI/local collections are validated before sampling or traffic and purpose is frozen in promptfoo Reports',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'veritas-benchmark-run-')),mock=await startMock();
  try {
    const file=join(dir,'source.jsonl'),data=join(dir,'data'),target=join(dir,'target.json'),out=join(dir,'run');
    save(target,{adapter:'f5-scan',url:mock.f5Url});
    writeFileSync(file,[attack(),goal()].map(c=>JSON.stringify(c)).join('\n')+'\n');await importDataset({dataset:'veritas',file,out:data});
    assert.throws(()=>prepareRun({data,target,out,testPurpose:'jailbreak-detection',limit:1}),/behavior goals/);assert.equal(mock.requests.length,0);
    rmSync(data,{recursive:true});writeFileSync(file,[attack(),benign()].map(c=>JSON.stringify(c)).join('\n')+'\n');await importDataset({dataset:'veritas',file,out:data});
    const result=await runEvaluation({data,target,out,testPurpose:'jailbreak-detection',repeat:2,concurrency:2,evidence:'synthetic-local-demo'});
    assert.equal(result.exitCode,0);assert.equal(mock.requests.length,4);assert.equal(result.report.summary.accuracy,1);assert.equal(result.report.summary.precision,1);assert.equal(result.report.benchmark.counts['attack-prompt'],1);
    const snapshot=json(join(out,'snapshot.json'));assert.equal(snapshot.testPurpose,'jailbreak-detection');assert.equal(snapshot.engine.name,'promptfoo');
    assert.throws(()=>compatibleSnapshots(snapshot,{...snapshot,testPurpose:'endpoint-decisions'}),/test purposes/);
    assert.match(readFileSync(join(out,'results.csv'),'utf8'),/test_purpose/);assert.match(readFileSync(join(out,'report.md'),'utf8'),/not native-model/);
  } finally {await mock.close();rmSync(dir,{recursive:true,force:true});}
});

test('Historical Report interpretation is read-only, retains grades and exposes missing controls',()=>{
  const cases=[goal(),benign()],snapshot={cases},report={summary:{accuracy:.139,passed:100,failed:619},datasets:{},groups:{}};
  const before=JSON.stringify({snapshot,report});const derived=withClassification(report,snapshot,[]);
  assert.equal(derived.summary.accuracy,.139);assert.equal(derived.summary.passed,100);assert.equal(derived.benchmark.counts['behavior-goal'],1);assert.match(derived.benchmark.warnings[0],/cannot establish jailbreak-detector accuracy/);assert.equal(JSON.stringify({snapshot,report}),before);
  assert.ok(benchmarkScope({cases:[attack()]}).warnings.some(w=>w.includes('No allow controls')));
  assert.ok(benchmarkScope({cases}).warnings.some(w=>w.includes('JBB benign labels')));
  assert.ok(!benchmarkScope({cases,testPurpose:'jailbreak-detection'}).warnings.some(w=>w.includes('JBB benign labels')));
});

const entry=catalog().find(c=>c.id==='jailbreakbench-attacks')!;
const available=entry.files.every((f:any)=>existsSync(sourcePath(entry.id,f.path)));
test('Pinned attack archive has 18 real artifact scopes and 1,637 submitted prompts; fixtures and empty prompts are excluded',{skip:!available},async()=>{
  assert.equal(entry.files.length,18);let rows=0,cases=0;
  for(const f of entry.files){assert.ok(!f.path.includes('test-artifact'));for await(const r of loadRows(sourcePath(entry.id,f.path))){rows++;cases+=normalize(entry.id,r,{phase:'input',config:f.config,split:f.split}).length;}}
  assert.equal(rows,1800);assert.equal(cases,1637);
});

test('API freezes official attack prompts and benign controls, records all progress stages and rejects a wrong source without traffic',{skip:!available},async()=>{
  const mock=await startMock(),{app,store}=await buildServer({ui:false}),target=saveTarget({name:'benchmark-scope-test-'+Date.now(),target:{adapter:'f5-scan',url:mock.f5Url}}),headers={host:'localhost:38100'};
  let id='',input='';
  try {
    const invalid=await app.inject({method:'POST',url:'/api/runs',headers,payload:{testPurpose:'jailbreak-detection',datasets:[{datasetId:'jailbreakbench'}],targetId:target.id,repeat:1,concurrency:2}});assert.equal(invalid.statusCode,400);assert.equal(mock.requests.length,0);
    const result=await app.inject({method:'POST',url:'/api/runs',headers,payload:{testPurpose:'jailbreak-detection',datasets:[{datasetId:'jailbreakbench-attacks',config:options.config,split:'attacks'},{datasetId:'jailbreakbench',split:'benign'}],targetId:target.id,repeat:2,concurrency:2,limitPerDataset:2,sampling:{method:'stratified',seed:42},evidence:'synthetic-local-demo'}});
    assert.equal(result.statusCode,202,result.body);id=result.json().id;
    const end=Date.now()+30000;while(isActiveRun(store.detail(id).run.status)){if(Date.now()>end)throw new Error('Test timed out');await new Promise(r=>setTimeout(r,20));}
    const detail=store.detail(id),snapshot=json(join(store.directory(id),'snapshot.json'));assert.equal(snapshot.testPurpose,'jailbreak-detection');assert.equal(detail.report!.summary.recordedAttempts,8);assert.equal(mock.requests.length,8);
    assert.deepEqual(detail.run.stageHistory!.map(s=>s.stage),['preparing','running','scoring','reporting','finished']);assert.equal(detail.report!.benchmark.counts['attack-prompt'],2);assert.equal(detail.report!.benchmark.counts['benign-control'],2);
    for(const s of snapshot.manifest.sources)assert.ok(s.revision);
    const frozen=hash(readFileSync(join(store.directory(id),'snapshot.json')));store.detail(id);assert.equal(hash(readFileSync(join(store.directory(id),'snapshot.json'))),frozen);
    input=datasets().find(d=>d.id===detail.run.selectionId)?.path??'';
  } finally {
    await app.close();store.close();await mock.close();deleteTarget(target.id);
    if(id){const run=store.directory(id);const jobFile=join(root,'data/jobs',id+'.json');if(existsSync(jobFile)){const job=json(jobFile);input ||= job.inputPath??job.dataPath??'';}rmSync(run,{recursive:true,force:true});for(const folder of ['jobs','job-targets','job-requests'])rmSync(join(root,'data',folder,id+'.json'),{force:true});}
    if(input.startsWith(join(root,'data/evaluation-inputs/')))rmSync(input,{recursive:true,force:true});
  }
});
